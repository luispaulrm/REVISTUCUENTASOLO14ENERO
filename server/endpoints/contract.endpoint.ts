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

    // Harden Timeouts for massive contracts
    req.setTimeout(0); // Unlimited input timeout
    res.setTimeout(600000); // 10 minutes for output

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

        // --- VALIDATION LAYER START ---
        const { ValidationService } = await import('../services/validation.service.js');
        const validationService = new ValidationService(apiKey);

        // Streaming updates for contract are done differently (sendUpdate wrapper inside try block)
        // But here we can send a preliminary check or just reject.
        // The contract endpoint supports streaming NDJSON output.
        // Let's emulate the validation log.
        if (res.writable) {
            sendUpdate({ type: 'chunk', text: '[VALIDATION] 🕵️ Verificando si el documento es un CONTRATO de Salud...\n' });
        }

        const validation = await validationService.validateDocumentType(image, mimeType, 'CONTRATO');

        if (!validation.isValid) {
            console.warn(`[CONTRACT] VALIDATION REJECTED: ${validation.detectedType}. Reason: ${validation.reason}`);
            // If using NDJSON, we should send error type? Or just 400? 
            // The client expects NDJSON.
            sendUpdate({
                type: 'error',
                message: `VALIDACIÓN FALLIDA: Se esperaba un "CONTRATO" (Plan de Salud) pero se detectó: "${validation.detectedType}". (${validation.reason})`
            });
            return res.end();
        }
        if (res.writable) {
            sendUpdate({ type: 'chunk', text: `[VALIDATION] ✅ Documento validado: ${validation.detectedType}\n` });
        }
        // --- VALIDATION LAYER END ---

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
        console.log(`[CONTRACT] Final analysis complete. Serializing and sending ${result.coberturas.length} items...`);
        sendUpdate({
            type: 'final',
            data: result
        });
        console.log(`[CONTRACT] Data sent successfully.`);

        res.end();

    } catch (error: any) {
        console.error('[CONTRACT] Independent Engine Error:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error during forensic analysis' });
        res.end();
    }
}
