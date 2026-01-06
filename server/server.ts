import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiService } from './services/gemini.service.js';
import { ParserService } from "./services/parser.service.js";
import { AI_CONFIG, GENERATION_CONFIG } from "./config/ai.config.js";
import { handlePamExtraction } from './endpoints/pam.endpoint.js';
import { handleContractExtraction } from './endpoints/contract.endpoint.js';
import { handleAuditAnalysis } from './endpoints/audit.endpoint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ⚠️ CRITICAL: Only load dotenv in development
// Railway injects env vars natively, dotenv.config() interferes
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

// ✅ Railway-compatible env access (Object.keys can fail in some runtimes)
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

// Environment Check
console.log("\n" + "=".repeat(50));
console.log("🚀 AUDIT SERVER BOOTSTRAP");
console.log("\n=== RAILWAY CONTEXT ===");
console.log("SERVICE:", envGet("RAILWAY_SERVICE_NAME") || "N/A");
console.log("ENV:", envGet("RAILWAY_ENVIRONMENT_NAME") || "N/A");
console.log("PROJECT:", envGet("RAILWAY_PROJECT_NAME") || "N/A");
console.log("=======================\n");

const ENV_KEYS = Object.getOwnPropertyNames(process.env);
console.log("[ENV_CHECK] Total Vars:", ENV_KEYS.length);
console.log("[ENV_CHECK] Keys sample:", ENV_KEYS.slice(0, 30));
console.log("[ENV_CHECK] NODE_ENV:", envGet("NODE_ENV") || "development");
console.log("[ENV_CHECK] has PORT:", Boolean(envGet("PORT")));
console.log("[ENV_CHECK] has RAILWAY_PROJECT_ID:", Boolean(envGet("RAILWAY_PROJECT_ID")));

// Read API key with Railway-compatible method
const GEMINI_API_KEY = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
console.log("[ENV_CHECK] GEMINI KEY PRESENT:", Boolean(GEMINI_API_KEY));

if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY NOT FOUND (checked GEMINI_API_KEY + API_KEY)");
} else {
    console.log(`✅ GEMINI_API_KEY LOADED`);
    console.log(`   Key preview: ${GEMINI_API_KEY.substring(0, 8)}...${GEMINI_API_KEY.slice(-4)}`);
}

const GEMINI_SEC = envGet("GEMINI_API_KEY_SECONDARY");
if (GEMINI_SEC) {
    console.log(`✅ GEMINI_API_KEY_SECONDARY LOADED`);
    console.log(`   Key preview: ${GEMINI_SEC.substring(0, 8)}...${GEMINI_SEC.slice(-4)}`);
} else {
    console.log(`⚪ NO SECONDARY KEY FOUND (Optional)`);
}
console.log("=".repeat(50) + "\n");

// 🛡️ GLOBAL CRASH GUARD
// Evita que el servidor se reinicie por errores "flaky" de librerías externas (ej: Google AI stream)
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
    // No salimos (process.exit) para mantener el servidor vivo ante fallos transitorios
});

process.on('uncaughtException', (err) => {
    console.error('🚨 [CRITICAL] Uncaught Exception:', err);
    // En producción idealmente se reinicia, pero en este dev-server preferimos aguantar
    // a menos que sea algo irrecuperable.
});

const app = express();
// ✅ Railway requires listening to process.env.PORT
const PORT = Number(envGet("PORT") || 5000);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage() });

// Helper para obtener la API Key
const getApiKey = () => GEMINI_API_KEY;

const billingSchema = {
    type: "object",
    properties: {
        clinicName: { type: "string" },
        patientName: { type: "string" },
        invoiceNumber: { type: "string" },
        date: { type: "string" },
        currency: { type: "string", description: "Currency symbol or code, e.g., CLP" },
        sections: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    category: { type: "string", description: "Categoría (Ej: Pabellón, Insumos, Farmacia)" },
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                index: { type: "number", description: "Número correlativo del ítem" },
                                description: { type: "string" },
                                quantity: { type: "number" },
                                unitPrice: { type: "number", description: "Precio unitario (preferiblemente bruto/ISA)" },
                                total: { type: "number", description: "Valor Total del ítem incluyendo IVA/Impuestos (Valor ISA)" },
                                bonification: { type: "number", description: "Bonificación, Copago o Reembolso si existe" }
                            },
                            required: ["index", "description", "total"]
                        }
                    },
                    sectionTotal: { type: "number", description: "Total declarado por la clínica para la sección" }
                },
                required: ["category", "items", "sectionTotal"]
            }
        },
        clinicStatedTotal: { type: "number", description: "El Gran Total final de la cuenta" }
    },
    required: ["clinicName", "sections", "clinicStatedTotal"]
};

