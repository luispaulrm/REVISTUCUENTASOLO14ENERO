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
        let fullHtml = "";
        let isFinalized = false;
        let pass = 0;
        const maxPasses = 5;

        while (!isFinalized && pass < maxPasses) {
            pass++;
            const prompt = pass === 1 ? `
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
                8. TRUNCATION: If the document is too long for one response, STOP before a logical break and I will ask you to continue.
                9. FINAL MARKER: If you have finished projecting the ENTIRE document (all pages, annexes, and clauses), end with "<!-- END_OF_DOCUMENT -->".
                
                OUTPUT:
                A single <div> container containing the HTML projection.
            ` : `
                CONTINUE PROJECTING THE DOCUMENT.
                
                You were projecting the PDF but reached the token limit.
                Last part projected: "${fullHtml.slice(-100)}"
                
                Please CONTINUE the projection exactly where you left off. 
                Maintain the same style and HTML structure. 
                If you finish the entire document, end with "<!-- END_OF_DOCUMENT -->".
            `;

            try {
                const model = this.client.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        maxOutputTokens: 35000,
                        temperature: 0.1,
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
                    fullHtml += chunkText;

                    // Filter out the end marker from the stream
                    const cleanChunk = chunkText.replace("<!-- END_OF_DOCUMENT -->", "");
                    if (cleanChunk) {
                        yield { type: 'chunk', text: cleanChunk };
                    }

                    const usage = chunk.usageMetadata;
                    if (usage) {
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

                if (fullHtml.includes("<!-- END_OF_DOCUMENT -->")) {
                    isFinalized = true;
                } else {
                    console.log(`[ProjectionService] 🔄 Truncated detected in pass ${pass}. Requesting continuation...`);
                    const { calculatePrice } = await import('../config/ai.config.js'); // just to satisfy types if needed
                }

            } catch (err: any) {
                console.error('[ProjectionService] Error:', err);
                yield { type: 'error', error: err.message || 'Error projecting PDF to HTML' };
                break;
            }
        }
    }
}
