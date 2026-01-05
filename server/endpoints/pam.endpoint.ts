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
                // Ensure array format
                let folioDetails = repairAndParseJson(extractedText);

                // If the model returned a single object instead of array (common in granular prompts), wrap it
                if (!Array.isArray(folioDetails)) {
                    // Sometimes it wraps in { items: ... } or just returns the object
                    if (folioDetails.items) folioDetails = [folioDetails];
                    else folioDetails = [folioDetails];
                }

                // Append
                allFolioData.push(...folioDetails);
                sendUpdate({ type: 'phase', name: 'extraction_success', folio: folioId });

            } catch (e) {
                console.error(`[PAM] Error parsing details for folio ${folioId}:`, extractedText);
                sendUpdate({ type: 'phase', name: 'extraction_error', folio: folioId, error: 'JSON malformed' });
                // We continue to next folio even if one fails
            }
        }

        // =================================================================================
        // FASE 3: CONSOLIDATION & VALIDATION
        // =================================================================================
        console.log('[PAM] Phase 3: Merging and Validating...');

        // Reuse existing validation logic
        // --- CONSOLIDACIÓN DE FOLIOS DUPLICADOS ---
        const mergedFoliosMap = new Map<string, any>();

        (allFolioData || []).forEach(item => {
            if (!item) return;
            const id = item.folioPAM;
            if (!id) return;

            if (mergedFoliosMap.has(id)) {
                const existing = mergedFoliosMap.get(id);
                // Combinar desgloses de forma segura
                const existingDesglose = existing.desglosePorPrestador || [];
                const newDesglose = item.desglosePorPrestador || [];

                existing.desglosePorPrestador = [...existingDesglose, ...newDesglose];
            } else {
                // Inicializar si no existe array
                if (!item.desglosePorPrestador) item.desglosePorPrestador = [];
                mergedFoliosMap.set(id, { ...item });
            }
        });

        const pamData = Array.from(mergedFoliosMap.values());

        // --- VALIDACIÓN ARITMÉTICA GLOBAL (Reused Logic) ---
        let globalValor = 0;
        let globalBonif = 0;
        let globalCopago = 0;
        let globalDeclarado = 0;
        let globalTotalItems = 0;

        const parseMoney = (val: string | number) => {
            if (!val) return 0;
            if (typeof val === 'number') return val;
            return parseInt(val.replace(/[^\d]/g, '')) || 0;
        };

        const validatedFolios = pamData.map(folio => {
            let calcTotalValor = 0;
            let calcTotalBonif = 0;
            let calcTotalCopago = 0;

            folio.desglosePorPrestador = (folio.desglosePorPrestador || []).map((prestador: any) => {
                let pValor = 0, pBonif = 0, pCopago = 0;

                prestador.items = (prestador.items || []).map((item: any) => {
                    const vt = parseMoney(item.valorTotal);
                    const bn = parseMoney(item.bonificacion);
                    const cp = parseMoney(item.copago);

                    pValor += vt;
                    pBonif += bn;
                    pCopago += cp;

                    const expected = vt - bn;
                    const itemAudit = Math.abs(expected - cp) > 10 ? '❌ ERROR' : '✅ OK';
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

            const declaredCopago = parseMoney(folio.resumen?.totalCopagoDeclarado || "");
            const diff = Math.abs(calcTotalCopago - declaredCopago);

            // Si cuadra con un margen de 50 pesos
            const isCorrect = diff <= 50;
            const auditStatus = isCorrect
                ? '✅ Totales cuadran'
                : `⚠️ Diferencia detectada: Suma Calc $${calcTotalCopago.toLocaleString()} vs Declarado $${declaredCopago.toLocaleString()}`;

            // Acumular globales
            globalValor += calcTotalValor;
            globalBonif += calcTotalBonif;
            globalCopago += calcTotalCopago;
            globalDeclarado += declaredCopago;

            // Sumar items de este folio
            const folioItemsCount = folio.desglosePorPrestador?.reduce((acc: number, p: any) => acc + (p.items?.length || 0), 0) || 0;
            globalTotalItems += folioItemsCount;

            return {
                ...folio,
                resumen: {
                    ...(folio.resumen || {}),
                    totalCopagoCalculado: calcTotalCopago,
                    auditoriaStatus: auditStatus,
                    cuadra: isCorrect
                }
            };
        });

        const globalDiff = Math.abs(globalCopago - globalDeclarado);
        const globalAuditStatus = globalDiff > 50
            ? `❌ La cuenta consolidada NO CUADRA por $${globalDiff.toLocaleString()}`
            : `✅ TODO CUADRA: Total consolidado $${globalCopago.toLocaleString()}`;

        // Enviar resultado final estructurado
        sendUpdate({
            type: 'final',
            data: {
                folios: validatedFolios,
                global: {
                    totalValor: globalValor,
                    totalBonif: globalBonif,
                    totalCopago: globalCopago,
                    totalCopagoDeclarado: globalDeclarado,
                    cuadra: globalDiff <= 50,
                    discrepancia: globalDiff,
                    auditoriaStatus: globalAuditStatus,
                    totalItems: globalTotalItems
                }
            }
        });

        res.end();

    } catch (error: any) {
        console.error('[PAM] Error en endpoint PAM:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}
