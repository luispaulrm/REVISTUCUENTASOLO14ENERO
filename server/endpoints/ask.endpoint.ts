import { Request, Response } from 'express';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "../config/ai.config.js";

// Helper to get all API keys (copied from server.ts pattern or shared utility if available)
// Ideally this should be in a shared config/utils file, but for speed replicating the safe usage.
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

    const { question, context } = req.body;

    if (!question) {
        return res.status(400).send("Falta la pregunta.");
    }

    // Context unpacking
    const htmlContext = context?.htmlContext || "";
    const billJson = context?.billJson || null;
    const contractJson = context?.contractJson || null;
    const pamJson = context?.pamJson || null;

    // Calculate context size roughly
    const ctxSize = htmlContext.length + JSON.stringify(contractJson || {}).length + JSON.stringify(pamJson || {}).length;
    console.log(`[ASK] Question: "${question}" | Context Size: ${ctxSize} chars`);

    const PROMPT = `
        ACTÚA COMO UN AUDITOR MÉDICO FORENSE EXPERTO Y METICULOSO.
        
        CONTEXTO DISPONIBLE:
        --------------------
        1. PROYECCIÓN VISUAL (HTML): 
           ${htmlContext ? "Disponible (Prioridad Alta para validación visual)" : "No disponible"}
           ${htmlContext ? `[INICIO HTML]${htmlContext.substring(0, 150000)}[FIN HTML]` : ""}
        
        2. DATA ESTRUCTURADA (JSON):
           - Cuenta: ${billJson ? "Disponible" : "No disponible"}
           - Contrato: ${contractJson ? "Disponible" : "No disponible"}
           - PAM: ${pamJson ? "Disponible" : "No disponible"}

        --------------------
        DATOS JSON (SI APLICA):
        ${contractJson ? `CONTRATO: ${JSON.stringify(contractJson)}` : ""}
        ${pamJson ? `PAM: ${JSON.stringify(pamJson)}` : ""}
        ${billJson ? `CUENTA: ${JSON.stringify(billJson)}` : ""}
        --------------------

        TU MISIÓN:
        Responder la pregunta del usuario basándote EXCLUSIVAMENTE en la evidencia provista arriba.

        PREGUNTA DEL USUARIO:
        "${question}"

        DIRECTRICES DE RESPUESTA:
        1. PRECISIÓN VISUAL: Si la pregunta es sobre qué se ve en el documento, usa el HTML. Cita líneas exactas si es posible.
        2. PRECISIÓN CONTRACTUAL: Si la pregunta es sobre coberturas, usa el JSON del contrato y cita la regla específica.
        3. HONESTIDAD: Si el dato no está en el contexto, DI QUE NO ESTÁ. No alucines.
        4. FORMATO: Responde directo al grano. Usa Markdown si ayuda (listas, negritas).
        5. LENGUAJE: Profesional, técnico, directo. Español formal.

        RESPUESTA:
    `;

    const apiKeys = getApiKeys();
    if (apiKeys.length === 0) {
        res.write("Error: No API Keys configured server-side.");
        res.end();
        return;
    }

    try {
        // Try with Primary Key and Active Model
        const apiKey = apiKeys[0]; // Simplification for short interaction
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: AI_CONFIG.ACTIVE_MODEL || "gemini-1.5-flash" }); // Fallback safe

        const result = await model.generateContentStream(PROMPT);

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            res.write(chunkText);
        }

        res.end();

    } catch (error: any) {
        console.error("[ASK] Error generating answer:", error);
        res.write(`Error al interrogar al auditor: ${error.message}`);
        res.end();
    }
};
