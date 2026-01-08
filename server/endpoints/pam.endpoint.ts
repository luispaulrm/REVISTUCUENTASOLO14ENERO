import { Request, Response } from 'express';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
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
    console.log('[PAM] New PAM extraction request (Workflow Mode)');

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

        console.log('[PAM] Starting Workflow Execution...');

        let resultStream;
        let lastError: any;
        let activeApiKey: string | undefined;
        let activeModel: string = "";

        // WORKFLOW CONFIGURATION
        // Testing gemini-3-flash-preview with fallback to gemini-2.5-flash
        const workflow = [
            {
                model: 'gemini-3-flash-preview',
                timeout: 60000, // 60s timeout
                desc: 'Gemini 3 Flash Preview - Testing'
            },
            {
                model: 'gemini-2.5-flash',
                timeout: 60000, // 60s timeout
                desc: 'Gemini 2.5 Flash - Fallback confiable'
            }
        ];

        console.log('[PAM] Workflow Steps:', workflow.map(w => `${w.model} (${w.timeout}ms)`));

        for (const step of workflow) {
            console.log(`[PAM] 🔄 Executing Workflow Step: ${step.model} (${step.desc})`);

            for (const apiKey of apiKeys) {
                const keyMask = apiKey ? (apiKey.substring(0, 4) + '...') : '???';
                console.log(`[PAM] Trying with API Key: ${keyMask} (Model: ${step.model})`);

                try {
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({
                        model: step.model,
                        generationConfig: {
                            maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                            // High precision for medical data (User Request)
                            temperature: 0.1,
                            topP: 0.95,
                            topK: GENERATION_CONFIG.topK,
                            responseMimeType: "text/plain"
                        },
                        // CRITICAL: Block NONE settings to prevent medical content blocks
                        safetySettings: [
                            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        ]
                    });

                    console.log(`[PAM] Initiating stream with model ${step.model}...`);
                    sendUpdate({ type: 'log', message: `Conectando con ${step.model}...` });

                    // Progress indicator
                    let waitingIndicator: NodeJS.Timeout | null = setInterval(() => {
                        console.log(`[PAM] ⏳ Waiting... model: ${step.model}`);
                    }, 5000);

                    // Timeout promise from workflow config
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Timeout (${step.timeout}ms) exceeded for ${step.model}`));
                        }, step.timeout);
                    });

                    try {
                        const streamPromise = model.generateContentStream([
                            { text: PAM_PROMPT },
                            { inlineData: { data: image, mimeType: mimeType } }
                        ]);

                        resultStream = await Promise.race([streamPromise, timeoutPromise]);

                        if (resultStream) {
                            console.log(`[PAM] ✅ Stream established with Key: ${keyMask} on Model: ${step.model}`);
                            activeApiKey = apiKey;
                            activeModel = step.model;
                            clearInterval(waitingIndicator);
                            break; // Success with this key
                        }
                    } catch (raceError) {
                        clearInterval(waitingIndicator);
                        throw raceError;
                    }

                    if (waitingIndicator) clearInterval(waitingIndicator);

                } catch (attemptError: any) {
                    // Enhanced error logging to diagnose API issues
                    console.error(`[PAM] ❌ Failed with Key: ${keyMask} on ${step.model}`);
                    console.error(`[PAM] Error Message: ${attemptError.message}`);
                    console.error(`[PAM] Error Status: ${attemptError.status || 'N/A'}`);
                    console.error(`[PAM] Error Code: ${attemptError.code || 'N/A'}`);
                    console.error(`[PAM] Full Error:`, attemptError);

                    lastError = attemptError;

                    // Send detailed error to frontend for diagnosis
                    sendUpdate({
                        type: 'log',
                        message: `[DEBUG] ${step.model} error: ${attemptError.message} (status: ${attemptError.status || 'unknown'})`
                    });

                    // Continue to next key
                }
            }
            if (activeApiKey) break; // Workflow success

            console.warn(`[PAM] ⚠️ All keys failed for model ${step.model}. Switching to next workflow step...`);
            sendUpdate({ type: 'log', message: `⚠️ ${step.model} falló o tardó demasiado. Probando siguiente...` });
        }

        if (!resultStream) {
            console.error("[PAM] ❌ All Workflow steps failed.");
            const errStr = (lastError?.toString() || "") + (lastError?.message || "");
            const has429 = errStr.includes('429') || errStr.includes('Too Many Requests') || lastError?.status === 429;
            const has503 = errStr.includes('503') || errStr.includes('Overloaded');

            if (has429 || has503) {
                sendUpdate({ type: 'error', message: '⏳ Servidores Saturados (Google AI 503/429). Intente nuevamente en 1 minuto.' });
            } else {
                sendUpdate({ type: 'error', message: `Error crítico: Streaming falló. ${lastError?.message || ''}` });
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

                sendUpdate({ type: 'chunk', text: chunkText });

                // Send usage metadata if available
                const usage = chunk.usageMetadata;
                if (usage) {
                    const promptTokens = usage.promptTokenCount || 0;
                    const candidatesTokens = usage.candidatesTokenCount || 0;
                    const totalTokens = usage.totalTokenCount || 0;

                    const { estimatedCost, estimatedCostCLP } = GeminiService.calculateCost(
                        // Use active model we captured
                        activeModel || 'gemini-2.5-flash',
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

        // Parse the LINE-BASED response (Imitating Bill Parser Pattern)
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
        const mapFolios = new Map<string, any>();
        let currentFolio = "UNKNOWN";
        let currentProvider = "UNKNOWN";
        let currentFolioObj: any = null;
        let currentProviderObj: any = null;

        console.log(`[PAM] Parsing ${lines.length} lines of text data...`);

        // Helper for cleaning money
        const cleanMoney = (val: string): number => {
            if (!val) return 0;
            return parseInt(val.replace(/[^\d-]/g, ''), 10) || 0;
        };

        for (const line of lines) {
            if (line.startsWith('FOLIO:')) {
                currentFolio = line.replace('FOLIO:', '').trim();
                currentProvider = "UNKNOWN";

                if (!mapFolios.has(currentFolio)) {
                    currentFolioObj = {
                        folioPAM: currentFolio,
                        prestadorPrincipal: "PENDING",
                        periodoCobro: "PENDING",
                        desglosePorPrestador: [],
                        resumen: { totalCopagoDeclarado: 0, copago: 0 }
                    };
                    mapFolios.set(currentFolio, currentFolioObj);
                } else {
                    currentFolioObj = mapFolios.get(currentFolio);
                }
                continue;
            }

            if (line.startsWith('PROVIDER:')) {
                currentProvider = line.replace('PROVIDER:', '').trim();
                // Ensure folio exists if provider comes first (rare but possible)
                if (!currentFolioObj) {
                    currentFolio = "DEFAULT_PAM";
                    currentFolioObj = {
                        folioPAM: currentFolio,
                        prestadorPrincipal: "PENDING",
                        periodoCobro: "PENDING",
                        desglosePorPrestador: [],
                        resumen: {}
                    };
                    mapFolios.set(currentFolio, currentFolioObj);
                }

                // Check if provider already exists in this folio
                currentProviderObj = currentFolioObj.desglosePorPrestador.find((p: any) => p.nombrePrestador === currentProvider);
                if (!currentProviderObj) {
                    currentProviderObj = {
                        nombrePrestador: currentProvider,
                        items: []
                    };
                    currentFolioObj.desglosePorPrestador.push(currentProviderObj);

                    // Update main provider if it's the first one
                    if (currentFolioObj.prestadorPrincipal === "PENDING") {
                        currentFolioObj.prestadorPrincipal = currentProvider;
                    }
                }
                continue;
            }

            if (line.startsWith('TOTAL_COPAGO_DECLARADO:')) {
                if (currentFolioObj) {
                    currentFolioObj.resumen.totalCopagoDeclarado = cleanMoney(line.replace('TOTAL_COPAGO_DECLARADO:', ''));
                }
                continue;
            }

            // Pipe delimited Items: [Code]|[Desc]|[Qty]|[Total]|[Bonif]|[Copago]
            if (line.includes('|')) {
                const parts = line.split('|').map(p => p.trim());
                if (parts.length >= 6) {
                    // Start from index 0 if format is strictly followed
                    // [0]Code, [1]Desc, [2]Qty, [3]Total, [4]Bonif, [5]Copago
                    const code = parts[0];
                    const desc = parts[1];
                    const qtyStr = parts[2];
                    const totalStr = parts[3];
                    const bonifStr = parts[4];
                    const copagoStr = parts[5];

                    if (!currentFolioObj) continue; // Skip if no context

                    // If no provider set, create a default one
                    if (!currentProviderObj) {
                        currentProviderObj = {
                            nombrePrestador: "PRESTADOR_GENERAL",
                            items: []
                        };
                        currentFolioObj.desglosePorPrestador.push(currentProviderObj);
                    }

                    // Avoid headers
                    if (desc.includes("Descripción") || desc.includes("---")) continue;

                    const newItem = {
                        codigoGC: code,
                        descripcion: desc,
                        cantidad: qtyStr,
                        valorTotal: cleanMoney(totalStr),
                        bonificacion: cleanMoney(bonifStr),
                        copago: cleanMoney(copagoStr)
                    };

                    currentProviderObj.items.push(newItem);
                }
            }
        }

        const rawFolios = Array.from(mapFolios.values());
        console.log(`[PAM] Parsed ${rawFolios.length} folios from text stream.`);

        /* 
        // Post-process: Transform array into PamDocument structure
        // (Existing logic continues below...)
        */
        const folios = rawFolios; // Compatible assignment

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