const EXTRACTION_PROMPT = `
    ACTÚA COMO UN AUDITOR FORENSE DE CUENTAS CLÍNICAS CHILENAS.
    
    CONTEXTO DE "CAJA NEGRA":
    Las clínicas en Chile usan formatos confusos para ocultar el costo real. 
    A menudo presentan una columna "Valor" (Neto) y mucho después una columna "Valor ISA" (Bruto con IVA).
    
    REGLA DE ORO DE TRAZABILIDAD Y MATEMÁTICA:
    - NUMERA LOS ÍTEMS: Cada ítem debe tener un campo 'index' comenzando desde 1 para toda la cuenta.
    - NO AGRUPES SECCIONES: Extrae cada sección por separado como aparece en el papel.
    - PRIORIZA VALORES BRUTOS (VALOR ISA): La auditoría se basa en el costo real final.
    - CONSISTENCIA MATEMÁTICA OBLIGATORIA: Antes de escribir cada línea, verifica que (unitPrice * quantity = total).
    - NORMALIZACIÓN: Si el documento muestra un Precio Neto pero el Total es Bruto (con IVA), DEBES extraer el unitPrice como (Total / Cantidad). El objetivo es que Price * Qty NUNCA de error de cálculo.
    - HONORARIOS FRACCIONARIOS (0.1, 0.25, etc.): El 'total' DEBE ser proporcional (ej: 0.1 * 4.000.000 = 400.000). Prohibido alucinar el total de la cirugía completa en líneas de porcentaje.
    - BLOQUE DE CÁLCULO: En el formato de salida, DEBES incluir el resultado de tu multiplicación en la columna de verificación.

    REGLA DE RECONCILIACIÓN MATEMÁTICA (AUDITORÍA INTERNA):
    - TU PRIORIDAD ES LA EXHAUSTIVIDAD: Si el subtotal de la sección no coincide con lo que estás viendo en los ítems, NO TE DETENGAS NI RESUMAS. Extrae CADA ítem exactamente como aparece.
    - TU VERDAD SON LOS ÍTEMS: Si la clínica sumó mal, el auditor lo verá después. Tu trabajo es listar el 100% de las filas.

    REGLA DE HONORARIOS Y PORCENTAJES:
    - En secciones de Honorarios (6010, 6011, etc.), si la cantidad es fraccionaria (0.1, 0.2, 0.25, etc.), el Total DEBE ser el resultado de esa fracción (ej: 0.1 * 4.000.000 = 400.000). Prohibido poner el total de la cirugía completa en una línea de porcentaje.
    - Si el papel muestra el total de la cirugía pero tú estás extrayendo una línea de "Primer Ayudante (0.25)", el total de esa línea es el 25%.

    REGLA ANTIFUSIÓN Y PRECIOS:
    - IVA Y ARITMÉTICA: A veces el Precio Unitario es NETO y el Total es BRUTO (Precio * 1.19 * Cantidad). Si ves esto, extrae el precio tal cual.
    - "PRICE BLEED": Separa códigos de precio (ej: 2.470500501 -> 2.470).

    REGLA DE NEGATIVOS (REVERSIONES):
    - Las líneas con signo menos (-) o entre paréntesis ( ) son CRÉDITOS/REVERSIONES.
    - DEBES extraer el valor como NEGATIVO (ej: -1, -3006). Esto es vital para que la suma cuadre.

    INSTRUCCIONES DE EXTRACCIÓN EXHAUSTIVA:
    0. MARCADOR DE PÁGINA: Cada vez que comiences a leer una nueva página, escribe obligatoriamente "PAGE: n".
    1. Identifica las cabeceras de sección y sus subtotales declarados.
    2. EXTRAE CADA LÍNEA DEL DESGLOSE SIN EXCEPCIÓN. Si hay 56 fármacos, deben salir 56 fármacos.
    3. FORMATO NUMÉRICO ESTRICTO: Solo números enteros en precios/totales.
    4. PROHIBIDO INVENTAR O RESUMIR.
    5. Absolutamente prohibido usar puntos suspensivos (...) o detenerse antes del final de la cuenta.
`;

// Helper to get all API keys
const getApiKeys = () => {
    const keys = [];
    if (envGet("GEMINI_API_KEY")) keys.push(envGet("GEMINI_API_KEY"));
    if (envGet("API_KEY")) keys.push(envGet("API_KEY"));
    if (envGet("GEMINI_API_KEY_SECONDARY")) keys.push(envGet("GEMINI_API_KEY_SECONDARY"));
    // Deduplicate
    return [...new Set(keys)].filter(k => !!k);
};

