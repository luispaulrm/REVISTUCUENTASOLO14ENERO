import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
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
        console.error('[ContractEngine] JSON parse error, trying jsonrepair:', error.message);
        try {
            const repaired = jsonrepair(cleaned);
            return JSON.parse(repaired);
        } catch (repairError: any) {
            console.error('[ContractEngine] jsonrepair failed:', repairError.message);
            throw new Error(`Invalid JSON response: ${error.message}`);
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
    const {
        maxOutputTokens = 40000,
        ocrMaxPages = CONTRACT_OCR_MAX_PAGES,
        modelName = CONTRACT_REASONING_MODEL,
    } = options;

    const log = (m: string) => {
        console.log(m);
        onLog?.(m);
    };

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`[ContractEngine v4.1] 🛡️ MOTOR ${AI_CONFIG.MODEL_LABEL.toUpperCase()} ESTABLE`);
    log(`[ContractEngine] 📄 Modelo: ${AI_CONFIG.ACTIVE_MODEL}`);
    log(`[ContractEngine] 📄 Doc: ${file.originalname}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const genAI = new GoogleGenerativeAI(apiKey);
    const filePart = fileToGenerativePart(file);

    // FASE 1: OCR
    const { text: extractedText, totalPages } = await extractTextFromPdf(file, ocrMaxPages, log);

    // FASE 2: AI (Using System Instruction for performance)
    log(`[ContractEngine] ⚡ Solicitando auditoría forense ${AI_CONFIG.MODEL_LABEL}...`);
    log(`[ContractEngine] ⏳ RAZONANDO: Espere mientras el modelo ${AI_CONFIG.MODEL_LABEL} aplica las reglas forenses.`);

    const model = genAI.getGenerativeModel({
        model: AI_CONFIG.ACTIVE_MODEL,
        systemInstruction: CONTRACT_ANALYSIS_PROMPT,
        generationConfig: { maxOutputTokens, temperature: 0 },
        safetySettings: SAFETY_SETTINGS,
    }, {
        timeout: 180000 // 3 minutes timeout to prevent infinite hangs
    });

    const userPrompt = `
    [DOCUMENTO A ANALIZAR]
    METADATOS VERIFICADOS: El documento original contiene ${totalPages} páginas.
    INSTRUCCIÓN DE COBERTURA: Usted DEBE procesar y extraer información hasta la PÁGINA ${totalPages}.
    
    Use el documento adjunto para el análisis forense estructurado.
    
    [MANDATO FINAL]
    Siga estrictamente el mandato de exhaustividad del sistema y genere el JSON final.
    Confirme explícitamente haber revisado hasta la página ${totalPages}.
    `;

    const contents = [
        {
            role: 'user',
            parts: [
                filePart,
                { text: userPrompt }
            ]
        }
    ];

    let sessionActive = true;
    let secondsSinceStar = 0;
    let chunksReceived = 0;

    // Estimate input tokens to save a heavy API call (approx 4000 per page for contracts)
    const inputTokens = totalPages * 4000;
    log(`[ContractEngine] 🔢 Tokens de Entrada (Est.): ${inputTokens}`);

    log('[ContractEngine] 🚀 Iniciando stream con Auto-Retry...');
    let fullText = '';
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 1) {
                log(`[ContractEngine] 🔄 Reintentando (Intento ${attempt}/${MAX_RETRIES})...`);
            }

            const streamResult = await model.generateContentStream({ contents });
            log('[ContractEngine] 📡 Stream conectado. Esperando primer chunk...');

            for await (const chunk of streamResult.stream) {
                const chunkText = chunk.text();
                fullText += chunkText;
                chunksReceived++;

                // Always log first chunk to confirm aliveness
                if (chunksReceived === 1) {
                    log('[ContractEngine] 🐣 Primer chunk recibido!');
                }

                // Emitting Real-Time Metrics every ~2 seconds (assuming chunks come fast)
                if (chunksReceived % 2 === 0) {
                    log(`[ContractEngine] 📡 CONEXIÓN ACTIVA: DESCARGANDO (${chunksReceived} chunks)`);

                    // Calculate real-time metrics
                    const currentOutputTokens = Math.ceil(fullText.length / 4);
                    const currentCost = calculatePrice(inputTokens, currentOutputTokens).costCLP;

                    // Special log format for endpoint interception
                    log(`@@METRICS@@${JSON.stringify({
                        input: inputTokens,
                        output: currentOutputTokens,
                        cost: currentCost
                    })}`);
                }
            }

            // If success, break loop
            break;

        } catch (streamError: any) {
            const isAbort = streamError.message.includes('aborted') || streamError.name === 'AbortError' || streamError.message.includes('AbortError');

            if (isAbort && attempt < MAX_RETRIES) {
                log(`[ContractEngine] ⚠️ Timeout detectado en intento ${attempt}. Reintentando automáticamente en 2s...`);
                // Reset for retry
                fullText = '';
                chunksReceived = 0;
                await new Promise(r => setTimeout(r, 2000));
                continue;
            } else {
                log(`[ContractEngine] ❌ Error CRÍTICO en stream (Intento ${attempt}): ${streamError.message}`);
                throw streamError;
            }
        }
    }

    log(`[ContractEngine] ✅ Recepción completa.`);
    log(`[ContractEngine] 🔧 Validando estructura final...`);

    let parsedResult: any;
    try {
        parsedResult = safeJsonParse(fullText);
    } catch (parseError) {
        log(`[ContractEngine] ⚠️ Estructura rota. Intentando reparación...`);
        const repairedJson = await repairJsonWithGemini(genAI, CONTRACT_ANALYSIS_SCHEMA, fullText, log);
        parsedResult = safeJsonParse(repairedJson);
    }

    if (!parsedResult || (!parsedResult.reglas && !parsedResult.coberturas)) {
        throw new Error('Respuesta del modelo incompleta o estructura inválida.');
    }

    log(`[ContractEngine] ✅ Auditoría estructurada correctamente.`);

    // Estimate output tokens since streaming doesn't give it directly in all versions, or use usageMetadata if available
    const outputTokens = Math.ceil(fullText.length / 4); // Rough approximation if usageMetadata missing
    const totalTokens = inputTokens + outputTokens;

    // RE-APPLYING PRICE FIX
    const priceData = calculatePrice(inputTokens, outputTokens);

    log(`[ContractEngine] 📊 Resumen: ${totalTokens} tokens | Costo Est: $${priceData.costCLP} CLP`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const result: ContractAnalysisResult = {
        ...parsedResult,
        metrics: {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: inputTokens,
                output: outputTokens,
                total: totalTokens,
                costClp: priceData.costCLP
            }
        }
    };

    log(`[ContractEngine] ✅ ÉXITO EN ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return result;
}
