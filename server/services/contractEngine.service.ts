import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import {
    ContractAnalysisResult,
    ContractAnalysisOptions,
    UploadedFile
} from './contractTypes.js';
import { jsonrepair } from 'jsonrepair';
import { getCanonicalCategory } from './contractCanonical.js';
import {
    PROMPT_REGLAS_P1,
    PROMPT_REGLAS_P2,
    PROMPT_HOSP_P1,
    PROMPT_HOSP_P2,
    PROMPT_AMB_P1,
    PROMPT_AMB_P2,
    PROMPT_AMB_P3,
    PROMPT_AMB_P4,
    PROMPT_EXTRAS,
    PROMPT_ANEXOS_P1,
    PROMPT_ANEXOS_P2,
    PROMPT_CLASSIFIER,
    SCHEMA_REGLAS,
    SCHEMA_COBERTURAS,
    SCHEMA_CLASSIFIER,
    CONTRACT_OCR_MAX_PAGES,
    CONTRACT_FAST_MODEL,
    CONTRACT_REASONING_MODEL,
    CONTRACT_FALLBACK_MODEL,
    CONTRACT_DEFAULT_RETRIES,
    CONTRACT_MAX_OUTPUT_TOKENS,
    CONTRACT_TEMPERATURE,
    CONTRACT_TOP_P,
    CONTRACT_TOP_K
} from './contractConstants.js';
import { AI_CONFIG, calculatePrice } from '../config/ai.config.js';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fileToGenerativePart(file: UploadedFile) {
    return {
        inlineData: {
            data: file.buffer.toString('base64'),
            mimeType: file.mimetype,
        },
    };
}

function safeJsonParse<T>(text: string): T {
    const cleaned = text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (error: any) {
        // console.error('[ContractEngine] JSON parse error, trying jsonrepair:', error.message);
        try {
            const repaired = jsonrepair(cleaned);
            return JSON.parse(repaired);
        } catch (repairError: any) {
            // console.error('[ContractEngine] jsonrepair failed:', repairError.message);
            // Return null to signal failure
            return null as any;
        }
    }
}

async function extractTextFromPdf(file: UploadedFile, maxPages: number, log: (msg: string) => void): Promise<{ text: string, totalPages: number }> {
    try {
        log(`[ContractEngine] 🔍 Escaneando PDF: ${file.originalname}...`);
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

        // Resolve absolute path to standard fonts
        const fontPathRaw = path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts');
        // Convert to absolute path with forward slashes and a TRAILING SLASH
        const fontPath = fontPathRaw.replace(/\\/g, '/') + '/';
        const standardFontDataUrl = fontPath;

        log(`[ContractEngine] 📄 Cargando fuentes: ${standardFontDataUrl}`);

        const data = new Uint8Array(file.buffer);
        const loadingTask = pdfjsLib.getDocument({
            data,
            disableFontFace: true,
            standardFontDataUrl
        });
        const pdf = await loadingTask.promise;

        const pagesToScan = Math.min(pdf.numPages, Number.isFinite(maxPages) ? maxPages : pdf.numPages);
        log(`[ContractEngine] 📗 PDF cargado (${pdf.numPages} págs). Procesando ${pagesToScan}.`);

        let formattedText = '';

        for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
            log(`[ContractEngine] 📄 OCR Página ${pageNumber}/${pagesToScan}...`);

            const pagePromise = pdf.getPage(pageNumber).then(async (page) => {
                const textContent = await page.getTextContent();
                return (textContent?.items || [])
                    .map((item: any) => item?.str || '')
                    .join('\n')
                    .replace(/\s+/g, ' ')
                    .trim();
            });

            const pageText = await Promise.race([
                pagePromise,
                new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout de lectura')), 25000))
            ]).catch(err => {
                log(`[ContractEngine] ⚠️ Error pág ${pageNumber}: ${err.message}`);
                return '';
            });

            if (pageText) {
                formattedText += `\n--- PÁGINA ${pageNumber} ---\n${pageText}\n`;
            }
        }

        return { text: formattedText.trim(), totalPages: pdf.numPages };
    } catch (error) {
        log(`[ContractEngine] ❌ Error en OCR: ${error instanceof Error ? error.message : 'Error fatal'}`);
        return { text: '', totalPages: 0 };
    }
}

async function repairJsonWithGemini(
    genAI: GoogleGenerativeAI,
    schema: any,
    invalidText: string,
    log: (msg: string) => void
): Promise<string> {
    log('[ContractEngine] 🔧 Solicitando reparación estructural Pro...');
    const repairPrompt = `JSON INVÁLIDO:\n${invalidText}\n\nDevuelve SOLO el JSON corregido:`;
    try {
        const model = genAI.getGenerativeModel({ model: CONTRACT_FAST_MODEL });
        const result = await model.generateContent(repairPrompt);
        return result.response.text() || invalidText;
    } catch (error) {
        log(`[ContractEngine] ⚠️ Reparación fallida.`);
        return invalidText;
    }
}

