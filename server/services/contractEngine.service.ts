import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import {
    ExplorationJSON,
    ExplorationItem,
    ExplorationModality,
    ExplorationTopeCompound,
    ContractAnalysisResult,
    ContractAnalysisOptions,
    UploadedFile,
    ContractCoverage,
    RawCell // Cartesian Support
} from './contractTypes.js';
import { decodeCartesian } from './contractDecoder.js';
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
    SCHEMA_RAW_CELLS, // New Cartesian Schema
    SCHEMA_CLASSIFIER,
    PROMPT_MODULAR_JSON,
    SCHEMA_MODULAR_JSON,
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
import { ContractCacheService } from './contractCache.service.js';

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

/**
 * Detects column boundaries in a table by analyzing X-coordinates of text items.
 * Uses dynamic clustering based on gap analysis.
 */
function detectColumnBoundaries(items: any[], log?: (msg: string) => void): Array<{ start: number, end: number, index: number }> {
    if (!items || items.length === 0) return [];

    // 1. Collect and Sort unique X positions
    const xPositions = items
        .filter(item => item.transform && item.transform.length >= 6)
        .map(item => item.transform[4]) // X position
        .sort((a, b) => a - b);

    if (xPositions.length === 0) return [];

    // 2. Calculate Gaps to determine dynamic tolerance
    const gaps: number[] = [];
    for (let i = 1; i < xPositions.length; i++) {
        const gap = xPositions[i] - xPositions[i - 1];
        if (gap > 1.0) gaps.push(gap); // Ignore tiny jitter
    }

    // Default to 30 if no significant gaps, otherwise use median-ish heuristic
    let clusterTolerance = 30;
    if (gaps.length > 0) {
        gaps.sort((a, b) => a - b);
        const medianGap = gaps[Math.floor(gaps.length / 2)];
        // A column gap is usually significantly larger than character spacing jitter
        // We set tolerance to be slightly larger than the median alignment jitter
        clusterTolerance = Math.max(10, medianGap * 2);
    }

    // log?.(`[DEBUG_OCR] Dynamic Cluster Tolerance: ${clusterTolerance.toFixed(1)}px`);

    // 3. Cluster X positions
    const clusters: number[] = [];
    let currentClusterSum = xPositions[0];
    let currentClusterCount = 1;
    let lastX = xPositions[0];

    for (let i = 1; i < xPositions.length; i++) {
        const x = xPositions[i];
        if (x - lastX > clusterTolerance) {
            // End of cluster, save centroid
            clusters.push(currentClusterSum / currentClusterCount);
            // Start new cluster
            currentClusterSum = x;
            currentClusterCount = 1;
        } else {
            // Add to current cluster
            currentClusterSum += x;
            currentClusterCount++;
        }
        lastX = x;
    }
    clusters.push(currentClusterSum / currentClusterCount); // Push last cluster

    // 4. Create boundaries (midpoints between clusters)
    const columns = clusters.map((centroid, index) => {
        const nextCentroid = clusters[index + 1];
        const end = nextCentroid ? (centroid + nextCentroid) / 2 : centroid + 100;
        // Start is midpoint from previous, or slightly before centroid for first
        const prevCentroid = clusters[index - 1];
        const start = prevCentroid ? (prevCentroid + centroid) / 2 : centroid - 20;

        return { start, end, index };
    });

    return columns;
}

/**
 * Assigns a text item to its corresponding column based on X-coordinate.
 */
function assignToColumn(item: any, columns: Array<{ start: number, end: number, index: number }>): number {
    if (!item.transform || item.transform.length < 6) return -1;
    const x = item.transform[4]; // Start X
    // Use center point of text ideally, but start is usually enough for left-aligned
    // Let's stick to start X for consistency with detection

    for (const col of columns) {
        if (x >= col.start && x < col.end) {
            return col.index;
        }
    }
    return -1; // Out of bounds
}

