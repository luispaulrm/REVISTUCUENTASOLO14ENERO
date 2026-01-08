import { Request, Response } from 'express';
import { performForensicAudit } from '../services/auditEngine.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { AI_CONFIG } from '../config/ai.config.js';

export async function handleAuditAnalysis(req: Request, res: Response) {
    console.log('[AUDIT] New Forensic Audit Request Initiated');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { cuentaJson, pamJson, contratoJson } = req.body;

        if (!cuentaJson || !pamJson || !contratoJson) {
            sendUpdate({ type: 'error', message: 'Missing required JSONs (Cuenta, PAM or Contrato)' });
            return res.end();
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (!apiKey) {
            sendUpdate({ type: 'error', message: 'API Key not configured' });
            return res.end();
        }

        sendUpdate({ type: 'progress', progress: 10 });

        const result = await performForensicAudit(
            cuentaJson,
            pamJson,
            contratoJson,
            apiKey,
            (msg) => sendUpdate({ type: 'log', message: msg })
        );

        sendUpdate({ type: 'progress', progress: 90 });

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
