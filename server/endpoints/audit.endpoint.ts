import { Request, Response } from 'express';
import { performForensicAudit } from '../services/auditEngine.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { AI_CONFIG } from '../config/ai.config.js';

export async function handleAuditAnalysis(req: Request, res: Response) {
    console.log('[AUDIT] New Single-Pass Forensic Audit Request Initiated');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { cuentaJson, pamJson, contratoJson, htmlContext, isAgentMode, previousAuditResult } = req.body;

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
        sendUpdate({ type: 'log', message: isAgentMode ? '[AGENT] Iniciando Protocolo de Búsqueda Forense (17 Pasos)...' : '[AUDIT] Iniciando auditoría forense...' });

        // Always use single pass
        const result = await performForensicAudit(
            cuentaJson,
            pamJson,
            contratoJson,
            apiKey,
            (msg) => sendUpdate({ type: 'log', message: msg }),
            htmlContext,
            '', // contractMarkdown (New argument)
            // onUsageUpdate
            (usage) => {
                const usageData = usage as any;
                const { estimatedCost, estimatedCostCLP } = GeminiService.calculateCost(
                    'gemini-2.5-flash',
                    usageData.promptTokenCount || usageData.promptTokens,
                    usageData.candidatesTokenCount || usageData.candidatesTokens
                );
                sendUpdate({
                    type: 'usage',
                    usage: {
                        promptTokens: usage.promptTokenCount || usage.promptTokens,
                        candidatesTokens: usage.candidatesTokenCount || usage.candidatesTokens,
                        totalTokens: usage.totalTokenCount || usage.totalTokens,
                        estimatedCost,
                        estimatedCostCLP
                    }
                });
            },
            // onProgressUpdate
            (prog) => sendUpdate({ type: 'progress', progress: prog }),
            isAgentMode,
            previousAuditResult
        );

        sendUpdate({ type: 'progress', progress: 95 });

        if (result.usage) {
            // Final usage check (if not already sent by streaming)
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
