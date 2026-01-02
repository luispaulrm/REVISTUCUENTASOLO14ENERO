import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import { existsSync } from "fs";
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
    CONTRACT_MAX_OUTPUT_TOKENS,
    CONTRACT_FAST_MODEL,
    CONTRACT_REASONING_MODEL,
    CONTRACT_DEFAULT_RETRIES
} from './contractConstants.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert UploadedFile to Gemini file part format
 */
function fileToGenerativePart(file: UploadedFile) {
    return {
        inlineData: {
            data: file.buffer.toString('base64'),
            mimeType: file.mimetype,
        },
    };
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safe JSON parsing with error handling
 */
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
        console.error('[ContractEngine] JSON parse error, trying jsonrepair:', error.message);
        try {
            const repaired = jsonrepair(cleaned);
            return JSON.parse(repaired);
        } catch (repairError: any) {
            console.error('[ContractEngine] jsonrepair also failed:', repairError.message);
            throw new Error(`Invalid JSON response: ${error.message}`);
        }
    }
}

/**
 * Extract text from PDF using pdfjs-dist (Node.js compatible)
 */
async function extractTextFromPdf(file: UploadedFile, maxPages: number): Promise<string> {
    try {
        // En Node.js con pdfjs-dist, necesitamos importar así
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

        const data = new Uint8Array(file.buffer);
        const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true });
        const pdf = await loadingTask.promise;

        const pagesToScan = Math.min(pdf.numPages, Number.isFinite(maxPages) ? maxPages : pdf.numPages);
        console.log(`[ContractEngine] 📘 PDF cargado: ${pdf.numPages} páginas totales. Escaneando primeras ${pagesToScan}.`);
        let formattedText = '';

        for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const pageText = (textContent?.items || [])
                .map((item: any) => item?.str || '')
                .join('\n')
                .replace(/\s+/g, ' ')
                .trim();

            if (pageText) {
                formattedText += `\n--- PÁGINA ${pageNumber} ---\n${pageText}\n`;
            }
        }

        return formattedText.trim();
    } catch (error) {
        console.warn('[ContractEngine] PDF text extraction failed, will use vision-only:', error);
        return '';
    }
}

/**
 * Repair invalid JSON using Gemini
 */
async function repairJsonWithGemini(
    genAI: GoogleGenerativeAI,
    schema: any,
    invalidText: string
): Promise<string> {
    const repairPrompt = `
La siguiente respuesta JSON es inválida. Por favor, corrígela y devuelve SOLO el JSON válido (sin markdown, sin explicaciones):

${invalidText}

IMPORTANTE:
- Escapa comillas dobles dentro de strings con \\\\"
- No uses comas finales (trailing commas)
- Asegura que el JSON sea válido y cumpla con el schema
- Responde SOLO con el JSON corregido
`;

    try {
        const model = genAI.getGenerativeModel({ model: CONTRACT_FAST_MODEL });
        const result = await model.generateContent(repairPrompt);
        return result.response.text() || invalidText;
    } catch (error) {
        console.error('[ContractEngine] JSON repair failed:', error);
        return invalidText;
    }
}

/**
 * Execute Gemini API call with retry and fallback logic
 */
async function executeGeminiCall(
    genAI: GoogleGenerativeAI,
    modelName: string,
    params: any,
    retries: number = CONTRACT_DEFAULT_RETRIES,
    fallbackModel: string | null = null
): Promise<any> {
    let lastError: any = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            console.log(`[ContractEngine] Attempt ${attempt + 1}/${retries} with model ${modelName}`);

            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: params.config
            });

            const result = await model.generateContent(params.contents.parts);

            if (!result || !result.response) {
                throw new Error('Empty response from Gemini API');
            }

            return result.response;
        } catch (error: any) {
            lastError = error;
            console.warn(`[ContractEngine] Attempt ${attempt + 1} failed:`, error.message);

            if (attempt < retries - 1) {
                const backoffMs = Math.pow(2, attempt) * 1000;
                console.log(`[ContractEngine] Retrying in ${backoffMs}ms...`);
                await sleep(backoffMs);
            }
        }
    }

    if (fallbackModel && fallbackModel !== modelName) {
        console.log(`[ContractEngine] All retries failed. Trying fallback model: ${fallbackModel}`);
        try {
            const model = genAI.getGenerativeModel({
                model: fallbackModel,
                generationConfig: params.config
            });
            const result = await model.generateContent(params.contents.parts);
            return result.response;
        } catch (error: any) {
            console.error(`[ContractEngine] Fallback model also failed:`, error.message);
            throw lastError || error;
        }
    }

    throw lastError || new Error('All retry attempts failed');
}

// ============================================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Analyze a single contract document
 */