app.post('/api/extract', async (req, res) => {
    console.log(`[REQUEST] New extraction request (Streaming)`);

    // Configurar cabeceras para streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        if (!res.writableEnded) {
            res.write(JSON.stringify(data) + '\n');
        }
    };

    const forensicLog = (msg: string) => {
        console.log(`[FORENSIC] ${msg}`);
        sendUpdate({ type: 'chunk', text: `[FORENSIC] ${msg}` });
    };

    forensicLog("Iniciando análisis forense de la cuenta clínica.");

    try {
        const { image, mimeType } = req.body;
        console.log(`[REQUEST] Processing image style: ${mimeType}`);

        const apiKeys = getApiKeys();
        console.log(`[AUTH] Found ${apiKeys.length} API Keys.`);

        if (!image || !mimeType) {
            console.error(`[ERROR] Missing payload: image=${!!image}, mimeType=${mimeType}`);
            return res.status(400).json({ error: 'Missing image data or mimeType' });
        }

        if (apiKeys.length === 0) {
            console.error(`[CRITICAL] Cannot proceed without API Key`);
            return res.status(500).json({ error: 'Server configuration error: Gemini API Key not found' });
        }

        const CSV_PROMPT = `
        ${EXTRACTION_PROMPT}

        INSTRUCCIONES DE FORMATO SALIDA (JERÁRQUICO):
        1. Al principio, extrae estos metadatos si están visibles (si no, usa "N/A"):
           CLINIC: [Nombre de la Clínica/Institución]
           PATIENT: [Nombre del Paciente]
           INVOICE: [Número de Cuenta/Folio/Factura]
           DATE: [Fecha de la Cuenta]
           GRAND_TOTAL: [Valor Total Final de la Cuenta]
        2. NO repitas el nombre de la sección en cada línea. Úsalo como CABECERA.
        3. Estructura:
          CLINIC: ...
          PATIENT: ...
          INVOICE: ...
          DATE: ...
          GRAND_TOTAL: ...
          SECTION: [Nombre Exacto Sección]
          [Index]|[Código]|[Descripción]|[Cant]|[PrecioUnit]|[Verif: Cant*Precio]|[Total]|[Bonificación/Copago]
          SECTION_TOTAL: [Subtotal Declarado por la Clínica para esta Sección]
          SECTION: [Siguiente Sección...]
          ...
        `;

        let resultStream;
        let lastError: any;
        let activeApiKey: string | undefined;

        // RETRY LOOP WITH FAILURE OVER KEYS AND MODELS
        const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL];

        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            console.log(`[AUTH] 🛡️ Attempting extraction with model: ${modelName}`);

            for (const apiKey of apiKeys) {
                const keyMask = apiKey ? (apiKey.substring(0, 4) + '...') : '???';
                console.log(`[AUTH] Trying with API Key: ${keyMask} (Model: ${modelName})`);

                try {
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                            temperature: GENERATION_CONFIG.temperature,
                            topP: GENERATION_CONFIG.topP,
                            topK: GENERATION_CONFIG.topK
                        }
                    });

                    resultStream = await model.generateContentStream([
                        { text: CSV_PROMPT },
                        {
                            inlineData: {
                                data: image,
                                mimeType: mimeType
                            }
                        }
                    ]);

                    // If successful, break both loops
                    if (resultStream) {
                        console.log(`[AUTH] Success with Key: ${keyMask} on Model: ${modelName}`);
                        activeApiKey = apiKey;

                        // Critical: Update pricing used for this successful request if possible, 
                        // but actually pricing is static map. We should probably note which model won.
                        // For now just breaking.
                        break;
                    }

                } catch (attemptError: any) {
                    console.warn(`[AUTH] Failed with Key: ${keyMask} on ${modelName}:`, attemptError.message);
                    lastError = attemptError;
                    const errStr = (attemptError?.toString() || "") + (attemptError?.message || "");

                    // If 400 Bad Request (Invalid Argument), switching models/keys might not help if prompt is bad,
                    // but switching model MIGHT help if one model doesn't support a param.
                    // For 429/500, definitely retry.
                }
            }
            if (activeApiKey) break; // Found a working key/model combo
            console.warn(`[AUTH] ⚠️ All keys failed for model ${modelName}. Switching to next model if available...`);
        }

        if (!resultStream) {
            console.error("❌All API Keys failed.");
            // Handle last error specifically
            const errStr = (lastError?.toString() || "") + (lastError?.message || "");
            const has429 = errStr.includes('429') || errStr.includes('Too Many Requests') || lastError?.status === 429;

            if (has429) {
                sendUpdate({
                    type: 'error',
                    message: '⏳ Todas las claves de API están saturadas (Quota Exceeded). Por favor espera 1-2 minutos.'
                });
                return res.end();
            }
            throw lastError || new Error("All API attempts failed");
        }


        let fullText = "";
        let previousLength = 0;
        let stuckCount = 0;
        let maxIterations = 10000; // Safety limit
        let iteration = 0;

        for await (const chunk of resultStream.stream) {
            iteration++;

            // Safety check: prevent infinite loops
            if (iteration > maxIterations) {
                console.error(`[CRITICAL] Stream exceeded ${maxIterations} iterations. Breaking loop.`);
                break;
            }

            const chunkText = chunk.text();
            fullText += chunkText;

            // Detect stuck stream (same length for 3+ iterations)
            if (fullText.length === previousLength) {
                stuckCount++;
                if (stuckCount > 3) {
                    console.log(`[WARN] Stream appears stuck at ${fullText.length} chars. Breaking loop.`);
                    break;
                }
            } else {
                stuckCount = 0; // Reset counter
            }
            previousLength = fullText.length;

            console.log(`[CHUNK] Received chunk: ${chunkText.length} chars (Total: ${fullText.length})`);
            // Enviar el texto extraído en tiempo real al log del frontend
            sendUpdate({ type: 'chunk', text: chunkText });

            // Enviar actualización de tokens si está disponible en el chunk
            const usage = chunk.usageMetadata;
            if (usage) {
                const promptTokens = usage.promptTokenCount || 0;
                const candidatesTokens = usage.candidatesTokenCount || 0;
                const totalTokens = usage.totalTokenCount || 0;

                const { estimatedCost, estimatedCostCLP } = GeminiService.calculateCost(AI_CONFIG.ACTIVE_MODEL, promptTokens, candidatesTokens);

                sendUpdate({
                    type: 'usage',
                    usage: {
                        promptTokens,
                        candidatesTokens,
                        totalTokens,
                        estimatedCost,
                        estimatedCostCLP
                    }
                });
            } else {
                sendUpdate({ type: 'progress', length: fullText.length });
            }
        }

        console.log(`\n[DEBUG] Extracción finalizada. Longitud total texto: ${fullText.length} caracteres.`);
        if (fullText.length === 0) {
            console.warn("[WARN] Gemini devolvió un texto vacío.");
        }

        console.log(`[PROCESS] Starting data parsing for ${fullText.length} chars...`);
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
        const sectionsMap = new Map<string, any>();
        const sectionPageTracking = new Map<string, Set<number>>();
        let currentSectionName = "SECCION_DESCONOCIDA";
        let currentPage = 1;
        let globalIndex = 1;

        let clinicGrandTotalField = 0;
        let clinicName = "CLINICA INDISA";
        let patientName = "PACIENTE AUDITORIA";
        let invoiceNumber = "000000";
        let billingDate = new Date().toLocaleDateString('es-CL');

        const cleanCLP = (value: string, isQuantity: boolean = false): number => {
            if (!value) return 0;
            let cleaned = value.trim();

            // Handle parentheses for negatives (ej: (1.234) -> -1.234)
            if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
                cleaned = '-' + cleaned.substring(1, cleaned.length - 1);
            }

            // Now remove non-numeric characters, but keep '.', ',', and '-'
            cleaned = cleaned.replace(/[^\d.,-]/g, '');
            if (cleaned === '' || cleaned === '-') return 0;

            // Start cleaning from first digit or minus sign
            const firstNumeric = cleaned.search(/[0-9-]/);
            if (firstNumeric > 0) cleaned = cleaned.substring(firstNumeric);

            // Handle Chilean format if comma exists
            if (cleaned.includes(',')) {
                // "1.000,50" -> "1000.50"
                return parseFloat(cleaned.replace(/\./g, '').replace(/,/g, '.')) || 0;
            }

            // Handle ambiguity: dots without commas
            const dots = (cleaned.match(/\./g) || []).length;
            if (dots === 1) {
                const parts = cleaned.split('.');

                // CRITICAL FIX: Context-Aware Parsing
                // If it's a PRICE/TOTAL in CLP, decimals are almost non-existent (no cents).
                // So "24.000" MUST be 24000.
                if (!isQuantity) {
                    // For prices, assume dot is thousands separator unless typically small floating math from AI
                    // But AI usually outputs "24000" or "24.000".
                    // Safe bet for CLP: Treat dot as thousands.
                    return parseFloat(cleaned.replace(/\./g, '')) || 0;
                }

                // For QUANTITY, "1.000" might be 1. "0.5" is 0.5.
                // Logic: If decimal part is "000", it's likely an integer formatted with thousands.
                if (parts[1] === "000") {
                    // 1.000 -> 1000? Or 1?
                    // In medical quantities, 1000 units is rare but possible (grams?).
                    // But 1.000 (1) is also possible output from AI.
                    // Let's stick to previous logic for quantities: small numbers are decimals.
                    if (parts[0].length <= 2) {
                        return parseFloat(cleaned) || 0; // 1.000 -> 1
                    } else {
                        return parseFloat(cleaned.replace(/\./g, '')) || 0; // 100.000 -> 100000
                    }
                }

                // If it ends with .00 or .0, it's a decimal (1.0 -> 1)
                if (parts[1].length !== 3) {
                    return parseFloat(cleaned) || 0;
                }

                // Default: Treat as thousands
                return parseFloat(cleaned.replace(/\./g, '')) || 0;
            } else if (dots > 1) {
                // "1.000.000" -> thousands
                return parseFloat(cleaned.replace(/\./g, '')) || 0;
            }

            // No dots/commas or scientific notation/plain
            const finalVal = cleaned.replace(/[^\d.eE-]/g, '');
            return parseFloat(finalVal) || 0;
        };

        const robustSplit = (line: string): string[] => {
            // Remove leading and trailing pipes if they exist (Markdown table style)
            let trimmed = line.trim();
            if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
            if (trimmed.endsWith('|')) trimmed = trimmed.substring(0, trimmed.length - 1);
            return trimmed.split('|').map(c => c.trim());
        };

        const processedItemsSet = new Set<string>();
        for (const line of lines) {
            if (line.startsWith('GRAND_TOTAL:')) {
                const rawVal = line.replace('GRAND_TOTAL:', '').trim();
                clinicGrandTotalField = Math.round(cleanCLP(rawVal, false));
                console.log(`[PARSER] Raw GRAND_TOTAL: "${rawVal}" -> Parsed: ${clinicGrandTotalField}`);
                continue;
            }
            if (line.startsWith('CLINIC:')) {
                clinicName = line.replace('CLINIC:', '').trim();
                continue;
            }
            if (line.startsWith('PATIENT:')) {
                patientName = line.replace('PATIENT:', '').trim();
                continue;
            }
            if (line.startsWith('INVOICE:')) {
                invoiceNumber = line.replace('INVOICE:', '').trim();
                continue;
            }
            if (line.startsWith('DATE:')) {
                billingDate = line.replace('DATE:', '').trim();
                continue;
            }

            if (line.startsWith('PAGE:')) {
                const p = parseInt(line.replace('PAGE:', '').trim());
                if (!isNaN(p)) currentPage = p;
                forensicLog(`Procesando Página ${currentPage}...`);
                continue;
            }

            if (line.startsWith('SECTION:')) {
                currentSectionName = line.replace('SECTION:', '').trim();
                if (!sectionsMap.has(currentSectionName)) {
                    sectionsMap.set(currentSectionName, { category: currentSectionName, items: [], sectionTotal: 0 });
                }
                if (!sectionPageTracking.has(currentSectionName)) {
                    sectionPageTracking.set(currentSectionName, new Set<number>());
                }
                continue;
            }

            const parts = robustSplit(line);
            if (parts.length < 3) continue;

            // Track page for this section based on where its items are found
            if (sectionPageTracking.has(currentSectionName)) {
                sectionPageTracking.get(currentSectionName).add(currentPage);
            }

            if (line.startsWith('SECTION_TOTAL:')) {
                const rawVal = line.replace('SECTION_TOTAL:', '').trim();
                const secTotal = Math.round(cleanCLP(rawVal, false));

                if (sectionsMap.has(currentSectionName)) {
                    sectionsMap.get(currentSectionName).sectionTotal = secTotal;
                }
                console.log(`[PARSER] Found explicit SECTION_TOTAL for "${currentSectionName}": ${secTotal}`);
                continue;
            }

            if (!line.includes('|')) continue;

            const cols = robustSplit(line);
            if (cols.length < 4) continue;

            const idxStr = cols[0];
            const code = cols[1];
            const desc = cols[2];
            const qtyStr = cols[3];
            const unitPriceStr = cols[4];
            // En el nuevo formato v1.6.3:
            // cols[5] es la verificación Cant * Precio
            // cols[6] es el total final
            // cols[7] es la Bonificación/Copago (opcional)
            const totalStr = cols.length >= 7 ? cols[6] : (cols.length >= 6 ? cols[5] : cols[3]); // Fallback safe
            const bonificationStr = cols.length >= 8 ? cols[7] : "0";

            const isClinicTotalLine = desc?.toUpperCase().includes("TOTAL SECCIÓN") || desc?.toUpperCase().includes("SUBTOTAL");
            const total = Math.round(cleanCLP(totalStr || "0", false));
            const quantity = cleanCLP(qtyStr || "1", true); // TRUE: Quantity allows decimals
            const unitPrice = Math.round(cleanCLP(unitPriceStr || "0", false));
            const bonification = Math.round(cleanCLP(bonificationStr || "0", false));
            const fullDescription = code ? `${desc} ${code}` : desc;

            let sectionObj = sectionsMap.get(currentSectionName);
            if (!sectionObj) {
                sectionsMap.get("SECCIONES_GENERALES") || sectionsMap.set("SECCIONES_GENERALES", { category: "SECCIONES_GENERALES", items: [], sectionTotal: 0 });
                sectionObj = sectionsMap.get("SECCIONES_GENERALES");
            }

            const calcTotal = Math.round(unitPrice * quantity);
            let finalQuantity = quantity;
            let finalUnitPrice = unitPrice;
            let finalTotal = total;
            let finalCalcTotal = calcTotal;

            // --- SMART COHERENCE CHECK ---
            // Detect if quantity or unitPrice is inflated due to decimal confusion (e.g. 1.000 read as 1000)
            // Expanding factors up to 10^12 for extreme cases (Sevoflurano, Esferas, etc.)
            const factors = [10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000, 100000000000, 1000000000000];
            let foundFix = false;

            if (Math.abs(calcTotal - total) > 5) {
                // 1. Try single factors first (Qty or Price)
                for (const f of factors) {
                    if (unitPrice > 0) {
                        const testQty = quantity / f;
                        const testCalc = Math.round(unitPrice * testQty);
                        if (Math.abs(testCalc - total) <= 10) { // Tolerance slightly higher for extreme scales
                            finalQuantity = testQty;
                            finalCalcTotal = testCalc;
                            foundFix = true;
                            console.log(`[PARSER] Fixed magnitude (Qty) for "${fullDescription}": ${quantity} -> ${finalQuantity}`);
                            break;
                        }
                    }
                    if (quantity > 0) {
                        const testPrice = unitPrice / f;
                        const testCalc = Math.round(testPrice * quantity);
                        if (Math.abs(testCalc - total) <= 10) {
                            finalUnitPrice = testPrice;
                            finalCalcTotal = testCalc;
                            foundFix = true;
                            console.log(`[PARSER] Fixed magnitude (Price) for "${fullDescription}": ${unitPrice} -> ${finalUnitPrice}`);
                            break;
                        }
                    }
                }

                // 2. Try combined factors (Total / F)
                if (!foundFix) {
                    // Try common factors: 10, 100, 1000
                    const commonFactors = [10, 100, 1000];
                    for (const f of commonFactors) {
                        // Prefer scaling PRICE down if it results in an integer-like Quantity
                        // Especially for drugs where quantities are usually whole numbers or simple decimals (0.5)
                        if (Math.abs((quantity * (unitPrice / f)) - finalTotal) < 10) {
                            finalUnitPrice = unitPrice / f;
                            finalCalcTotal = Math.round(quantity * finalUnitPrice);
                            foundFix = true;
                            console.log(`[PARSER] Fixed Price magnitude for "${fullDescription}": Price/${f}`);
                            break;
                        }
                        // Only scale Quantity if the resulting quantity is not "too small" (< 0.01)
                        if (Math.abs(((quantity / f) * unitPrice) - finalTotal) < 10) {
                            const qf = quantity / f;
                            if (qf >= 0.009) { // Avoid micro-quantities unless very precise
                                finalQuantity = qf;
                                finalCalcTotal = Math.round(finalQuantity * unitPrice);
                                foundFix = true;
                                console.log(`[PARSER] Fixed Qty magnitude for "${fullDescription}": Qty/${f}`);
                                break;
                            }
                        }
                    }
                }

                if (!foundFix) {
                    for (const f of factors) { // This 'factors' is the large array [10, 100, ..., 10^12]
                        if (Math.abs(Math.round(calcTotal / f) - total) <= 10) {
                            // If Total / F works, try to distribute f between Qty and Price
                            // Common: Qty has 1000x or 1000000x inflation
                            const commonQtyFactors = [1000, 1000000];
                            for (const qf of commonQtyFactors) {
                                if (f % qf === 0) {
                                    const pf = f / qf;
                                    finalQuantity = quantity / qf;
                                    finalUnitPrice = unitPrice / pf;
                                    finalCalcTotal = Math.round(finalQuantity * finalUnitPrice);
                                    foundFix = true;
                                    console.log(`[PARSER] Combined Fixed magnitude for "${fullDescription}": Qty/${qf}, Price/${pf}`);
                                    break;
                                }
                            }
                            if (!foundFix) {
                                // Default distribution to Price if no common Qty factor
                                finalUnitPrice = unitPrice / f;
                                finalCalcTotal = Math.round(quantity * finalUnitPrice);
                                foundFix = true;
                                console.log(`[PARSER] Global Fixed magnitude for "${fullDescription}": Price/${f}`);
                            }
                            break;
                        }
                    }
                }
            }

            // IVA Intelligence: Check if (Price * Qty) matches Total, OR if (Price * 1.19 * Qty) matches Total
            const simpleError = Math.abs(finalTotal - finalCalcTotal) > 10;
            const ivaError = Math.abs(finalTotal - Math.round(finalCalcTotal * 1.19)) > 10;
            let hasError = !foundFix && simpleError && ivaError;
            const isIVAApplied = simpleError && !ivaError;

            // AUTO-FIX: Absurd quantity detection (OCR code fusion error)
            // If quantity is > 10000 but total is reasonable (< 1M) and unitPrice is reasonable, recalculate
            if (finalQuantity > 10000 && finalTotal < 1000000 && finalUnitPrice > 0 && finalUnitPrice < finalTotal) {
                const correctedQuantity = Math.round((finalTotal / finalUnitPrice) * 100) / 100;
                if (correctedQuantity < 1000 && correctedQuantity > 0) {
                    console.log(`[AUTO-FIX] Correcting absurd quantity: ${finalQuantity} -> ${correctedQuantity} for "${desc}"`);
                    finalQuantity = correctedQuantity;
                    finalCalcTotal = Math.round(finalQuantity * finalUnitPrice);
                    hasError = Math.abs(finalTotal - finalCalcTotal) > 10;
                }
            }

            if (isClinicTotalLine) {
                sectionObj.sectionTotal = finalTotal;
            } else {
                // --- DEDUPLICATION LOGIC ---
                // Avoid adding the same item twice ONLY if the entire row (including quantity and price) is identical
                // and they share the same Folio (idxStr). 
                // We use a counter in the key to allow legitimate multiple charges of same product in same section
                // if they appear as distinct lines in the AI response.
                const itemKey = `${currentSectionName}|${idxStr}|${code}|${desc}|${finalQuantity}|${finalUnitPrice}|${finalTotal}`;
                if (processedItemsSet.has(itemKey)) {
                    // Only skip if the AI is clearly repeating itself (same everything)
                    // But if it's a clinical bill, sometimes same code and total repeat legitimately.
                    // We'll trust the AI's list unless it's an exact duplicate of a previously seen line.
                    console.log(`[PARSER] Skipping potential duplicate row: ${fullDescription}`);
                    continue;
                }
                processedItemsSet.add(itemKey);

                const isHeaderArtifact = fullDescription.toLowerCase().includes("descripción") ||
                    fullDescription.toLowerCase().includes("código") ||
                    fullDescription.includes("---");

                if (!isHeaderArtifact && finalTotal > 0) {
                    sectionObj.items.push({
                        index: globalIndex++,
                        description: fullDescription,
                        quantity: finalQuantity,
                        unitPrice: finalUnitPrice,
                        total: finalTotal,
                        calculatedTotal: finalCalcTotal,
                        hasCalculationError: hasError,
                        isIVAApplied: isIVAApplied,
                        bonification: bonification
                    });
                }
            }
        }

        // ... After parsing lines Loop ...

        // --- AUTO-RECONCILIATION LOOP ---
        forensicLog(`Iniciando Auditoría Matemática de ${sectionsMap.size} secciones.`);
        const sectionsArray = Array.from(sectionsMap.values());
        // Use the key that worked for the initial extraction
        if (!activeApiKey) throw new Error("No active API key available for repair service");
        const geminiService = new GeminiService(activeApiKey);

        for (const sec of sectionsArray) {
            const sumItems = sec.items.reduce((acc: number, item: any) => acc + item.total, 0);

            if (sec.sectionTotal === 0 && sec.items.length > 0) {
                sec.sectionTotal = sumItems;
                continue;
            }

            const diff = sec.sectionTotal - sumItems;

            if (Math.abs(diff) > 10) { // Reducido el threshold para mayor sensibilidad
                const pages = Array.from(sectionPageTracking.get(sec.category) || []);
                const pagesInfo = pages.length > 0 ? `detectado en pág(s): ${pages.join(', ')}` : "páginas no identificadas";

                forensicLog(`⚠️ DESCUADRE en "${sec.category}": Declarado $${sec.sectionTotal} vs Suma $${sumItems} (Dif: $${diff}). Contexto: ${pagesInfo}.`);
                forensicLog(`Solicitando REPARACIÓN focalizada para "${sec.category}"...`);

                try {
                    const repairedItems = await geminiService.repairSection(
                        image,
                        mimeType,
                        sec.category,
                        sec.sectionTotal,
                        sumItems,
                        pages
                    );

                    if (repairedItems && repairedItems.length > 0) {
                        const newSum = repairedItems.reduce((acc: number, item: any) => acc + (item.total || 0), 0);
                        const newDiff = sec.sectionTotal - newSum;

                        const improvedMath = Math.abs(newDiff) < Math.abs(diff);
                        const improvedCount = repairedItems.length > sec.items.length;

                        // CRITICAL: Prioritize exhaustiveness (improvedCount) over perfect math
                        // because the clinic might have summed it wrong.
                        if (improvedMath || improvedCount) {
                            const reason = improvedCount ?
                                `Detectados ${repairedItems.length - sec.items.length} ítems adicionales.` :
                                `Diferencia reducida de $${diff} a $${newDiff}.`;

                            forensicLog(`✅ MEJORA en "${sec.category}": ${reason} Aplicando cambios.`);

                            sec.items = repairedItems.map((item: any) => {
                                const q = item.quantity || 1;
                                const p = item.unitPrice || 0;
                                const t = item.total || 0;

                                // IVA Intelligence: Check if (Price * Qty) matches Total, OR if (Price * 1.19 * Qty) matches Total
                                const simpleError = Math.abs((p * q) - t) > 10;
                                const ivaError = Math.abs((p * 1.19 * q) - t) > 10;
                                const hasRealCalcError = simpleError && ivaError;

                                return {
                                    ...item,
                                    total: t,
                                    unitPrice: p,
                                    quantity: q,
                                    hasCalculationError: hasRealCalcError,
                                    isIVAApplied: simpleError && !ivaError // Meta flag useful for audit
                                };
                            });
                        } else {
                            forensicLog(`❌ REPARACIÓN OMITIDA en "${sec.category}": No aumentó el detalle ni mejoró la cuadratura.`);
                        }
                    }
                } catch (repairError) {
                    forensicLog(`🔴 ERROR CRÍTICO reparando "${sec.category}": ${repairError}`);
                }
            }
        }

        // REMOVED REDUNDANT CONSISTENCY CHECK (Found Root Cause in Parser)

        // Re-calculate section totals before Discrepancy Hunter avoids confusion
        for (const sec of sectionsMap.values()) {
            sec.sectionTotal = sec.items.reduce((acc: number, item: any) => acc + item.total, 0);
        }

        // --- DISCREPANCY HUNTER ---
        // Final attempt to fix global discrepancies by identifying suspect items
        // Specifically targets "Honorarios" duplicates where AI forces Qty 1 on assistants.
        const currentExtractedTotal = Array.from(sectionsMap.values()).reduce((acc: number, sec: any) => acc + sec.sectionTotal, 0);
        const globalDiscrepancy = currentExtractedTotal - clinicGrandTotalField; // Positive means we over-extracted

        if (Math.abs(globalDiscrepancy) > 1000) {
            forensicLog(`🔍 DISCREPANCY HUNTER: Analizando sobrante de $${globalDiscrepancy}...`);

            let fixedGlobal = false;
            for (const sec of Array.from(sectionsMap.values())) {
                // look for items that might be inflated
                for (const item of sec.items) {
                    // Scenario: Item Total is suspiciously close to Discrepancy + X (where X is the real value)
                    // Or simply: If we reduce this item's Qty, does it fix the discrepancy?

                    if (item.unitPrice > 0) {
                        const targetTotal = item.total - globalDiscrepancy;
                        if (targetTotal > 0) {
                            const impliedQty = targetTotal / item.unitPrice;

                            // Check if impliedQty is a "clean" decimal (e.g. 0.08, 0.25, 0.33)
                            // or if the item is a duplicate Price of another item in the same section
                            const candidates = sec.items.filter((i: any) => i.unitPrice === item.unitPrice);
                            const isDuplicatePrice = candidates.length > 1;
                            const isFirstOccurrence = candidates[0] === item;
                            const isProtected = (isDuplicatePrice && isFirstOccurrence && item.unitPrice > 100000);

                            if ((isDuplicatePrice || impliedQty < 0.3) && impliedQty < 1 && impliedQty > 0 && !isProtected) {
                                // Double check if this new quantity makes sense
                                // e.g. 0.07999 -> 0.08
                                const potentialQty = Math.round(impliedQty * 100) / 100;

                                // STRICT CHECK: Only allow common medical fractions
                                // We don't want to change a quantity to 0.96 (or 0.07!) just because it fits the math.
                                const commonFractions = [0.1, 0.125, 0.2, 0.25, 0.3, 0.33, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9];
                                const isCommon = commonFractions.some(f => Math.abs(potentialQty - f) < 0.02);

                                if (!isCommon) {
                                    // DEAD STOP. No more loopholes for small values.
                                    // If isn't a standard surgery split (assistant, etc), don't invent it.
                                    continue;
                                }

                                const verificationTotal = Math.round(potentialQty * item.unitPrice);
                                const residual = Math.abs(verificationTotal - targetTotal);

                                if (residual < 5000) { // Tolerance
                                    forensicLog(`🎯 CAZADO: "${item.description}" parece estar inflado. Qty ${item.quantity} -> ${potentialQty}. Ajustando Total de $${item.total} a $${verificationTotal}.`);

                                    // Apply fix
                                    item.quantity = potentialQty;
                                    item.total = verificationTotal;
                                    item.calculatedTotal = verificationTotal;
                                    item.isUnjustifiedCharge = true; // Mark as suspiciously fixed

                                    // Update section total
                                    sec.sectionTotal -= (item.total - verificationTotal); // This won't work directly if sectionTotal is separate, but helps logic
                                    // Actually we should just update the item and let the final sum happen later, 
                                    // but sectionObj.sectionTotal is what creates the JSON.
                                    sec.sectionTotal = sec.items.reduce((sum: number, i: any) => sum + i.total, 0);

                                    // Break after fixing one major discrepancy per run to avoid cascading errors
                                    item.hasCalculationError = false;
                                    fixedGlobal = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (fixedGlobal) break;
            }
        }


        const sumOfSections = Array.from(sectionsMap.values()).reduce((acc: number, s: any) => acc + s.sectionTotal, 0);

        // --- MAGNITUDE SANITY CHECK ---
        // Scenario: Gemini reads "452.075,00" as 45207500 (x100 inflation) for items.
        // But reads "Total: 6.912.876" correctly or differently.
        // If Sum is ~100x Stated Total, we should SCALE DOWN the items, not scale up the total.
        if (clinicGrandTotalField > 0 && sumOfSections > 0) {
            const ratio = sumOfSections / clinicGrandTotalField;
            if (ratio > 80 && ratio < 120) {
                console.warn(`[AUDIT] Detected likely magnitude error (Items Sum is 100x Stated Total). Sum: ${sumOfSections}, Stated: ${clinicGrandTotalField}. Scaling down ALL items by 100.`);

                // Fix every item in every section
                for (const section of sectionsMap.values()) {
                    section.items.forEach((item: any) => {
                        item.unitPrice = item.unitPrice / 100;
                        item.total = item.total / 100;
                        item.calculatedTotal = item.calculatedTotal / 100;
                    });
                    // Recalculate section total
                    section.sectionTotal = section.sectionTotal / 100;
                }

                // Update the Sum variable for the audit report
                // (Note: We don't update clinicGrandTotalField, we assume it was correct)
            }
        }

        // Re-calculate sum after potential fix
        // EXCLUDE informative sections (PAM) that should not be counted in total
        const finalSumOfSections = Array.from(sectionsMap.values())
            .filter((s: any) => {
                const cat = s.category.toUpperCase();
                const isInformative = cat.includes('PROGRAMA DE ATENCION MEDICA')
                    || cat.includes('PAM')
                    || cat.includes('DETALLE DE COBROS DUPLICADOS');
                if (isInformative) {
                    console.log(`[AUDIT] Excluding informative section from total: "${s.category}"`);
                }
                return !isInformative;
            })
            .reduce((acc: number, s: any) => acc + s.sectionTotal, 0);

        const auditData = {
            clinicName: clinicName,
            patientName: patientName,
            invoiceNumber: invoiceNumber,
            date: billingDate,
            currency: "CLP",
            sections: Array.from(sectionsMap.values()),
            clinicStatedTotal: clinicGrandTotalField || finalSumOfSections
        };

        console.log(`[SUCCESS] Audit data prepared. Sections: ${sectionsMap.size}. Total: ${auditData.clinicStatedTotal}`);

        // Enviar resultado final
        sendUpdate({
            type: 'final',
            data: auditData
        });
        console.log(`[RESPONSE] Final update sent.`);

        res.end();

    } catch (error: any) {
        console.error('Error in streaming extraction:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
});

// ========== PAM ENDPOINT (NEW) ==========
// Endpoint para análisis de documentos PAM
app.post('/api/extract-pam', handlePamExtraction);
app.post('/api/extract-contract', handleContractExtraction);
app.post('/api/audit/analyze', handleAuditAnalysis);

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '../dist')));

// Manejar cualquier otra ruta con el index.html del frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend server running on port ${PORT}`);
});
server.timeout = 600000; // 10 minutes
