import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from '../config/ai.config.js';

export interface ProjectionChunk {
    type: 'chunk' | 'usage' | 'error';
    text?: string;
    usage?: {
        promptTokens: number;
        candidatesTokens: number;
        totalTokens: number;
        estimatedCost: number;
        estimatedCostCLP: number;
    };
    error?: string;
}

export class ProjectionService {
    private client: GoogleGenerativeAI;
    private keys: string[];

    constructor(apiKeyOrKeys: string | string[]) {
        this.keys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];
        this.client = new GoogleGenerativeAI(this.keys[0]);
    }

    async *projectPdfToHtml(
        image: string,
        mimeType: string,
        modelName: string = AI_CONFIG.ACTIVE_MODEL
    ): AsyncIterable<ProjectionChunk> {
        const prompt = `
            ACT AS A HIGH-FIDELITY DOCUMENT PROJECTOR.
            
            GOAL:
            Convert the provided PDF document into a CLEAN, SEMANTIC, and VISUALLY ACCURATE HTML representation.
            
            INSTRUCTIONS:
            1. PROJECTION TYPE: High-fidelity reconstruction.
            2. FORMATTING: Use semantic HTML5 (table, h1, h2, p, span, div).
            3. STYLING (CRITICAL): 
               - Use INLINE CSS style attributes to replicate the layout.
               - Preserve font weights, relative sizes, and positions.
               - Maintain the structure of tables exactly as seen in the PDF.
            4. ACCURACY: Do not interpret, summarize, or extract. PROJECT exactly what is visible.
            5. VERBATIM: Copy all text exactly as it appears.
            6. NO MARKDOWN: Output strictly RAW HTML inside a <div> container. Do not use code blocks.
            7. FULL DOCUMENT: Process every page and item.
            
            OUTPUT:
            A single <div> container containing the complete HTML projection.
        `;

        try {
            const model = this.client.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    maxOutputTokens: 35000,
                    temperature: 0.1, // Low temperature for high fidelity
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

            for await (const chunk of resultStream.stream) {
                const chunkText = chunk.text();
                yield { type: 'chunk', text: chunkText };

                const usage = chunk.usageMetadata;
                if (usage) {
                    // Import calculatePrice dynamically to avoid circular dependency if needed, 
                    // or just use the static utility from GeminiService if we refactor.
                    // For now, let's assume we can import it.
                    const { calculatePrice } = await import('../config/ai.config.js');
                    const { costUSD, costCLP } = calculatePrice(usage.promptTokenCount, usage.candidatesTokenCount);

                    yield {
                        type: 'usage',
                        usage: {
                            promptTokens: usage.promptTokenCount,
                            candidatesTokens: usage.candidatesTokenCount,
                            totalTokens: usage.totalTokenCount,
                            estimatedCost: costUSD,
                            estimatedCostCLP: costCLP
                        }
                    };
                }
            }
        } catch (err: any) {
            console.error('[ProjectionService] Error:', err);
            yield { type: 'error', error: err.message || 'Error projecting PDF to HTML' };
        }
    }
}
