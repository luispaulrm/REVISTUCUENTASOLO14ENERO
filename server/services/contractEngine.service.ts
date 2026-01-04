import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import {
    ContractAnalysisResult,
    ContractAnalysisOptions,
    UploadedFile
} from './contractTypes.js';
import { jsonrepair } from 'jsonrepair';
import {
    CONTRACT_ANALYSIS_SCHEMA,
    CONTRACT_ANALYSIS_PROMPT,
    CONTRACT_OCR_MAX_PAGES,
    CONTRACT_FAST_MODEL,
    CONTRACT_REASONING_MODEL,
    CONTRACT_FALLBACK_MODEL,
    CONTRACT_DEFAULT_RETRIES,
    CONTRACT_MAX_OUTPUT_TOKENS,
    CONTRACT_TEMPERATURE,
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
    log(`[ContractEngine v6.1] 🛡️ MOTOR ${AI_CONFIG.MODEL_LABEL.toUpperCase()} CON SOLIDEZ DE CUENTAS`);
    log(`[ContractEngine] 📄 Modelo: ${AI_CONFIG.ACTIVE_MODEL}`);
    log(`[ContractEngine] 📄 Doc: ${file.originalname}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. NATIVE PDF PROCESSING (Replaces Local OCR)
    // Strategy: Send PDF directly as inlineData to match Bill/PAM mechanism.
    // This avoids local tokenizer hangs on garbage OCR text and leverages Gemini's native PDF parsing.

    // Convert Buffer to Base64
    const base64Data = file.buffer.toString('base64');
    const mimeType = file.mimetype; // e.g. 'application/pdf'

    log(`[ContractEngine] 📤 Estrategia: PDF Nativo (InlineData). Tamaño: ${(base64Data.length / 1024).toFixed(2)} KB`);

    // 1.5. Get Page Count (Observability)
    try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const data = new Uint8Array(file.buffer);
        const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
        const pdf = await loadingTask.promise;
        log(`[ContractEngine] 📄 Documento cargado exitosamente. Total de páginas detectadas: ${pdf.numPages}`);
    } catch (pdfError: any) {
        log(`[ContractEngine] ⚠️ No se pudo determinar el número exacto de páginas: ${pdfError.message}`);
    }

    // 2. Initialize Centralized Gemini Service (Double Loop support built-in)
    const geminiService = new GeminiService(apiKey);

    log('[ContractEngine] 🚀 Iniciando flujo de extracción con GeminiService...');

    const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL];

    // Helper to get keys
    const getKeys = () => {
        const keys = [apiKey];
        if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
        if (process.env.API_KEY) keys.push(process.env.API_KEY);
        if (process.env.GEMINI_API_KEY_SECONDARY) keys.push(process.env.GEMINI_API_KEY_SECONDARY);
        return [...new Set(keys)].filter(k => !!k && k.length > 5);
    };
    const allKeys = getKeys();

    let resultStream: any = null;
    let lastError: any = null;
    let activeModelUsed = "";

    for (const modelName of modelsToTry) {
        if (!modelName) continue;
        log(`[ContractEngine] 🛡️ Strategy: Attempting with model ${modelName}`);

        for (const currentKey of allKeys) {
            const mask = currentKey.substring(0, 4) + '...';
            log(`[ContractEngine] 🔄 Intentando con llave: ${mask} (Modelo: ${modelName})`);

            try {
                // Define Safety Settings for maximum throughput (Contract text can be sensitive but we need it all)
                const SAFETY_SETTINGS = [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ];

                // EXACT REPLICATION OF server.ts / gemini.service.ts PATTERN
                const genAI = new GoogleGenerativeAI(currentKey);
                // We re-enable explicit safety settings because "defaults" might be blocking parts of the contract
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        maxOutputTokens: CONTRACT_MAX_OUTPUT_TOKENS,
                        responseMimeType: "application/json",
                        responseSchema: CONTRACT_ANALYSIS_SCHEMA as any,
                        temperature: CONTRACT_TEMPERATURE
                    },
                    safetySettings: SAFETY_SETTINGS
                });

                // WRAP STREAM GENERATION IN TIMEOUT (120s - increased for Large PDF processing)
                // SANDWICH STRATEGY: Instructions -> PDF -> Enforcement Reminder
                const streamPromise = model.generateContentStream([
                    { text: CONTRACT_ANALYSIS_PROMPT },
                    {
                        inlineData: {
                            data: base64Data,
                            mimeType: mimeType
                        }
                    },
                    {
                        text: `


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 VALIDACIÓN FINAL OBLIGATORIA - CONTEO DE SUB-ÍTEMS (MODO FORENSE ESTRICTO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANTES DE FINALIZAR TU JSON, VERIFICA CONTRA LA LISTA MAESTRA:

📊 CONTEO DE REGLAS (array "reglas"):
   ✓ MÍNIMO ABSOLUTO: 30 objetos (Todas las notas 1.1 a 1.13 + Secciones 2, 3, 4, 5)
   
📊 CONTEO DE COBERTURAS (array "coberturas"):
   ✓ MÍNIMO ABSOLUTO: 45 OBJETOS (Filas únicas de la tabla)
   ✓ SI TIENES MENOS DE 45, ESTÁS OMITIENDO FILAS VISIBLES. REVISA DE NUEVO.
   ✓ ¿Incluiste "Sala Cuna", "Incubadora"?
   ✓ ¿Incluiste "Fonoaudiología", "Nutricionista", "Enfermería"?
   ✓ ¿Desglosaste la URGENCIA en 6 ítems? (Consulta, Examen, Pabellón...)
   ✓ ¿Incluiste los DERIVADOS al final?

⚠️ VERIFICACIÓN DE SECUENCIA:
   Si extraes la fila 1 y saltas a la 3, HAS FALLADO.
   
🔴 REGLA DE TEXTO LITERAL:
   "VALOR EXTRACTO LITERAL DETALLADO" debe ser TEXTO COMPLETO.
   Prohibido resumir.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 SI TU JSON NO TIENE AL MENOS 45 COBERTURAS, ES UN FALLO CRÍTICO.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GENERA AHORA EL JSON COMPLETO (REGLAS >= 30, COBERTURAS >= 45).` }
                ]);
                const timeoutPromise = new Promise<any>((_, reject) =>
                    setTimeout(() => reject(new Error("Timeout: Gemini Stream failed to start in 120s")), 120000)
                );

                resultStream = await Promise.race([streamPromise, timeoutPromise]);

                if (resultStream) {
                    log(`[ContractEngine] ✅ Éxito iniciando stream con llave: ${mask}`);
                    activeModelUsed = modelName;
                    break; // Break inner loop
                }
            } catch (err: any) {
                lastError = err;
                const errStr = (err?.toString() || "") + (err?.message || "");
                const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests');
                const isTimeout = errStr.includes('Timeout');

                if (isQuota) {
                    log(`[ContractEngine] ⚠️ Quota Exceeded (429) con llave ${mask}. Probando siguiente...`);
                } else if (isTimeout) {
                    log(`[ContractEngine] ⏱️ Timeout (60s) iniciando stream con llave ${mask}. Zombie connection detectada. Reintentando...`);
                } else {
                    log(`[ContractEngine] ❌ Error: ${err.message}`);
                }
            }
        }
        if (resultStream) break; // Break outer loop
        log(`[ContractEngine] ⚠️ Todas las llaves fallaron para el modelo ${modelName}.`);
    }

    if (!resultStream) {
        throw lastError || new Error("All API keys and models failed.");
    }

    let fullText = "";
    // 3. Process Stream with Metrics
    for await (const chunk of resultStream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onLog?.(chunkText);

        // Usage metrics
        const usage = chunk.usageMetadata;
        if (usage) {
            const promptTokens = usage.promptTokenCount || 0;
            const candidatesTokens = usage.candidatesTokenCount || 0;
            const priceData = calculatePrice(promptTokens, candidatesTokens);
            log(`@@METRICS@@${JSON.stringify({
                input: promptTokens,
                output: candidatesTokens,
                cost: priceData.costCLP
            })}`);
        }
    }

    log(`\n[Process] Parsing ${fullText.length} characters...`);

    // 4. SURVIVOR PARSER V2.0 (Handles both JSON and PIPES)
    let reglas: any[] = [];
    let coberturas: any[] = [];
    let diseno_ux: any = {
        nombre_isapre: "N/A",
        titulo_plan: "N/A",
        layout: "forensic_report_v2",
        funcionalidad: "contract_streaming_v6",
        salida_json: "survivor_parsed"
    };

    // A. Try JSON First (Best Case)
    let jsonSuccess = false;
    try {
        const potentialJson = fullText.substring(fullText.indexOf('{'), fullText.lastIndexOf('}') + 1);
        if (potentialJson.length > 10) {
            const parsed = safeJsonParse<any>(potentialJson);
            if (parsed && (Array.isArray(parsed.reglas) || Array.isArray(parsed.coberturas))) {
                reglas = parsed.reglas || [];
                coberturas = parsed.coberturas || [];
                if (parsed.diseno_ux) diseno_ux = { ...diseno_ux, ...parsed.diseno_ux };
                jsonSuccess = true;
                log(`[ContractEngine] ✅ PARSER: JSON nativo detectado y procesado exitosamente.`);
            }
        }
    } catch (jsonErr) {
        // Fallback
    }

    // B. Fallback to Pipe Parsing (Resilience Mode)
    if (!jsonSuccess) {
        log(`[ContractEngine] ⚠️ PARSER: Modo JSON no detectado. Activando Modo Resiliencia (Pipes)...`);
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
        let currentSection = "";

        for (const line of lines) {
            const upper = line.toUpperCase();

            // Metadata
            if (upper.includes('ISAPRE:')) { diseno_ux.nombre_isapre = line.replace(/.*ISAPRE:/i, '').trim().replace(/\*/g, ''); continue; }
            if (upper.includes('PLAN:')) { diseno_ux.titulo_plan = line.replace(/.*PLAN:/i, '').trim().replace(/\*/g, ''); continue; }

            // Section Headers
            if (upper.includes('SECTION:')) {
                const rawSection = upper.substring(upper.indexOf('SECTION:'));
                if (rawSection.includes('REGLAS')) currentSection = "REGLAS";
                else if (rawSection.includes('COBERTURAS')) currentSection = "COBERTURAS";
                log(`[ContractEngine] 📂 Sección Detectada: ${currentSection}`);
                continue;
            }

            // Pipe Parsing
            if (line.includes('|')) {
                const cleanLine = line.replace(/^\|/, '').replace(/\|$/, '');
                const parts = cleanLine.split('|').map(p => p.trim());

                if (cleanLine.length < 5) continue;

                if (currentSection === "REGLAS") {
                    // Check if header row to skip
                    if (parts[0].toUpperCase().includes('PAGINA') || parts[0].toUpperCase().includes('PÁGINA')) continue;

                    // Relaxed parsing: Accept 3 or more parts.
                    // If 3 parts: Page | Code | Text (Subcategory merged or missing)
                    if (parts.length >= 3) {
                        reglas.push({
                            'PÁGINA ORIGEN': parts[0],
                            'CÓDIGO/SECCIÓN': parts[1],
                            'SUBCATEGORÍA': parts.length >= 4 ? parts[2] : 'General',
                            'VALOR EXTRACTO LITERAL DETALLADO': parts.length >= 4 ? parts.slice(3).join('|') : parts[2]
                        });
                    } else {
                        log(`[ContractEngine] ⚠️ REGLAS Parser rechazo línea: "${cleanLine}" (Parts: ${parts.length})`);
                    }
                } else if (currentSection === "COBERTURAS" && parts.length >= 7) {
                    // Check if header
                    if (parts[0].toUpperCase().includes('PRESTACION') || parts[0].toUpperCase().includes('PRESTACIÓN')) continue;

                    coberturas.push({
                        'PRESTACIÓN CLAVE': parts[0],
                        'MODALIDAD/RED': parts[1],
                        '% BONIFICACIÓN': parts[2],
                        'COPAGO FIJO': parts[3],
                        'TOPE LOCAL 1 (VAM/EVENTO)': parts[4],
                        'TOPE LOCAL 2 (ANUAL/UF)': parts[5],
                        'RESTRICCIÓN Y CONDICIONAMIENTO': parts[6],
                        'ANCLAJES': []
                    });
                }
            }
        }
    }

    // 4. Extract Metrics (Use Real UsageMetadata if available)
    let finalInputTokens = 0;
    let finalOutputTokens = 0;

    if (resultStream?.response?.usageMetadata) {
        finalInputTokens = resultStream.response.usageMetadata.promptTokenCount || 0;
        finalOutputTokens = resultStream.response.usageMetadata.candidatesTokenCount || 0;
        log(`[ContractEngine] 📊 Metricas Reales (Gemini): Input=${finalInputTokens}, Output=${finalOutputTokens}`);
    } else {
        // Fallback Heuristic for PDF (much lower density than text)
        // A 6MB PDF is NOT 1.5M tokens. It's normally 10k-50k. 
        // We divide by 400 to get a safer approximation if metadata fails.
        finalInputTokens = Math.ceil(base64Data.length / 400) + 500;
        finalOutputTokens = Math.ceil(fullText.length / 4);
        log(`[ContractEngine] ⚠️ Usando Metricas Estimadas (Fallback): Input=${finalInputTokens}, Output=${finalOutputTokens}`);
    }

    const priceData = calculatePrice(finalInputTokens, finalOutputTokens);

    const result: ContractAnalysisResult = {
        reglas,
        coberturas,
        diseno_ux,
        metrics: {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: finalInputTokens,
                output: finalOutputTokens,
                total: finalInputTokens + finalOutputTokens,
                costClp: priceData.costCLP
            },
            extractionBreakdown: {
                totalReglas: reglas.length,
                totalCoberturas: coberturas.length,
                totalItems: reglas.length + coberturas.length
            }
        }
    };

    log(`[ContractEngine] ✅ ÉXITO FINAL: Reglas=${reglas.length}, Coberturas=${coberturas.length}`);
    return result;
}
