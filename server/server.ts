import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiService } from './services/gemini.service.js';
import { performForensicAudit } from './services/auditEngine.service.js';
import { classifyBillingModel } from './services/billingModelClassifier.service.js';
import { ParserService } from "./services/parser.service.js";
import { AI_CONFIG, GENERATION_CONFIG } from "./config/ai.config.js";
import { handlePamExtraction } from './endpoints/pam.endpoint.js';
import { handleContractExtraction } from './endpoints/contract.endpoint.js';
// No unnecessary imports
import { handleProjection } from './endpoints/projection.endpoint.js';
import { handleAskAuditor } from './endpoints/ask.endpoint.js';
import { handlePreCheck } from './endpoints/precheck.endpoint.js';
import { handleGeneratePdf } from './endpoints/generate-pdf.endpoint.js';
import { handleCanonicalExtraction } from './endpoints/canonical.endpoint.js';
import { LearnContractEndpoint } from './endpoints/learn-contract.endpoint.js';
import { learnFromContract } from './services/contractLearning.service.js';
import { BILL_PROMPT } from './prompts/bill.prompt.js';
import { TaxonomyPhase1Service } from './services/taxonomyPhase1.service.js';
import { TaxonomyPhase1_5Service } from './services/taxonomyPhase1_5.service.js';
import { SkeletonService } from './services/skeleton.service.js';

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
    console.log(`✅ GEMINI_API_KEY_SECONDARY LOADED: ${GEMINI_SEC.substring(0, 8)}...`);
}
const GEMINI_TER = envGet("GEMINI_API_KEY_TERTIARY");
if (GEMINI_TER) {
    console.log(`✅ GEMINI_API_KEY_TERTIARY LOADED: ${GEMINI_TER.substring(0, 8)}...`);
}
const GEMINI_QUA = envGet("GEMINI_API_KEY_QUATERNARY");
if (GEMINI_QUA) {
    console.log(`✅ GEMINI_API_KEY_QUATERNARY LOADED: ${GEMINI_QUA.substring(0, 8)}...`);
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
        patientEmail: { type: "string" },
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
                                total: { type: "number", description: "Valor Total del ítem incluyendo IVA/Impuestos (Valor ISA)" }
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

// Redundant EXTRACTION_PROMPT removed. Now using BILL_PROMPT from ./prompts/bill.prompt.js

// Helper to get all API keys
const getApiKeys = () => {
    const keys = [];
    if (envGet("GEMINI_API_KEY")) keys.push(envGet("GEMINI_API_KEY"));
    if (envGet("API_KEY")) keys.push(envGet("API_KEY"));
    if (envGet("GEMINI_API_KEY_SECONDARY")) keys.push(envGet("GEMINI_API_KEY_SECONDARY"));
    if (envGet("GEMINI_API_KEY_TERTIARY")) keys.push(envGet("GEMINI_API_KEY_TERTIARY"));
    if (envGet("GEMINI_API_KEY_QUATERNARY")) keys.push(envGet("GEMINI_API_KEY_QUATERNARY"));
    // Deduplicate
    return [...new Set(keys)].filter((k): k is string => !!k && k.length > 5);
};

app.post('/api/audit/ask', handleAskAuditor);
app.post('/api/audit/pre-check', handlePreCheck);
app.post('/api/generate-pdf', handleGeneratePdf);
app.post('/api/extract-canonical', handleCanonicalExtraction);
app.post('/api/learn-contract', LearnContractEndpoint);

// import { handleTaxonomyClassification } from './endpoints/taxonomy.endpoint.js';
// app.post('/api/audit/taxonomy', handleTaxonomyClassification);

app.get('/api/contract-count', async (req, res) => {
    try {
        const { ContractCacheService } = await import('./services/contractCache.service.js');
        const count = await ContractCacheService.getCount();
        res.json({ count });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/mental-model', async (req, res) => {
    try {
        const mentalModelPath = path.resolve('./mental_model.json');
        if (fs.existsSync(mentalModelPath)) {
            const data = fs.readFileSync(mentalModelPath, 'utf-8');
            res.json(JSON.parse(data));
        } else {
            res.status(404).json({ error: 'Mental model not generated yet' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/contracts/clear-cache', async (req, res) => {
    console.log('[CACHE] Clearing contract cache...');
    try {
        const { ContractCacheService } = await import('./services/contractCache.service.js');
        const { resetLearningMemory } = await import('./services/contractLearning.service.js'); // New Import logic

        const count = await ContractCacheService.clearAll();
        resetLearningMemory(); // Reset counter

        res.json({ success: true, deletedCount: count });
    } catch (err: any) {
        console.error('[CACHE] Error clearing cache:', err);
        res.status(500).json({ error: err.message });
    }
});

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

        const CSV_PROMPT = BILL_PROMPT;

        // --- VALIDATION LAYER START (HOTFIX) ---
        // Ensure this is actually a BILL (Cuenta) and not a PAM or random meme.
        const { ValidationService } = await import('./services/validation.service.js');
        const validationService = new ValidationService(apiKeys);

        forensicLog("🕵️ Validando identidad del documento (Debe ser CUENTA)...");
        const validation = await validationService.validateDocumentType(image, mimeType, 'CUENTA');

        if (!validation.isValid) {
            console.warn(`[EXTRACT] VALIDATION REJECTED: ${validation.detectedType}. Reason: ${validation.reason}`);
            sendUpdate({
                type: 'error',
                message: `VALIDACIÓN FALLIDA: Sube una CUENTA CLÍNICA. Se detectó: "${validation.detectedType}". (${validation.reason})`
            });
            return res.end();
        }
        forensicLog(`✅ Documento validado como CUENTA CLÍNICA.`);
        // --- VALIDATION LAYER END ---  

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
                    forensicLog(`Intentando extracción con modelo ${modelName}...`);
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

                    forensicLog(`Enviando imagen al modelo ${modelName}...`);

                    // Progress ticking to keep user informed during long waits
                    const waitingInterval = setInterval(() => {
                        forensicLog(`⏳ Esperando respuesta de ${modelName}... (Procesando)`);
                    }, 10000);

                    // Add timeout wrapper to prevent indefinite hangs
                    const timeoutMs = 90000; // 90 seconds for bill extraction
                    const streamPromise = model.generateContentStream([
                        { text: CSV_PROMPT },
                        {
                            inlineData: {
                                data: image,
                                mimeType: mimeType
                            }
                        }
                    ]);

                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Timeout: El modelo ${modelName} no respondió en ${timeoutMs / 1000} segundos`));
                        }, timeoutMs);
                    });

                    try {
                        resultStream = await Promise.race([streamPromise, timeoutPromise]) as any;
                    } finally {
                        clearInterval(waitingInterval);
                    }

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
                    const errStr = (attemptError?.toString() || "") + (attemptError?.message || "");
                    const isTimeout = errStr.includes('Timeout');

                    if (isTimeout) {
                        forensicLog(`⏱️ Timeout: El modelo ${modelName} no respondió en 90 segundos.`);
                        forensicLog(`💡 Esto puede indicar que el PDF es muy grande o complejo.`);
                        lastError = attemptError;
                        // Try next key/model
                        continue;
                    }

                    console.warn(`[AUTH] Failed with Key: ${keyMask} on ${modelName}:`, attemptError.message);
                    lastError = attemptError;
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
        let patientEmail = "N/A";
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
            if (line.startsWith('GRAND_TOTAL_BRUTO:')) {
                const rawVal = line.replace('GRAND_TOTAL_BRUTO:', '').trim();
                clinicGrandTotalField = Math.round(cleanCLP(rawVal, false));
                console.log(`[PARSER] Raw GRAND_TOTAL_BRUTO: "${rawVal}" -> Parsed: ${clinicGrandTotalField}`);
                continue;
            }
            if (line.startsWith('GRAND_TOTAL_NETO:')) {
                // We capture it but the primary pivot for Audit M8 is the BRUTO
                continue;
            }
            if (line.startsWith('GRAND_TOTAL:')) { // Fallback for old models
                const rawVal = line.replace('GRAND_TOTAL:', '').trim();
                clinicGrandTotalField = Math.round(cleanCLP(rawVal, false));
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
            if (line.startsWith('EMAIL:')) {
                patientEmail = line.replace('EMAIL:', '').trim();
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

            // New logic to handle extra columns (ValorIsa, Bonif, Copago)
            // Expected: [Index]|[Code]|[Desc]|[Qty]|[UnitPrice]|[Verif]|[ValorIsa]|[Bonif]|[Copago]|[Total]

            const idxStr = cols[0];
            const code = cols[1];
            const desc = cols[2];
            const qtyStr = cols[3];
            const unitPriceStr = cols[4];

            // Default mappings fallback
            let totalStr = "";
            let valorIsaStr = "";
            let bonifStr = "";
            let copagoStr = "";

            if (cols.length >= 10) {
                // Full new format
                valorIsaStr = cols[6];
                bonifStr = cols[7];
                copagoStr = cols[8];
                totalStr = cols[9];
            } else if (cols.length >= 7) {
                // Mid format or old format + verification
                // Assuming format: ...[Verif]|[Total]
                totalStr = cols[6];
            } else {
                totalStr = cols.length >= 6 ? cols[5] : cols[3];
            }

            const isClinicTotalLine = desc?.toUpperCase().includes("TOTAL SECCIÓN") || desc?.toUpperCase().includes("SUBTOTAL");
            const total = Math.round(cleanCLP(totalStr || "0", false));
            const quantity = cleanCLP(qtyStr || "1", true);
            const unitPrice = Math.round(cleanCLP(unitPriceStr || "0", false));

            const valorIsa = Math.round(cleanCLP(valorIsaStr || "0", false));
            const bonificacion = Math.round(cleanCLP(bonifStr || "0", false));
            const copago = Math.round(cleanCLP(copagoStr || "0", false));

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

                    // NEW: 3-Model Classification System (Applied after Coherence/Auto-Fix)
                    const classification = classifyBillingModel({
                        quantity: finalQuantity,
                        unitPrice: finalUnitPrice,
                        total: finalTotal, // stated total (after parsing fix)
                        valorIsa: valorIsa, // authoritative
                        description: fullDescription
                    });

                    // Update Truths
                    const finalAuthoritativeTotal = classification.authoritativeTotal;

                    // IF we trust the authoritative total more than the text total, update it.
                    // Usually authoritativeTotal IS `valorIsa` or `total` depending on rule.
                    // If Rule 1 applied (ValorISA exists), we override.
                    if (valorIsa > 0) {
                        finalTotal = finalAuthoritativeTotal;
                    }

                    // Recalculate Error Flags based on Model
                    if (classification.model === 'MULTIPLICATIVE_EXACT') {
                        finalCalcTotal = Math.round(finalQuantity * finalUnitPrice);
                        const tolerance = classification.toleranceApplied || 10;
                        hasError = Math.abs(finalTotal - finalCalcTotal) > tolerance;
                    } else {
                        // PRORATED or UNTRUSTED
                        // No calculation error by definition (we don't calculate)
                        finalCalcTotal = finalAuthoritativeTotal;
                        hasError = false;
                    }

                    // For UNTRUSTED (Rule 4), we might want to flag it differently?
                    // The plan said: "Flag as UNIT_PRICE_UNTRUSTED... Validation: Flag as EXTRACTION ERROR"
                    // But `hasCalculationError` is specific to arithmetic.
                    // We interpret "hasCalculationError" as "Invalid Arithmetic".
                    // If it's B or C, the arithmetic is irrelevant.

                    sectionObj.items.push({
                        index: globalIndex++,
                        description: fullDescription,
                        quantity: finalQuantity,
                        unitPrice: finalUnitPrice,
                        total: finalTotal,
                        calculatedTotal: finalCalcTotal,
                        hasCalculationError: hasError,
                        isIVAApplied: isIVAApplied,
                        valorIsa: valorIsa,
                        bonificacion: bonificacion,
                        copago: copago,

                        // New Metadata
                        billingModel: classification.model,
                        authoritativeTotal: finalAuthoritativeTotal,
                        unitPriceTrust: classification.unitPriceTrust,
                        qtyIsProration: classification.qtyIsProration,
                        suspectedColumnShift: classification.suspectedColumnShift,
                        toleranceApplied: classification.toleranceApplied
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


        // --- MANITUDE FIX 2.0 (Heuristic Validation) ---
        // If final sum is massive (> 100M) and we have standard medical items in the >10M range, 
        // it's extremely likely we have a 100x inflation (comma read as dot).
        // Rizotomia is typically 2M, not 205M.
        let detectedInflation = false;
        if (finalSumOfSections > 100000000) { // > 100 Million
            // Check average item price
            let highValCount = 0;
            let totalCount = 0;
            for (const sec of sectionsMap.values()) {
                for (const item of sec.items) {
                    totalCount++;
                    if (item.unitPrice > 10000000) { // > 10 Million
                        highValCount++;
                    }
                }
            }

            if (totalCount > 0 && (highValCount / totalCount) > 0.1) {
                detectedInflation = true;
                console.warn(`[AUDIT] 🚨 DETECTED 100x INFLATION. Correcting values...`);

                for (const sec of sectionsMap.values()) {
                    for (const item of sec.items) {
                        item.unitPrice = Math.round(item.unitPrice / 100);
                        item.total = Math.round(item.total / 100);
                        item.calculatedTotal = Math.round(item.calculatedTotal / 100);
                        item.valorIsa = Math.round((item.valorIsa || 0) / 100);
                        item.bonificacion = Math.round((item.bonificacion || 0) / 100);
                        item.copago = Math.round((item.copago || 0) / 100);
                        item.authoritativeTotal = Math.round((item.authoritativeTotal || 0) / 100);
                    }
                    sec.sectionTotal = Math.round(sec.sectionTotal / 100);
                    sec.calculatedSectionTotal = Math.round(sec.calculatedSectionTotal / 100);
                }
            }
        }


        // --- NEW: CANONICAL AC2 INFERENCE (STRICT NORM) ---
        // Rule: AC2 = Bonification / Factor
        // Anchor: Rizotomia (1103057) -> Factor 1.2
        let inferredAC2: string | undefined = undefined;
        try {
            for (const sec of sectionsMap.values()) {
                for (const item of sec.items) {
                    const desc = (item.description || "").toUpperCase();
                    const code = (item.code || "").toUpperCase();

                    // Check for RIZOTOMIA (1103057)
                    if ((code === '1103057' || desc.includes('1103057') || desc.includes('RIZOTO')) && item.bonificacion > 0) {
                        const factor = 1.2; // Canonical Factor for Rizotomia (per User Rule)
                        const rawAC2 = item.bonificacion / factor;

                        // Validation range (AC2 typical values ~20k - 300k)
                        if (rawAC2 > 20000 && rawAC2 < 500000) {
                            // No rounding to "pretty" numbers. Use Math.round to get closest integer peso.
                            const ac2Value = Math.round(rawAC2);
                            inferredAC2 = `$${ac2Value.toLocaleString('es-CL')}`;
                            console.log(`[AUDIT] 🧮 DEDUCCIÓN AC2 (HECHO MATEMÁTICO):`);
                            console.log(`[AUDIT]   Ancla: ${desc} (${code})`);
                            console.log(`[AUDIT]   Análisis: Despeje desde aplicación observada del contrato.`);
                            console.log(`[AUDIT]   Formula: Bonificación $${item.bonificacion.toLocaleString('es-CL')} / Factor ${factor}`);
                            console.log(`[AUDIT]   Resultado: ${rawAC2.toFixed(4)} => ${inferredAC2}`);
                        }
                        break;
                    }
                }
                if (inferredAC2) break;
            }
        } catch (e) {
            console.error('[AUDIT] Error inferring AC2:', e);
        }

        // --- NEW: ACCOUNT SKELETON (PHASE 1.5) ---
        let skeleton = null;
        try {
            const allItemsForSkeleton: any[] = [];
            for (const sec of sectionsMap.values()) {
                allItemsForSkeleton.push(...sec.items);
            }

            if (allItemsForSkeleton.length > 0) {
                forensicLog(`📊 Generando estructura jerárquica de la cuenta (${allItemsForSkeleton.length} ítems)...`);
                // Use the same API key that worked for extraction
                const geminiForTaxonomy = new GeminiService(activeApiKey);
                const taxonomyService = new TaxonomyPhase1Service(geminiForTaxonomy);
                const skeletonService = new SkeletonService();

                const rawItems = allItemsForSkeleton.map((it, idx) => ({
                    id: it.id || `item-${idx}`,
                    text: it.description || "",
                    sourceRef: it.code || ""
                }));

                const taxonomyResults = await taxonomyService.classifyItems(rawItems);
                skeleton = skeletonService.generateSkeleton(taxonomyResults);
                forensicLog(`✅ Esqueleto generado: ${skeleton.children?.length || 0} ramas detectadas.`);
            } else {
                console.log(`[SKELETON] No items found to generate skeleton.`);
            }
        } catch (skError) {
            console.error('[SKELETON] Error generating account skeleton:', skError);
        }
        // --- TAXONOMY & ETIOLOGY PHASE (MOTOR 1.5) ---
        // Integramos la clasificación taxonómica y etiológica (MEP) directamente en el flujo de extracción
        try {
            const allItems: any[] = [];
            for (const sec of sectionsMap.values()) {
                allItems.push(...sec.items);
            }

            if (allItems.length > 0) {
                forensicLog(`🧠 Ejecutando Motor Taxonómico (Fase 1.5) para ${allItems.length} ítems...`);

                // 1. Taxonomy Phase 1 (Basic Classification)
                // We reuse the existing service instance if possible, or create new one
                const taxonomyService = new TaxonomyPhase1Service(new GeminiService(activeApiKey || getApiKey()));
                const phase1Results = await taxonomyService.classifyItems(allItems);

                // 2. Taxonomy Phase 1.5 (MEP / Etiology)
                const mepService = new TaxonomyPhase1_5Service(new GeminiService(activeApiKey || getApiKey()), {
                    enableLLM: false, // Use deterministic regex only for speed during extraction
                    cache: new Map()
                });

                // Build anchors for MEP context
                const sectionNames = Array.from(sectionsMap.keys());
                const anchors = {
                    hasPabellon: sectionNames.some(n => /(^|\b)pabell/i.test(n) || /farmacia.*pabell/i.test(n)),
                    hasDayBed: sectionNames.some(n => /d[ií]as?\s*cama/i.test(n)),
                    hasUrgencia: sectionNames.some(n => /urgenc/i.test(n) || /consulta.*urgenc/i.test(n)),
                    hasEventoUnicoHint: false,
                    sectionNames: sectionNames
                };

                const mepResults = await mepService.run(phase1Results, anchors);

                // 3. Merge back into sectionsMap
                // We create a map of processed items by index/description to update the original objects
                // Note: The original items in sectionsMap are references, so updating them *might* work if we preserved objects.
                // But `classifyItems` might have returned new objects. Let's map back carefully.

                // Optimization: The `phase1Results`/`mepResults` should be in same order if we passed `allItems`.
                // Let's assume order is preserved or use strict object reference if possible. 
                // TaxonomyService returns NEW objects usually.
                // We will map by Index if available, or just iterate since it's sequential.

                let itemsWithAbsorption = 0;
                let totalExposedAmount = 0;
                const forensicItems: any[] = [];

                // mepResults corresponds to allItems array order
                for (let i = 0; i < allItems.length; i++) {
                    const original = allItems[i];
                    const enriched = mepResults[i];

                    if (enriched) {
                        const isAbsorption = enriched.etiologia?.tipo === 'ACTO_NO_AUTONOMO' || enriched.etiologia?.tipo === 'DESCLASIFICACION_CLINICA';

                        if (isAbsorption) {
                            itemsWithAbsorption++;
                            totalExposedAmount += original.total || 0;
                        }

                        // Create parallel forensic item
                        forensicItems.push({
                            index: original.index, // Reference by Index
                            description: original.description, // Reference by Description (Safety)
                            // Forensic Analysis Object
                            diagnostico_forense: {
                                index: original.index,
                                clasificacion: enriched.etiologia?.tipo || "CORRECTO",
                                dominio_funcional: enriched.etiologia?.absorcion_clinica || "CLINICO_GENERAL",
                                regla_aplicada: enriched.etiologia?.evidence?.rules?.[0] || "ARANCEL_FONASA",
                                motivo_rechazo_previsible: enriched.etiologia?.motivo_rechazo_previsible || "SIN_RECHAZO",
                                tipo_unbundling: isAbsorption ? 1 : 0,
                                rationale: enriched.rationale_short
                            }
                        });
                    }
                }

                // Store analysis in a temporary global to be picked up by final JSON construction
                // (Quick fix to avoid rewriting the whole function flow)
                (global as any).forensicAnalysisBuffer = {
                    resumen: {
                        total_items: allItems.length,
                        items_con_absorcion_normativa: itemsWithAbsorption,
                        monto_expuesto_indebidamente: totalExposedAmount
                    },
                    items: forensicItems
                };

                forensicLog(`✅ Análisis Forense generado: ${itemsWithAbsorption} ítems observados.`);
            }

        } catch (taxError) {
            console.error("Error en Fase Taxonómica:", taxError);
            forensicLog(`⚠️ Error en Motor Taxonómico: ${taxError instanceof Error ? taxError.message : String(taxError)} (Continuando extracción base)`);
        }
        // --- END TAXONOMY PHASE ---
        console.log(`[SUCCESS] Audit data prepared. Skeleton present: ${!!skeleton}`);

        const auditData = {
            clinicName: clinicName,
            patientName: patientName,
            patientEmail: patientEmail,
            invoiceNumber: invoiceNumber,
            date: billingDate,
            currency: "CLP",
            sections: Array.from(sectionsMap.values()),
            clinicStatedTotal: detectedInflation ? Math.round((clinicGrandTotalField || finalSumOfSections) / 100) : (clinicGrandTotalField || finalSumOfSections),
            // INJECT INFERRED AC2 (CANONICAL)
            valorUnidadReferencia: inferredAC2,
            // INJECT SKELETON
            skeleton: skeleton,
            // INJECT PARALLEL FORENSIC ANALYSIS (SEMANTIC FIREWALL)
            analisis_taxonomico_forense: (global as any).forensicAnalysisBuffer
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
import { handleTaxonomyPhase1 } from './endpoints/taxonomy.endpoint.js';
import { handleAuditOrchestration } from './endpoints/audit.endpoint.js';

app.post('/api/cuenta/taxonomy-phase1', handleTaxonomyPhase1);
app.post('/api/audit/run', handleAuditOrchestration);

import { handleAuditAnalysis } from './endpoints/audit.endpoint.js';
app.post('/api/extract-pam', handlePamExtraction);
app.post('/api/extract-contract', handleContractExtraction);
app.post('/api/audit/analyze', handleAuditAnalysis);
app.post('/api/project', handleProjection);

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
