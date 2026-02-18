import { GeminiService } from './gemini.service.js';
import { TaxonomyResult, RawCuentaItem, GrupoCanonico, SubFamilia } from '../types/taxonomy.types.js';
import crypto from 'crypto';

// --- PROMPT MAESTRO (STRICT VERSION) ---
const TAXONOMY_SYSTEM_PROMPT = `
ERES UN CLASIFICADOR FORENSE STRICT-JSON. TU INPUT SON ÍTEMS CLÍNICOS.
TU OUTPUT ES SU CLASIFICACIÓN EN UNA TAXONOMÍA CANÓNICA.

TAXONOMÍA:
1. GRUPO: HOTELERA, PABELLON, INSUMOS, HONORARIOS.
2. SUB_FAMILIA: FARMACOS, MATERIALES, LABORATORIO, IMAGENOLOGIA, ADMINISTRATIVO, N_A.

ATRIBUTOS (boolean):
- es_cargo_fijo: Cobro por estructura/tiempo, no consumo unitario.
- es_recuperable: Bien físico que el paciente se lleva o consume.
- requiere_respaldo_medico: Necesita receta/orden.
- potencial_inherente_dia_cama: Incluido en día cama (ej. insumos básicos, enfermería).
- potencial_inherente_pabellon: Incluido en derecho pabellón (ej. ropa, aseo).
- potencial_no_clinico: Administrativo/Recargo.
- potencial_parte_de_paquete: Parte de un kit.

OUTPUT FORMAT (STRICT JSON OBJECT):
{
  "results": [
    {
      "id": "string",
      "item_original": "string",
      "grupo": "ENUM",
      "sub_familia": "ENUM",
      "atributos": { ... },
      "confidence": 0.0-1.0
    }
  ]
}
NO MARKDOWN. ONLY JSON.`;

export class TaxonomyPhase1Service {
    private gemini: GeminiService;
    private cache: Map<string, TaxonomyResult>; // In-memory cache for robustness (Production should use Redis)

    constructor(geminiService: GeminiService) {
        this.gemini = geminiService;
        this.cache = new Map();
    }

    // --- UTILS ---
    private normalizeText(text: any): string {
        if (!text || typeof text !== 'string') {
            return "";
        }
        return text.trim().toUpperCase()
            .replace(/\s+/g, ' ') // Collapse spaces
            .replace(/[.,;:]/g, ''); // Remove punctuation broadly
    }

    private generateHash(normalizedText: string): string {
        return crypto.createHash('sha256').update(normalizedText).digest('hex');
    }

    // --- MAIN METHOD ---
    async classifyItems(items: RawCuentaItem[], onProgress?: (msg: string) => void): Promise<TaxonomyResult[]> {
        const results: TaxonomyResult[] = new Array(items.length);
        const itemsToProcessIndices: number[] = [];
        const itemsToProcessPayload: any[] = [];

        // 1. Check Cache
        console.log(`[TaxonomyPhase1] classifyItems called with ${items.length} items.`);
        items.forEach((item, index) => {
            if (!item) {
                console.error(`[TaxonomyPhase1] ❌ Item at index ${index} is UNDEFINED!`);
                return;
            }
            try {
                const norm = this.normalizeText(item.text);
                const hash = this.generateHash(norm);
                // ... rest of log ...
            } catch (err: any) {
                console.error(`[TaxonomyPhase1] ❌ Error processing item at index ${index}:`, item);
                throw err;
            }

            const norm = this.normalizeText(item.text);
            const hash = this.generateHash(norm);

            if (this.cache.has(hash)) {
                const cached = this.cache.get(hash)!;
                // Return cached result but with current ID/SourceRef
                results[index] = {
                    ...cached,
                    id: item.id,
                    sourceRef: item.sourceRef,
                    item_original: item.text, // Ensure original text matches request
                    atributos: {
                        ...cached.atributos,
                        section: item.originalSection
                    }
                };
            } else {
                itemsToProcessIndices.push(index);
                itemsToProcessPayload.push({
                    id: item.id,
                    text: item.text,
                    originalSection: item.originalSection
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

                // Execute batches SEQUENTIALLY to avoid Rate Limits (429) & Congestion on Render
                const successfulBatches: TaxonomyResult[][] = [];
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    try {
                        const msg = `Procesando lote ${i + 1}/${chunks.length} (${chunk.length} ítems)...`;
                        console.log(`[TaxonomyPhase1] ${msg}`);
                        if (onProgress) onProgress(msg);

                        const res = await this.callLlmWithRepair(chunk, 1);
                        console.log(`[TaxonomyPhase1] Batch ${i + 1}/${chunks.length} completed (${res.length} items).`);
                        successfulBatches.push(res);
                    } catch (err: any) {
                        console.error(`[TaxonomyPhase1] Batch ${i + 1}/${chunks.length} FAILED:`, err.message);
                        // Fallback: push empty, will be handled by final safety net
                        successfulBatches.push([]);
                    }
                }
                const batchResults = successfulBatches.flat();

                // 3. Merge Results & Update Cache
                batchResults.forEach((res) => {
                    if (!res || !res.id) return; // Safety check

                    // Find matching index in original array via ID
                    const originalIndex = items.findIndex(i => i.id === res.id);
                    if (originalIndex !== -1) {
                        results[originalIndex] = {
                            ...res,
                            atributos: {
                                ...res.atributos,
                                section: items[originalIndex].originalSection
                            }
                        };

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
            const cleanJson = (responseText || "").replace(/```json/g, '').replace(/```/g, '').trim();

            const parsed = JSON.parse(cleanJson);

            let resultsArray: any[] = [];
            if (Array.isArray(parsed)) {
                resultsArray = parsed;
            } else if (parsed && Array.isArray(parsed.results)) {
                resultsArray = parsed.results;
            } else {
                throw new Error("Invalid structure: missing 'results' array or root array");
            }

            return resultsArray;

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
