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

async function extractTextFromPdf(file: UploadedFile, maxPages: number, log: (msg: string) => void): Promise<string> {
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

        return formattedText.trim();
    } catch (error) {
        log(`[ContractEngine] ❌ Error en OCR: ${error instanceof Error ? error.message : 'Error fatal'}`);
        return '';
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

async function analyzeSingleContract(
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
    log(`[ContractEngine v4.1] 🛡️ MOTOR FLASH ESTABLE`);
    log(`[ContractEngine] 📄 Modelo: Gemini 3 Flash`);
    log(`[ContractEngine] 📄 Doc: ${file.originalname}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const genAI = new GoogleGenerativeAI(apiKey);
    const filePart = fileToGenerativePart(file);

    // FASE 1: OCR
    const extractedText = await extractTextFromPdf(file, ocrMaxPages, log);

    // FASE 2: AI (Using System Instruction for performance)
    log(`[ContractEngine] ⚡ Solicitando auditoría forense Flash...`);
    log(`[ContractEngine] ⏳ RAZONANDO: Espere mientras el modelo Flash aplica las reglas forenses.`);

    const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview', // Switch to Flash
        systemInstruction: CONTRACT_ANALYSIS_PROMPT,
        generationConfig: { maxOutputTokens, temperature: 0 },
        safetySettings: SAFETY_SETTINGS
    });

    const userPrompt = `
    [DOCUMENTO A ANALIZAR]
    ${extractedText ? `Texto OCR extraído:\n${extractedText}` : 'Use el PDF adjunto para el análisis forense.'}
    
    [MANDATO FINAL]
    Siga estrictamente el mandato de exhaustividad del sistema y genere el JSON final.
    `;

    const contents = [
        filePart,
        { text: userPrompt },
    ];

    let sessionActive = true;
    let secondsSinceStar = 0;
    let chunksReceived = 0;

    const heartbeat = setInterval(() => {
        if (!sessionActive) return;
        secondsSinceStar += 4;
        const phase = chunksReceived > 0 ? "DESCARGANDO" : "PROCESANDO REGLAS";
        log(`[ContractEngine] 📡 CONEXIÓN ACTIVA: ${phase} (${secondsSinceStar}s)`);
    }, 4000);

    let responseText = '';
    let usageMetadata: any = null;

    try {
        const streamingResult = await model.generateContentStream(contents);

        for await (const chunk of streamingResult.stream) {
            try {
                chunksReceived++;
                const chunkText = chunk.text();
                responseText += chunkText;

                if (chunksReceived === 1) {
                    log('[ContractEngine] 📦 PRIMER BYTE RECIBIDO: El modelo Flash está escribiendo.');
                }

                if (chunksReceived % 20 === 0) {
                    log(`[ContractEngine] 📥 Progreso de descarga: ${(responseText.length / 1024).toFixed(1)} KB...`);
                }
            } catch (chunkError: any) {
                console.warn('[ContractEngine] Stream chunk error:', chunkError.message);
            }
        }

        const response = await streamingResult.response;
        usageMetadata = response.usageMetadata;
        sessionActive = false;
        clearInterval(heartbeat);

    } catch (error: any) {
        sessionActive = false;
        clearInterval(heartbeat);
        log(`[ContractEngine] ❌ Error en motor Flash: ${error.message}`);
        if (!responseText) throw error;
    }

    log(`[ContractEngine] ✅ Recepción completa.`);
    log('[ContractEngine] 🔧 Validando estructura final...');

    let result: ContractAnalysisResult | null = null;
    let lastText = responseText;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            result = safeJsonParse<ContractAnalysisResult>(lastText);
            log(`[ContractEngine] ✅ Auditoría estructurada correctamente.`);
            break;
        } catch (parseError) {
            if (attempt === 2) throw new Error("JSON ilegible tras reparación.");
            log(`[ContractEngine] ⚠️ Corrigiendo estructura...`);
            lastText = await repairJsonWithGemini(genAI, CONTRACT_ANALYSIS_SCHEMA, lastText, log);
        }
    }

    if (!result) throw new Error("Fallo en generación v3.5.");

    // Final Metrics
    if (usageMetadata) {
        const promptTokens = usageMetadata.promptTokenCount || 0;
        const candidatesTokens = usageMetadata.candidatesTokenCount || 0;
        const costClp = ((promptTokens / 1_000_000) * 0.50 + (candidatesTokens / 1_000_000) * 3.00) * 980;

        log(`[ContractEngine] 📊 Resumen: ${promptTokens + candidatesTokens} tokens | Costo Est: $${Math.round(costClp)} CLP`);

        result.metrics = {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: promptTokens,
                output: candidatesTokens,
                total: usageMetadata.totalTokenCount || (promptTokens + candidatesTokens),
                costClp: costClp
            }
        };
    }

    result.executionTimeMs = Date.now() - startTime;
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`[ContractEngine] ✅ ÉXITO EN ${(result.executionTimeMs / 1000).toFixed(1)}s`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return result;
}

export async function analyzeContract(
    file: UploadedFile,
    apiKey: string,
    onLog?: (msg: string) => void,
    options: ContractAnalysisOptions = {}
): Promise<ContractAnalysisResult> {
    return analyzeSingleContract(file, apiKey, onLog, options);
}
