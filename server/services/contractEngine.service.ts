import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import {
    ContractAnalysisResult,
    ContractAnalysisOptions,
    UploadedFile
} from './contractTypes.js';
import { jsonrepair } from 'jsonrepair';
import {
    PROMPT_REGLAS,
    PROMPT_COBERTURAS_HOSP,
    PROMPT_COBERTURAS_AMB,
    PROMPT_EXTRAS,
    SCHEMA_REGLAS,
    SCHEMA_COBERTURAS,
    PROMPT_REGLAS_SOLO_PASE_1,
    SCHEMA_REGLAS_SOLO_PASE_1,
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

/**
 * Validador de Calidad Forense v8.5
 * Verifica que los extractos literales tengan la densidad requerida.
 */
function auditIntegrityCheck(jsonOutput: any, log: (msg: string) => void) {
    const minChars = 50; // Longitud mínima para un extracto legal real
    const issues: string[] = [];

    const reglas = jsonOutput.reglas || [];
    reglas.forEach((regla: any, index: number) => {
        const literal = regla['VALOR EXTRACTO LITERAL DETALLADO'];

        if (!literal || literal.toLowerCase() === 'null') {
            issues.push(`Error en Regla ${index}: Extracto nulo.`);
        } else if (literal.length < minChars) {
            issues.push(`Advertencia en Regla ${index}: Extracto muy corto (${literal.length} chars). Posible resumen.`);
        }
    });

    if (issues.length > 0) {
        log('\n[ContractEngine] ⚠️ INTEGRIDAD FORENSE COMPROMETIDA EN ALGUNAS REGLAS:');
        issues.forEach(i => log(`   - ${i}`));
    } else {
        log('\n[ContractEngine] ✅ INTEGRIDAD FORENSE CERTIFICADA: Todos los extractos cumplen densidad mínima.');
    }

    return {
        isValid: issues.length === 0,
        report: issues,
        totalRules: reglas.length
    };
}

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
    log(`[ContractEngine v7.0] 🛡️ MULTI-PASS EXTRACTION (STRICT 8192 TOKENS)`);
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
                    onLog?.(txt); // Stream to UI

                    if (chunk.usageMetadata) {
                        tokensInput = chunk.usageMetadata.promptTokenCount;
                        tokensOutput = chunk.usageMetadata.candidatesTokenCount;
                        const p = calculatePrice(tokensInput, tokensOutput);
                        cost = p.costCLP;
                        log(`@@METRICS@@${JSON.stringify({ input: tokensInput, output: tokensOutput, cost: cost })}`);
                    }
                }
                result = safeJsonParse(streamText);
                break; // Success
            } catch (err: any) {
                log(`[${name}] ⚠️ Error con llave ${currentKey.substring(0, 4)}...: ${err.message}`);
            }
        }

        if (!result) log(`[${name}] ❌ FALLO CRÍTICO: No se pudo extraer.`);
        return { result, metrics: { tokensInput, tokensOutput, cost } };
    }

    // --- EXECUTE PHASE 1: REGLAS (USING v9.0 PROMPT) ---
    const reglasPhase = await extractSection("REGLAS_V9", PROMPT_REGLAS, SCHEMA_REGLAS);

    // --- EXECUTE PHASE 2: COBERTURAS HOSPITALARIAS ---
    const hospPhase = await extractSection("HOSPITALARIO", PROMPT_COBERTURAS_HOSP, SCHEMA_COBERTURAS);

    // --- EXECUTE PHASE 3: COBERTURAS AMBULATORIO/URGENCIA ---
    const ambPhase = await extractSection("AMBULATORIO_RESTO", PROMPT_COBERTURAS_AMB, SCHEMA_COBERTURAS);

    // --- EXECUTE PHASE 4: EXTRAS (Partos, Tiempos, Derivados) ---
    const extrasPhase = await extractSection("EXTRAS", PROMPT_EXTRAS, SCHEMA_COBERTURAS);

    // --- MERGE ---
    const reglas = reglasPhase.result?.reglas || [];
    const coberturasHosp = hospPhase.result?.coberturas || [];
    const coberturasAmb = ambPhase.result?.coberturas || [];
    const coberturasExtras = extrasPhase.result?.coberturas || [];

    // Merge all coverage arrays
    const coberturas = [...coberturasHosp, ...coberturasAmb, ...coberturasExtras];

    const diseno_ux = hospPhase.result?.diseno_ux || ambPhase.result?.diseno_ux || {
        nombre_isapre: "Unknown",
        titulo_plan: "Unknown",
        layout: "failed_extraction",
        funcionalidad: "multi_pass_v4_universal",
        salida_json: "merged"
    };

    // --- TOTAL METRICS ---
    const totalInput = (reglasPhase.metrics.tokensInput) + (hospPhase.metrics.tokensInput) + (ambPhase.metrics.tokensInput) + (extrasPhase.metrics.tokensInput);
    const totalOutput = (reglasPhase.metrics.tokensOutput) + (hospPhase.metrics.tokensOutput) + (ambPhase.metrics.tokensOutput) + (extrasPhase.metrics.tokensOutput);
    const totalCost = (reglasPhase.metrics.cost) + (hospPhase.metrics.cost) + (ambPhase.metrics.cost) + (extrasPhase.metrics.cost);

    const result: ContractAnalysisResult = {
        reglas,
        coberturas,
        diseno_ux,
        metrics: {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: totalInput,
                output: totalOutput,
                total: totalInput + totalOutput,
                costClp: totalCost
            },
            extractionBreakdown: {
                totalReglas: reglas.length,
                totalCoberturas: coberturas.length,
                totalItems: reglas.length + coberturas.length
            }
        }
    };

    // --- FINAL FORENSIC CHECK ---
    auditIntegrityCheck({ reglas }, log);

    return result;
}
