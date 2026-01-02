import { GoogleGenerativeAI } from "@google/generative-ai";
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
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const data = new Uint8Array(file.buffer);
        const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true });
        const pdf = await loadingTask.promise;

        const pagesToScan = Math.min(pdf.numPages, Number.isFinite(maxPages) ? maxPages : pdf.numPages);
        log(`[ContractEngine] 📗 PDF cargado: ${pdf.numPages} páginas totales (Escaneando primeras ${pagesToScan}).`);
        let formattedText = '';

        for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
            // Log más frecuente para documentos largos
            log(`[ContractEngine] 📄 Escaneando contenido: Página ${pageNumber}/${pagesToScan}...`);

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
        log(`[ContractEngine] ⚠️ Error en extracción de texto (OCR): ${error instanceof Error ? error.message : 'Error desconocido'}`);
        return '';
    }
}

async function repairJsonWithGemini(
    genAI: GoogleGenerativeAI,
    schema: any,
    invalidText: string,
    log: (msg: string) => void
): Promise<string> {
    log('[ContractEngine] 🔧 Detectada estructura JSON dañada. Solicitando reparación mecánica...');
    const repairPrompt = `La respuesta JSON de un contrato de salud es inválida. Corrígela preservando TODOS los datos y devuelve SOLO el JSON válido:\n\n${invalidText}`;
    try {
        const model = genAI.getGenerativeModel({ model: CONTRACT_FAST_MODEL });
        const result = await model.generateContent(repairPrompt);
        return result.response.text() || invalidText;
    } catch (error) {
        log(`[ContractEngine] ❌ Error en reparación: ${error instanceof Error ? error.message : 'Error fatal'}`);
        return invalidText;
    }
}

// ============================================================================
// CORE ANALYSIS FUNCTIONS (ULTRA-RESILIENT STREAMING)
// ============================================================================

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
    } = options;

    const log = (m: string) => {
        console.log(m);
        onLog?.(m);
    };

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('[ContractEngine v3.0] 🚀 MODO DE TRANSMISIÓN ULTRA-RESILIENTE');
    log(`[ContractEngine] 📄 Archivo: ${file.originalname || 'documento.pdf'}`);
    log(`[ContractEngine] ⚖️ Peso: ${(file.buffer.length / 1024 / 1024).toFixed(2)} MB`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const genAI = new GoogleGenerativeAI(apiKey);
    const filePart = fileToGenerativePart(file);

    log('[ContractEngine] 🔍 Fase 1/4 (OCR): Analizando estructura física...');
    const extractedText = await extractTextFromPdf(file, ocrMaxPages, log);

    log('[ContractEngine] 🧠 Fase 2/4 (STREAM): Solicitando auditoría forense...');
    log('[ContractEngine] ⏳ LA IA ESTÁ PROCESANDO 50+ PÁGINAS. NO CIERRE LA VENTANA.');

    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            maxOutputTokens,
            temperature: 0,
        }
    });

    const contents = [
        filePart,
        ...(extractedText ? [{ text: `\n[MANDATO DE CONTEXTO: TEXTO PDF EXTRAÍDO]\n${extractedText}\n[FIN TEXTO EXTRAÍDO]` }] : []),
        { text: CONTRACT_ANALYSIS_PROMPT },
    ];

    // Heartbeat Interval (Every 10 seconds to avoid connection drop)
    let sessionActive = true;
    let dotCounter = 0;
    const heartbeat = setInterval(() => {
        if (!sessionActive) return;
        dotCounter++;
        const dots = '.'.repeat((dotCounter % 3) + 1);
        log(`[ContractEngine] 📡 CONEXIÓN ACTIVA: Procesando bloques de coberturas${dots}`);
    }, 10000);

    let responseText = '';
    let usageMetadata: any = null;

    try {
        const streamingResult = await model.generateContentStream(contents);

        for await (const chunk of streamingResult.stream) {
            try {
                const chunkText = chunk.text();
                responseText += chunkText;

                // Progress signal every 1000 characters
                if (responseText.length % 5000 < 500) {
                    log(`[ContractEngine] 📥 Recibidos ${(responseText.length / 1024).toFixed(1)} KB de datos forenses...`);
                }
            } catch (chunkError) {
                // Handle cases where chunk might be a safety block
                console.warn('[ContractEngine] Chunk rejected or safety filter triggered:', chunkError);
            }
        }

        const response = await streamingResult.response;
        usageMetadata = response.usageMetadata;
        sessionActive = false;
        clearInterval(heartbeat);

    } catch (error: any) {
        sessionActive = false;
        clearInterval(heartbeat);
        log(`[ContractEngine] ❌ ERROR CRÍTICO EN TRANSMISIÓN: ${error.message}`);
        throw error;
    }

    log(`[ContractEngine] ✅ Recepción finalizada (${(responseText.length / 1024).toFixed(1)} KB)`);
    log('[ContractEngine] 🔧 Fase 3/4 (VALIDACIÓN): Reconstruyendo JSON...');

    let result: ContractAnalysisResult | null = null;
    let lastText = responseText;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            result = safeJsonParse<ContractAnalysisResult>(lastText);
            log(`[ContractEngine] ✅ Estructura JSON validada con éxito.`);
            break;
        } catch (parseError) {
            if (attempt === 3) throw new Error("No se pudo reconstruir el JSON tras 3 intentos.");
            log(`[ContractEngine] ⚠️ Error de estructura (Intento ${attempt}/3). Reparando...`);
            lastText = await repairJsonWithGemini(genAI, CONTRACT_ANALYSIS_SCHEMA, lastText, log);
        }
    }

    if (!result) throw new Error("Fallo crítico en la generación de resultados del contrato.");

    // Final Metrics
    if (usageMetadata) {
        const promptTokens = usageMetadata.promptTokenCount || 0;
        const candidatesTokens = usageMetadata.candidatesTokenCount || 0;
        const inputRate = 0.50;
        const outputRate = 3.00;
        const costClp = ((promptTokens / 1_000_000) * inputRate + (candidatesTokens / 1_000_000) * outputRate) * 980;

        log(`[ContractEngine] 📊 MÉTRICAS FINALES: ${promptTokens + candidatesTokens} tokens | Costo Est: $${Math.round(costClp)} CLP`);

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
    log(`[ContractEngine] ✅ PROCESAMIENTO EXITOSO EN ${(result.executionTimeMs / 1000).toFixed(1)}s`);
    log(`[ContractEngine]    - Coberturas extraídas: ${result.coberturas?.length || 0}`);
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
