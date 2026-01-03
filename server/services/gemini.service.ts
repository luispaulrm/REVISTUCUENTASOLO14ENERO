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
                maxOutputTokens: config.maxTokens || 35000,
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
     * Uses CSV format for token efficiency and preventing truncation.
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
        3. Use GROSS values (Valor Bruto/Valor Isa) for unitPrice and total.
        4. ENSURE MATHEMATICAL CONSISTENCY: quantity * unitPrice MUST EQUAL total. Avoid high precision decimals; keep results simple.
        5. VERBATIM EXTRACTION: Do not skip items. Do not summarize. List EVERY single item belonging to this section across ALL pages.
        6. RE-COUNT VERIFICATION: Before outputting the CSV, count the number of items you see. Ensure your CSV has that exact number of rows.
        7. If the section is very long, output as many items as possible until you reach your output token limit.
        8. Return ONLY a CSV-style list using "|" as separator. No markdown. No text outside the data.
        
        CSV FORMAT:
        index|description|quantity|unitPrice|total
        1|GLUCOSA 5% 500ML|2|1500|3000
        ...
        `;

        const model = this.client.getGenerativeModel({
            model: AI_CONFIG.ACTIVE_MODEL,
            generationConfig: {
                maxOutputTokens: 35000
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
        console.log("[REPAIR] Raw Response (CSV/Text Preview):", text.substring(0, 300) + "...");

        const items: any[] = [];
        const lines = text.split('\n').map(l => l.trim()).filter(l => l && l.includes('|'));

        for (const line of lines) {
            // Skip header if present
            if (line.toLowerCase().includes('description|quantity')) continue;
            // Skip markdown table separators like |--|--|
            if (line.includes('---')) continue;

            const parts = line.split('|').map(p => p.trim()).filter(p => p !== "");
            if (parts.length >= 4) {
                try {
                    const idx = parseInt(parts[0]);
                    const desc = parts[1];

                    // Standard parser for quantities and prices in repair CSV
                    const parseVal = (v: string): number => {
                        let c = v.trim().replace(/[^\d.,-]/g, '');
                        if (c.includes(',')) return parseFloat(c.replace(/\./g, '').replace(/,/g, '.')) || 0;
                        const d = (c.match(/\./g) || []).length;
                        const p = c.split('.');
                        if (d === 1 && p[1].length !== 3) return parseFloat(c) || 0;
                        return parseFloat(c.replace(/\./g, '')) || 0;
                    };

                    const qty = parseVal(parts[2]);

                    let uprice = 0;
                    let total = 0;

                    if (parts.length >= 5) {
                        uprice = Math.round(parseVal(parts[3]));
                        total = Math.round(parseVal(parts[4]));
                    } else {
                        total = Math.round(parseVal(parts[3]));
                    }

                    if (!isNaN(total)) {
                        items.push({
                            index: isNaN(idx) ? items.length + 1 : idx,
                            description: desc,
                            quantity: isNaN(qty) ? 1 : qty,
                            unitPrice: uprice || (qty !== 0 ? Math.round(Math.abs(total / qty)) : 0),
                            total: total
                        });
                    }
                } catch (err) { }
            }
        }

        if (items.length > 0) {
            console.log(`[REPAIR SUCCESS] Parsed ${items.length} items from CSV response.`);
            return items;
        }

        // Final Fallback: Try regex on original text just in case it sent JSON anyway
        const itemRegex = /\{[\s\n]*"index"[\s\n]*:[\s\n]*(-?\d+)[\s\S]*?"description"[\s\n]*:[\s\n]*"([\s\S]*?)"[\s\S]*?"quantity"[\s\n]*:[\s\n]*(-?\d*\.?\d+)[\s\S]*?"unitPrice"[\s\n]*:[\s\n]*(-?\d+)[\s\S]*?"total"[\s\n]*:[\s\n]*(-?\d+)[\s\n]*\}?/g;
        let match;
        while ((match = itemRegex.exec(text)) !== null) {
            try {
                items.push({
                    index: parseInt(match[1]),
                    description: match[2],
                    quantity: parseFloat(match[3]),
                    unitPrice: parseInt(match[4]),
                    total: parseInt(match[5])
                });
            } catch (e) { }
        }

        return items;
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
