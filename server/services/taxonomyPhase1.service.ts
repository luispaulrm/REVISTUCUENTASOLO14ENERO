import { GeminiService } from './gemini.service.js';
import { TaxonomyResult, RawCuentaItem, GrupoCanonico, SubFamilia } from '../types/taxonomy.types.js';
import crypto from 'crypto';

// --- PROMPT MAESTRO (STRICT VERSION) ---
const TAXONOMY_SYSTEM_PROMPT = `
ERES UN ANALISTA FORENSE DE CUENTAS CLÍNICAS (MÓDULO DE TAXONOMÍA).
TU ÚNICA MISIÓN ES CLASIFICAR ÍTEMS CLÍNICOS EN UNA ESTRUCTURA CANÓNICA ESTRICTA.
NO DEBES EMITIR JUICIOS DE VALOR NI AUDITORÍA. SOLO RESPONDE "QUÉ ES".

PARA CADA ÍTEM, ASIGNA:
1. GRUPO (Enum: HOTELERA, PABELLON, INSUMOS, HONORARIOS)
   - HOTELERA: Días cama, alimentación, servicios básicos, hostelería.
   - PABELLON: Derecho de pabellón, tiempo de quirófano, recuperación.
   - INSUMOS: Todo material, fármaco, insumo, dispositivo médico.
   - HONORARIOS: Pagos a personas (cirujanos, equipos médicos, visitas).

2. SUB_FAMILIA (Enum: FARMACOS, MATERIALES, LABORATORIO, IMAGENOLOGIA, ADMINISTRATIVO, N_A)
   - FARMACOS: Medicamentos, drogas, soluciones.
   - MATERIALES: Jeringas, guantes, suturas, catéteres.
   - LABORATORIO: Exámenes de sangre, cultivos.
   - IMAGENOLOGIA: Rayos, TAC, Resonancia.
   - ADMINISTRATIVO: Cargos administrativos, recargos.
   - N_A: Si no aplica (ej: Días cama es N_A).

3. ATRIBUTOS (Booleanos. SIEMPRE true/false):
   - es_cargo_fijo: Se cobra por estructura, no por consumo unitario variable?
   - es_recuperable: ¿El ítem es un bien físico que el paciente se lleva o consume totalmente?
   - requiere_respaldo_medico: ¿Necesita receta u orden médica explícita?
   - potencial_inherente_dia_cama: (Flag) ¿Es algo que típicamente está incluido en el valor del día cama? (Ej: Jeringa básica, Tórula, Guante, Toma de signos vitales, Enfermería).
   - potencial_inherente_pabellon: (Flag) ¿Es algo incluido en el derecho de pabellón? (Ej: Sutura básica, Ropa estéril, Aseo quirófano).
   - potencial_no_clinico: (Flag) ¿Es un cargo administrativo o no sanitario?
   - potencial_parte_de_paquete: (Flag) ¿Parece ser parte de un kit o paquete?

OUTPUT FORMAT:
DEBES RESPONDER EXCLUSIVAMENTE UN JSON VÁLIDO.
UN ARRAY DE OBJETOS "TaxonomyResult".
EL ORDEN DE SALIDA DEBE SER EXACTAMENTE EL MISMO QUE EL DE ENTRADA.
LA CANTIDAD DE ITEMS DEBE SER LA MISMA.

SCHEMA RESULTADO (TypeScript):
{
  "results": [
    {
      "id": "string (mismo que input)",
      "item_original": "string",
      "grupo": "HOTELERA" | "PABELLON" | "INSUMOS" | "HONORARIOS",
      "sub_familia": "FARMACOS" | "MATERIALES" | "LABORATORIO" | "IMAGENOLOGIA" | "ADMINISTRATIVO" | "N_A",
      "atributos": {
          "es_cargo_fijo": boolean,
          "es_recuperable": boolean,
          "requiere_respaldo_medico": boolean,
          "potencial_inherente_dia_cama": boolean,
          "potencial_inherente_pabellon": boolean,
          "potencial_no_clinico": boolean,
          "potencial_parte_de_paquete": boolean
      },
      "confidence": number (0.1 a 1.0),
      "rationale_short": "string (max 10 words)"
    }
  ]
}

NO INVENTES CAMPOS. NO AGREGUES MARKDOWN (\`\`\`json). SOLO EL JSON PURO.
SI TIENES DUDAS, CLASIFICA LO MEJOR POSIBLE Y BAJA EL CONFIDENCE.
`;

export class TaxonomyPhase1Service {
    private gemini: GeminiService;
    private cache: Map<string, TaxonomyResult>; // In-memory cache for robustness (Production should use Redis)

    constructor(geminiService: GeminiService) {
        this.gemini = geminiService;
        this.cache = new Map();
    }

    // --- UTILS ---
    private normalizeText(text: string): string {
        return text.trim().toUpperCase()
            .replace(/\s+/g, ' ') // Collapse spaces
            .replace(/[.,;:]/g, ''); // Remove punctuation broadly
    }

    private generateHash(normalizedText: string): string {
        return crypto.createHash('sha256').update(normalizedText).digest('hex');
    }

