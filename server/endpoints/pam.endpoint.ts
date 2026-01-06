import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PAM_PROMPT } from '../prompts/pam.prompt.js';
import { AI_CONFIG, GENERATION_CONFIG } from '../config/ai.config.js';
import { GeminiService } from '../services/gemini.service.js';
import { repairAndParseJson } from '../utils/jsonRepair.js';

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

export async function handlePamExtraction(req: Request, res: Response) {
    console.log('[PAM] New PAM extraction request (Bill-Style Streaming)');

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
            sendUpdate({ type: 'error', message: 'Missing image or mimeType' });
            return res.end();
        }

        // Get ALL API keys
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            sendUpdate({ type: 'error', message: 'API Key not configured' });
            return res.end();
        }

        sendUpdate({ type: 'log', message: 'Iniciando extracción de datos PAM...' });
        sendUpdate({ type: 'progress', progress: 10 });

        console.log('[PAM] Starting Gemini streaming extraction...');

        let resultStream;
        let lastError: any;
        let activeApiKey: string | undefined;

        // RETRY LOOP WITH FAILURE OVER MODELS AND KEYS (Aligned with server.ts)
        const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL].filter(Boolean);

        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            console.log(`[PAM] 🛡️ Attempting extraction with model: ${modelName}`);

            for (const apiKey of apiKeys) {
                const keyMask = apiKey ? (apiKey.substring(0, 4) + '...') : '???';
                console.log(`[PAM] Trying with API Key: ${keyMask} (Model: ${modelName})`);

                try {
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                            temperature: GENERATION_CONFIG.temperature,
                            topP: GENERATION_CONFIG.topP,
                            topK: GENERATION_CONFIG.topK
                        }
                    });

                    // Direct stream generation (No explicit timeout wrapper, matching server.ts)
                    resultStream = await model.generateContentStream([
                        { text: PAM_PROMPT },
                        {
                            inlineData: {
                                data: image,
                                mimeType: mimeType
                            }
                        }
                    ]);

                    if (resultStream) {
                        console.log(`[PAM] Success with Key: ${keyMask} on Model: ${modelName}`);
                        activeApiKey = apiKey;
                        break; // Success with this key
                    }

                } catch (attemptError: any) {
                    console.warn(`[PAM] Failed with Key: ${keyMask} on ${modelName}:`, attemptError.message);
                    lastError = attemptError;
                }
            }
            if (activeApiKey) break; // Success with this model
            console.warn(`[PAM] ⚠️ All keys failed for model ${modelName}. Switching to next model...`);
            sendUpdate({ type: 'log', message: `⚠️ Modelo ${modelName} saturado/falló. Probando alternativo...` });
        }

        if (!resultStream) {
            console.error("[PAM] ❌ All API Keys/Models failed.");
            const errStr = (lastError?.toString() || "") + (lastError?.message || "");
            const has429 = errStr.includes('429') || errStr.includes('Too Many Requests') || lastError?.status === 429;
            const has503 = errStr.includes('503') || errStr.includes('Overloaded');

            if (has429 || has503) {
                sendUpdate({ type: 'error', message: '⏳ Servidores Saturados (Google AI 503/429). Intente nuevamente en 1 minuto.' });
            } else {
                sendUpdate({ type: 'error', message: `Error iniciando stream: ${lastError?.message || 'Unknown Error'}` });
            }
            return res.end();
        }

        console.log('[PAM] Stream initiated successfully');

        sendUpdate({ type: 'progress', progress: 30 });

        // Stream the response EXACTLY like Bill does
        let fullText = '';
        let previousLength = 0;
        let stuckCount = 0;
        let maxIterations = 10000; // Safety limit
        let iteration = 0;

        try {
            for await (const chunk of resultStream.stream) {
                iteration++;

                // Safety check: prevent infinite loops
                if (iteration > maxIterations) {
                    console.error(`[PAM] Stream exceeded ${maxIterations} iterations. Breaking loop.`);
                    break;
                }

                const chunkText = chunk.text();
                fullText += chunkText;

                // Detect stuck stream (same length for 3+ iterations)
                if (fullText.length === previousLength) {
                    stuckCount++;
                    if (stuckCount > 3) {
                        console.log(`[PAM] Stream appears stuck at ${fullText.length} chars. Breaking loop.`);
                        break;
                    }
                } else {
                    stuckCount = 0; // Reset counter
                }
                previousLength = fullText.length;

                console.log(`[PAM] Received chunk: ${chunkText.length} chars (Total: ${fullText.length})`);

                sendUpdate({ type: 'log', message: `Procesando... ${fullText.length} chars` });

                // Send usage metadata if available
                const usage = chunk.usageMetadata;
                if (usage) {
                    const promptTokens = usage.promptTokenCount || 0;
                    const candidatesTokens = usage.candidatesTokenCount || 0;
                    const totalTokens = usage.totalTokenCount || 0;

                    const { estimatedCost, estimatedCostCLP } = GeminiService.calculateCost(
                        AI_CONFIG.ACTIVE_MODEL,
                        promptTokens,
                        candidatesTokens
                    );

                    sendUpdate({
                        type: 'usage',
                        usage: {
                            promptTokens,
                            candidatesTokens,
                            totalTokens,
                            estimatedCost,
                            estimatedCostCLP
                        }
                    });
                }
            }
        } catch (streamReadError: any) {
            console.error('[PAM] Error reading stream:', streamReadError);
            sendUpdate({ type: 'error', message: `Error leyendo stream: ${streamReadError.message}` });
            return res.end();
        }

        console.log(`[PAM] Stream complete. Total length: ${fullText.length} chars`);
        sendUpdate({ type: 'progress', progress: 80 });
        sendUpdate({ type: 'log', message: 'Procesando respuesta...' });

        // Parse the JSON response
        let rawFolios;
        try {
            console.log('[PAM] Attempting to parse JSON...');
            rawFolios = repairAndParseJson(fullText);
            console.log('[PAM] JSON parsed successfully. Type:', typeof rawFolios, 'Is Array:', Array.isArray(rawFolios));
        } catch (parseError: any) {
            console.error('[PAM] JSON parse error:', parseError);
            console.error('[PAM] Raw text (first 500 chars):', fullText?.substring(0, 500));
            sendUpdate({ type: 'error', message: `Error al parsear JSON: ${parseError.message}` });
            return res.end();
        }

        // Post-process: Transform array into PamDocument structure
        console.log('[PAM] Post-processing folios...');
        sendUpdate({ type: 'log', message: 'Validando y consolidando datos...' });

        const folios = Array.isArray(rawFolios) ? rawFolios : [];

        // Calculate global totals
        let globalValor = 0;
        let globalBonif = 0;
        let globalCopago = 0;
        let globalDeclarado = 0;
        let globalItems = 0;

        const parseMoney = (val: any) => {
            if (!val) return 0;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return parseInt(val.replace(/[^\d]/g, '')) || 0;
            return 0;
        };

        folios.forEach((folio: any) => {
            const desglose = folio.desglosePorPrestador || [];

            // Calculate folio totals
            let folioValor = 0;
            let folioBonif = 0;
            let folioCopago = 0;

            desglose.forEach((prestador: any) => {
                const items = prestador.items || [];
                items.forEach((item: any) => {
                    const valor = parseMoney(item.valorTotal);
                    const bonif = parseMoney(item.bonificacion);
                    const copago = parseMoney(item.copago);

                    folioValor += valor;
                    folioBonif += bonif;
                    folioCopago += copago;

                    globalValor += valor;
                    globalBonif += bonif;
                    globalCopago += copago;
                    globalItems++;
                });
            });

            // Ensure resumen exists and has cuadra property
            if (!folio.resumen) {
                folio.resumen = {};
            }

            const totalDeclarado = parseMoney(folio.resumen.totalCopagoDeclarado || folio.resumen.totalCopago || 0);
            folio.resumen.cuadra = Math.abs(folioCopago - totalDeclarado) <= 500;
            folio.resumen.discrepancia = folioCopago - totalDeclarado;

            globalDeclarado += totalDeclarado;
        });

        const pamData = {
            folios: folios,
            global: {
                totalValor: globalValor,
                totalBonif: globalBonif,
                totalCopago: globalCopago,
                totalCopagoDeclarado: globalDeclarado,
                cuadra: Math.abs(globalCopago - globalDeclarado) <= 500,
                discrepancia: globalCopago - globalDeclarado,
                auditoriaStatus: 'COMPLETED',
                totalItems: globalItems
            }
        };

        console.log('[PAM] Sending final response...');
        sendUpdate({ type: 'progress', progress: 100 });
        sendUpdate({ type: 'final', data: pamData });
        console.log('[PAM] Response sent successfully');
        res.end();

    } catch (error: any) {
        console.error('[PAM] Unexpected error in endpoint:', error);
        console.error('[PAM] Stack trace:', error.stack);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}
