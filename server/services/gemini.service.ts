import { GoogleGenerativeAI } from "@google/generative-ai";

export interface StreamChunk {
    text: string;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

export class GeminiService {
    private client: GoogleGenerativeAI;

    constructor(apiKey: string) {
        this.client = new GoogleGenerativeAI(apiKey);
    }

    async extractWithStream(
        image: string,
        mimeType: string,
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
        } = {}
    ): Promise<AsyncIterable<StreamChunk>> {
        const model = this.client.getGenerativeModel({
            model: "gemini-3-pro-preview",
            generationConfig: {
                maxOutputTokens: config.maxTokens || 64000,
                responseMimeType: config.responseMimeType,
                responseSchema: config.responseSchema,
            }
        });

        const resultStream = await model.generateContentStream([
            { text: prompt },
            {
                inlineData: {
                    data: image,
                    mimeType: mimeType
                }
            }
        ]);

        return this.processStream(resultStream);
    }

    private async *processStream(resultStream: any): AsyncIterable<StreamChunk> {
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

    /**
     * Calcula el costo estimado basado en el modelo y el uso de tokens.
     * Basado en las nuevas tarifas de Gemini 3.
     */
    static calculateCost(modelName: string, promptTokens: number, candidatesTokens: number) {
        // Precios por 1 millón de tokens
        const pricing = {
            'gemini-3-pro-preview': {
                inputLow: 2.00, // <= 200K
                inputHigh: 4.00, // > 200K
                outputLow: 12.00, // <= 200K
                outputHigh: 18.00 // > 200K
            },
            'gemini-3-flash-preview': {
                input: 0.50,
                output: 3.00
            }
        };

        const totalTokens = promptTokens + candidatesTokens;
        let estimatedCost = 0;

        if (modelName.includes('pro')) {
            const p = pricing['gemini-3-pro-preview'];
            const rateInput = totalTokens > 200000 ? p.inputHigh : p.inputLow;
            const rateOutput = totalTokens > 200000 ? p.outputHigh : p.outputLow;

            estimatedCost = (promptTokens / 1000000) * rateInput + (candidatesTokens / 1000000) * rateOutput;
        } else {
            // Default to Flash pricing if not Pro
            const p = pricing['gemini-3-flash-preview'];
            estimatedCost = (promptTokens / 1000000) * p.input + (candidatesTokens / 1000000) * p.output;
        }

        return {
            estimatedCost,
            estimatedCostCLP: Math.round(estimatedCost * 980) // Tasa de cambio aproximada
        };
    }
}
