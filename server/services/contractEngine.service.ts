import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import {
    ContractAnalysisResult,
    ContractAnalysisOptions,
    UploadedFile,
    ContractCoverage
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
    if (!raw || s === "—" || s === "-" || /sin tope|ilimitado/i.test(s)) {
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

    // Default fallback (soft fail or treat as pesos/unknown)
    return { tope: num, unidad: "SIN_TOPE", tipoTope: "ILIMITADO" };
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
            ambito: prestacion.toLowerCase().includes("hospital") ? "HOSPITALARIO" : "AMBULATORIO", // Simple heuristic for now
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
            ambito: prestacion.toLowerCase().includes("hospital") ? "HOSPITALARIO" : "AMBULATORIO",
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

    // --- TEXT EXTRACTION PHASE (Dual Verification) ---
    const textExtractionPromise = extractTextFromPdf(file, CONTRACT_OCR_MAX_PAGES, log);

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
        extrasPhase,
        ocrResult // New
    ] = await Promise.all([...phasePromises, textExtractionPromise]);

    log(`\n[ContractEngine] ✅ 12 Fases Modulares + OCR Completadas.`);

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
    let coberturasHospRaw = [
        ...(hospP1Phase.result?.coberturas || []),
        ...(hospP2Phase.result?.coberturas || [])
    ];
    let coberturasAmbRaw = [
        ...(ambP1Phase.result?.coberturas || []),
        ...(ambP2Phase.result?.coberturas || []),
        ...(ambP3Phase.result?.coberturas || []),
        ...(ambP4Phase.result?.coberturas || [])
    ];
    let coberturasExtrasRaw = extrasPhase.result?.coberturas || [];

    // --- INTEGRATION: DETERMINISTIC MARKDOWN PARSER ---
    // We attempt to parse the OCR markdown directly.
    // If successful, we can use these items directly or merge them.
    // For now, let's inject them into the raw streams.

    if ((ocrResult as any).text) {
        log(`[ContractEngine] 🧠 Ejecutando Parser Determinístico en Markdown OCR...`);
        const deterministicCoverages = parseContractMarkdown((ocrResult as any).text);
        log(`[ContractEngine] 🧩 Items Determinísticos Encontrados: ${deterministicCoverages.length}`);

        if (deterministicCoverages.length > 0) {
            // We classify and inject them based on 'ambito' hint or just into EXTRAS for now 
            // but mapped correctly to the flat structure expected by cleanAndCheck/contractTypes

            // Convert ContractCoverage (Flat) to Cobertura (Nested) structure expected by cleanAndCheck for now?
            // OR better: cleanAndCheck expects the nested structure 'modalidades'.
            // The Parser returns Flat ContractCoverage.
            // We need a helper to group Flat -> Nested if we want to reuse cleanAndCheck logic.

            const groupedDeterministic: any[] = [];
            const map = new Map<string, any>();

            deterministicCoverages.forEach(d => {
                if (!map.has(d.prestacion)) {
                    map.set(d.prestacion, {
                        item: d.prestacion,
                        categoria: d.prestacion, // Temporary
                        modalidades: []
                    });
                    groupedDeterministic.push(map.get(d.prestacion));
                }

                const entry = map.get(d.prestacion);
                entry.modalidades.push({
                    tipo: d.modalidad,
                    tope: d.tope !== null ? d.tope : undefined,
                    unidadTope: d.unidad,
                    tipoTope: d.tipoTope
                });
            });

            log(`[ContractEngine] 🧩 Items Agrupados (Nested): ${groupedDeterministic.length}`);

            // If AI failed significantly, we might want to REPLACE.
            // For safety, let's APPEND to extras or respective buckets.
            // Ambito helps.

            deterministicCoverages.forEach(d => {
                // We actually already grouped them above.
            });

            // Let's just append grouped properties to extras for robust processing
            coberturasExtrasRaw = [...coberturasExtrasRaw, ...groupedDeterministic];
        }
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
    function normalizeTopeFactor(val: any, unitHint?: string): { factor: number | null; unit: 'UF' | 'AC2' | 'PESOS' | 'SIN_TOPE' | 'UNKNOWN', raw: string } {
        const raw = String(val || "").trim();
        const s = raw.toUpperCase();

        if (!val || s === '-' || s === '---' || s === '—' || s === "NULL") {
            return { factor: null, unit: 'UNKNOWN', raw };
        }

        if (s.includes('SIN TOPE') || s.includes('ILIMITADO') || s.includes('SIN LIMITE')) {
            return { factor: null, unit: 'SIN_TOPE', raw };
        }

        // Try to parse number (handles 1.2, 1,2, 4.5, etc.)
        const numMatch = s.match(/([\d\.,]+)/);
        let factor = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;

        let unit: 'UF' | 'AC2' | 'PESOS' | 'UNKNOWN' = 'UNKNOWN';

        if (s.includes('AC2') || s.includes('ARANCEL') || unitHint === 'AC2') unit = 'AC2';
        else if (s.includes('UF') || unitHint === 'UF') unit = 'UF';
        else if (s.includes('$') || s.includes('PESOS') || unitHint === 'PESOS') unit = 'PESOS';

        // Fallback: If just a number < 50 likely UF or factor, if > 1000 likely Pesos. 
        // But better to remain UNKNOWN if ambiguous.

        return { factor, unit, raw };
    }

    const cleanAndCheck = (list: any[]) => list.map((cob: any) => {
        let cleaned = { ...cob };

        // --- PHASE 1: STRUCTURAL INTEGRITY CHECK (v14.0 Strict) ---
        if (!cleaned.modalidades || !Array.isArray(cleaned.modalidades) || cleaned.modalidades.length === 0) {
            // Force create modalities if missing but flat fields exist (Recovery)
            if (cleaned.topePreferente || cleaned.topeLibre) {
                cleaned.modalidades = [];
                if (cleaned.topePreferente) cleaned.modalidades.push({ tipo: 'PREFERENTE', tope: cleaned.topePreferente, unitTope: 'UNKNOWN' });
                if (cleaned.topeLibre) cleaned.modalidades.push({ tipo: 'LIBRE_ELECCION', tope: cleaned.topeLibre, unitTope: 'UNKNOWN' });
            } else {
                // Skip throwing here to allow recovery statistics, but filter out later if needed.
                // For now, we tag it invalid.
                cleaned.invalid = true;
            }
        }

        // --- PHASE 2: CANONICAL NORMALIZATION (v9.0) ---
        cleaned.categoria_canonica = getCanonicalCategory(
            cleaned.item || cleaned.prestacion || cleaned['PRESTACIÓN CLAVE'] || '',
            cleaned.categoria || ''
        );

        if (!cleaned.nota_restriccion || cleaned.nota_restriccion === null) {
            cleaned.nota_restriccion = "Sin restricciones adicionales especificadas. Sujeto a condiciones generales del plan.";
        }

        // --- PHASE 3: LOGICAL VALIDATION & NORMALIZATION (v12.0 - Deep Structure) ---
        const itemName = String(cleaned.item || '').toLowerCase();

        if (cleaned.modalidades) {
            cleaned.modalidades = cleaned.modalidades.map((mod: any) => {
                // Normalize Ceiling
                const norm = normalizeTopeFactor(mod.tope, mod.unidadTope);

                // Apply corrections
                if (itemName.includes('medicamento') || itemName.includes('insumo') || itemName.includes('material')) {
                    // Materials usually have numeric caps
                }

                return {
                    ...mod,
                    tope_normalizado: norm.factor,
                    unidad_normalizada: norm.unit,
                    tope_raw: norm.raw
                };
            });
        }

        // Sanity Check
        const SANITY_LIMIT = 2000;
        ['item', 'nota_restriccion'].forEach(key => {
            if (cleaned[key] && typeof cleaned[key] === 'string' && cleaned[key].length > SANITY_LIMIT) {
                log(`[SYSTEM] 🚨 HALLUCINATION detected in ${cleaned.item} (${key}). Truncating...`);
                cleaned[key] = cleaned[key].substring(0, 500) + "... [Truncado]";
            }
        });
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
            SI ENCUENTRAS TABLAS, RECONSTRÚYELAS LÓGICAMENTE.
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
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            // Use the strongest available reasoning model for the final attempt
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
                    log(`[ContractEngine] ✅ FALLBACK IMAGEN EXITOSO: Recuperados ${fallbackCoberturas.length} items de rescate.`);
                    const fallbackClean = cleanAndCheck(fallbackCoberturas);
                    coberturas = [...coberturas, ...fallbackClean];
                } else {
                    log(`[ContractEngine] ❌ FALLBACK IMAGEN RETORNÓ 0 ITEMS.`);
                }
            } else {
                log(`[ContractEngine] ❌ FALLBACK IMAGEN FALLÓ (JSON inválido).`);
            }
        } catch (err: any) {
            log(`[ContractEngine] ❌ FALLBACK IMAGEN FALLÓ CRÍTICAMENTE: ${err.message}`);
        }
    }

    // Final check after fallback
    if (coberturas.length === 0) {
        throw new Error("ERROR_EXTRACCION_CONTRATO: El contrato no es legible computacionalmente (coberturas vacías).");
    }

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
        rawMarkdown: (ocrResult as any).text || '', // Include Markdown for Dual Verification
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
