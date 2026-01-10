import { Request, Response } from 'express';
import { performForensicAudit, performMultiPassAudit } from '../services/auditEngine.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { AI_CONFIG } from '../config/ai.config.js';

export async function handleAuditAnalysis(req: Request, res: Response) {
    console.log('[AUDIT] New Multi-Pass Forensic Audit Request Initiated');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { cuentaJson, pamJson, contratoJson, htmlContext, singlePass } = req.body;

        if ((!cuentaJson && !htmlContext) || !pamJson || !contratoJson) {
            sendUpdate({ type: 'error', message: 'Missing required data (Cuenta/HTML, PAM or Contrato)' });
            return res.end();
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (!apiKey) {
            sendUpdate({ type: 'error', message: 'API Key not configured' });
            return res.end();
        }

        sendUpdate({ type: 'progress', progress: 5 });
        sendUpdate({ type: 'log', message: singlePass ? '[AUDIT] Usando modo single-pass' : '[AUDIT] Usando modo MULTI-PASS (3 Rondas de Verificación)' });

        // Use multi-pass by default unless explicitly disabled
        const auditFunction = singlePass ? performForensicAudit : performMultiPassAudit;

        const result = await auditFunction(
            cuentaJson,
            pamJson,
            contratoJson,
            apiKey,
            (msg) => sendUpdate({ type: 'log', message: msg }),
            htmlContext
        );

        sendUpdate({ type: 'progress', progress: 95 });

        if (result.usage) {
            // Use audit-specific model pricing (gemini-2.5-flash)
            const { estimatedCost, estimatedCostCLP } = GeminiService.calculateCost(
                'gemini-2.5-flash', // Audit uses economical model
                result.usage.promptTokens,
                result.usage.candidatesTokens
            );
            sendUpdate({
                type: 'usage',
                usage: {
                    ...result.usage,
                    estimatedCost,
                    estimatedCostCLP
                }
            });
        }

        sendUpdate({ type: 'final', data: result.data });
        res.end();

    } catch (error: any) {
        console.error('[AUDIT] Forensic Audit Error:', error);
        sendUpdate({
            type: 'error',
            message: error.message || 'Internal Server Error during forensic audit'
        });
        res.end();
    }
}

