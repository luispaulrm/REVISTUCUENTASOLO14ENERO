import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { AI_CONFIG } from '../config/ai.config.js';

export const handleChat = async (req: Request, res: Response) => {
    try {
        const { message, context, history } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // 1. Unpack Raw Canonical Contract if exists
        let contractSource = context.rawContract || {};
        if (contractSource.content && typeof contractSource.content === 'string') {
            try { contractSource = JSON.parse(contractSource.content); } catch { }
        } else if (contractSource.data) {
            contractSource = contractSource.data;
        }

        const rawJsonSummary = contractSource.coberturas ? `
        CONTENIDO BRUTO DEL JSON CANÓNICO (COBERTURAS/TOPES):
        ${JSON.stringify({
            coberturas: contractSource.coberturas?.slice(0, 15),
            topes: contractSource.topes?.slice(0, 10),
            reglas: contractSource.reglas_aplicacion?.slice(0, 5)
        }, null, 2)}
        ` : '';

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
        ${rawJsonSummary}
        ` : 'No hay resultados de auditoría aún.';

        const contractRules = context.contract?.rules || [];
        const rulesDetail = contractRules.length > 0
            ? contractRules.map((r: any) =>
                `- DOMINIO: ${r.domain} | COBERTURA: ${r.coberturaPct ?? '0'}% | TOPE: ${r.tope?.kind || 'Sin tope'} ${r.tope?.value || ''} | GLOSA: "${r.textLiteral || ''}"`
            ).join('\n')
            : 'No se detectaron reglas paramétricas en el contrato.';

        const systemPrompt = `
        Eres el Asistente Forense M11. Tu misión es analizar el caso cruzando Contrato, PAM y Cuenta.
        
        DEFINICIÓN TÉCNICA DEL PLAN (CONTRATO):
        ${rulesDetail}
        
        HISTORIAL DE CARGA:
        - Reglas contractuales mapeadas: ${contractRules.length}
        - Folios PAM: ${context.pam?.folios?.length || 0}
        - Ítems Cuenta: ${context.bill?.items?.length || 0}

        ${auditSummary}

        INSTRUCCIONES CRÍTICAS:
        1. Si el usuario pregunta por topes o coberturas, utiliza la sección "DEFINICIÓN TÉCNICA DEL PLAN" de arriba. 
        2. Responde en español de forma técnica y auditable.
        3. Si una regla tiene TOPE, menciónalo explícitamente.
        4. No inventes datos. Si el contrato no especifica un tope para un dominio, di que no aparece registrado.
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
