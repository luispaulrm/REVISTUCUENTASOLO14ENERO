import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PAM_PROMPT } from '../prompts/pam.prompt.js';
import { AI_CONFIG, GENERATION_CONFIG } from '../config/ai.config.js';
import { GeminiService } from '../services/gemini.service.js';
import { repairAndParseJson } from '../utils/jsonRepair.js';

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

        // Get API key
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (!apiKey) {
            sendUpdate({ type: 'error', message: 'API Key not configured' });
            return res.end();
        }

        sendUpdate({ type: 'log', message: 'Iniciando extracción de datos PAM...' });
        sendUpdate({ type: 'progress', progress: 10 });

        console.log('[PAM] Starting Gemini streaming extraction with model:', AI_CONFIG.ACTIVE_MODEL);

        // Use the SAME pattern as Bill: direct streaming with RETRY
        let resultStream;
        const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL].filter(Boolean); // Ensure valid models

        for (const modelName of modelsToTry) {
            try {
                console.log(`[PAM] 🛡️ Attempting extraction with model: ${modelName}`);

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: 'application/json',
                        maxOutputTokens: GENERATION_CONFIG.maxOutputTokens, // Ensure this config is appropriate for PAM
                        temperature: GENERATION_CONFIG.temperature,
                        topP: GENERATION_CONFIG.topP,
                        topK: GENERATION_CONFIG.topK
                    }
                });

                console.log('[PAM] Initiating Gemini stream...');

                // Timeout wrapper for stream initiation - INCREASED TO 60s
                const streamPromise = model.generateContentStream([
                    { text: PAM_PROMPT },
                    {
                        inlineData: {
                            data: image,
                            mimeType: mimeType
                        }
                    }
                ]);

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout esperando respuesta de Google AI (${modelName}, 60s)`)), 60000)
                );

                // @ts-ignore
                resultStream = await Promise.race([streamPromise, timeoutPromise]);

                console.log(`[PAM] Stream initiated successfully with ${modelName}`);
                break; // If successful, exit loop

            } catch (streamError: any) {
                console.warn(`[PAM] Failed with model ${modelName}:`, streamError.message);
                if (modelName === modelsToTry[modelsToTry.length - 1]) {
                    // If this was the last model, throw or handle the error
                    console.error('[PAM] All models failed.');
                    sendUpdate({ type: 'error', message: `Error iniciando stream (Todos los modelos fallaron): ${streamError.message}` });
                    return res.end();
                }
                // Otherwise continue to next model
                sendUpdate({ type: 'log', message: `⚠️ Modelo ${modelName} lento/falló. Reintentando con alternativo...` });
            }
        }

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
