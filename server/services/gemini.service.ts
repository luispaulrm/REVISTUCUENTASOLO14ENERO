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
        currentSum: number
    ): Promise<any[]> {
        const prompt = `
        ACT AS A CLINICAL BILL AUDIT SPECIALIST.
        
        ISSUE:
        In the section "${sectionName}", you previously extracted items that sum up to $${currentSum.toLocaleString('es-CL')}.
        However, the document states that the TOTAL for this section should be $${declaredTotal.toLocaleString('es-CL')}.
        
        There is a DISCREPANCY of $${(declaredTotal - currentSum).toLocaleString('es-CL')}.

        CRITICAL INSTRUCTIONS:
        1. If your sum is HIGHER than the declared total, you likely DUPLICATED items or read a subtotal as a line item. REMOVE the extra items.
        2. Only use negative quantities if they are EXPLICITLY present in the document (e.g., a reversal or credit). DO NOT INVENT them just to force a balance.
        3. Provide the COMPLETE correct list of items for this section.
        4. If the section is very long, output as many items as possible before truncated.
        5. Return ONLY a plain JSON array of objects. No markdown. No text outside the array.

        [
          { "index": 1, "description": "...", "quantity": 1, "unitPrice": 100, "total": 100 },
          ...
        ]
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
            // Remove markdown sugar if present
            const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            return JSON.parse(cleaned);
        } catch (e) {
            console.error("Failed to parse repair JSON with JSON.parse. Attempting regex fallback...", e);
            console.log("[DEBUG] Raw malformed response:", text);

            // Fallback: Robust regex to extract item objects even if truncated or malformed
            const items: any[] = [];
            const itemRegex = /\{[\s\n]*"index"[\s\n]*:[\s\n]*(-?\d+)[\s\S]*?"description"[\s\n]*:[\s\n]*"([\s\S]*?)"[\s\S]*?"quantity"[\s\n]*:[\s\n]*(-?\d*\.?\d+)[\s\S]*?"unitPrice"[\s\n]*:[\s\n]*(-?\d+)[\s\S]*?"total"[\s\n]*:[\s\n]*(-?\d+)[\s\n]*\}?/g;

            let match;
            while ((match = itemRegex.exec(text)) !== null) {
                try {
                    const idx = parseInt(match[1]);
                    const desc = match[2];
                    const qty = parseFloat(match[3]);
                    const uprice = parseInt(match[4]);
                    const tot = parseInt(match[5]);

                    items.push({
                        index: idx,
                        description: desc,
                        quantity: qty,
                        unitPrice: uprice,
                        total: tot
                    });
                } catch (innerError) {
                    // Silently skip corrupted items
                }
            }

            if (items.length > 0) {
                console.log(`[REPAIR SUCCESS] Recovered ${items.length} items via robust regex fallback.`);
                return items;
            }

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
