import { Request, Response } from 'express';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "../config/ai.config.js";
import fs from 'fs/promises';
import path from 'path';
import { getRelevantKnowledge, extractCaseKeywords } from '../services/knowledgeFilter.service.js';
import { PersistentMemoryService } from '../services/persistentMemory.service.js';

import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge');

// Helper to get all API keys (copied from server.ts pattern or shared utility if available)
// ... (rest of imports and helpers)
function envGet(k: string) {
    return process.env[k];
}

const getApiKeys = () => {
    const keys = [];
    if (envGet("GEMINI_API_KEY")) keys.push(envGet("GEMINI_API_KEY"));
    if (envGet("API_KEY")) keys.push(envGet("API_KEY"));
    if (envGet("GEMINI_API_KEY_SECONDARY")) keys.push(envGet("GEMINI_API_KEY_SECONDARY"));
    return [...new Set(keys)].filter(k => !!k);
};

export const handleAskAuditor = async (req: Request, res: Response) => {
    console.log(`[ASK] New interrogation request`);

    // Setup streaming headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const { question, context, images } = req.body; // Added images support

    if (!question) {
        return res.status(400).send("Falta la pregunta.");
    }

    // Context unpacking
    const htmlContext = context?.htmlContext || "";
    const billJson = context?.billJson || null;
    const contractJson = context?.contractJson || null;
    const pamJson = context?.pamJson || null;
    const auditResult = context?.auditResult || null;

    // --- LOADING KNOWLEDGE BASE (Filtered to prevent leakage) ---
    let extraLiterature = "";
    try {
        const keywords = extractCaseKeywords(billJson, pamJson, contractJson, htmlContext);
        const filteredKnowledge = await getRelevantKnowledge(keywords, 40000, (msg) => console.log(`[ASK-KNOWLEDGE] ${msg}`));
        extraLiterature = filteredKnowledge.text;

        console.log(`[ASK] Filtered knowledge loaded: ${filteredKnowledge.sources.join(', ')} (${filteredKnowledge.tokenEstimate} tokens)`);
    } catch (err) {
        console.error("[ASK] Error loading literature:", err);
    }

    // --- CONTRACT NORMALIZATION (Support for V3 Schema) ---
    let finalContractDisplay = "No disponible";
    let finalContractData = "";

    if (contractJson) {
        const isSchemaV3 = !!contractJson.auditoria_schema || !!contractJson.definiciones || (!!contractJson.contrato && (!!contractJson.contrato.auditoria_schema || !!contractJson.auditoria_schema));

        if (isSchemaV3) {
            const schema = contractJson.auditoria_schema || contractJson;
            const cleaned = {
                metadata: contractJson.metadata || contractJson.contrato?.metadata || schema.metadata,
                coberturas: (schema.definiciones || []).map((def: any) => ({
                    categoria: (def.categoria_canonica || def.ambito || "OTROS").toUpperCase(),
                    item: def.descripcion_textual || def.nombre_norm || def.nombre,
                    modalidades: (def.modalidades || def.reglas_financieras || def.regimenes || []).map((m: any) => ({
                        tipo: (m.modalidad || m.tipo || "").toUpperCase(),
                        porcentaje: m.porcentaje,
                        tope: m.tope?.valor ?? m.valor ?? m.tope,
                        unidadTope: m.tope?.tipo ?? m.unidad ?? "SIN_TOPE",
                        tipoTope: m.tope?.aplicacion?.toUpperCase() ?? m.aplicacion?.toUpperCase() ?? "POR_EVENTO",
                        factor: m.tope?.factor ?? m.factor,
                        sin_tope_adicional: m.tope?.sin_tope_adicional ?? m.sin_tope_adicional
                    }))
                }))
            };
            finalContractDisplay = "Disponible (V3 Deterministico)";
            finalContractData = `CONTRATO (TIPO: CANONICO_DETERMINISTICO): ${JSON.stringify(cleaned)}`;
        } else {
            finalContractDisplay = "Disponible (Legacy)";
            finalContractData = `CONTRATO: ${JSON.stringify(contractJson)}`;
        }
    }

    const PROMPT_TEXT = `
        ACTÚA COMO UN AUDITOR MÉDICO FORENSE EXPERTO Y METICULOSO CON ACCESO A LITERATURA LEGAL Y REGLAMENTARIA.
        
        LITERATURA Y JURISPRUDENCIA (MARCO DE REFERENCIA):
        ${extraLiterature || "No hay literatura cargada actualmente."}

        CONTEXTO DEL CASO ESPECÍFICO DISPONIBLE:
        --------------------
        1. PROYECCIÓN VISUAL (HTML): 
           ${htmlContext ? "Disponible (Prioridad Alta para validación visual)" : "No disponible"}
           ${htmlContext ? `[INICIO HTML]${htmlContext.substring(0, 150000)}[FIN HTML]` : ""}
        
        2. DATA ESTRUCTURADA (JSON):
           - Cuenta: ${billJson ? "Disponible" : "No disponible"}
           - Contrato: ${finalContractDisplay}
           - PAM: ${pamJson ? "Disponible" : "No disponible"}
           - RESULTADOS AUDITORÍA FORENSE: ${auditResult ? "Disponible (USAR PARA ACLARAR DUDAS SOBRE EL INFORME)" : "No disponible"}

        --------------------
        DATOS JSON DEL CASO:
        ${finalContractData}
        ${pamJson ? `PAM: ${JSON.stringify(pamJson)}` : ""}
        ${billJson ? `CUENTA: ${JSON.stringify(billJson)}` : ""}
        ${auditResult ? `RESULTADOS AUDITORÍA: ${JSON.stringify(auditResult)}` : ""}
        --------------------

        TU MISIÓN:
        Responder la pregunta del usuario basándote en la evidencia del caso (texto e IMÁGENES si las hay) Y fundamentando con la LITERATURA provista.

        PREGUNTA DEL USUARIO:
        "${question}"

        DIRECTRICES DE RESPUESTA:
        1. PRECISIÓN VISUAL: Si la pregunta es sobre qué se ve en el documento (HTML o IMAGEN adjunta), usa esa evidencia. Cita líneas exactas si es posible.
        2. PRECISIÓN CONTRACTUAL: Si la pregunta es sobre coberturas, usa el JSON del contrato y cita la regla específica.
        3. HONESTIDAD: Si el dato no está en el contexto ni en las imágenes, DI QUE NO ESTÁ. No alucines.
        4. FORMATO: Responde directo al grano. Usa Markdown si ayuda (listas, negritas).
        5. LENGUAJE: Profesional, técnico, directo. Español formal.

        RESPUESTA:
    `;

    // Construct parts for the model (Text + Images)
    const parts: any[] = [{ text: PROMPT_TEXT }];

    if (images && Array.isArray(images)) {
        for (const imgBase64 of images) {
            // Check if it has the data:image/... base64 prefix and strip it if necessary for the API
            // The API expects just the base64 data strings for inlineData
            const match = imgBase64.match(/^data:(image\/[a-z]+);base64,(.+)$/);
            if (match) {
                parts.push({
                    inlineData: {
                        mimeType: match[1],
                        data: match[2]
                    }
                });
            } else {
                // Assume it's raw base64 png if no prefix, or try to guess. Defaulting to jpeg for safety if unknown or assume validation upstream.
                // Better to assume the frontend sends data URI.
                // If raw base64 is sent, we might default to image/png
                parts.push({
                    inlineData: {
                        mimeType: "image/png",
                        data: imgBase64
                    }
                });
            }
        }
    }

    const apiKeys = getApiKeys();
    if (apiKeys.length === 0) {
        res.write("Error: No API Keys configured server-side.");
        res.end();
        return;
    }

    // --- FALLBACK LOGIC ---
    // Models to try in order
    const preferredModel = AI_CONFIG.ACTIVE_MODEL || "gemini-1.5-flash";
    const modelsToTry = [
        preferredModel,
        "gemini-2.5-flash" // User-enforced strict fallback (2.0 and 1.5 are retired/excluded)
    ];
    // Removing duplicates while preserving order
    const uniqueModels = [...new Set(modelsToTry)];

    let success = false;
    let lastError: any = null;

    for (const modelName of uniqueModels) {
        if (success) break;
        try {
            console.log(`[ASK] Attempting with model: ${modelName}`);
            // Use Primary Key first, could rotate keys if needed but simple for now
            const apiKey = apiKeys[0];
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContentStream(parts);

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                res.write(chunkText);
            }
            success = true;
        } catch (error: any) {
            console.warn(`[ASK] Failed with model ${modelName}: ${error.message}`);
            lastError = error;
            // Continue to next model
        }
    }

    if (!success) {
        console.error("[ASK] All models failed.", lastError);
        res.write(`Error al interrogar al auditor (Todos los modelos fallaron). Último error: ${lastError?.message}`);
    }

    res.end();
};
