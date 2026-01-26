import { Request, Response } from 'express';
import { analyzeSingleContract } from '../services/contractEngine.service.js';
import { transformToCanonical } from '../services/canonicalTransform.service.ts';
import { registerProcessedContract, getContractCount } from '../services/contractLearning.service.ts';

function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handleCanonicalExtraction(req: Request, res: Response) {
    console.log('[CANONICAL] New Extraction Request');

    // Setup streaming for logs (reusing existing UI logic)
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType, originalname } = req.body;
        if (!image || !mimeType) {
            return res.status(400).json({ error: 'Missing image/pdf data' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) return res.status(500).json({ error: 'API Key not configured' });

        const buffer = Buffer.from(image, 'base64');
        const file = { buffer, mimetype: mimeType, originalname: originalname || 'contrato.pdf' };

        // 1. Run full fidelity extraction
        const result = await analyzeSingleContract(
            file,
            apiKey,
            (logMsg) => {
                if (logMsg.startsWith('@@METRICS@@')) {
                    try {
                        const metrics = JSON.parse(logMsg.replace('@@METRICS@@', ''));
                        sendUpdate({ type: 'metrics', metrics });
                    } catch (e) {
                        console.error('[CANONICAL] Failed to parse metrics:', e);
                    }
                } else {
                    sendUpdate({ type: 'chunk', text: logMsg });
                }
            }
        );

        // 2. Transform to Canonical JSON
        const canonicalResult = transformToCanonical(result);

        // 3. Register as processed unique contract (fingerprint: name|size)
        const fingerprint = `${file.originalname}|${file.buffer.length}`;
        const totalCount = await registerProcessedContract(fingerprint);

        // 4. Send final canonical data
        sendUpdate({
            type: 'final',
            data: canonicalResult,
            metrics: result.metrics,
            totalCount
        });

        res.end();

    } catch (error: any) {
        console.error('[CANONICAL] Error:', error);
        sendUpdate({ type: 'error', message: error.message });
        res.end();
    }
}
