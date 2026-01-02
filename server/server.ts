import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { handlePamExtraction } from './endpoints/pam.endpoint.js';

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
console.log("=".repeat(50) + "\n");

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
    - HONORARIOS FRACCIONARIOS: Presta extrema atención a cantidades como 0.1 o 0.25. El 'total' DEBE ser proporcional (ej: 0.1 * 4.000.000 = 400.000). Prohibido alucinar el total de la cirugía completa en líneas de porcentaje.

    REGLA DE RECONCILIACIÓN MATEMÁTICA (AUDITORÍA INTERNA):
    - ANTES DE ESCRIBIR CADA SECCIÓN: Realiza un cálculo silencioso. Suma los valores de la columna 'Valor Isa' de todos los ítems que planeas extraer para esa sección.
    - COMPARA: Compara esa suma con el Subtotal declarado por la clínica para dicha sección.
    - CORRIGE: Si tu suma es menor al subtotal del papel, significa que TE FALTA ALGÚN ÍTEM. Re-escanea visualmente el documento, encuentra las líneas que omitiste y agrégalas.
    - El objetivo es que la suma de tus líneas sea EXACTAMENTE IGUAL al subtotal de la sección. Si no cuadra, indica el motivo en un comentario técnico suave al final de la sección.

    INSTRUCCIONES DE EXTRACCIÓN EXHAUSTIVA:
    1. Identifica las cabeceras de sección y sus subtotales declarados. Úsalos exactamente como aparecen.
    2. EXTRAE CADA LÍNEA DEL DESGLOSE SIN EXCEPCIÓN.
    3. ESTÁ PROHIBIDO RESUMIR, AGRUPAR O SIMPLIFICAR DATOS. Si el documento tiene 500 filas, el JSON debe tener 500 ítems.
    4. No omitas información por ser repetitiva o de bajo valor (ej: "Suministro", "Gasa").
    5. Convierte puntos de miles (.) a nada y comas decimales (,) a puntos para el JSON.
    6. Absolutamente prohibido usar puntos suspensivos (...) o detenerse antes del final de la cuenta.
