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
    CONTRACT_FALLBACK_MODEL,
    CONTRACT_DEFAULT_RETRIES,
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
    } = options;

    const log = (m: string) => {
        console.log(m);
        onLog?.(m);
    };

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`[ContractEngine v5.0] 🛡️ MOTOR ${AI_CONFIG.MODEL_LABEL.toUpperCase()} STREAMING`);
    log(`[ContractEngine] 📄 Modelo: ${AI_CONFIG.ACTIVE_MODEL}`);
    log(`[ContractEngine] 📄 Doc: ${file.originalname}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: AI_CONFIG.ACTIVE_MODEL,
        generationConfig: { maxOutputTokens, temperature: 0 },
        safetySettings: SAFETY_SETTINGS,
    });

    log('[ContractEngine] 🚀 Iniciando flujo de extracción jerárquica...');

    const resultStream = await model.generateContentStream([
        { text: CONTRACT_ANALYSIS_PROMPT },
        {
            inlineData: {
                data: file.buffer.toString('base64'),
                mimeType: file.mimetype
            }
        }
    ]);

    let fullText = "";
    let reglas: any[] = [];
    let coberturas: any[] = [];
    let diseno_ux: any = {
        nombre_isapre: "N/A",
        titulo_plan: "N/A",
        layout: "forensic_report_v2",
        funcionalidad: "contract_streaming_v5",
        salida_json: "hierarchical_parsed"
    };

    let currentSection = "";

    const robustSplit = (line: string): string[] => {
        let trimmed = line.trim();
        if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
        if (trimmed.endsWith('|')) trimmed = trimmed.substring(0, trimmed.length - 1);
        return trimmed.split('|').map(c => c.trim());
    };

    for await (const chunk of resultStream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onLog?.(chunkText); // Stream text to UI logs

        // Usage metrics if available
        const usage = chunk.usageMetadata;
        if (usage) {
            const promptTokens = usage.promptTokenCount || 0;
            const candidatesTokens = usage.candidatesTokenCount || 0;
            const totalTokens = usage.totalTokenCount || 0;
            const priceData = calculatePrice(promptTokens, candidatesTokens);

            log(`@@METRICS@@${JSON.stringify({
                input: promptTokens,
                output: candidatesTokens,
                cost: priceData.costCLP
            })}`);
        }
    }

    log(`\n[Process] Parsing ${fullText.length} characters...`);
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);

    for (const line of lines) {
        if (line.startsWith('ISAPRE:')) {
            diseno_ux.nombre_isapre = line.replace('ISAPRE:', '').trim();
            continue;
        }
        if (line.startsWith('PLAN:')) {
            diseno_ux.titulo_plan = line.replace('PLAN:', '').trim();
            continue;
        }
        if (line.startsWith('SUBTITULO:')) {
            diseno_ux.subtitulo_plan = line.replace('SUBTITULO:', '').trim();
            continue;
        }
        if (line.startsWith('SECTION:')) {
            currentSection = line.replace('SECTION:', '').trim().toUpperCase();
            continue;
        }

        if (line.includes('|')) {
            const parts = robustSplit(line);
            if (currentSection === "REGLAS" && parts.length >= 4) {
                reglas.push({
                    'PÁGINA ORIGEN': parts[0],
                    'CÓDIGO/SECCIÓN': parts[1],
                    'SUBCATEGORÍA': parts[2],
                    'VALOR EXTRACTO LITERAL DETALLADO': parts[3]
                });
            } else if (currentSection === "COBERTURAS" && parts.length >= 7) {
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

    const outputTokens = Math.ceil(fullText.length / 4);
    // Note: real prompt tokens would be better from usageMetadata, but let's provide a fallback
    const inputTokens = Math.ceil(CONTRACT_ANALYSIS_PROMPT.length / 4) + 10000;
    const priceData = calculatePrice(inputTokens, outputTokens);

    const result: ContractAnalysisResult = {
        reglas,
        coberturas,
        diseno_ux,
        metrics: {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: inputTokens,
                output: outputTokens,
                total: inputTokens + outputTokens,
                costClp: priceData.costCLP
            }
        }
    };

    log(`[ContractEngine] ✅ ÉXITO: Extraídas ${reglas.length} reglas y ${coberturas.length} coberturas.`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return result;
}
