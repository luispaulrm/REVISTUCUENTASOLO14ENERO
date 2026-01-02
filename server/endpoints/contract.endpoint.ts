import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { CONTRACT_PROMPT, CONTRACT_ANALYSIS_SCHEMA } from '../prompts/contract.prompt.js';

// Helper para obtener env vars
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handleContractExtraction(req: Request, res: Response) {
    console.log('[CONTRACT] New Contract extraction request (Forensic Analysis)');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType } = req.body;

        // Validaciones
        if (!image || !mimeType) {
            console.error('[CONTRACT] Missing payload');
            return res.status(400).json({ error: 'Missing image/pdf data or mimeType' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) {
            console.error('[CONTRACT] No API Key');
            return res.status(500).json({ error: 'API Key not configured' });
        }

        // Inicializar servicio Gemini
        const gemini = new GeminiService(apiKey);
        let fullText = "";

        console.log('[CONTRACT] Starting Gemini forensic extraction...');

        const stream = await gemini.extractWithStream(image, mimeType, CONTRACT_PROMPT, {
            responseMimeType: 'application/json',
            responseSchema: CONTRACT_ANALYSIS_SCHEMA,
            maxTokens: 30000
        });

        for await (const chunk of stream) {
            fullText += chunk.text;

            // Enviar chunk al frontend para logs de traza
            sendUpdate({ type: 'chunk', text: chunk.text });

            // Enviar métricas si disponibles
            if (chunk.usageMetadata) {
                const usage = chunk.usageMetadata;
                const inputCost = (usage.promptTokenCount / 1000000) * 0.10;
                const outputCost = (usage.candidatesTokenCount / 1000000) * 0.40;
                const estimatedCost = inputCost + outputCost;

                sendUpdate({
                    type: 'usage',
                    usage: {
                        promptTokens: usage.promptTokenCount,
                        candidatesTokens: usage.candidatesTokenCount,
                        totalTokens: usage.totalTokenCount,
                        estimatedCost,
                        estimatedCostCLP: Math.round(estimatedCost * 980)
                    }
                });
            }
        }

        console.log(`[CONTRACT] Extraction complete: ${fullText.length} chars`);

        // Convertir el texto acumulado a JSON
        try {
            const cleanedText = fullText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
            const contractData = JSON.parse(cleanedText);

            // Enviar resultado final estructurado
            sendUpdate({
                type: 'final',
                data: contractData
            });

        } catch (parseError) {
            console.error('[CONTRACT] JSON Parse Error:', parseError);
            throw new Error('No se pudo procesar la respuesta forense del contrato.');
        }

        res.end();

    } catch (error: any) {
        console.error('[CONTRACT] Error en endpoint CONTRACT:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}
