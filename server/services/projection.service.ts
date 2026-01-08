import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from '../config/ai.config.js';

export interface ProjectionChunk {
    type: 'chunk' | 'usage' | 'error' | 'log';
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
        const maxPasses = 10;

        while (!isFinalized && pass < maxPasses) {
            pass++;
            yield { type: 'log', text: `[IA] 🚀 Iniciando Pase ${pass}/${maxPasses}...` };

            const prompt = pass === 1 ? `
                ACT AS A HIGH-FIDELITY DOCUMENT PROJECTOR.
                
                GOAL:
                Convert the provided PDF document into a CLEAN, SEMANTIC, and VISUALLY ACCURATE HTML representation.
                
                INSTRUCTIONS (STRICT):
                1. PROJECTION TYPE: Full, high-fidelity reconstruction.
                2. FORMATTING: Use semantic HTML5 (table, h1, h2, p, span, div).
                3. STYLING: Use INLINE CSS style attributes to replicate layout, fonts, and table structures exactly.
                4. ACCURACY: PROJECT exactly what is visible. Copy text VERBATIM.
                5. NO PLACEHOLDERS: NEVER use placeholders like "[Document continues...]", "... [snip] ...", or similar. You MUST project EVERY line, clause, and item.
                6. TOKEN MANAGEMENT: If the document is too long, STOP at a logical point (e.g., after a complete </table> row, or a paragraph </p>) and WAIT for the continuation signal. Do NOT summarize or skip content.
                7. FINAL MARKER: ONLY use "<!-- END_OF_DOCUMENT -->" if you have reached the ABSOLUTE END of the file (including annexes, signatures, and fine print).
                
                OUTPUT:
                A single <div> container containing the HTML projection.
            ` : `
                CONTINUE PROJECTING THE DOCUMENT.
                
                You were projecting the PDF but reached your output limit. 
                Last 1000 characters projected: "${fullHtml.slice(-1000)}"
                
                MANDATORY RULES:
                1. CONTINUE exactly where you left off. 
                2. SEAMLESS TRANSITION: If you were in the middle of a table, start with the NEXT row <tr>. If you were in a paragraph, continue the text.
                3. NO GAPS: Do not skip content or use placeholders like "[...]".
                4. NO REPETITION: Do not repeat what you already projected.
                5. COMPLETENESS: You MUST project everything until the final page.
                6. FINAL MARKER: End with "<!-- END_OF_DOCUMENT -->" ONLY if there is NO MORE text in the PDF.
            `;

            try {
                const model = this.client.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        maxOutputTokens: 80000,
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

                let currentPassOutput = "";
                for await (const chunk of resultStream.stream) {
                    const chunkText = chunk.text();
                    currentPassOutput += chunkText;
                    fullHtml += chunkText;

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

                // LAZY DETECTION: If the AI claims it's done but uses a placeholder phrase, it's NOT done.
                const lazyPhrases = [
                    "[Documento continúa",
                    "[Continúa",
                    "[Document continues",
                    "Continúa con Notas",
                    "Continúa con Tablas",
                    "... [",
                ];
                const isLazy = lazyPhrases.some(phrase => currentPassOutput.includes(phrase));

                if (currentPassOutput.includes("<!-- END_OF_DOCUMENT -->") && !isLazy) {
                    isFinalized = true;
                    yield { type: 'log', text: `[IA] ✅ Marcador de finalización detectado en el pase ${pass}.` };
                } else {
                    const logMsg = isLazy ?
                        `[IA] ⚠️ Pereza detectada en el pase ${pass}. Forzando continuación...` :
                        `[IA] 🔄 Truncamiento detectado en el pase ${pass}. Solicitando continuación...`;
                    console.log(`[ProjectionService] ${logMsg}`);
                    yield { type: 'log', text: logMsg };
                }

            } catch (err: any) {
                console.error('[ProjectionService] Error:', err);
                yield { type: 'error', error: err.message || 'Error projecting PDF to HTML' };
                break;
            }
        }
    }
}
