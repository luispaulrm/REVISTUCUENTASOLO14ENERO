import { Request, Response } from 'express';
import { analyzeSingleContract } from '../services/contractEngine.service.js';

// Helper para obtener env vars
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handleContractExtraction(req: Request, res: Response) {
    console.log('[CONTRACT] New Forensic Analysis Request (Independent Engine v2.0)');

    // Setup streaming response for logs
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent buffering in proxies like Nginx/Railway

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType, originalname } = req.body;

        if (!image || !mimeType) {
            console.error('[CONTRACT] Missing payload');
            return res.status(400).json({ error: 'Missing image/pdf data or mimeType' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) {
            console.error('[CONTRACT] No API Key');
            return res.status(500).json({ error: 'API Key not configured' });
        }

        // Convert base64 to Buffer for the engine
        const buffer = Buffer.from(image, 'base64');
        const file = {
            buffer,
            mimetype: mimeType,
            originalname: originalname || 'documento.pdf'
        };

        // Execute Independent Engine
        const result = await analyzeSingleContract(
            file,
            apiKey,
            (logMsg) => {
                if (logMsg.startsWith('@@METRICS@@')) {
                    try {
                        const metrics = JSON.parse(logMsg.replace('@@METRICS@@', ''));
                        sendUpdate({
                            type: 'usage',
                            usage: {
                                phase: metrics.phase,
                                promptTokens: metrics.input,
                                candidatesTokens: metrics.output,
                                totalTokens: metrics.input + metrics.output,
                                estimatedCostCLP: Math.round(metrics.cost)
                            }
                        });
                    } catch (e) {
                        // Fallback if parsing fails
                        console.error('Error parsing metrics', e);
                    }
                } else {
                    sendUpdate({ type: 'chunk', text: logMsg + '\n' });
                }
            },
            {
                // Custom options if needed
            }
        );

        // Send Metrics update
        if (result.metrics) {
            sendUpdate({
                type: 'usage',
                usage: {
                    promptTokens: result.metrics.tokenUsage.input,
                    candidatesTokens: result.metrics.tokenUsage.output,
                    totalTokens: result.metrics.tokenUsage.total,
                    estimatedCostCLP: Math.round(result.metrics.tokenUsage.costClp)
                }
            });
        }

        // Send Final Data
        sendUpdate({
            type: 'final',
            data: result
        });

        res.end();

    } catch (error: any) {
        console.error('[CONTRACT] Independent Engine Error:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error during forensic analysis' });
        res.end();
    }
}
