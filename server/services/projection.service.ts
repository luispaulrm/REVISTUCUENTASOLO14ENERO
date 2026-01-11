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
                
                ========================================
                🎯 PROTOCOLO KINDERGARTENER PARA TABLAS (OBLIGATORIO)
                ========================================
                
                ANTES de proyectar CUALQUIER tabla, DEBES:
                
                **PASO 1: LEER Y CONTAR ENCABEZADOS**
                - Identifica TODAS las columnas del encabezado de la tabla
                - Cuenta cuántas columnas hay (ej: 6 columnas)
                - Los encabezados pueden estar en MÚLTIPLES FILAS (ej: fila 1 tiene categorías, fila 2 tiene sub-columnas)
                
                **PASO 2: NOMBRAR CADA COLUMNA**
                Escribe mentalmente: "Columna 1: [nombre], Columna 2: [nombre], ..."
                Ejemplo para tabla de prestaciones:
                - Columna 1: PRESTACIONES
                - Columna 2: % Bonificación
                - Columna 3: TOPE BONIFICACIÓN (Nacional)
                - Columna 4: TOPE MÁXIMO Año Contrato
                - Columna 5: TOPE Internacional
                - Columna 6: AMPLIACIÓN COBERTURA
                
                **PASO 3: GENERAR HTML CON ENCABEZADOS EXPLÍCITOS**
                <thead>
                  <tr>
                    <th data-col="1">PRESTACIONES</th>
                    <th data-col="2">% Bonificación</th>
                    <th data-col="3" data-type="nacional">TOPE BONIFICACIÓN</th>
                    <th data-col="4" data-type="anual">TOPE MÁXIMO Año</th>
                    <th data-col="5" data-type="internacional">TOPE Internacional</th>
                    <th data-col="6">AMPLIACIÓN</th>
                  </tr>
                </thead>
                
                **PASO 4: LLENAR CADA FILA CON EXACTAMENTE N CELDAS**
                - Cada <tr> DEBE tener EXACTAMENTE el mismo número de <td> que <th> hay
                - Si una celda está VACÍA, usa: <td data-col="N" data-empty="true">—</td>
                - NUNCA omitas celdas vacías
                - NUNCA fusiones celdas a menos que el PDF original las fusione visualmente
                
                **EJEMPLO CORRECTO:**
                <tr>
                  <td data-col="1">Medicamentos</td>
                  <td data-col="2">100%</td>
                  <td data-col="3" data-type="nacional">SIN TOPE</td>
                  <td data-col="4" data-empty="true">—</td>
                  <td data-col="5" data-type="internacional">300,00 UF</td>
                  <td data-col="6" data-empty="true">—</td>
                </tr>
                
                ========================================
                🏥 PATRONES ESPECÍFICOS DE ISAPRE
                ========================================
                
                **TABLA DE PRESTACIONES (Hospitalarias/Ambulatorias):**
                - Columna "TOPE DE BONIFICACION U.F. o Veces Arancel" = NACIONAL (marcar data-type="nacional")
                - Columna "TOPE MÁXIMO Año Contrato por Beneficiario" = ANUAL
                - Columna "TOPE BONIFICACION Internacional" = INTERNACIONAL (marcar data-type="internacional")
                - Si dice "SIN TOPE" en el área de encabezado, ESO es el valor para la columna Nacional
                
                **TABLA DE FACTORES DE EDAD:**
                Cuando veas una tabla con "GRUPOS DE EDAD" y valores como "1,90", "1,80":
                - Separa CADA valor numérico en su propia celda <td>
                - Ejemplo INCORRECTO: "0 a menos de 2 Años1,901,901,801,80"
                - Ejemplo CORRECTO:
                  <tr>
                    <td>0 a menos de 2 Años</td>
                    <td>1,90</td>
                    <td>1,90</td>
                    <td>1,80</td>
                    <td>1,80</td>
                  </tr>
                
                ========================================
                🚫 REGLA ANTI-MENTIRAS (CRÍTICO)
                ========================================
                
                **NUNCA INVENTES DATOS:**
                - Si NO puedes leer claramente un valor en el PDF, usa: <td data-uncertain="true">???</td>
                - Si una celda está VACÍA en el documento original, usa: <td data-empty="true">—</td>
                - Si NO estás seguro a qué columna pertenece un valor, DETENTE y re-lee los encabezados
                
                **PROHIBIDO:**
                - Copiar un valor de la columna Internacional a la columna Nacional
                - Inventar valores numéricos que no existen en el PDF
                - Asumir que un valor pertenece a una columna sin verificar el encabezado
                
                **SI NO PUEDES SEPARAR COLUMNAS VISUALMENTE:**
                - Usa el orden de izquierda a derecha
                - Cuenta los espacios o líneas verticales del PDF
                - Si es imposible determinar, marca TODA la fila como data-uncertain="true"
                
                ========================================
                
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
