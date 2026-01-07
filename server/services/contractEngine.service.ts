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
import { retryWithBackoff } from '../utils/retryWithBackoff.js';
import { detectRepetition, truncateAtRepetition } from '../utils/repetitionDetector.js';
import { safeStreamParse, balanceJson } from '../utils/streamErrorHandler.js';
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
        log(`[ContractEngine] 🔍 Escaneando PDF con Reconstructor Geométrico (v10.5)...`);
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

        const fontPathRaw = path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts');
        const fontPath = fontPathRaw.replace(/\\/g, '/') + '/';
        const standardFontDataUrl = fontPath;

        const data = new Uint8Array(file.buffer);
        const loadingTask = pdfjsLib.getDocument({
            data,
            disableFontFace: true,
            standardFontDataUrl
        });
        const pdf = await loadingTask.promise;

        const pagesToScan = Math.min(pdf.numPages, Number.isFinite(maxPages) ? maxPages : pdf.numPages);
        log(`[ContractEngine] 📗 PDF cargado (${pdf.numPages} págs). Procesando ${pagesToScan} manteniendo layout.`);

        let formattedText = '';

        for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
            // log(`[ContractEngine] 📄 OCR Pág ${pageNumber}...`);

            const pagePromise = pdf.getPage(pageNumber).then(async (page) => {
                const textContent = await page.getTextContent();
                const items: any[] = textContent.items || [];

                // --- GEOMETRIC LAYOUT RECONSTRUCTION ---
                // 1. Group items by Y-coordinate (Row detection) with tolerance
                const Y_TOLERANCE = 4.0;
                const lines: { y: number, items: any[] }[] = [];

                for (const item of items) {
                    if (!item.transform || item.transform.length < 6) continue;
                    const y = item.transform[5]; // PDF Y-coordinate (0 at bottom)

                    // Find existing line bucket
                    const line = lines.find(l => Math.abs(l.y - y) < Y_TOLERANCE);
                    if (line) {
                        line.items.push(item);
                    } else {
                        lines.push({ y, items: [item] });
                    }
                }

                // 2. Sort Lines Top-to-Bottom (Descending Y)
                lines.sort((a, b) => b.y - a.y);

                // 3. Sort Items Left-to-Right (Ascending X) and Join
                const pageLines = lines.map(line => {
                    line.items.sort((a, b) => (a.transform[4] - b.transform[4])); // Sort by X

                    // Intelligent spacing based on X-gap (Optional enhancement for columns)
                    // For now, simple space joining is vastly better than linear soup
                    return line.items.map(i => i.str).join(' ');
                });

                return pageLines.join('\n');
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

    // Helper for Extraction Call with Robustness Features
    async function extractSection(name: string, prompt: string, schema: any): Promise<any> {
        log(`\n[ContractEngine] 🚀 Iniciando FASE: ${name.toUpperCase()}...`);
        const geminiService = new GeminiService(apiKey);

        const allKeys = [apiKey, process.env.GEMINI_API_KEY, process.env.API_KEY, process.env.GEMINI_API_KEY_SECONDARY]
            .filter(k => !!k && k.length > 5);

        let finalResult = null;
        let finalMetrics = { tokensInput: 0, tokensOutput: 0, cost: 0 };

        // Multi-Model Fallback: Contract-specific configuration
        // Primary: gemini-2.5-flash | Fallback: gemini-3-flash-preview
        const modelsToTry = ['gemini-2.5-flash', 'gemini-3-flash-preview'];

        // Retry with exponential backoff for 503 errors
        const attemptExtraction = async (currentKey: string, modelName: string): Promise<any> => {
            return retryWithBackoff(
                async () => {
                    const genAI = new GoogleGenerativeAI(currentKey);
                    const model = genAI.getGenerativeModel({
                        model: modelName,
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

                    // Safe stream parsing with error recovery
                    const streamResult = await safeStreamParse(stream.stream, {
                        onChunk: (text) => onLog?.(`[${name}] ${text}`),
                        onError: (err) => log(`[${name}] ⚠️ Stream chunk error: ${err.message}`),
                        maxChunks: 10000
                    });

                    let streamText = streamResult.text;

                    // Check for token usage in the stream
                    let tokensInput = 0;
                    let tokensOutput = 0;
                    try {
                        const finalChunk = await stream.response;
                        if (finalChunk.usageMetadata) {
                            tokensInput = finalChunk.usageMetadata.promptTokenCount;
                            tokensOutput = finalChunk.usageMetadata.candidatesTokenCount;
                            const p = calculatePrice(tokensInput, tokensOutput);
                            finalMetrics = { tokensInput, tokensOutput, cost: p.costCLP };
                        }
                    } catch (metadataError: any) {
                        log(`[${name}] ⚠️ Could not extract metadata: ${metadataError.message}`);
                    }

                    // Detect AI repetition loops
                    const repetition = detectRepetition(streamText);
                    if (repetition.hasRepetition) {
                        log(`[${name}] 🚨 AI REPETITION LOOP detected: "${repetition.repeatedPhrase?.substring(0, 50)}..." (${repetition.count} times)`);
                        streamText = truncateAtRepetition(streamText);
                        log(`[${name}] 🔧 Truncated output at repetition boundary`);
                    }

                    // If stream was truncated, try to balance JSON
                    if (streamResult.truncated) {
                        log(`[${name}] 🔧 Stream was truncated, attempting JSON repair...`);
                        streamText = balanceJson(streamText);
                    }

                    // Parse JSON
                    const result = safeJsonParse(streamText);
                    if (!result) {
                        throw new Error('Failed to parse JSON output');
                    }

                    // Log final metrics for the phase
                    log(`@@METRICS@@${JSON.stringify({ phase: name, input: tokensInput, output: tokensOutput, cost: finalMetrics.cost })}`);

                    return result;
                },
                {
                    maxRetries: 3,
                    initialDelay: 1000,
                    maxDelay: 10000,
                    shouldRetry: (error: any) => {
                        const msg = error?.message || String(error);
                        return msg.includes('503') || msg.includes('overloaded') || msg.includes('Service Unavailable');
                    },
                    onRetry: (attempt, error, delay) => {
                        log(`[${name}] 🔄 Reintento ${attempt}/3 en ${delay}ms: ${error.message}`);
                    }
                }
            );
        };

        // Try each model, then each API key
        for (const modelName of modelsToTry) {
            log(`[${name}] 📍 Intentando con modelo: ${modelName}...`);

            for (const currentKey of [...new Set(allKeys)]) {
                try {
                    finalResult = await attemptExtraction(currentKey, modelName);
                    log(`[${name}] ✅ Éxito con ${modelName}`);
                    break; // Success with this model
                } catch (err: any) {
                    log(`[${name}] ⚠️ Error con llave ${currentKey.substring(0, 4)}... y modelo ${modelName}: ${err.message}`);
                }
            }

            // If we got a result, stop trying other models
            if (finalResult) break;
        }

        if (!finalResult) {
            log(`[${name}] ❌ FALLO CRÍTICO: No se pudo extraer después de todos los reintentos con todos los modelos.`);
        }

        return { result: finalResult, metrics: finalMetrics };
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