`;

app.post('/api/extract', async (req, res) => {
    console.log(`[REQUEST] New extraction request (Streaming)`);

    // Configurar cabeceras para streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType } = req.body;
        console.log(`[REQUEST] Processing image style: ${mimeType}`);

        const apiKey = getApiKey();
        console.log(`[AUTH] API Key status: ${apiKey ? 'Found (Starts with ' + apiKey.substring(0, 4) + '...)' : 'MISSING'}`);

        if (!image || !mimeType) {
            console.error(`[ERROR] Missing payload: image=${!!image}, mimeType=${mimeType}`);
            return res.status(400).json({ error: 'Missing image data or mimeType' });
        }

        if (!apiKey) {
            console.error(`[CRITICAL] Cannot proceed without API Key`);
            return res.status(500).json({ error: 'Server configuration error: Gemini API Key not found' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            generationConfig: {
                maxOutputTokens: 64000
            }
        });

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
          [Index]|[Código]|[Descripción]|[Cant]|[PrecioUnit]|[Total]
          SECTION: [Siguiente Sección...]
          ...
        `;

        const resultStream = await model.generateContentStream([
            { text: CSV_PROMPT },
            {
                inlineData: {
                    data: image,
                    mimeType: mimeType
                }
            }
        ]);

        let fullText = "";

        for await (const chunk of resultStream.stream) {
            const chunkText = chunk.text();
            fullText += chunkText;
            console.log(`[CHUNK] Received chunk: ${chunkText.length} chars (Total: ${fullText.length})`);
            // Enviar el texto extraído en tiempo real al log del frontend
            sendUpdate({ type: 'chunk', text: chunkText });

            // Enviar actualización de tokens si está disponible en el chunk
            const usage = chunk.usageMetadata;
            if (usage) {
                const promptTokens = usage.promptTokenCount || 0;
                const candidatesTokens = usage.candidatesTokenCount || 0;
                const totalTokens = usage.totalTokenCount || 0;

                const inputCost = (promptTokens / 1000000) * 0.10;
                const outputCost = (candidatesTokens / 1000000) * 0.40;
                const estimatedCost = inputCost + outputCost;

                sendUpdate({
                    type: 'usage',
                    usage: {
                        promptTokens,
                        candidatesTokens,
                        totalTokens,
                        estimatedCost,
                        estimatedCostCLP: Math.round(estimatedCost * 980)
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
        const sectionsMap = new Map();
        let currentSectionName = "SECCION_DESCONOCIDA";
        let globalIndex = 1;

        let clinicGrandTotalField = 0;
        let clinicName = "CLINICA INDISA";
        let patientName = "PACIENTE AUDITORIA";
        let invoiceNumber = "000000";
        let billingDate = new Date().toLocaleDateString('es-CL');

        for (const line of lines) {
            if (line.startsWith('GRAND_TOTAL:')) {
                clinicGrandTotalField = parseInt(line.replace('GRAND_TOTAL:', '').trim().replace(/\./g, '')) || 0;
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

            if (line.startsWith('SECTION:')) {
                currentSectionName = line.replace('SECTION:', '').trim();
                if (!sectionsMap.has(currentSectionName)) {
                    sectionsMap.set(currentSectionName, { category: currentSectionName, items: [], sectionTotal: 0 });
                }
                continue;
            }

            if (!line.includes('|')) continue;

            const cols = line.split('|').map(c => c.trim());
            if (cols.length < 4) continue;

            const idxStr = cols[0];
            const code = cols[1];
            const desc = cols[2];
            const qtyStr = cols[3];
            const unitPriceStr = cols[4];
            const totalStr = cols[5];

            const isClinicTotalLine = desc?.toUpperCase().includes("TOTAL SECCIÓN") || desc?.toUpperCase().includes("SUBTOTAL");
            const total = parseInt((totalStr || "0").replace(/\./g, '')) || 0;
            const quantity = parseFloat((qtyStr || "1").replace(',', '.')) || 1;
            const unitPrice = parseInt((unitPriceStr || "0").replace(/\./g, '')) || 0;
            const fullDescription = code ? `${desc} ${code}` : desc;

            let sectionObj = sectionsMap.get(currentSectionName);
            if (!sectionObj) {
                sectionsMap.get("SECCIONES_GENERALES") || sectionsMap.set("SECCIONES_GENERALES", { category: "SECCIONES_GENERALES", items: [], sectionTotal: 0 });
                sectionObj = sectionsMap.get("SECCIONES_GENERALES");
            }

            if (isClinicTotalLine) {
                sectionObj.sectionTotal = total;
            } else {
                sectionObj.items.push({
                    index: parseInt(idxStr) || globalIndex++,
                    description: fullDescription,
                    quantity: quantity,
                    unitPrice: unitPrice,
                    total: total,
                    calculatedTotal: total,
                    hasCalculationError: false
                });
            }
        }

        for (const sec of sectionsMap.values()) {
            if (sec.sectionTotal === 0 && sec.items.length > 0) {
                sec.sectionTotal = sec.items.reduce((sum: number, item: any) => sum + item.total, 0);
            }
        }

        const sumOfSections = Array.from(sectionsMap.values()).reduce((acc: number, s: any) => acc + s.sectionTotal, 0);

        const auditData = {
            clinicName: clinicName,
            patientName: patientName,
            invoiceNumber: invoiceNumber,
            date: billingDate,
            currency: "CLP",
            sections: Array.from(sectionsMap.values()),
            clinicStatedTotal: clinicGrandTotalField || sumOfSections
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

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '../dist')));

// Manejar cualquier otra ruta con el index.html del frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend server running on port ${PORT}`);
});
