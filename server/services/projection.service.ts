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
                
                ========================================
                🎯 PROTOCOLO KINDERGARTENER PARA TABLAS (OBLIGATORIO)
                ========================================
                
                **PASO 1: ANÁLISIS DE FRONTERA (ENCABEZADO vs CUERPO)**
                - Identifica visualmente dónde termina el encabezado y comienzan los datos.
                - NUNCA mezcles texto del encabezado dentro de las filas de datos.
                - Si el encabezado tiene varias filas de alto, agrúpalas todas en el elemento thead.
                
                **PASO 2: CONTEO RIGUROSO DE COLUMNAS**
                - Cuenta cuántas columnas tiene la tabla en su parte más ancha.
                - Cada fila tr DEBE tener exactamente ese número de celdas td.
                
                **PASO 3: MAREO DE ATRIBUTOS DATA**
                - Para cada encabezado th, usa data-col="N" (siendo N el número de columna).
                - Identifica el tipo de columna: data-type="nacional", "anual", "internacional", etc.
                
                **PASO 4: DISTINCIÓN ABSOLUTA (EL FILTRO)**
                - Antes de escribir una fila de datos, confirma que NO estás repitiendo palabras del encabezado.
                - Si una celda está vacía, usa <td data-col="N" data-empty="true">—</td>.
                - NUNCA omitas columnas. Si hay un espacio en blanco entre dos valores, es una columna vacía.
                
                **PASO 5: REGLA ANTI-HALLUCINACIÓN (ANTI-MENTIRAS)**
                - Si un valor es ilegible, usa <td data-uncertain="true">???</td>.
                - Prohibido inventar datos o mover valores entre columnas (ej: no mover Internacional a Nacional).
                
                INSTRUCTIONS (STRICT):
                1. PROJECTION TYPE: Full, high-fidelity reconstruction.
                2. FORMATTING: Use semantic HTML5 (table, h1, h2, p, span, div).
                3. STYLING: Use INLINE CSS style attributes to replicate layout and fonts.
                4. ACCURACY: PROJECT exactly what is visible. Copy text VERBATIM.
                5. FINAL MARKER: ONLY use "<!-- END_OF_DOCUMENT -->" at the absolute end.
                
                OUTPUT:
                A single <div> container containing the HTML projection.
            ` : `
                CONTINUE PROJECTING THE DOCUMENT.
                
                Last 1000 characters projected: "${fullHtml.slice(-1000)}"
                
                MANDATORY RULES:
                1. CONTINUE exactly where you left off. 
                2. SEAMLESS TRANSITION: If you were in a table, start with the NEXT row tr. 
                3. NO GAPS: Do not skip content or use placeholders like "[...]".
                4. NO REPETITION: Do not repeat what you already projected.
                5. FINAL MARKER: End with "<!-- END_OF_DOCUMENT -->" ONLY if there is NO MORE text.
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