// ============================================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================================

// ============================================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================================

// Define Safety Settings locally to ensure they are available
const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];


export async function analyzeSingleContract(
    file: UploadedFile,
    apiKey: string,
    onLog?: (msg: string) => void,
    options: ContractAnalysisOptions = {}
): Promise<ContractAnalysisResult> {
    const startTime = Date.now();
    const { maxOutputTokens = 40000 } = options;

    const log = (m: string) => {
        console.log(m);
        onLog?.(m);
    };

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`[ContractEngine v1.13.1] 🛡️ 12-PHASE TOTAL EXTRACTION (v11.3)`);
    log(`[ContractEngine] 📄 Modelo: ${AI_CONFIG.ACTIVE_MODEL}`);
    log(`[ContractEngine] 📄 Doc: ${file.originalname}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Convert Buffer to Base64
    const base64Data = file.buffer.toString('base64');
    const mimeType = file.mimetype;

    // Helper for Extraction Call
    async function extractSection(name: string, prompt: string, schema: any): Promise<any> {
        log(`\n[ContractEngine] 🚀 Iniciando FASE: ${name.toUpperCase()}...`);
        const geminiService = new GeminiService(apiKey);

        let result = null;
        let tokensInput = 0;
        let tokensOutput = 0;
        let cost = 0;
        let streamText = "";

        const allKeys = [apiKey, process.env.GEMINI_API_KEY, process.env.API_KEY, process.env.GEMINI_API_KEY_SECONDARY]
            .filter(k => !!k && k.length > 5);

        // Simple Retry Logic for Keys (Simplified from v6 for brevity but same robustness)
        // Note: Using GeminiService's internal rotation would be better but let's stick to simple direct call loop here
        // actually GeminiService.extractWithStream is what we want? No, we custom built it here.
        // Let's reuse the custom logic from before but adapted.

        let activeKeyIndex = 0;
        // ... Logic to get model ...

        // Let's use standard loop
        for (const currentKey of [...new Set(allKeys)]) {
            try {
                const genAI = new GoogleGenerativeAI(currentKey);
                const model = genAI.getGenerativeModel({
                    model: AI_CONFIG.ACTIVE_MODEL,
                    generationConfig: {
                        maxOutputTokens: CONTRACT_MAX_OUTPUT_TOKENS,
                        responseMimeType: "application/json",
                        responseSchema: schema,
                        temperature: CONTRACT_TEMPERATURE,
                        topP: CONTRACT_TOP_P,
                        topK: CONTRACT_TOP_K
                    },
                    safetySettings: SAFETY_SETTINGS
                });

                const stream = await model.generateContentStream([
                    { text: prompt },
                    { inlineData: { data: base64Data, mimeType: mimeType } }
                ]);

                for await (const chunk of stream.stream) {
                    const txt = chunk.text();
                    streamText += txt;
                    onLog?.(`[${name}] ${txt}`); // Tagged Stream to UI
                    if (chunk.usageMetadata) {
                        tokensInput = chunk.usageMetadata.promptTokenCount;
                        tokensOutput = chunk.usageMetadata.candidatesTokenCount;
                        const p = calculatePrice(tokensInput, tokensOutput);
                        cost = p.costCLP;
                    }
                }
                // Final Metrics log for the phase (after stream ends)
                log(`@@METRICS@@${JSON.stringify({ phase: name, input: tokensInput, output: tokensOutput, cost: cost })}`);
                result = safeJsonParse(streamText);
                break; // Success
            } catch (err: any) {
                log(`[${name}] ⚠️ Error con llave ${currentKey.substring(0, 4)}...: ${err.message}`);
            }
        }

        if (!result) log(`[${name}] ❌ FALLO CRÍTICO: No se pudo extraer.`);
        return { result, metrics: { tokensInput, tokensOutput, cost } };
    }

    // --- EXECUTE PHASES IN PARALLEL (v10.0 Modular Rule Engine) ---
    log(`\n[ContractEngine] ⚡ Ejecutando 12 fases en paralelo para cobertura 100%...`);

    const phasePromises = [
        extractSection("CLASSIFIER", PROMPT_CLASSIFIER, SCHEMA_CLASSIFIER),
        extractSection("REGLAS_P1", PROMPT_REGLAS_P1, SCHEMA_REGLAS), // PHASE 2
        extractSection("REGLAS_P2", PROMPT_REGLAS_P2, SCHEMA_REGLAS), // PHASE 3
        extractSection("ANEXOS_P1", PROMPT_ANEXOS_P1, SCHEMA_REGLAS), // PHASE 4
        extractSection("ANEXOS_P2", PROMPT_ANEXOS_P2, SCHEMA_REGLAS), // PHASE 5
        extractSection("HOSP_P1", PROMPT_HOSP_P1, SCHEMA_COBERTURAS),
        extractSection("HOSP_P2", PROMPT_HOSP_P2, SCHEMA_COBERTURAS),
        extractSection("AMB_P1", PROMPT_AMB_P1, SCHEMA_COBERTURAS),
        extractSection("AMB_P2", PROMPT_AMB_P2, SCHEMA_COBERTURAS),
        extractSection("AMB_P3", PROMPT_AMB_P3, SCHEMA_COBERTURAS),
        extractSection("AMB_P4", PROMPT_AMB_P4, SCHEMA_COBERTURAS),
        extractSection("EXTRAS", PROMPT_EXTRAS, SCHEMA_COBERTURAS)
    ];

    const [
        fingerprintPhase,
        reglasP1Phase,
        reglasP2Phase,
        anexosP1Phase,
        anexosP2Phase,
        hospP1Phase,
        hospP2Phase,
        ambP1Phase,
        ambP2Phase,
        ambP3Phase,
        ambP4Phase,
        extrasPhase
    ] = await Promise.all(phasePromises);

    log(`\n[ContractEngine] ✅ 12 Fases Modulares Completadas.`);

    if (fingerprintPhase.result) {
        log(`\n[ContractEngine] 📍 Huella Digital:`);
        log(`   Tipo: ${fingerprintPhase.result.tipo_contrato}`);
        log(`   Confianza: ${fingerprintPhase.result.confianza}%`);
    }

    // --- MERGE ---
    const rawReglas = [
        ...(reglasP1Phase.result?.reglas || []),
        ...(reglasP2Phase.result?.reglas || []),
        ...(anexosP1Phase.result?.reglas || []),
        ...(anexosP2Phase.result?.reglas || [])
    ];

    const reglas = rawReglas.map((r: any) => ({
        ...r,
        categoria_canonica: getCanonicalCategory(
            (r['CÓDIGO/SECCIÓN'] || r['seccion'] || '') + ' ' + (r['VALOR EXTRACTO LITERAL DETALLADO'] || r['texto'] || ''),
            r['SUBCATEGORÍA'] || r['categoria'] || ''
        )
    }));

    // Combine coverage from all modular prompts
    const coberturasHospRaw = [
        ...(hospP1Phase.result?.coberturas || []),
        ...(hospP2Phase.result?.coberturas || [])
    ];
    const coberturasAmbRaw = [
        ...(ambP1Phase.result?.coberturas || []),
        ...(ambP2Phase.result?.coberturas || []),
        ...(ambP3Phase.result?.coberturas || []),
        ...(ambP4Phase.result?.coberturas || [])
    ];
    const coberturasExtrasRaw = extrasPhase.result?.coberturas || [];

    // ============================================================================
    // POST-PROCESSING FILTER v10.4: Quality Control & Forensic Isolation
    // ============================================================================
    const MAX_HOSP_ITEMS = 56;
    const MAX_AMB_ITEMS = 70;

    // Independent slicing
    const hospSliced = coberturasHospRaw.slice(0, MAX_HOSP_ITEMS);
    const ambSliced = coberturasAmbRaw.slice(0, MAX_AMB_ITEMS);

    const cleanAndCheck = (list: any[]) => list.map((cob: any) => {
        let cleaned = { ...cob };

        // --- PHASE 2: CANONICAL NORMALIZATION (v9.0) ---
        cleaned.categoria_canonica = getCanonicalCategory(
            cleaned.item || cleaned.prestacion || cleaned['PRESTACIÓN CLAVE'] || '',
            cleaned.categoria || ''
        );

        if (!cleaned.nota_restriccion || cleaned.nota_restriccion === null) {
            cleaned.nota_restriccion = "Sin restricciones adicionales especificadas. Sujeto a condiciones generales del plan.";
        }

        // Sanity Check: Truncate repeating hallucinations (>2000 chars)
        const SANITY_LIMIT = 2000;
        ['item', 'tope', 'nota_restriccion', 'LOGICA_DE_CALCULO'].forEach(key => {
            if (cleaned[key] && typeof cleaned[key] === 'string' && cleaned[key].length > SANITY_LIMIT) {
                log(`[SYSTEM] 🚨 HALLUCINATION detected in ${cleaned.item} (${key}). Truncating...`);
                cleaned[key] = cleaned[key].substring(0, 500) + "... [Truncado]";
            }
        });
        return cleaned;
    });

    const hospClean = cleanAndCheck(hospSliced);
    const ambClean = cleanAndCheck(ambSliced);

    // Filter redundant grid items from Extras
    const GRID_CATEGORIES = ["Día Cama", "Pabellón", "Honorarios", "Medicamentos", "Insumos", "Anestesia"];
    const filteredExtras = coberturasExtrasRaw.filter((ext: any) => {
        const name = (ext.item || "").toLowerCase();
        return !GRID_CATEGORIES.some(cat => name === cat.toLowerCase() || name.includes(cat.toLowerCase() + " ("));
    });
    const extrasClean = cleanAndCheck(filteredExtras);

    let coberturas = [...hospClean, ...ambClean, ...extrasClean];

    log(`🔧 POST-PROCESSING: Hosp: ${hospClean.length}, Amb: ${ambClean.length}, Extras: ${extrasClean.length}`);
    log(`✅ Final total: ${coberturas.length} items.`);


    // --- IDENTIFICATION BACKUP (v8.0) ---
    const detectedIsapre = fingerprintPhase.result?.observaciones?.find(o => o.toLowerCase().includes('isapre'))?.split('isapre')?.[1]?.trim() || "Unknown";
    const detectedPlan = fingerprintPhase.result?.observaciones?.find(o => o.toLowerCase().includes('plan'))?.split('plan')?.[1]?.trim() || "Unknown";

    const diseno_ux = reglasP1Phase.result?.diseno_ux || reglasP2Phase.result?.diseno_ux || hospP1Phase.result?.diseno_ux || ambP1Phase.result?.diseno_ux || extrasPhase.result?.diseno_ux || {
        nombre_isapre: detectedIsapre !== "Unknown" ? detectedIsapre : "Unknown",
        titulo_plan: detectedPlan !== "Unknown" ? detectedPlan : "Unknown",
        layout: "failed_extraction",
        funcionalidad: "multi_pass_v4_universal",
        salida_json: "merged"
    };

    // Simple fallback if everything is unknown but fingerprint has info
    if (diseno_ux.nombre_isapre === "Unknown" && fingerprintPhase.result?.tipo_contrato) {
        diseno_ux.nombre_isapre = fingerprintPhase.result.tipo_contrato.split('_')[0];
    }

    // --- TOTAL METRICS ---
    const allPhases = [
        fingerprintPhase, reglasP1Phase, reglasP2Phase,
        anexosP1Phase, anexosP2Phase,
        hospP1Phase, hospP2Phase,
        ambP1Phase, ambP2Phase, ambP3Phase, ambP4Phase,
        extrasPhase
    ];
    const totalInput = allPhases.reduce((acc, p) => acc + (p.metrics?.tokensInput || 0), 0);
    const totalOutput = allPhases.reduce((acc, p) => acc + (p.metrics?.tokensOutput || 0), 0);
    const totalCost = allPhases.reduce((acc, p) => acc + (p.metrics?.cost || 0), 0);

    const result: ContractAnalysisResult = {
        fingerprint: fingerprintPhase.result || undefined,
        reglas,
        coberturas,
        diseno_ux,
        metrics: {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: totalInput,
                output: totalOutput,
                total: totalInput + totalOutput,
                costClp: totalCost,
                phases: [
                    { phase: "Clasificación", ...getMetrics(fingerprintPhase) },
                    { phase: "Reglas_P1", ...getMetrics(reglasP1Phase) },
                    { phase: "Reglas_P2", ...getMetrics(reglasP2Phase) },
                    { phase: "Anexos_P1", ...getMetrics(anexosP1Phase) },
                    { phase: "Anexos_P2", ...getMetrics(anexosP2Phase) },
                    { phase: "Hosp_P1", ...getMetrics(hospP1Phase) },
                    { phase: "Hosp_P2", ...getMetrics(hospP2Phase) },
                    { phase: "Amb_P1", ...getMetrics(ambP1Phase) },
                    { phase: "Amb_P2", ...getMetrics(ambP2Phase) },
                    { phase: "Amb_P3", ...getMetrics(ambP3Phase) },
                    { phase: "Amb_P4", ...getMetrics(ambP4Phase) },
                    { phase: "Extras", ...getMetrics(extrasPhase) }
                ]
            },
            extractionBreakdown: {
                totalReglas: reglas.length,
                totalCoberturas: coberturas.length,
                totalItems: reglas.length + coberturas.length
            }
        }
    };

    function getMetrics(p: any) {
        return {
            totalTokens: (p.metrics?.tokensInput || 0) + (p.metrics?.tokensOutput || 0),
            promptTokens: p.metrics?.tokensInput || 0,
            candidatesTokens: p.metrics?.tokensOutput || 0,
            estimatedCostCLP: p.metrics?.cost || 0
        };
    }

    return result;
}
