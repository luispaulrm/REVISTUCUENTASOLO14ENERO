import { Request, Response } from 'express';
import { ProjectionService } from '../services/projection.service.js';

// ✅ Railway-compatible env access
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

// Helper to get all API keys
const getApiKeys = () => {
    const keys = [];
    if (envGet("GEMINI_API_KEY")) keys.push(envGet("GEMINI_API_KEY"));
    if (envGet("API_KEY")) keys.push(envGet("API_KEY"));
    if (envGet("GEMINI_API_KEY_SECONDARY")) keys.push(envGet("GEMINI_API_KEY_SECONDARY"));
    // Deduplicate
    return [...new Set(keys)].filter(k => !!k);
};

export async function handleProjection(req: Request, res: Response) {
    console.log('[PROJECTION] New PDF-to-HTML projection request');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        if (!res.writableEnded) {
            res.write(JSON.stringify(data) + '\n');
        }
    };

    try {
        const { image, mimeType } = req.body;

        if (!image || !mimeType) {
            sendUpdate({ type: 'error', error: 'Missing image or mimeType' });
            return res.end();
        }

        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            sendUpdate({ type: 'error', error: 'API Key not configured' });
            return res.end();
        }

        const projectionService = new ProjectionService(apiKeys[0]);

        console.log('[PROJECTION] Starting projection stream...');
        sendUpdate({ type: 'log', text: 'Iniciando proyector maestro...' });

        const stream = projectionService.projectPdfToHtml(image, mimeType);

        for await (const chunk of stream) {
            sendUpdate(chunk);
        }

        console.log('[PROJECTION] Projection complete');
        res.end();

    } catch (error: any) {
        console.error('[PROJECTION] Error in endpoint:', error);
        sendUpdate({ type: 'error', error: error.message || 'Internal Server Error' });
        res.end();
    }
}
