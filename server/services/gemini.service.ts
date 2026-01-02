import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG, calculatePrice } from '../config/ai.config.js';

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
            model: AI_CONFIG.ACTIVE_MODEL,
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
     * Executes a targeted repair tailored for a specific section discrepancy.
     */
    async repairSection(
        image: string,
        mimeType: string,
        sectionName: string,
        declaredTotal: number,
        calculatedTotal: number
    ): Promise<any[]> {
        const diff = declaredTotal - calculatedTotal;
        const prompt = `
        ACT AS A CLINICAL BILL AUDIT SPECIALIST.
        
        ISSUE:
        In the section "${sectionName}", you previously extracted items that sum up to $${calculatedTotal.toLocaleString('es-CL')}.
        However, the document clearly states that the TOTAL for this section should be $${declaredTotal.toLocaleString('es-CL')}.
        
        There is a DISCREPANCY of $${diff.toLocaleString('es-CL')} (Missing or Misread Items).
        
        YOUR TASK:
        1. Re-scan ONLY the section "${sectionName}" in the provided image.
        2. Find the items that explain this difference. It might be:
           - A missing item you skipped.
           - An item where you read a digit wrongly (e.g. read 6 as 8).
           - An item where you read the Unit Price instead of the Total Price.
        3. Output the COMPLETE correct list of items for this section.
        
        OUTPUT FORMAT: A plain JSON array of objects.
        [
          { "index": 1, "description": "...", "quantity": 1, "unitPrice": 100, "total": 100 },
          ...
        ]
        
        IMPORTANT:
        - Return ONLY the JSON array. No markdown formatting.
        - Ensure the new list sums up EXACTLY to $${declaredTotal.toLocaleString('es-CL')}.
        `;

        const model = this.client.getGenerativeModel({
            model: AI_CONFIG.ACTIVE_MODEL,
            generationConfig: {
                maxOutputTokens: 8000,
                responseMimeType: "application/json"
            }
        });

        const result = await model.generateContent([
            { text: prompt },
            {
                inlineData: {
                    data: image,
                    mimeType: mimeType
                }
            }
        ]);

        const text = result.response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error("Failed to parse repair JSON", e);
            return [];
        }
    }

    /**
     * Calcula el costo estimado basado en el modelo y el uso de tokens.
     * Basado en las nuevas tarifas de Gemini 3.
     */
    static calculateCost(modelName: string, promptTokens: number, candidatesTokens: number) {
        // We ignore modelName argument to enforce Single Source of Truth from Config
        // or check if it matches AI_CONFIG.ACTIVE_MODEL

        const { costUSD, costCLP } = calculatePrice(promptTokens, candidatesTokens);

        return {
            promptTokens,
            candidatesTokens,
            totalTokens: promptTokens + candidatesTokens,
            estimatedCost: costUSD,
            estimatedCostCLP: costCLP
        };
    }
}