async function extractTextFromPdf(file: UploadedFile, maxPages: number, log: (msg: string) => void): Promise<{ text: string, totalPages: number, structuredData?: any }> {
    try {
        log(`[ContractEngine] 🔍 Escaneando PDF con Detector de Columnas Geométricas v13.5 (Debug Mode)...`);
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
        log(`[ContractEngine] 📗 PDF cargado (${pdf.numPages} págs). Procesando ${pagesToScan}.`);

        let formattedText = '';
        const structuredTables: any[] = [];

        for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
            const pagePromise = pdf.getPage(pageNumber).then(async (page) => {
                const textContent = await page.getTextContent();
                const items: any[] = textContent.items || [];

                // --- STEP 1: DETECT COLUMN BOUNDARIES ---
                const columns = detectColumnBoundaries(items, log);
                log(`[DEBUG_OCR] Pág ${pageNumber}: ${columns.length} columnas detectadas.`);
                columns.forEach(c => log(`  -> Col ${c.index}: ${c.start.toFixed(0)}px - ${c.end.toFixed(0)}px`));

                // --- STEP 2: GROUP ITEMS BY ROW (Y-coordinate) ---
                const Y_TOLERANCE = 5.0; // Slightly increased vertical tolerance
                const lines: { y: number, items: any[] }[] = [];

                for (const item of items) {
                    if (!item.transform || item.transform.length < 6) continue;
                    const y = item.transform[5];

                    const line = lines.find(l => Math.abs(l.y - y) < Y_TOLERANCE);
                    if (line) {
                        line.items.push(item);
                    } else {
                        lines.push({ y, items: [item] });
                    }
                }

                lines.sort((a, b) => b.y - a.y); // Top to bottom

                // --- STEP 3: ASSIGN ITEMS TO COLUMNS AND BUILD STRUCTURED TABLE ---
                const tableRows: any[] = [];

                for (const line of lines) {
                    const row: string[] = new Array(columns.length).fill('');

                    // Sort items in line by X to ensure logical reading order even within cells
                    line.items.sort((a, b) => a.transform[4] - b.transform[4]);

                    for (const item of line.items) {
                        const colIndex = assignToColumn(item, columns);
                        if (colIndex >= 0 && colIndex < columns.length) {
                            row[colIndex] += (row[colIndex].length > 0 ? ' ' : '') + item.str;
                        }
                    }

                    // Only add non-empty rows
                    if (row.some(cell => cell.trim().length > 0)) {
                        tableRows.push(row);
                    }
                }

                structuredTables.push({
                    page: pageNumber,
                    columns: columns.length,
                    rows: tableRows
                });

                // --- STEP 4: DEBUG OUTPUT & FORMATTING ---
                const pageLines = tableRows.map(row => {
                    const formattedRow = row.map((cell: string) => cell.trim()).join(' | ');
                    return formattedRow;
                });

                // Log a sample of rows for debugging
                if (pageLines.length > 0) {
                    log(`[DEBUG_OCR] --- Muestra de Filas Detectadas (Pág ${pageNumber}) ---`);
                    pageLines.slice(0, 10).forEach(l => log(`  ${l.substring(0, 150)}...`));
                }

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

        return { text: formattedText.trim(), totalPages: pdf.numPages, structuredData: structuredTables };
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
// DETERMINISTIC MARKDOWN PARSER (The "No-Smoke" Engine)
// ============================================================================

function parseTope(raw: string): { tope: number | null; unidad: "UF" | "AC2" | "SIN_TOPE"; tipoTope: "POR_EVENTO" | "ANUAL" | "ILIMITADO" } {
    const s = String(raw || "").trim();

    // DOCTRINA IMBATIBLE: Celda vacía != "Sin Tope"
    // "—" o "-" son ausencia de dato, no cobertura infinita
    if (!raw || s === "—" || s === "-" || s === "") {
        return { tope: null, unidad: "SIN_TOPE" as any, tipoTope: "POR_EVENTO" as any }; // Mark as UNKNOWN in schema
    }

    // Solo texto explícito "sin tope" o "ilimitado" otorga cobertura infinita
    if (/sin tope|ilimitado/i.test(s)) {
        return { tope: null, unidad: "SIN_TOPE", tipoTope: "ILIMITADO" };
    }

    // Extract number: "4.5 UF" -> 4.5, "20%" -> 20
    const numMatch = s.match(/([0-9.,]+)/);
    const num = numMatch ? parseFloat(numMatch[1].replace(",", ".")) : null;

    if (/UF/i.test(s)) {
        return { tope: num, unidad: "UF", tipoTope: "POR_EVENTO" };
    }

    if (/AC2|veces/i.test(s)) {
        return { tope: num, unidad: "AC2", tipoTope: "POR_EVENTO" };
    }

    // Default fallback: if we have a number but no unit, mark as unknown
    return { tope: num, unidad: "SIN_TOPE" as any, tipoTope: "POR_EVENTO" as any };
}

function rowToCoverages(row: string[]): ContractCoverage[] {
    // Expected format: [Prestación, %Pref, TopePref, %Libre, TopeLibre]
    if (row.length < 5) return [];

    const [prestacion, porcPref, topePref, porcLibre, topeLibre] = row;
    const covers: ContractCoverage[] = [];

    // 1. Preferente
    if (porcPref && porcPref !== "—") {
        const pVal = parseFloat(porcPref.replace("%", "").replace(",", "."));
        covers.push({
            prestacion: prestacion,
            // DOCTRINA IMBATIBLE: No guessing. Este es un fallback legacy de markdown.
            // Si se usa, debe marcar UNDETERMINED o recibir ambito inyectado.
            ambito: "UNDETERMINED" as any,
            modalidad: "PREFERENTE",
            porcentaje: isNaN(pVal) ? null : pVal,
            ...parseTope(topePref),
            fuente: "TABLA_CONTRATO"
        });
    }

    // 2. Libre Elección
    if (porcLibre && porcLibre !== "—") {
        const pVal = parseFloat(porcLibre.replace("%", "").replace(",", "."));
        covers.push({
            prestacion: prestacion,
            ambito: "UNDETERMINED" as any,
            modalidad: "LIBRE_ELECCION",
            porcentaje: isNaN(pVal) ? null : pVal,
            ...parseTope(topeLibre),
            fuente: "TABLA_CONTRATO"
        });
    }

    return covers;
}

export function parseContractMarkdown(md: string): ContractCoverage[] {
    if (!md) return [];

    // 1. Split by lines and pipe
    const lines = md.split("\n").filter(l => l.includes("|"));

    // 2. Extract rows
    const rows = lines.map(l =>
        l.split("|").map(c => c.trim()).filter(c => c.length > 0)
    ).filter(r => r.length >= 5); // Must have at least name + 2 pairs of coverages

    // 3. Filter likely header rows or garbage
    const dataRows = rows.filter(r =>
        !/prestaci|bonificaci|tope/i.test(r[0]) && // Not header
        !/^[\-: ]+$/.test(r[0]) // Not separator
    );

    // 4. Map to coverages
    const coberturas = dataRows.flatMap(rowToCoverages);

    return coberturas;
}

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
): Promise<ExplorationJSON> {
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

    // --- CACHE CHECK (Phase -1) ---
    const fileHash = ContractCacheService.calculateHash(file.buffer);
    const cachedResult = await ContractCacheService.get(fileHash);
    if (cachedResult) {
        log(`\n[ContractEngine] 🚀 CACHE HIT! Reusing previous analysis for hash: ${fileHash.substring(0, 10)}...`);
        log(`[ContractEngine] 💰 Tokens Saved: ~${cachedResult.usageMetadata?.totalTokenCount || 'N/A'}`);
        return cachedResult;
    }
    log(`\n[ContractEngine] 🚀 CACHE MISS. Proceeding with LLM analysis...`);

    // Discover and stabilize all available API keys globally for this run
    const allKeys = [
        apiKey,
        process.env.GEMINI_API_KEY,
        process.env.API_KEY,
        process.env.GEMINI_API_KEY_SECONDARY,
        process.env.GEMINI_API_KEY_TERTIARY,
        process.env.GEMINI_API_KEY_QUATERNARY
    ].filter(k => !!k && k.length > 5);
    const uniqueKeys = [...new Set(allKeys)];

    // Convert Buffer to Base64
    const base64Data = file.buffer.toString('base64');
    const mimeType = file.mimetype;

    // Helper for Extraction Call with Robustness Features
    async function extractSection(name: string, prompt: string, schema: any): Promise<any> {
        log(`\n[ContractEngine] 🚀 Iniciando FASE: ${name.toUpperCase()}...`);
        // Use uniqueKeys defined in parent scope

        let finalResult = null;
        let finalMetrics = { tokensInput: 0, tokensOutput: 0, cost: 0 };
        let isSuccess = false;

        // Multi-Model Fallback Strategy (v3.0):
        // 1. Primary: Gemini 3 Pro (High Intellect) - CONTRACT_FAST_MODEL
        // 2. Secondary: Gemini 3 Flash (Speed/Reasoning) - CONTRACT_REASONING_MODEL
        // 3. Fallback: Gemini 2.5 Flash (Legacy Reliability) - CONTRACT_FALLBACK_MODEL
        const modelsToTry = [
            CONTRACT_FAST_MODEL,
            CONTRACT_REASONING_MODEL,
            CONTRACT_FALLBACK_MODEL
        ].filter(m => !!m && m.length > 0); // Ensure no empty models

        // Retry with exponential backoff for 503 errors
        const attemptExtraction = async (currentKey: string, modelName: string): Promise<any> => {
            return retryWithBackoff(
                async () => {
                    const genAI = new GoogleGenerativeAI(currentKey);

                    // --- LEARNING INJECTION (v20.0) ---
                    // Retrieve relevant few-shot examples based on prompt context (phase name)
                    // We map the phase name to tags, e.g., 'HOSP_P1' -> ['HOSPITALARIO']
                    let enrichedPrompt = prompt;
                    if (prompt.includes("{{FEW_SHOT_EXAMPLES}}")) {
                        const { retrieveRelevantExamples } = await import('./contractLearning.service.js');
                        // Use filename as context tag if available, or just generic
                        const examples = await retrieveRelevantExamples(file.originalname);

                        let exampleText = "";
                        if (examples.length > 0) {
                            exampleText = `
                            \n\n================================================================================
                            🧠 LECCIONES APRENDIDAS (CORRECCIONES HUMANAS PREVIAS)
                            ================================================================================
                            Presta atención a estos errores cometidos anteriormente en documentos similares:

                            ${examples.map((ex, i) => `
                            --- EJEMPLO ${i + 1} ---
                            CONTEXTO VISUAL (OCR):
                            "${ex.originalTextSnippet}"

                            ERROR COMÚN: El sistema ignoró "Sin Cobertura" o "Excluido".
                            CORRECCIÓN CORRECTA (JSON):
                            ${JSON.stringify(ex.correctedJson, null, 2)}
                            `).join('\n')}
                            
                            INSTRUCCIÓN: SI VES ALGO SIMILAR, APLICA LA LÓGICA DE LA CORRECCIÓN.
                            ================================================================================\n\n
                            `;
                        }
                        enrichedPrompt = prompt.replace("{{FEW_SHOT_EXAMPLES}}", exampleText);
                    }


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
                        { text: enrichedPrompt },
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

            for (const currentKey of uniqueKeys) {
                try {
                    finalResult = await attemptExtraction(currentKey, modelName);
                    log(`[${name}] ✅ Éxito con ${modelName}`);
                    isSuccess = true;
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

        return { result: finalResult, metrics: finalMetrics, success: isSuccess };
    }

    // --- PHASE 0: CLASSIFIER (Sequential Validation) ---
    const fingerprintPhase = await extractSection("CLASSIFIER", PROMPT_CLASSIFIER, SCHEMA_CLASSIFIER);

    if (fingerprintPhase.result) {
        log(`\n[ContractEngine] 📍 Huella Digital:`);
        log(`   Tipo: ${fingerprintPhase.result.tipo_contrato}`);
        log(`   Confianza: ${fingerprintPhase.result.confianza}%`);

        if (fingerprintPhase.result.tipo_contrato === 'BILL_OR_PAM') {
            log(`\n[ContractEngine] ❌ ERROR DE VALIDACIÓN: El documento detectado es una Boleta o PAM.`);
            throw new Error('EL DOCUMENTO NO ES UN CONTRATO. El generador canónico solo acepta contratos de salud (Isapre/Fonasa). Por favor sube el archivo correcto.');
        }
    }

    // --- DETERSMINISTIC PHASES CONFIGURATION ---
    const PHASES = [
        { id: "HOSP_P1", ambito: "HOSPITALARIO" as const, prompt: PROMPT_HOSP_P1 },
        { id: "HOSP_P2", ambito: "HOSPITALARIO" as const, prompt: PROMPT_HOSP_P2 },
        { id: "AMB_P1", ambito: "AMBULATORIO" as const, prompt: PROMPT_AMB_P1 },
        { id: "AMB_P2", ambito: "AMBULATORIO" as const, prompt: PROMPT_AMB_P2 },
        { id: "AMB_P3", ambito: "AMBULATORIO" as const, prompt: PROMPT_AMB_P3 },
        { id: "AMB_P4", ambito: "AMBULATORIO" as const, prompt: PROMPT_AMB_P4 }
    ];

    function isValidSectionHeader(text: string): boolean {
        const t = (text || "").trim();
        if (t.length < 5) return false;
        // DOCTRINA IMBATIBLE: Must be uppercase, no numbers, no symbols
        // Prevents contamination from numeric values
        return t === t.toUpperCase() && !/[0-9%$.,]/.test(t);
    }

    const runModularPhase = async (phaseId: string, segmentPrompt: string, targetAmbito: "HOSPITALARIO" | "AMBULATORIO") => {
        const enrichedPrompt = PROMPT_MODULAR_JSON.replace("{{SEGMENT}}", segmentPrompt);
        const phase = await extractSection(phaseId, enrichedPrompt, SCHEMA_MODULAR_JSON);

        let currentSectionHeader = "SIN_SECCION_VISUAL";
        const processedItems: any[] = [];

        (phase.result?.coberturas || []).forEach((item: any) => {
            // Guardrail: Process Visual Headers
            if (item.tipo === "seccion_visual") {
                if (isValidSectionHeader(item.seccion_raw || item.item)) {
                    currentSectionHeader = (item.seccion_raw || item.item || "").trim().toUpperCase();
                    log(`[${phaseId}] 📑 Nuevo encabezado visual detectado: ${currentSectionHeader}`);
                } else {
                    // Demote rejected header
                    item.tipo = "texto_no_prestacion";
                }
            }

            // Skip non-prestacion text for actual coverage mapping
            if (item.tipo !== "prestacion") return;

            // ENFORCE INVARIANTS
            const rowAmbito = targetAmbito;
            const seccionRaw = item.seccion_raw || currentSectionHeader;

            // Map Modalities
            const modalities = [];

            const mapModality = (rawMod: any, tipo: "PREFERENTE" | "LIBRE_ELECCION") => {
                if (!rawMod) return null;

                const topeStr = String(rawMod.tope || "").toUpperCase();
                let unit: "UF" | "AC2" | "VAM" | "PESOS" | "SIN_TOPE" | "DESCONOCIDO" | "MIXTO" = "DESCONOCIDO";

                // DOCTRINA IMBATIBLE: Detectar MIXTO antes que unidades simples
                const hasVAM = topeStr.includes("VAM");
                const hasUF = topeStr.includes("UF");

                if (hasVAM && hasUF) unit = "MIXTO";
                else if (hasUF) unit = "UF";
                else if (hasVAM) unit = "VAM";
                else if (topeStr.includes("AC2") || topeStr.includes("VECES")) unit = "AC2";
                else if (topeStr.includes("PESOS") || topeStr.includes("$")) unit = "PESOS";
                else if (topeStr.includes("SIN TOPE") || topeStr.includes("ILIMITADO")) unit = "SIN_TOPE";

                return {
                    tipo,
                    porcentaje: rawMod.porcentaje,
                    tope: rawMod.tope,
                    unidadTope: unit,
                    tipoTope: "DESCONOCIDO" as const, // NO ASSUMING POR_EVENTO
                    copago: rawMod.tope,
                    // --- EXPLORATION DOCTRINE EVIDENCE ---
                    evidencia_literal: rawMod.tope || item.item,
                    incertidumbre: (rawMod.porcentaje === null || rawMod.tope === null) ? "Dato faltante o ambiguo en PDF" : undefined,
                    origen_extraccion: 'VISUAL_MODULAR' as const
                    // interpretacion_sugerida REMOVED from extraction phase (v1.6.0)
                };
            };

            const modPref = mapModality(item.preferente, "PREFERENTE");
            if (modPref) modalities.push(modPref);

            const modLibre = mapModality(item.libre_eleccion, "LIBRE_ELECCION");
            if (modLibre) modalities.push(modLibre);

            processedItems.push({
                categoria: seccionRaw, // Map seccion_raw to categoria for UI
                seccion_raw: seccionRaw,
                item: item.item,
                ambito: rowAmbito,
                modalidades: modalities
            });
        });

        return { items: processedItems, phase };
    };

    // Execute phases
    const phaseResults = await Promise.all(
        PHASES.map(p => runModularPhase(p.id, p.prompt, p.ambito))
    );

    const hospResults = phaseResults.filter((_, i) => PHASES[i].ambito === "HOSPITALARIO");
    const coberturasHospRaw = hospResults.flatMap(r => r.items);
    const ambResults = phaseResults.filter((_, i) => PHASES[i].ambito === "AMBULATORIO");
    const coberturasAmbRaw = ambResults.flatMap(r => r.items);
    let coberturasExtrasRaw: any[] = [];

    // Legacy mapping support for metrics
    const allModularPhases = phaseResults.map(r => r.phase);
    const fullJsonPhase = { success: allModularPhases.every(p => p.success), result: null };


    // OCR Text is still useful for deterministic check
    const textExtractionPromise = extractTextFromPdf(file, CONTRACT_OCR_MAX_PAGES, log);
    const [ocrResult] = await Promise.all([textExtractionPromise]);

    // --- INTEGRATION: DETERMINISTIC MARKDOWN PARSER ---
    // We attempt to parse the OCR markdown directly.
    // If successful, we can use these items directly or merge them.
    // For now, let's inject them into the raw streams.

    // OCR parsing disabled in single-pass mode (data comes from fullJsonPhase)
    if ((ocrResult as any).text) {
        log(`[ContractEngine] 🧠 OCR Text extracted for reference (${(ocrResult as any).text.length} chars)`);
    }

    // ============================================================================
    // POST-PROCESSING FILTER v10.4: Quality Control & Forensic Isolation
    // ============================================================================
    const MAX_HOSP_ITEMS = 56;
    const MAX_AMB_ITEMS = 70;

    const hospSliced = coberturasHospRaw;
    const ambSliced = coberturasAmbRaw;


    // ============================================================================
    // HELPER: Ceiling Normalizer (Hybrid Parser)
    // ============================================================================
    function normalizeTopeFactor(val: any, unitHint?: string): { factor: number | null; unit: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'UNKNOWN', raw: string } {
        const raw = String(val || "").trim();
        const s = raw.toUpperCase();

        if (!val || s === '-' || s === '---' || s === '—' || s === "NULL") {
            return { factor: null, unit: 'UNKNOWN', raw };
        }

        // Detect MIXTO (UF and VAM)
        if (s.includes('UF') && s.includes('VAM')) {
            return { factor: null, unit: 'MIXTO', raw };
        }

        // R-UNIT-NORMALIZE-01: SIN_TOPE priority
        // If it says "SIN TOPE", we don't care about numbers (likely percentages)
        if (s.includes('SIN TOPE') || s.includes('ILIMITADO') || s.includes('SIN LIMITE')) {
            return { factor: null, unit: 'SIN_TOPE', raw };
        }

        // Try to parse number
        // R-TOPE-NORM-01: Ignore numbers followed by % (coverage, not tope)
        const cleanForNum = s.replace(/\d+%/g, '').trim();
        const numMatch = cleanForNum.match(/([\d\.,]+)/);
        let factor = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;

        const hasNumbers = !!numMatch;
        const hasKnownUnits = s.includes('UF') || s.includes('VAM') || s.includes('AC2') || s.includes('ARANCEL') || s.includes('$') || s.includes('PESOS');

        let unit: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'MIXTO' | 'UNKNOWN' = 'UNKNOWN';

        if (s.includes('UF')) unit = 'UF';
        else if (s.includes('VAM')) unit = 'VAM';
        else if (s.includes('AC2') || s.includes('ARANCEL') || unitHint === 'AC2') unit = 'AC2';
        else if (s.includes('$') || s.includes('PESOS') || unitHint === 'PESOS') unit = 'PESOS';

        return { factor, unit, raw };
    }

    /**
     * EVOLUCIONAL v1.7.0 (R1-R10)
     * Proyecta un tope compuesto (multi-cláusula) determinístico.
     */
    function parseCompoundTope(evidencia: string): ExplorationTopeCompound[] {
        const compounds: ExplorationTopeCompound[] = [];
        const s = evidencia.toUpperCase();

        // R1 — Split por “/” con preservación literal
        const parts = evidencia.split(/\s\/\s/);

        parts.forEach(part => {
            const upart = part.toUpperCase();

            // R2 — Segmento “Internacional”
            let alcance: 'NACIONAL' | 'INTERNACIONAL' = 'NACIONAL';
            if (upart.includes('INTERNACIONAL') || upart.includes('INTERNAC')) alcance = 'INTERNACIONAL';

            const comp: ExplorationTopeCompound = { alcance };
            comp.tipoTope = 'TOPE_EVENTO'; // Default R2

            // R3 — Segmento “(Anual)”
            if (upart.includes('(ANUAL)') || upart.includes('ANUAL')) {
                comp.tipoTope = 'TOPE_ANUAL';
            }

            // R5 — Excepciones por prestador (Estructurado + Efecto)
            if (upart.includes('EXCEPTO')) {
                const excMatch = part.match(/EXCEPTO\s+([^/]+)/i);
                if (excMatch) {
                    const pctMatch = excMatch[1].match(/(\d+)%/);
                    const pct = pctMatch ? parseInt(pctMatch[1]) : 0;
                    const prestadores = excMatch[1].replace(/\d+%/g, '').replace(/ en /gi, '').split(/,| y /).map(e => e.trim()).filter(e => e.length > 3);

                    // FIX #5: Inferir efecto de la excepción
                    // Si pct < 100 es LIMITANTE (reduce cobertura)
                    const efecto: 'CAMBIO_DOMINIO' | 'LIMITANTE' | 'INFORMATIVO' = pct < 100 ? 'LIMITANTE' : 'INFORMATIVO';

                    comp.excepciones = prestadores.map(p => ({
                        prestador: p,
                        porcentaje: pct,
                        efecto
                    }));
                }
            }

            // R4 — Segmento “SIN TOPE” vs CON_TOPE
            if (upart.includes('SIN TOPE') || upart.includes('ILIMITADO')) {
                comp.regla = 'SIN_TOPE';
                comp.unidad = 'SIN_TOPE';
                comp.tope = null;
            } else {
                // R7 — Normalización numérica (coma decimal) via normalizeTopeFactor
                const norm = normalizeTopeFactor(part);
                if (norm.factor) {
                    comp.tope = norm.factor;
                    comp.unidad = norm.unit === 'UNKNOWN' ? 'UF' : norm.unit as any;
                    comp.regla = 'CON_TOPE';
                }
            }

            comp.descripcion = part.trim();
            compounds.push(comp);
        });

        return compounds;
    }

    const cleanAndCheck = (list: any[]) => list.map((cob: any) => {
        let cleaned = { ...cob };

        // --- PHASE 1: STRUCTURAL INTEGRITY CHECK ---
        if (!cleaned.modalidades || !Array.isArray(cleaned.modalidades) || cleaned.modalidades.length === 0) {
            cleaned.invalid = true;
        }

        // DOCTRINA DE SILENCIO
        cleaned.nota_restriccion = cleaned.nota_restriccion ?? null;

        // SANITY TRUNCATION
        const SANITY_LIMIT = 2000;
        ['item', 'nota_restriccion'].forEach(key => {
            if (cleaned[key] && typeof cleaned[key] === 'string' && cleaned[key].length > SANITY_LIMIT) {
                log(`[SYSTEM] 🚨 HALLUCINATION detected in ${cleaned.item} (${key}). Truncating...`);
                cleaned[key] = cleaned[key].substring(0, 500) + "... [Truncado]";
            }
        });

        // Semantic Correction (v1.6.0): Nullify copago if it mirrors tope/cobertura noise
        if (cleaned.modalidades) {
            cleaned.modalidades = cleaned.modalidades.map((m: any) => ({
                ...m,
                copago: null // SIS semantics: literal cell represents coverage/tope
            }));
        }

        return cleaned;
    }).filter((c: any) => !c.invalid);

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

    // --- FATAL ERROR CHECK ---
    if (coberturas.length === 0) {
        log(`[ContractEngine] ❌ ERROR_EXTRACCION_CONTRATO: No se detectaron coberturas ni topes válidos.`);
        // We throw to stop the pipeline before the auditor runs blind
        // throw new Error("ERROR_EXTRACCION_CONTRATO: no se detectaron coberturas ni topes. Revise la calidad del PDF o el formato.");
        // Commented out throw to allow Fallback Textual to try first below.
    }

    // --- FALLBACK PHASE: TEXT-BASED EXTRACTION (Dual Verification Activation) ---
    // If Vision extraction failed (0 items), we must try fallback methods.
    // --- FALLBACK PHASE: SEQUENTIAL RECOVERY (v15.0) ---
    // If Vision extraction failed (0 items), we attempt progressively more aggressive recovery methods.

    // 1. TEXT FALLBACK (Fast, Cheap) - Try this if we have ANY meaningful text
    if (coberturas.length === 0 && (ocrResult as any).text && (ocrResult as any).text.length > 100) {
        log(`[ContractEngine] ⚠️ VISIÓN ARTIFICIAL FALLÓ. Intentando FALLBACK TEXTUAL (Opción A)...`);

        try {
            const fallbackPrompt = `
            ACTÚA COMO EXPERTO EN ARANCELES MÉDICOS.
            ANALIZA EL SIGUIENTE TEXTO EXTRAÍDO DE UN CONTRATO DE SALUD (OCR):
            ---------------------
            ${(ocrResult as any).text.substring(0, 95000)} ... (Truncado)
            ---------------------
            
            EXTRAE TODAS LAS COBERTURAS, TOPES Y MODALIDADES QUE ENCUENTRES.
            SI ENCUENTRAS TABLAS, RECONSTRUYÉLAS LÓGICAMENTE.
            BUSCA ESPECIALMENTE: HÚMEDO/CLÍNICO, PABELLÓN, DÍA CAMA, MEDICAMENTOS, MATERIALES, HONORARIOS.
            
            RETORNA JSON SEGÚN SCHEMA.
            `;

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: CONTRACT_FAST_MODEL,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: SCHEMA_COBERTURAS as any
                }
            });

            const result = await model.generateContent(fallbackPrompt);
            const textResponse = result.response.text();
            const jsonFallback = safeJsonParse(textResponse);

            if (jsonFallback && Array.isArray((jsonFallback as any).coberturas)) {
                const fallbackCoberturas = (jsonFallback as any).coberturas;
                if (fallbackCoberturas.length > 0) {
                    log(`[ContractEngine] ✅ FALLBACK TEXTUAL EXITOSO: Recuperados ${fallbackCoberturas.length} items.`);
                    const fallbackClean = cleanAndCheck(fallbackCoberturas);
                    coberturas = [...coberturas, ...fallbackClean];
                }
            }
        } catch (fallbackError: any) {
            log(`[ContractEngine] ❌ FALLBACK TEXTUAL FALLÓ: ${fallbackError.message}`);
        }
    }

    // 2. IMAGE FALLBACK (Slow, Powerful - Hail Mary for Scanned Docs)
    // Runs if we STILL have 0 items (either Text Fallback failed, or there was no text, or Text Fallback returned 0)
    if (coberturas.length === 0) {
        log(`[ContractEngine] ⚠️ FALLBACK FINAL: Activando Protocolo de Emergencia por Imagen (Hail Mary)...`);

        for (const currentKey of uniqueKeys) {
            try {
                const genAI = new GoogleGenerativeAI(currentKey);
                const model = genAI.getGenerativeModel({
                    model: CONTRACT_REASONING_MODEL || CONTRACT_FAST_MODEL,
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: SCHEMA_COBERTURAS as any
                    }
                });

                const fallbackPrompt = `
                EMERGENCY EXTRACTION MODE.
                The previous attempts to read this contract failed completely. 
                This is likely a POOR QUALITY SCANNED IMAGE or HANDWRITTEN document.
                
                YOUR GOAL: Scan the visual document pixel-by-pixel for ANY tables defining "Coberturas", "Topes", "Hospitalario", "Ambulatorio".
                
                EXTRACT:
                - Item/Prestación (e.g. Dia Cama, Pabellon, Honorarios)
                - % Cobertura (Preferente/Libre)
                - Topes (UF, Veces Arancel)
                
                CRITICAL:
                - If text is blurry, infer from context columns.
                - Provide your best guess for numbers.
                - Capture at least the "Hospitalario" and "Ambulatorio" sections.
                `;

                const result = await model.generateContent([
                    { text: fallbackPrompt },
                    { inlineData: { data: base64Data, mimeType: mimeType } }
                ]);

                const textResponse = result.response.text();
                const jsonFallback = safeJsonParse(textResponse);

                if (jsonFallback && Array.isArray((jsonFallback as any).coberturas)) {
                    const fallbackCoberturas = (jsonFallback as any).coberturas;
                    if (fallbackCoberturas.length > 0) {
                        log(`[ContractEngine] ✅ FALLBACK IMAGEN EXITOSO (Llave ${currentKey.substring(0, 4)}...): Recuperados ${fallbackCoberturas.length} items de rescate.`);
                        const fallbackClean = cleanAndCheck(fallbackCoberturas);
                        coberturas = [...coberturas, ...fallbackClean];
                        break; // Success!
                    } else {
                        log(`[ContractEngine] ❌ FALLBACK IMAGEN RETORNÓ 0 ITEMS (Llave ${currentKey.substring(0, 4)}...).`);
                    }
                } else {
                    log(`[ContractEngine] ❌ FALLBACK IMAGEN FALLÓ (JSON inválido) con llave ${currentKey.substring(0, 4)}...`);
                }
            } catch (err: any) {
                log(`[ContractEngine] ❌ FALLBACK IMAGEN FALLÓ con llave ${currentKey.substring(0, 4)}...: ${err.message}`);
            }
        }
    }

    // Final check after fallback
    if (coberturas.length === 0) {
        throw new Error("ERROR_EXTRACCION_CONTRATO: El contrato no es legible computacionalmente (coberturas vacías).");
    }

    log(`✅ Final total: ${coberturas.length} items.`);


    // --- IDENTIFICATION BACKUP (v8.0) ---
    // Try to find Isapre and Plan from classifier observations or phase text
    const allText = (ocrResult as any).text || "";
    const isapreMatch = allText.match(/(Banmédica|Colmena|Consalud|Cruz\s+Blanca|Nueva\s+Masvida|Vida\s+Tres|Fonasa)/i);
    const planMatch = allText.match(/Plan\s+([\w\s\d]+)/i);

    const detectedIsapre = isapreMatch ? isapreMatch[0] : (fingerprintPhase.result?.observaciones?.find(o => o.toLowerCase().includes('isapre'))?.split('isapre')?.[1]?.trim() || "Unknown");
    const detectedPlan = planMatch ? planMatch[0] : (fingerprintPhase.result?.observaciones?.find(o => o.toLowerCase().includes('plan'))?.split('plan')?.[1]?.trim() || "Unknown");

    const diseno_ux = {
        nombre_isapre: detectedIsapre !== "Unknown" ? detectedIsapre : (fingerprintPhase.result?.tipo_contrato?.split('_')[0] || "Unknown"),
        titulo_plan: detectedPlan !== "Unknown" ? detectedPlan : (file.originalname.replace('.pdf', '')),
        layout: "modular_phased_v13",
        funcionalidad: "visual_hierarchy_v20",
        salida_json: "unified"
    };

    // --- TOTAL METRICS (Modular Phases) ---
    const allPhases = [fingerprintPhase, ...allModularPhases];
    const totalInput = allPhases.reduce((acc, p) => acc + (p.metrics?.tokensInput || 0), 0);
    const totalOutput = allPhases.reduce((acc, p) => acc + (p.metrics?.tokensOutput || 0), 0);
    const totalCost = allPhases.reduce((acc, p) => acc + (p.metrics?.cost || 0), 0);

    // --- CANONICAL ENRICHMENT LAYER (v1.0) ---
    // Rule: Evidence is frozen. Enrichment reasons and normalizes.
    const hasPreferente = fingerprintPhase.result?.tiene_oferta_preferente !== false;

    // 1. Evidence: Pure Literal from extraction
    const coberturas_evidencia = coberturas.map(c => ({
        ...c,
        modalidades: c.modalidades.filter(m => hasPreferente || m.tipo !== 'PREFERENTE')
    }));

    // 2. Enriched: Reasoned and Normalized
    const itemCollisionSet = new Set<string>();
    const coberturas_enriquecidas = coberturas_evidencia.filter(c => {
        // V2 — Duplicados exactos (Deduplicación determinista por clave)
        const firstMod = c.modalidades[0];
        const key = `${c.categoria}|${c.seccion_raw}|${c.item}|${firstMod?.tipo}|${firstMod?.evidencia_literal}`;

        if (itemCollisionSet.has(key)) return false;
        itemCollisionSet.add(key);
        return true;
    }).map((c, idx) => {
        let enriched = { ...c };

        // AMBITO-CATEGORY CONSISTENCY
        if (enriched.ambito === 'HOSPITALARIO') enriched.categoria_canonica = 'HOSPITALARIO';
        else if (enriched.ambito === 'AMBULATORIO') enriched.categoria_canonica = 'AMBULATORIO';

        // Normalized normalization (v1.7.0)
        enriched.modalidades = enriched.modalidades.map((mod, mIdx) => {
            const norm = (mod.unidadTope === 'MIXTO')
                ? { factor: null, unit: 'MIXTO', raw: mod.tope }
                : normalizeTopeFactor(mod.tope as string, mod.unidadTope);

            // R1-R8: Proyectar tope compuesto
            const tope_compuesto = parseCompoundTope(mod.evidencia_literal);

            // R6 — Tipificación de “MIXTO” (Evento + Anual)
            let tipoTopeGlobal = mod.tipoTope;
            const hasAnual = tope_compuesto.some(tc => tc.tipoTope === 'TOPE_ANUAL');
            const hasEvento = tope_compuesto.some(tc => tc.tipoTope === 'TOPE_EVENTO');
            if (hasAnual && hasEvento) tipoTopeGlobal = 'MIXTO_EVENTO_Y_ANUAL' as any;

            // R9 — “Por evento durante la Hospitalización”
            const upart = mod.evidencia_literal.toUpperCase();
            const uitem = enriched.item.toUpperCase();
            if (uitem.includes('POR EVENTO DURANTE LA HOSPITALIZACIÓN') || upart.includes('POR EVENTO DURANTE LA HOSPITALIZACIÓN')) {
                tipoTopeGlobal = 'POR_EVENTO';
            }

            // R10 — “PAD dental”
            let subdominio: any = 'GLOBAL';
            if (uitem.includes('PAD') || uitem.includes('PA D')) subdominio = 'DENTAL_PAD';
            if (uitem.includes('MEDICAMENTOS')) subdominio = 'MEDICAMENTOS';

            // V1 — Unidad mal declarada (SIN TOPE + UF Internacional)
            let unidadNormalizada: any = norm.unit;
            if (upart.includes('SIN TOPE') && upart.includes('UF')) {
                unidadNormalizada = 'COMPUESTO';
            }

            // FIX #3: Eliminar DESCONOCIDO - Colapsar tipoTope desde tope_compuesto
            if (tipoTopeGlobal === 'DESCONOCIDO' && tope_compuesto.length > 0) {
                const tipos = tope_compuesto.map(tc => tc.tipoTope).filter(Boolean);
                if (tipos.includes('TOPE_ANUAL') && tipos.includes('TOPE_EVENTO')) {
                    tipoTopeGlobal = 'MIXTO_EVENTO_Y_ANUAL' as any;
                } else if (tipos.includes('TOPE_ANUAL')) {
                    tipoTopeGlobal = 'ANUAL';
                } else {
                    tipoTopeGlobal = 'POR_EVENTO'; // Default para topes simples
                }
            }

            // FIX #4: Inferir contexto_clinico desde item y ambito
            let contexto_clinico: any = 'GLOBAL';
            if (uitem.includes('QUIRÚRGIC') || uitem.includes('PABELLON') || uitem.includes('PABELLÓN') || uitem.includes('CIRUGÍA') || uitem.includes('HONORARIOS MÉDICOS QUIRÚRGICOS')) {
                contexto_clinico = enriched.ambito === 'HOSPITALARIO' ? 'QUIRURGICO_HOSPITALARIO' : 'QUIRURGICO_AMBULATORIO';
            } else if (uitem.includes('CONSULTA')) {
                contexto_clinico = 'CONSULTA';
            } else if (uitem.includes('EXÁMEN') || uitem.includes('EXAMEN') || uitem.includes('LABORATORIO') || uitem.includes('IMAGEN') || uitem.includes('TAC') || uitem.includes('SCANNER') || uitem.includes('RESONANCIA') || uitem.includes('ECOTOMO') || uitem.includes('RAYOS')) {
                contexto_clinico = 'DIAGNOSTICO';
            } else if (uitem.includes('KINESIOLOG') || uitem.includes('FONOAUDIO') || uitem.includes('TERAPIA') || uitem.includes('PSICOTERAP')) {
                contexto_clinico = 'TERAPIA';
            } else if (uitem.includes('MEDICAMENTOS') || uitem.includes('MATERIALES') || uitem.includes('INSUMOS') || uitem.includes('PRÓTESIS') || uitem.includes('PROTESIS') || uitem.includes('ÓRTESIS') || uitem.includes('ORTESIS')) {
                contexto_clinico = 'INSUMOS';
            }

            // FIX #2: Recalibrar flag_inconsistencia_porcentaje
            // Solo disparar si es REALMENTE inconsistente, no para items quirúrgicos conocidos
            let flagInconsistencia = false;
            const itemsQuirurgicosAmbulatorios100 = ['HONORARIOS MÉDICOS QUIRÚRGICOS', 'PABELLÓN', 'PABELLON', 'BOX AMBULATORIO', 'DERECHO DE PABELLÓN', 'DERECHO DE PABELLON'];
            const esItemQuirurgicoAmb = itemsQuirurgicosAmbulatorios100.some(kw => uitem.includes(kw));

            if (enriched.ambito === 'AMBULATORIO' && mod.porcentaje === 100 && !esItemQuirurgicoAmb) {
                // Solo flaggear si NO es un item quirúrgico conocido
                flagInconsistencia = true;
            }

            // V4 — Segmento “95% Nivel I, II...” (Nivel rules)
            const reglas_por_nivel: any[] = [];
            const nivelMatches = upart.match(/(\d+)%\s+NIVEL\s+(I|II|III)/g);
            if (nivelMatches) {
                nivelMatches.forEach(m => {
                    const match = m.match(/(\d+)%\s+NIVEL\s+(I|II|III)/);
                    if (match) reglas_por_nivel.push({ nivel: match[2], porcentaje: parseInt(match[1]) });
                });
            }

            return {
                ...mod,
                interpretacion_sugerida: `IA detectó ${mod.porcentaje}% con evidencia: ${mod.evidencia_literal}`,
                tope_normalizado: norm.factor,
                unidad_normalizada: unidadNormalizada,
                tope_raw: norm.raw,
                tope_compuesto,
                tipoTope: tipoTopeGlobal,
                reglas_por_nivel: reglas_por_nivel.length > 0 ? reglas_por_nivel : undefined,
                subdominio,
                contexto_clinico,
                flag_inconsistencia_porcentaje: flagInconsistencia,
                source_occurrence_id: `${enriched.ambito === 'HOSPITALARIO' ? 'HOSP' : 'AMB'}_ITEM_${idx}_M${mIdx}`
            };

        });

        return enriched;
    });

    const result: ExplorationJSON = {
        fingerprint: fingerprintPhase.result || undefined,
        reglas: [],
        coberturas_evidencia,
        coberturas_enriquecidas,
        // FIX #1: Eliminamos 'coberturas' duplicado. UI debe usar solo coberturas_enriquecidas.
        coberturas: coberturas_enriquecidas, // DEPRECADO - UI fallback hasta refactor
        diseno_ux,
        rawMarkdown: (ocrResult as any).text || '',
        metrics: {
            executionTimeMs: Date.now() - startTime,
            tokenUsage: {
                input: totalInput,
                output: totalOutput,
                total: totalInput + totalOutput,
                costClp: totalCost,
                totalPages: (ocrResult as any).totalPages || 0,
                phaseSuccess: phaseResults.reduce((acc, r, i) => ({ ...acc, [PHASES[i].id]: r.phase.success }), { CLASSIFIER: fingerprintPhase.success }),
                phases: [
                    { phase: "Clasificación", ...getMetrics(fingerprintPhase) },
                    ...phaseResults.map((r, i) => ({ phase: PHASES[i].id, ...getMetrics(r.phase) }))
                ]
            },
            extractionBreakdown: {
                totalReglas: 0,
                totalCoberturas: coberturas_enriquecidas.length,
                totalItems: coberturas_evidencia.length
            }
        }
    };

    function getMetrics(p: any) {
        return {
            totalTokens: (p.metrics?.tokensInput || 0) + (p.metrics?.tokensOutput || 0),
            promptTokens: p.metrics?.tokensInput || 0,
            candidatesTokens: p.metrics?.tokensOutput || 0,
            estimatedCostCLP: p.metrics?.cost || 0
        }
    };

    // --- SAVE TO CACHE (Phase 13) ---
    await ContractCacheService.save(fileHash, result);
    log(`\n[ContractEngine] ✅ Analysis persisted to cache for future use.`);

    return result;
}
