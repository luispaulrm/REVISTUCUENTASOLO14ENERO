import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG, AI_MODELS, calculatePrice } from '../config/ai.config.js';

export interface StreamChunk {
    text: string;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

export class GeminiService {
    private keys: string[];
    private activeKeyIndex: number = 0;
    private client: GoogleGenerativeAI;
    private logCallback?: (msg: string) => void;

    constructor(apiKeyOrKeys: string | string[], logCallback?: (msg: string) => void) {
        this.logCallback = logCallback;
        const initialKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];
        const envKeys = [];
        const getEnv = (k: string) => typeof process !== 'undefined' && process.env ? process.env[k] : undefined;

        if (getEnv("GEMINI_API_KEY")) envKeys.push(getEnv("GEMINI_API_KEY")!);
        if (getEnv("API_KEY")) envKeys.push(getEnv("API_KEY")!);
        if (getEnv("GEMINI_API_KEY_SECONDARY")) envKeys.push(getEnv("GEMINI_API_KEY_SECONDARY")!);
        if (getEnv("GEMINI_API_KEY_TERTIARY")) envKeys.push(getEnv("GEMINI_API_KEY_TERTIARY")!);
        if (getEnv("GEMINI_API_KEY_QUATERNARY")) envKeys.push(getEnv("GEMINI_API_KEY_QUATERNARY")!);
        if (getEnv("GEMINI_API_KEY_QUINARY")) envKeys.push(getEnv("GEMINI_API_KEY_QUINARY")!);

        const combined = Array.from(new Set([...initialKeys, ...envKeys]));
        this.keys = combined.filter(k => !!k && k.length > 5);

        if (this.keys.length === 0) {
            console.error("❌ GeminiService started with NO VALID KEYS");
            this.client = new GoogleGenerativeAI("DUMMY_KEY");
        } else {
            this.client = new GoogleGenerativeAI(this.keys[0]);
        }
    }

    private log(msg: string) {
        if (this.logCallback) this.logCallback(msg);
        console.log(`[GeminiService] ${msg}`);
    }

