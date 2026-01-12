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
        modelName: string = AI_CONFIG.ACTIVE_MODEL,
        mode: 'FULL' | 'BILL_ONLY' = 'FULL',
        pageCount: number = 0
    ): AsyncIterable<ProjectionChunk> {
        let fullHtml = "";
        let isFinalized = false;
        let pass = 0;
        const maxPasses = 30; // Aumentado de 10 a 30 para documentos largos

        while (!isFinalized && pass < maxPasses) {
            pass++;
            yield { type: 'log', text: `[IA] 🚀 Iniciando Pase ${pass}/${maxPasses}...` };

            const isBillOnly = mode === 'BILL_ONLY';
            const prompt = pass === 1 ? `
                ACT AS A HIGH-FIDELITY DOCUMENT PROJECTOR.
                
                GOAL:
                Convert the PROVIDED PDF document into a CLEAN, SEMANTIC, and VISUALLY ACCURATE HTML representation.
                TOTAL PAGES IN DOCUMENT: ${pageCount || 'Unknown'}
                ${isBillOnly ? 'TARGET: You must ONLY project the "CUENTA HOSPITALARIA" (the bill/account breakdown). IGNORE medical records, clinical logs, or consent forms.' : 'YOU MUST PROCESS EVERY SINGLE PAGE. DO NOT SKIP ANY CONTENT.'}
                
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
                
                **PASO 3: MAPEO DE ATRIBUTOS DATA Y COLUMNAS CRÍTICAS**
                - Para cada encabezado th, usa data-col="N" (siendo N el número de columna).
                - Identifica el tipo de columna: data-type="nacional", "anual", "internacional", etc.
                - **CRÍTICO:** BUSCA ACTIVAMENTE columnas con encabezados: "Bonif", "Copago", "Reembolso", "Valor Isa", "Aporte".
                - ESTAS COLUMNAS SON OBLIGATORIAS. SI ESTÁN VISIBLES, DEBEN APARECER EN EL HTML FINAL EN SU FILA CORRESPONDIENTE.
                
                **PASO 4: DISTINCIÓN ABSOLUTA (EL FILTRO)**
                - Antes de escribir una fila de datos, confirma que NO estás repitiendo palabras del encabezado.
                - Si una celda está vacía, usa <td data-col="N" data-empty="true">—</td>.
                - NUNCA omitas columnas. Si hay un espacio en blanco entre dos valores, es una columna vacía.
                
                **PASO 5: REGLA ANTI-HALLUCINACIÓN (ANTI-MENTIRAS)**
                - Si un valor es ilegible, usa <td data-uncertain="true">???</td>.
                - Prohibido inventar datos o mover valores entre columnas (ej: no mover Internacional a Nacional).

                **PASO 6: COBERTURA TOTAL (SIN OMISIONES)**
                ${isBillOnly ? '- Locate the billing section and project it page by page.' : '- Este es un proceso serial. Debes proyectar página por página.'}
                - Si el documento es largo, proyecta lo que alcances y continúa en el siguiente pase.
                
                ${isBillOnly ? `
                **PASO 7: FILTRO DE CONTENIDO (BILL ONLY)**
                - Search for "Detalle de Cuenta", "Gastos Clínicos", "Insumos", "Medicamentos" or similar billing detailed tables.
                - IMPORTANT: Billing sections often span MULTIPLE PAGES. You MUST check every page of the document.
                - If you find medical records (evolución, epicrisis, clinical logs, etc.), SKIP THEM, but continue searching the following pages for more billing data.
                - ONLY stop and use the FINAL MARKER if you are 100% sure there are no more billing items or totals in the REMAINING pages.
                ` : ''}

                INSTRUCTIONS (STRICT):
                1. PROJECTION TYPE: Full, high-fidelity reconstruction.
                2. FORMATTING: Use semantic HTML5 (table, h1, h2, p, span, div).
                3. STYLING: Use INLINE CSS style attributes to replicate layout and fonts.
                4. ACCURACY: PROJECT exactly what is visible. Copy text VERBATIM.
                5. FINAL MARKER: ONLY use "<!-- END_OF_DOCUMENT -->" at the absolute end ${isBillOnly ? 'after verifying NO more billing data exists in ANY subsequent pages' : 'of the document'}.
                
                OUTPUT:
                A single <div> container containing the HTML projection.
            ` : `
                CONTINUE PROJECTING THE DOCUMENT.
                
                YOU MUST CONTINUE FROM THE EXACT POINT WHERE YOU LEFT OFF.
                DO NOT REPEAT CONTENT AND DO NOT JUMP TO THE END.
                
                ${isBillOnly ? 'REMINDER: Only project the billing section. Keep skipping non-billing pages if they appear.' : ''}

                Last characters projected: "${fullHtml.slice(-1500)}"
                
                MANDATORY RULES:
                1. CONTINUE exactly where you left off. 
                2. SEAMLESS TRANSITION: If you were in a table, start with the NEXT row tr. 
                3. NO GAPS: Do not skip content, pages, or use placeholders like "[...]".
                4. NO REPETITION: Do not repeat what you already projected.
                5. FINAL MARKER: End with "<!-- END_OF_DOCUMENT -->" ONLY if there is NO MORE billing data in the ENTIRE PDF (check all subsequent pages before marking as end).
            `;

            let streamSuccess = false;
            let retryCount = 0;
            const maxRetries = 3;
            // Strategy: Active Model -> Fallback Model
            const modelsToTry = [modelName, AI_CONFIG.FALLBACK_MODEL].filter(m => !!m);
            // Deduplicate models just in case
            const uniqueModels = [...new Set(modelsToTry)];

            for (const currentModel of uniqueModels) {
                if (streamSuccess) break;

                // Retry loop for the current model
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const model = this.client.getGenerativeModel({
                            model: currentModel,
                            generationConfig: {
                                maxOutputTokens: 80000,
                                temperature: 0.1,
                            }
                        });

                        if (attempt > 1 || currentModel !== modelName) {
                            yield { type: 'log', text: `[IA] ⚠️ Reintento/Fallback: Usando ${currentModel} (Intento ${attempt})...` };
                        }

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

                        // LAZY DETECTION: Catch various common ways LLMs try to skip content
                        const lazyPhrases = [
                            "[Documento continúa",
                            "[Continúa",
                            "[Document continues",
                            "Continúa con Notas",
                            "Continúa con Tablas",
                            "... [",
                            "--- FIN PARCIAL ---",
                            "(Resto del documento omitido)",
                            "(Se omite el resto",
                            "The rest of the document is a table",
                            "Following the same format",
                        ];
                        const isLazy = lazyPhrases.some(phrase => currentPassOutput.includes(phrase));

                        if (currentPassOutput.includes("<!-- END_OF_DOCUMENT -->") && !isLazy) {
                            isFinalized = true;
                            yield { type: 'log', text: `[IA] ✅ Marcador de finalización detectado en el pase ${pass}.` };
                        } else {
                            const logMsg = isLazy ?
                                `[IA] ⚠️ Pereza detectada en el pase ${pass}. Forzando continuación...` :
                                `[IA] 🔄 Truncamiento o fin de pase en ${pass}. Solicitando continuación...`;
                            console.log(`[ProjectionService] ${logMsg}`);
                            yield { type: 'log', text: logMsg };
                        }

                        streamSuccess = true;
                        break; // Break retry loop

                    } catch (err: any) {
                        console.error(`[ProjectionService] Error on ${currentModel} (Attempt ${attempt}):`, err);

                        // If it's the last attempt of the last model, throw or yield error
                        const isLastModel = currentModel === uniqueModels[uniqueModels.length - 1];
                        const isLastAttempt = attempt === maxRetries;

                        if (isLastModel && isLastAttempt) {
                            yield { type: 'error', error: err.message || 'Error projecting PDF to HTML' };
                            // We break the outer loop by setting pass = maxPasses to stop everything?
                            // Or just break inner loops and let the outer while condition handle it?
                            // Since we yielded error, we should probably stop.
                            // But the original code just broke the loop.
                            streamSuccess = false; // Ensure it stays false
                        } else {
                            // Wait a bit before retry
                            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                        }
                    }
                }
            }

            if (!streamSuccess) {
                break; // Stop passes if we couldn't generate content
            }
        }
    }
}
