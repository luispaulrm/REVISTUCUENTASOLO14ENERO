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

        // Progress Safety Valves
        let lastFullHtmlLength = 0;
        let stagnatedPasses = 0;
        const MAX_STAGNATED_PASSES = 3;

        while (!isFinalized && pass < maxPasses) {
            pass++;
            yield { type: 'log', text: `[IA] 🚀 Iniciando Pase ${pass}/${maxPasses}...` };

            const isBillOnly = mode === 'BILL_ONLY';
            const prompt = pass === 1 ? `
                ACT AS A HIGH-FIDELITY DOCUMENT PROJECTOR (OCR CALCO MODE).
                
                GOAL:
                Create an EXACT VISUAL REPLICA (CARBON COPY) of the provided contract/document in HTML.
                
                CRITICAL INSTRUCTION:
                - YOU ARE A "DUMB" OCR CLONER. YOU DO NOT THINK. YOU DO NOT DECIDE. YOU DO NOT SUMMARIZE.
                - YOUR ONLY JOB IS TO COPY PIXEL-PERFECT CONTENT INTO HTML.
                - IF CAEC/GES IS NOT MENTIONED, DO NOT INVENT IT.
                - IF A VALUE IS "SIN TOPE", WRITE "SIN TOPE". DO NOT CHANGE IT TO NUMBERS.
                - IF A VALUE IS BLANK, WRITE BLANK.
                - DO NOT "HELP" BY FILLING IN GAPS.

                ⚠️ CASTIGOS Y PENALIZACIONES (LEE ESTO PRIMERO) ⚠️
                
                SI RESUMES, OMITES, O PARAFRASEAS CUALQUIER CONTENIDO:
                - FALLA LA PROYECCIÓN INMEDIATAMENTE
                - EL USUARIO IDENTIFICARÁ TU OUTPUT COMO INVÁLIDO
                - TU TRABAJO SE MARCA COMO "NO CONFIABLE"
                
                EJEMPLOS ABSOLUTAMENTE PROHIBIDOS:
                ❌ "... (resto de la tabla similar)" 
                ❌ "[Continúa la lista de prestaciones]"
                ❌ "Las siguientes filas siguen el mismo formato"
                ❌ "(Ver cláusulas 5-10 en el documento original)"
                ❌ Any placeholder, ellipsis or reference like "(se omiten filas por brevedad)"
                
                REGLA NUCLEAR: Si el documento tiene 100 filas en una tabla, 
                tu HTML DEBE tener 100 filas. NO NEGOCIABLE.

                ========================================
                🎯 PROTOCOLO "COLUMNAS PERFECTAS" (ANY CONTRACT)
                ========================================
                
                **PASO 1: ANÁLISIS DE ESTRUCTURA GLOBAL**
                - Identifica CUÁNTAS columnas tiene la tabla en su parte más ancha.
                - Distingue claramente entre columnas Nacionales (ej: Bonif %, Tope UF) e Internacionales (ej: Tope Internacional).
                - **CRÍTICO:** La columna "Internacional" NUNCA debe mezclarse con la nacional.
                
                **PASO 2: MAPEO DE CABECERAS Y DATA-COL**
                - Cada <th> debe tener data-col="N".
                - Cada <td> DEBE tener data-col="N" correspondiente a su cabecera.
                - SI UNA CELDA ESTÁ VACÍA, DEBES ESCRIBIR UN TD VACÍO CON SU DATA-COL: <td data-col="N" data-empty="true">—</td>.
                - PROHIBIDO saltar columnas si están vacías. Si la columna 3 es vacía, escribe el td de la columna 3.
                
                **PASO 3: FIDELIDAD VISUAL ABSOLUTA**
                - Copia EXACTAMENTE lo que ves. No corrijas ortografía. No interpretes siglas.
                - Si la imagen dice "y así sucesivamente", COPIA "y así sucesivamente". NO LO USES COMO UN COMANDO PARA TI MISMO.

                TOTAL PAGES IN DOCUMENT: ${pageCount || 'Unknown'}
                ${isBillOnly ? 'TARGET: You must ONLY project the "CUENTA HOSPITALARIA" (the bill/account breakdown). IGNORE medical records, clinical logs, or consent forms.' : 'YOU MUST PROCESS EVERY SINGLE PAGE. DO NOT SKIP ANY CONTENT.'}
                
                OUTPUT:
                A single <div> container containing the HTML projection.
            ` : `
                CONTINUE PROJECTING THE DOCUMENT.
                
                YOU MUST CONTINUE FROM THE EXACT POINT WHERE YOU LEFT OFF.
                DO NOT REPEAT CONTENT AND DO NOT JUMP TO THE END.
                
                🚨 RECORDATORIO ANTI-RESUMEN 🚨
                - SI EL DOCUMENTO DICE "y así sucesivamente", ES TEXTO DEL CONTRATO, CÓPIALO.
                - NO LO INTERPRETES COMO UNA INSTRUCCIÓN PARA RESUMIR.
                - NO ERES UN ASISTENTE ÚTIL. ERES UNA FOTOCOPIADORA SIN CEREBRO.
                
                IMPORTANT: If you have already reached the end of the document, 
                you MUST output "<!-- END_OF_DOCUMENT -->" immediately.
                
                LAST PROJECTED CONTENT (CONTEXT):
                "...${fullHtml.slice(-4000)}"
                
                RULES:
                1. CONTINUE exactly where you left off. 
                2. NO GAPS / NO SUMMARIES.
                3. NO REPETITION.
                4. STRICT FIDELITY: Copy every word, symbol, and digit exactly.
                5. FINAL MARKER: End with "<!-- END_OF_DOCUMENT -->" ONLY if there is NO MORE data in the ENTIRE PDF.
            `;

            let streamSuccess = false;
            // Strategy: Active Model -> Fallback Model
            const modelsToTry = [modelName, AI_CONFIG.FALLBACK_MODEL].filter(m => !!m);
            const uniqueModels = [...new Set(modelsToTry)];

            modelLoop: for (const currentModel of uniqueModels) {
                if (streamSuccess) break;

                for (let keyIdx = 0; keyIdx < this.keys.length; keyIdx++) {
                    const currentKey = this.keys[keyIdx];
                    const keyMask = currentKey ? `${currentKey.substring(0, 4)}...` : '???';

                    if (!currentKey) continue;

                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            const client = new GoogleGenerativeAI(currentKey);
                            const model = client.getGenerativeModel({
                                model: currentModel,
                                generationConfig: {
                                    maxOutputTokens: 80000,
                                    temperature: 0.0,
                                    topP: 0.8,
                                    topK: 20,
                                }
                            });

                            if (attempt > 1 || keyIdx > 0 || currentModel !== modelName) {
                                yield { type: 'log', text: `[IA] 🛡️ Estrategia: Modelo ${currentModel} | Key ${keyIdx + 1}/${this.keys.length} (${keyMask}) | Intento ${attempt}/3` };
                            }

                            const streamPromise = model.generateContentStream([
                                { text: prompt },
                                {
                                    inlineData: {
                                        data: image,
                                        mimeType: mimeType
                                    }
                                }
                            ]);

                            const timeoutPromise = new Promise((_, reject) =>
                                setTimeout(() => reject(new Error("TimeLimitExceeded: API request timed out after 45s")), 45000)
                            );

                            const resultStream = await Promise.race([streamPromise, timeoutPromise]) as any;

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

                            // --- QUALITY & TERMINATION DETECTION ---

                            // 1. LAZY METADATA (Common meta-descriptions models use when summarizing)
                            const metaLazyPhrases = [
                                "[Documento continúa",
                                "[Continúa",
                                "[Document continues",
                                "--- FIN PARCIAL ---",
                                "(Resto del documento omitido)",
                                "The rest of the document",
                                "(omitido por brevedad)",
                                "(se omiten",
                                "tabla continúa",
                                "la tabla sigue",
                                "pattern repeats",
                                "format continues",
                            ];

                            // Check for laziness ONLY if the output is suspiciously short given how documents are usually structured
                            // If the output is > 2000 chars, it's probably legitimate text even if it contains "resto de" etc.
                            const isSuspiciouslyShort = currentPassOutput.length < 500;
                            const triggeredMeta = metaLazyPhrases.find(phrase => currentPassOutput.includes(phrase));

                            const isLazy = isSuspiciouslyShort && triggeredMeta;

                            // 2. STAGNATION DETECTION (Safety Valve)
                            const addedLength = fullHtml.length - lastFullHtmlLength;
                            if (addedLength < 20) {
                                stagnatedPasses++;
                                console.warn(`[PROJECTION] Stagnation detected. Added length: ${addedLength}. Stagnated passes: ${stagnatedPasses}`);
                            } else {
                                stagnatedPasses = 0;
                            }
                            lastFullHtmlLength = fullHtml.length;

                            if (currentPassOutput.includes("<!-- END_OF_DOCUMENT -->") && !isLazy) {
                                isFinalized = true;
                                yield { type: 'log', text: `[IA] ✅ Marcador de finalización detectado en el pase ${pass}.` };
                            } else if (stagnatedPasses >= MAX_STAGNATED_PASSES) {
                                isFinalized = true;
                                yield { type: 'log', text: `[IA] 🏁 Finalización forzada por estancamiento (no se añade contenido nuevo).` };
                            } else {
                                const logMsg = isLazy ?
                                    `[IA] 🚨 PEREZA DETECTADA EN PASE ${pass}. GATILLADA POR: "${triggeredMeta}". FORZANDO RE-GENERACIÓN...` :
                                    `[IA] 🔄 Truncamiento o fin de pase en ${pass}. Solicitando continuación...`;
                                yield { type: 'log', text: logMsg };
                            }

                            streamSuccess = true;
                            break modelLoop;

                        } catch (err: any) {
                            console.error(`[ProjectionService] Error:`, err);
                            const errorMsg = err.message || err.toString();
                            const isQuota = errorMsg.includes('429') || errorMsg.includes('Quota') || errorMsg.includes('TimeLimitExceeded');

                            if (isQuota) {
                                yield { type: 'log', text: `[IA] ⚠️ Problema de Cuota/Timeout. Rotando Key...` };
                                break;
                            }

                            if (currentModel === uniqueModels[uniqueModels.length - 1] && keyIdx === this.keys.length - 1 && attempt === 3) {
                                yield { type: 'error', error: err.message || 'Error projecting PDF to HTML' };
                                streamSuccess = false;
                            } else {
                                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                            }
                        }
                    }
                }
            }

            if (!streamSuccess) break;
        }
    }
}