    async extract(
        image: string,
        mimeType: string,
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
            temperature?: number;
            topP?: number;
            topK?: number;
        } = {}
    ): Promise<string> {
        let lastError: any;
        const modelsToTry = [
            AI_CONFIG.ACTIVE_MODEL,
            AI_CONFIG.FALLBACK_MODEL,
            AI_MODELS.fallback2,
            AI_MODELS.fallback3,
            AI_MODELS.fallback4,
            'gemini-2.0-flash'
        ].filter(Boolean);

        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            this.log(`🛡️ Estrategia: Intentando extracción con modelo ${modelName}`);

            let startingKeyIdx = this.activeKeyIndex;

            for (let i = 0; i < this.keys.length; i++) {
                const keyIdx = (startingKeyIdx + i) % this.keys.length;
                this.activeKeyIndex = keyIdx;
                const currentKey = this.keys[keyIdx];
                const mask = currentKey ? (currentKey.substring(0, 4) + '...') : '???';

                try {
                    this.client = new GoogleGenerativeAI(currentKey);
                    const model = this.client.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: config.maxTokens || 35000,
                            responseMimeType: config.responseMimeType,
                            responseSchema: config.responseSchema,
                            temperature: config.temperature,
                            topP: config.topP,
                            topK: config.topK
                        }
                    });

                    this.log(`🚀 Enviando solicitud a ${modelName}... (Llave ${keyIdx + 1})`);

                    const timeoutMs = 90000; // Increased to 90s for better stability
                    const extractionPromise = model.generateContent([{ text: prompt }, ...(image && mimeType ? [{
                        inlineData: { data: image, mimeType: mimeType }
                    }] : [])]);

                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error(`Timeout: Gemini ${modelName} did not respond in ${timeoutMs / 1000}s`)), timeoutMs);
                    });

                    const result = await Promise.race([extractionPromise, timeoutPromise]) as any;
                    const text = result.response.text();
                    this.log(`✅ Éxito con Llave ${mask} en ${modelName} (${text.length} chars)`);
                    return text;

                } catch (err: any) {
                    lastError = err;
                    const errStr = (err?.toString() || "") + (err?.message || "");
                    const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || err?.status === 429 || err?.status === 503;
                    const isTimeout = errStr.includes('Timeout') || errStr.includes('deadline');
                    const isInvalid = errStr.includes('404') || errStr.includes('not found') || errStr.includes('400');

                    if (isQuota) {
                        this.log(`⚠️ Error de cuota en Llave ${mask}. Probando siguiente llave...`);
                        continue;
                    } else if (isTimeout) {
                        this.log(`⏱️ Tiempo excedido en Llave ${mask} con ${modelName}. Probando siguiente llave/modelo...`);
                        if (i >= 1) break;
                        continue;
                    } else if (isInvalid) {
                        this.log(`❌ Modelo ${modelName} no disponible. Saltando al siguiente modelo...`);
                        break;
                    } else {
                        this.log(`❌ Error en Llave ${mask}: ${err.message}`);
                        if (i >= 1) break;
                    }
                }
            }
        }
        throw lastError || new Error("All API keys and models failed for extraction.");
    }

    async extractText(
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
            temperature?: number;
            topP?: number;
            topK?: number;
        } = {}
    ): Promise<string> {
        return this.extract('', '', prompt, config);
    }

    async extractWithStream(
        image: string,
        mimeType: string,
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
            temperature?: number;
            topP?: number;
            topK?: number;
        } = {}
    ): Promise<AsyncIterable<StreamChunk>> {
        let lastError: any;
        let startingKeyIdx = this.activeKeyIndex;
        const modelsToTry = [
            AI_CONFIG.ACTIVE_MODEL,
            AI_CONFIG.FALLBACK_MODEL,
            AI_MODELS.fallback2,
            AI_MODELS.fallback3,
            AI_MODELS.fallback4,
            'gemini-2.0-flash'
        ].filter(Boolean);

        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            this.log(`🛡️ Estrategia: Probando streaming con ${modelName}`);

            for (let i = 0; i < this.keys.length; i++) {
                const keyIdx = (startingKeyIdx + i) % this.keys.length;
                this.activeKeyIndex = keyIdx;
                const currentKey = this.keys[keyIdx];
                const mask = currentKey ? (currentKey.substring(0, 4) + '...') : '???';

                try {
                    this.client = new GoogleGenerativeAI(currentKey);
                    const model = this.client.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: config.maxTokens || 35000,
                            responseMimeType: config.responseMimeType,
                            responseSchema: config.responseSchema,
                            temperature: config.temperature,
                            topP: config.topP,
                            topK: config.topK
                        }
                    });

                    const resultStream = await model.generateContentStream([
                        { text: prompt },
                        ...(image && mimeType ? [{
                            inlineData: { data: image, mimeType: mimeType }
                        }] : [])
                    ]);

                    this.log(`✅ Éxito (Stream) con Llave ${mask} en ${modelName}`);
                    return this.processStream(resultStream);

                } catch (err: any) {
                    lastError = err;
                    const errStr = (err?.toString() || "") + (err?.message || "");
                    const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || err?.status === 429 || err?.status === 503;

                    if (isQuota) {
                        this.log(`⚠️ Error de cuota en Llave ${mask}. Probando siguiente...`);
                        continue;
                    } else {
                        this.log(`❌ Error en Llave ${mask}: ${err.message}`);
                    }
                }
            }
        }
        throw lastError || new Error("All API keys failed for stream extraction.");
    }

    private async * processStream(resultStream: any): AsyncIterable<StreamChunk> {
        for await (const chunk of resultStream.stream) {
            const chunkText = chunk.text();
            const usage = chunk.usageMetadata;
            yield {
                text: chunkText,
                usageMetadata: usage ? {
                    promptTokenCount: usage.promptTokenCount || 0,
                    candidatesTokenCount: usage.candidatesTokenCount || 0,
                    totalTokenCount: usage.totalTokenCount || 0
                } : undefined
            };
        }
    }

    static calculateCost(modelName: string, promptTokens: number, candidatesTokens: number) {
        const { costUSD, costCLP } = calculatePrice(promptTokens, candidatesTokens, modelName);
        return {
            promptTokens,
            candidatesTokens,
            totalTokens: promptTokens + candidatesTokens,
            estimatedCost: costUSD,
            estimatedCostCLP: costCLP
        };
    }

    static async generateChatResponse(
        systemPrompt: string,
        userMessage: string,
        history: { role: string, parts: { text: string }[] }[],
        modelName: string
    ): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (!apiKey) throw new Error("No API Key found for Chat");
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Entendido." }] },
                ...history
            ]
        });
        const result = await chat.sendMessage(userMessage);
        return result.response.text();
    }
}