    // --- MAIN METHOD ---
    async classifyItems(items: RawCuentaItem[]): Promise<TaxonomyResult[]> {
        const results: TaxonomyResult[] = new Array(items.length);
        const itemsToProcessIndices: number[] = [];
        const itemsToProcessPayload: any[] = [];

        // 1. Check Cache
        items.forEach((item, index) => {
            const norm = this.normalizeText(item.text);
            const hash = this.generateHash(norm);

            if (this.cache.has(hash)) {
                const cached = this.cache.get(hash)!;
                // Return cached result but with current ID/SourceRef
                results[index] = {
                    ...cached,
                    id: item.id,
                    sourceRef: item.sourceRef,
                    item_original: item.text // Ensure original text matches request
                };
            } else {
                itemsToProcessIndices.push(index);
                itemsToProcessPayload.push({
                    id: item.id,
                    text: item.text
                });
            }
        });

        // 2. Process Batch (if any)
        if (itemsToProcessIndices.length > 0) {
            console.log(`[TaxonomyPhase1] Processing ${itemsToProcessIndices.length} items (Cache Hit Rate: ${((items.length - itemsToProcessIndices.length) / items.length * 100).toFixed(1)}%)`);

            try {
                // CHUNK STRATEGY: 25 items per batch to avoid Token Limits & Latency timeouts
                const CHUNK_SIZE = 25;
                const chunks: any[][] = [];
                for (let i = 0; i < itemsToProcessPayload.length; i += CHUNK_SIZE) {
                    chunks.push(itemsToProcessPayload.slice(i, i + CHUNK_SIZE));
                }

                console.log(`[TaxonomyPhase1] Split into ${chunks.length} batches.`);

                // Execute batches in parallel
                const batchPromises = chunks.map((chunk, bIdx) =>
                    this.callLlmWithRepair(chunk, 1)
                        .then(res => {
                            console.log(`[TaxonomyPhase1] Batch ${bIdx + 1}/${chunks.length} completed (${res.length} items).`);
                            return res;
                        })
                        .catch(err => {
                            console.error(`[TaxonomyPhase1] Batch ${bIdx + 1}/${chunks.length} FAILED:`, err.message);
                            return [] as TaxonomyResult[]; // Return empty to allow other batches to succeed
                        })
                );

                const successfulBatches = await Promise.all(batchPromises);
                const batchResults = successfulBatches.flat();

                // 3. Merge Results & Update Cache
                batchResults.forEach((res) => {
                    if (!res || !res.id) return; // Safety check

                    // Find matching index in original array via ID
                    const originalIndex = items.findIndex(i => i.id === res.id);
                    if (originalIndex !== -1) {
                        results[originalIndex] = res;

                        // Update Cache
                        if (res.item_original) {
                            const norm = this.normalizeText(res.item_original);
                            const hash = this.generateHash(norm);
                            this.cache.set(hash, res);
                        }
                    }
                });

            } catch (error) {
                console.error("[TaxonomyPhase1] CRITICAL BATCH FAILURE", error);
                // Fallback for failed batch items stays in place via step 4
            }
        }

        // 4. Final Safety Net (Fill any holes)
        for (let i = 0; i < results.length; i++) {
            if (!results[i]) {
                results[i] = this.getFallbackResult(items[i]);
            }
        }

        return results;
    }

    private async callLlmWithRepair(items: any[], attempt = 1): Promise<TaxonomyResult[]> {
        const prompt = `${TAXONOMY_SYSTEM_PROMPT}\n\nITEMS TO CLASSIFY:\n${JSON.stringify(items, null, 2)}`;

        try {
            console.log(`[TaxonomyPhase1] Calling Gemini (Attempt ${attempt})...`);
            const responseText = await this.gemini.extractText(prompt, { temperature: 0.1 });

            // Clean Markdown wrapper if present
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

            const parsed = JSON.parse(cleanJson);

            if (!parsed.results || !Array.isArray(parsed.results)) {
                throw new Error("Invalid structure: missing 'results' array");
            }

            return parsed.results;

        } catch (e: any) {
            if (attempt < 3) {
                console.warn(`[TaxonomyPhase1] JSON Parse Error (Attempt ${attempt}): ${e.message}. Retrying...`);
                // Retry strategy could vary, here strict 3 attempts
                return this.callLlmWithRepair(items, attempt + 1);
            }
            throw e; // Fail after max attempts
        }
    }

    private getFallbackResult(item: RawCuentaItem): TaxonomyResult {
        return {
            id: item.id,
            item_original: item.text,
            grupo: 'INSUMOS', // Safe default
            sub_familia: 'N_A',
            atributos: {
                es_cargo_fijo: false,
                es_recuperable: false,
                requiere_respaldo_medico: false,
                potencial_inherente_dia_cama: false,
                potencial_inherente_pabellon: false,
                potencial_no_clinico: false,
                potencial_parte_de_paquete: false
            },
            confidence: 0.0,
            rationale_short: "FALLBACK_ERROR",
            sourceRef: item.sourceRef
        };
    }
}
