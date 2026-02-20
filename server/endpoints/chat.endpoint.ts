import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { AI_CONFIG } from '../config/ai.config.js';

export const handleChat = async (req: Request, res: Response) => {
    try {
        const { message, context, history } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Construct a concise context summary
        const auditSummary = context.result ? `
        RESULTADOS AUDITORÍA M11:
        - Total Copago Analizado: ${context.result.summary.totalCopagoAnalizado}
        - Impacto Fragmentación: ${context.result.summary.totalImpactoFragmentacion}
        - Opacidad Global: ${context.result.summary.opacidadGlobal.applies ? 'SI' : 'NO'} (Max IOP: ${context.result.summary.opacidadGlobal.maxIOP})
        - Evento Inferido: ${context.result.eventModel.actoPrincipal}
        
        HALLAZGOS PRINCIPALES (${context.result.matrix.length}):
        ${context.result.matrix.slice(0, 5).map((m: any) => `- ${m.itemLabel}: ${m.classification} (${m.fundamento})`).join('\n')}
        ${context.result.matrix.length > 5 ? '... y más hallazgos.' : ''}
        ` : 'No hay resultados de auditoría aún.';

        const sourceSummary = `
        DATOS FUENTE:
        - Contrato: ${context.contract?.rules?.length || 0} reglas cargadas.
        - PAM: ${context.pam?.folios?.length || 0} folios.
        - Cuenta: ${context.bill?.items?.length || 0} ítems.
        `;

        const systemPrompt = `
        Eres el Asistente Forense M11, un auditor médico experto en detección de fraude y errores de facturación.
        Tu objetivo es ayudar al auditor humano a entender los hallazgos del motor M11 y explorar los datos del caso.
        
        CONTEXTO DEL CASO:
        ${sourceSummary}

        ${auditSummary}

        INSTRUCCIONES:
        1. Responde de manera profesional, técnica pero accesible.
        2. Basa tus respuestas ESTRICTAMENTE en los datos proporcionados. Si no sabes algo, dilo.
        3. Si el usuario pregunta por un ítem específico, búscalo en el contexto (aunque aquí solo tienes un resumen, asume que puedes explicar los hallazgos generales).
        4. Sé conciso.
        `;

        // Convert history to Gemini format
        const chatHistory = history.map((h: any) => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.content }]
        }));

        const response = await GeminiService.generateChatResponse(
            systemPrompt,
            message,
            chatHistory,
            AI_CONFIG.ACTIVE_MODEL
        );

        res.json({ reply: response });

    } catch (error: any) {
        console.error('[CHAT] Error:', error);
        res.status(500).json({ error: 'Error processing chat request' });
    }
};
