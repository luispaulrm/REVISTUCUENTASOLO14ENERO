import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { PAM_PROMPT, PAM_ANALYSIS_SCHEMA, PAM_DISCOVERY_PROMPT, PAM_DISCOVERY_SCHEMA, PAM_DETAILS_PROMPT } from '../prompts/pam.prompt.js';
import { AI_CONFIG, GENERATION_CONFIG } from '../config/ai.config.js';
import { repairAndParseJson } from '../utils/jsonRepair.js';

// Helper para obtener env vars (reutilizado del server.ts)
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handlePamExtraction(req: Request, res: Response) {
    console.log('[PAM] New PAM extraction request (Multi-Pass Architecture)');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType } = req.body;

        if (!image || !mimeType) {
            console.error('[PAM] Missing payload');
            return res.status(400).json({ error: 'Missing image data or mimeType' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) {
            console.error('[PAM] No API Key');
            return res.status(500).json({ error: 'API Key not configured' });
        }

        const gemini = new GeminiService(apiKey);

        // =================================================================================
        // FASE 1: DISCOVERY (Model-Agnostic, usually fast)
        // =================================================================================
        console.log('[PAM] Phase 1: Discovery started...');
        sendUpdate({ type: 'phase', name: 'discovery', message: '🔍 Analizando documento en busca de folios...' });

        // IMPORTANT: Discovery Phase works best with a stricter schema to get just the list
        const discoveryResultText = await gemini.extract(image, mimeType, PAM_DISCOVERY_PROMPT, {
            responseMimeType: 'application/json',
            responseSchema: PAM_DISCOVERY_SCHEMA,
            maxTokens: 4096, // Enough for a list
            temperature: 0,
            topP: 0.1
        });

        let discoveryData: any = {};
        try {
            discoveryData = repairAndParseJson(discoveryResultText);
        } catch (e) {
            console.error('[PAM] Discovery breakdown:', discoveryResultText);
            throw new Error("No se pudieron identificar los folios del documento.");
        }

        let foliosFound = discoveryData.folios || [];

        // FILTER: Remove noise (e.g. "244-", empty strings, or very short fragments)
        foliosFound = foliosFound.filter((f: any) => {
            const id = f.folioPAM || "";
            return id.length > 5 && !id.endsWith('-');
        });

        console.log(`[PAM] Discovery complete. Found ${foliosFound.length} valid folios:`, foliosFound.map((f: any) => f.folioPAM));
        sendUpdate({ type: 'phase', name: 'discovery_complete', count: foliosFound.length, folios: foliosFound });

        if (foliosFound.length === 0) {
            throw new Error("No se encontraron folios PAM válidos en el documento.");
        }

        // =================================================================================
        // FASE 2: EXTRACTION LOOP (Per Folio)
        // =================================================================================
        const allFolioData: any[] = [];

        for (let i = 0; i < foliosFound.length; i++) {
            const folioObj = foliosFound[i];
            const folioId = folioObj.folioPAM;
            console.log(`[PAM] Phase 2: Extracting details for Folio ${folioId} (${i + 1}/${foliosFound.length})...`);

            sendUpdate({
                type: 'phase',
                name: 'extraction_start',
                folio: folioId,
                current: i + 1,
                total: foliosFound.length
            });

            // Inject Target Folio into Prompt
            const effectivePrompt = PAM_DETAILS_PROMPT.replace(/{{TARGET_FOLIO}}/g, folioId);

            // CALL GENERATIVE AI (No Stream for individual chunks to avoid valid JSON stream complexity, or stream to console only)
            // Actually, we can stream the text to the UI for "liveness" effect if we want, but keeping it simple for now.
            // Using 30k tokens for the detailed extraction
            const extractedText = await gemini.extract(image, mimeType, effectivePrompt, {
                responseMimeType: 'application/json',
                // schema: undefined, // LOOSE MODE
                maxTokens: 30000,
                temperature: 0,
                topP: 0.1
            });

            try {
                console.log(`[PAM DEBUG] Parsing extracted text (length: ${extractedText.length})...`);

                // Ensure array format
                let folioDetails = repairAndParseJson(extractedText);
                console.log(`[PAM DEBUG] Parsed details. Items: ${Array.isArray(folioDetails) ? folioDetails.length : 'Object'}`);

                // If the model returned a single object instead of array (common in granular prompts), wrap it
                if (!Array.isArray(folioDetails)) {
                    // Sometimes it wraps in { items: ... } or just returns the object
                    if (folioDetails.items) folioDetails = [folioDetails];
                    else folioDetails = [folioDetails];
                }

                console.log(`[PAM DEBUG] Pushing ${folioDetails.length} items to allFolioData...`);
                // Append
                allFolioData.push(...folioDetails);
                console.log(`[PAM DEBUG] Push success. Total items so far: ${allFolioData.length}`);

                sendUpdate({ type: 'phase', name: 'extraction_success', folio: folioId });

            } catch (e) {
                console.error(`[PAM] Error parsing details for folio ${folioId}:`, extractedText.substring(0, 100) + '...');
                console.error(e);
                sendUpdate({ type: 'phase', name: 'extraction_error', folio: folioId, error: 'JSON malformed' });
                // We continue to next folio even if one fails
            }
        }

        // =================================================================================
        // =================================================================================
        // FASE 3: CONSOLIDATION & VALIDATION
        // =================================================================================
        console.log('[PAM] Phase 3: Merging and Validating...');

        try {
            console.log('[PAM DEBUG] Starting Merge Process...');
            // --- CONSOLIDACIÓN DE FOLIOS DUPLICADOS ---
            const mergedFoliosMap = new Map<string, any>();
            const inputData = allFolioData || [];
            console.log(`[PAM DEBUG] Input items to merge: ${inputData.length}`);

            inputData.forEach((item, idx) => {
                if (!item) {
                    console.log(`[PAM DEBUG] Item ${idx} is null/undefined, skipping.`);
                    return;
                }
                const id = item.folioPAM;
                if (!id) {
                    console.log(`[PAM DEBUG] Item ${idx} has no folioPAM, skipping.`);
                    return;
                }

                if (mergedFoliosMap.has(id)) {
                    // console.log(`[PAM DEBUG] Merging duplicate folio: ${id}`);
                    const existing = mergedFoliosMap.get(id);

                    // Combinar desgloses de forma segura
                    let existingDesglose = existing.desglosePorPrestador;
                    if (!existingDesglose) existingDesglose = [];
                    if (!Array.isArray(existingDesglose)) existingDesglose = [existingDesglose];

                    let newDesglose = item.desglosePorPrestador;
                    if (!newDesglose) newDesglose = [];
                    if (!Array.isArray(newDesglose)) newDesglose = [newDesglose];

                    existing.desglosePorPrestador = [...existingDesglose, ...newDesglose];
                } else {
                    // Inicializar
                    // console.log(`[PAM DEBUG] New folio entry: ${id}`);
                    if (!item.desglosePorPrestador) {
                        item.desglosePorPrestador = [];
                    } else if (!Array.isArray(item.desglosePorPrestador)) {
                        item.desglosePorPrestador = [item.desglosePorPrestador];
                    }
                    mergedFoliosMap.set(id, { ...item });
                }
            });

            const pamData = Array.from(mergedFoliosMap.values());
            console.log(`[PAM DEBUG] Merge complete. Unique folios: ${pamData.length}`);

            // --- VALIDACIÓN ARITMÉTICA GLOBAL ---
            let globalValor = 0;
            let globalBonif = 0;
            let globalCopago = 0;
            let globalDeclarado = 0;
            let globalTotalItems = 0;

            const parseMoney = (val: any) => {
                if (!val) return 0;
                if (typeof val === 'number') return val;
                if (typeof val === 'string') return parseInt(val.replace(/[^\d]/g, '')) || 0;
                return 0;
            };

            console.log('[PAM DEBUG] Starting Validation Loop...');
            const validatedFolios = pamData.map((folio, fIdx) => {
                const folioId = folio.folioPAM || `UNKNOWN_${fIdx}`;
                console.log(`[PAM DEBUG] Validating folio ${fIdx + 1}/${pamData.length}: ${folioId}`);

                let calcTotalValor = 0;
                let calcTotalBonif = 0;
                let calcTotalCopago = 0;

                // Ensure desglose is array (already done in merge, but double check)
                let desgloses = folio.desglosePorPrestador;
                if (!Array.isArray(desgloses)) desgloses = [];

                folio.desglosePorPrestador = desgloses.map((prestador: any, pIdx: number) => {
                    if (!prestador) return {};

                    let pValor = 0, pBonif = 0, pCopago = 0;

                    let items = prestador.items;
                    if (!items) items = [];
                    if (!Array.isArray(items)) items = [items];

                    prestador.items = items.map((item: any) => {
                        const vt = parseMoney(item.valorTotal);
                        const bn = parseMoney(item.bonificacion);
                        const cp = parseMoney(item.copago);

                        pValor += vt;
                        pBonif += bn;
                        pCopago += cp;

                        const expected = vt - bn;
                        const itemAudit = Math.abs(expected - cp) > 10 ? '❌ ERROR' : '✅ OK';

                        globalTotalItems++;
                        return { ...item, _audit: itemAudit };
                    });

                    calcTotalValor += pValor;
                    calcTotalBonif += pBonif;
                    calcTotalCopago += pCopago;

                    return {
                        ...prestador,
                        _totals: { valor: pValor, bonif: pBonif, copago: pCopago }
                    };
                });

                // Update Globals
                globalValor += calcTotalValor;
                globalBonif += calcTotalBonif;
                globalCopago += calcTotalCopago;

                const decl = parseMoney(folio.resumen?.totalCopagoDeclarado || folio.resumen?.totalCopago);
                globalDeclarado += decl;

                const diff = Math.abs(calcTotalCopago - decl);
                const isCorrect = diff <= 100;

                return {
                    ...folio,
                    resumen: {
                        ...(folio.resumen || {}),
                        totalCopagoCalculado: calcTotalCopago,
                        auditoriaStatus: isCorrect ? '✅ Cuadra' : '⚠️ Discrepancia',
                        cuadra: isCorrect
                    }
                };
            });

            console.log('[PAM DEBUG] Validation complete. Preparing final response...');

            const globalDiff = Math.abs(globalCopago - globalDeclarado);
            const finalResult: PamDocument = {
                folios: validatedFolios,
                global: {
                    totalValor: globalValor,
                    totalBonif: globalBonif,
                    totalCopago: globalCopago,
                    totalCopagoDeclarado: globalDeclarado,
                    cuadra: globalDiff <= 500,
                    discrepancia: globalCopago - globalDeclarado,
                    auditoriaStatus: 'COMPLETED',
                    totalItems: globalTotalItems
                }
            };

            console.log('[PAM] Sending Final Success Response.');
            sendUpdate({ type: 'final', data: finalResult });
            res.end();

        } catch (phase3Error: any) {
            console.error('[PAM CRASH] Critical Error in Phase 3:', phase3Error);
            sendUpdate({ type: 'error', message: `CRASH en consolidación: ${phase3Error.message}` });
            res.end();
        }

    } catch (error: any) {
        console.error('[PAM] Error en endpoint PAM:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}