async function analyzeSingleContract(
    file: UploadedFile,
    apiKey: string,
    onLog?: (msg: string) => void,
    options: ContractAnalysisOptions = {}
): Promise<ContractAnalysisResult> {
    const startTime = Date.now();
    const {
        maxOutputTokens = CONTRACT_MAX_OUTPUT_TOKENS,
        ocrMaxPages = CONTRACT_OCR_MAX_PAGES,
        modelName = CONTRACT_REASONING_MODEL,
        retries = CONTRACT_DEFAULT_RETRIES,
    } = options;

    const log = (m: string) => {
        console.log(m);
        onLog?.(m);
    };

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('[ContractEngine] 🚀 INICIANDO ANÁLISIS FORENSE DE CONTRATO');
    log(`[ContractEngine] 📄 Archivo: ${file.originalname || 'unknown'}`);
    log(`[ContractEngine] 📊 Tamaño: ${(file.buffer.length / 1024).toFixed(2)} KB`);
    log(`[ContractEngine] 🎯 Modelo: ${modelName}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const genAI = new GoogleGenerativeAI(apiKey);
    const filePart = fileToGenerativePart(file);

    let extractedText = '';
    try {
        log('[ContractEngine] 🔍 Fase 1/4: Extracción de texto (OCR Híbrido)...');
        extractedText = await extractTextFromPdf(file, ocrMaxPages);
        if (extractedText) {
            log(`[ContractEngine] ✅ OCR completado: ${extractedText.length} caracteres extraídos`);
        } else {
            log('[ContractEngine] ⚠️  OCR vacío, usando solo análisis visual');
        }
    } catch (error) {
        log(`[ContractEngine] ⚠️  Extracción de texto falló: ${error instanceof Error ? error.message : error}`);
    }

    try {
        log('[ContractEngine] 🧠 Fase 2/4: Análisis Gemini Pro (Mando Imperativo)...');

        const response = await executeGeminiCall(
            genAI,
            modelName,
            {
                contents: {
                    parts: [
                        filePart,
                        ...(extractedText ? [{ text: `\n[MANDATO DE CONTEXTO: TEXTO PDF EXTRAÍDO]\n${extractedText}\n[FIN TEXTO EXTRAÍDO]` }] : []),
                        { text: CONTRACT_ANALYSIS_PROMPT },
                    ]
                },
                config: {
                    maxOutputTokens,
                    temperature: 0,
                    // Note: We avoid responseMimeType: 'application/json' for older models if needed, 
                    // but here we use it as requested.
                },
            },
            retries,
            CONTRACT_FAST_MODEL
        );

        const responseText = response.text();
        if (!responseText) throw new Error("Gemini API returned an empty response.");

        log(`[ContractEngine] 📦 Respuesta recibida: ${responseText.length} caracteres`);

        let result: ContractAnalysisResult | null = null;
        let lastText = responseText;

        log('[ContractEngine] 🔧 Fase 3/4: Validación y Reparación JSON...');

        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                result = safeJsonParse<ContractAnalysisResult>(lastText);
                log(`[ContractEngine] ✅ JSON validado (intento ${attempt + 1})`);
                break;
            } catch (parseError: any) {
                if (attempt === 2) throw new Error(`Fallback JSON repair failed: ${parseError.message}`);
                log(`[ContractEngine] ⚠️  JSON inválido (intento ${attempt + 1}/3). Reparando...`);
                lastText = await repairJsonWithGemini(genAI, CONTRACT_ANALYSIS_SCHEMA, lastText);
            }
        }

        if (!result) throw new Error("Failed to parse contract analysis result.");

        // Metrics and Cost calculation
        const usage = response.usageMetadata;
        if (usage) {
            const inputTokens = usage.promptTokenCount || 0;
            const outputTokens = usage.candidatesTokenCount || 0;

            // Tarifas Gemini 3 Flash (User config)
            const inputRate = 0.50;
            const outputRate = 3.00;
            const USD_TO_CLP = 980;
            const costClp = ((inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate) * USD_TO_CLP;

            log(`[ContractEngine] 📊 Tokens: [I: ${inputTokens} | O: ${outputTokens}] - Costo Est: $${Math.round(costClp)} CLP`);

            result.metrics = {
                executionTimeMs: Date.now() - startTime,
                tokenUsage: {
                    input: inputTokens,
                    output: outputTokens,
                    total: usage.totalTokenCount || (inputTokens + outputTokens),
                    costClp: costClp
                }
            };
        }

        result.executionTimeMs = Date.now() - startTime;
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log(`[ContractEngine] ✅ ANÁLISIS COMPLETADO EN ${(result.executionTimeMs / 1000).toFixed(1)}s`);
        log(`[ContractEngine]    - Prestaciones: ${result.coberturas?.length || 0}`);
        log(`[ContractEngine]    - Isapre: ${result.diseno_ux?.nombre_isapre}`);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        return result;

    } catch (err: any) {
        log(`[ContractEngine] ❌ ERROR CRÍTICO: ${err.message}`);
        throw err;
    }
}

/**
 * Public Entry Point
 */
export async function analyzeContract(
    file: UploadedFile,
    apiKey: string,
    onLog?: (msg: string) => void,
    options: ContractAnalysisOptions = {}
): Promise<ContractAnalysisResult> {
    return analyzeSingleContract(file, apiKey, onLog, options);
}
