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
    private keys: string[];
    private activeKeyIndex: number = 0;
    private client: GoogleGenerativeAI;

    constructor(apiKeyOrKeys: string | string[]) {
        // Normalize input to array
        const initialKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];

        // Auto-discover environmental keys if single key passed matches env
        const envKeys = [];
        // Helper to safely get env in both Node and potentially other runtimes (though this is server-side)
        const getEnv = (k: string) => typeof process !== 'undefined' && process.env ? process.env[k] : undefined;

        if (getEnv("GEMINI_API_KEY")) envKeys.push(getEnv("GEMINI_API_KEY")!);
        if (getEnv("API_KEY")) envKeys.push(getEnv("API_KEY")!);
        if (getEnv("GEMINI_API_KEY_SECONDARY")) envKeys.push(getEnv("GEMINI_API_KEY_SECONDARY")!);

        // Combine and unique
        this.keys = [...new Set([...initialKeys, ...envKeys])].filter(k => !!k && k.length > 5);

        if (this.keys.length === 0) {
            console.error("❌ GeminiService started with NO VALID KEYS");
            this.client = new GoogleGenerativeAI("DUMMY_KEY");
        } else {
            // Initialize with first available key
            this.client = new GoogleGenerativeAI(this.keys[0]);
        }
    }

    private getClientForCurrentKey(): GoogleGenerativeAI {
        const key = this.keys[this.activeKeyIndex];
        return new GoogleGenerativeAI(key);
    }

    private rotateKey(): boolean {
        if (this.activeKeyIndex >= this.keys.length - 1) return false; // No more keys
        this.activeKeyIndex++;
        const newKey = this.keys[this.activeKeyIndex];
        const mask = newKey.substring(0, 4) + '...';
        console.log(`[GeminiService] 🔄 Switching to Backup Key: ${mask} (Index ${this.activeKeyIndex})`);
        this.client = new GoogleGenerativeAI(newKey);
        return true;
    }

    async extract(
        image: string,
        mimeType: string,
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
            temperature?: number;
            topP?: number;
            topK?: number;
        } = {}
    ): Promise<string> {
        let lastError: any;
        const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL];

        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            console.log(`[GeminiService] 🛡️ Strategy: Attempting non-streaming extraction with model ${modelName}`);

            // Start with primary key, then rotate if needed
            this.activeKeyIndex = 0;

            for (let keyIdx = 0; keyIdx < this.keys.length; keyIdx++) {
                const currentKey = this.keys[keyIdx];
                const mask = currentKey ? (currentKey.substring(0, 4) + '...') : '???';

                try {
                    this.client = new GoogleGenerativeAI(currentKey);
                    const model = this.client.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: config.maxTokens || 35000,
                            responseMimeType: config.responseMimeType,
                            responseSchema: config.responseSchema,
                            temperature: config.temperature,
                            topP: config.topP,
                            topK: config.topK
                        }
                    });

                    const result = await model.generateContent([
                        { text: prompt },
                        ...(image && mimeType ? [{
                            inlineData: {
                                data: image,
                                mimeType: mimeType
                            }
                        }] : [])
                    ]);

                    const text = result.response.text();
                    console.log(`[GeminiService] ✅ Success (Non-Stream) with Key ${mask} on ${modelName}`);
                    return text;

                } catch (err: any) {
                    lastError = err;
                    const errStr = (err?.toString() || "") + (err?.message || "");
                    const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || err?.status === 429 || err?.status === 503;

                    if (isQuota) {
                        console.warn(`[GeminiService] ⚠️ Quota error on Key ${mask}. Trying next key...`);
                        continue;
                    } else {
                        console.error(`[GeminiService] ❌ Non-retriable error on Key ${mask}:`, err.message);
                        // Try next key just in case, or break?
                        // For robustness, try next.
                    }
                }
            }
        }
        throw lastError || new Error("All API keys and models failed for extraction.");
    }

    async extractText(
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
            temperature?: number;
        } = {}
    ): Promise<string> {
        let lastError: any;
        const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL];
        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            for (const key of this.keys) {
                try {
                    const genAI = new GoogleGenerativeAI(key);
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: config.maxTokens,
                            responseMimeType: config.responseMimeType,
                            responseSchema: config.responseSchema,
                            temperature: config.temperature ?? 0.1
                        }
                    });
                    const result = await model.generateContent(prompt);
                    return result.response.text();
                } catch (err: any) {
                    lastError = err;
                }
            }
        }
        throw lastError || new Error("All keys failed for text extraction.");
    }

    async extractWithStream(
        image: string,
        mimeType: string,
        prompt: string,
        config: {
            maxTokens?: number;
            responseMimeType?: string;
            responseSchema?: any;
            temperature?: number;
            topP?: number;
            topK?: number;
        } = {}
    ): Promise<AsyncIterable<StreamChunk>> {
        let lastError: any;

        // Reset key index for new request? No, keep using the working one or start fresh?
        // Ideally we start fresh or stick to what works. Let's try current active, then rotate.
        // Actually for a new major request, maybe we should try all from start if we want to Load Balance?
        // For simplicity: Try current active. If fail, rotate forward. 
        // If we hit end, wrap around? No, end means failure.
        // If we assumed keys are Primary, Secondary... we should try Primary first?
        // Let's implement a loop: Try up to keys.length times.

        const startIdx = 0; // Always start from primary? Or stay on backup?
        // Staying on backup is safer if primary is permanently suspended.
        // Starting on primary is better if it's intermittent quota.
        // Let's start from 0 to preserve backup quota.
        this.activeKeyIndex = 0;

        const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL];

        // Loop through Models (Primary -> Fallback)
        for (const modelName of modelsToTry) {
            if (!modelName) continue;
            console.log(`[GeminiService] 🛡️ Strategy: Attempting with model ${modelName}`);

            // Loop through Keys (Primary -> Secondary -> etc)
            for (let keyIdx = 0; keyIdx < this.keys.length; keyIdx++) {
                const currentKey = this.keys[keyIdx];
                const mask = currentKey ? (currentKey.substring(0, 4) + '...') : '???';

                try {
                    // Update client with current key
                    this.client = new GoogleGenerativeAI(currentKey);

                    const model = this.client.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            maxOutputTokens: config.maxTokens || 35000,
                            responseMimeType: config.responseMimeType,
                            responseSchema: config.responseSchema,
                            temperature: config.temperature,
                            topP: config.topP,
                            topK: config.topK
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

                    console.log(`[GeminiService] ✅ Success with Key ${mask} on ${modelName}`);
                    return this.processStream(resultStream);

                } catch (err: any) {
                    lastError = err;
                    const errStr = (err?.toString() || "") + (err?.message || "");
                    const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || err?.status === 429 || err?.status === 503;

                    if (isQuota) {
                        console.warn(`[GeminiService] ⚠️ Quota/Service Error on Key ${mask} (${modelName}). Trying next key...`);
                        continue;
                    } else {
                        // Non-quota error (param error, bad image, etc). Do not retry blindly?
                        console.error(`[GeminiService] ❌ Non-retriable error on Key ${mask} (${modelName}):`, err.message);
                        // If it's a model-specific error (Active model unsupported?), we SHOULD try fallback model.
                        // But if it's "Invalid Argument", fallback likely won't help unless arguments differ.
                        // For safety, we continue to next Key/Model ONLY if it helps.
                        // Determining if it helps is hard. Let's assume strict retry only on Quota/Server Errors.
                        // If user wants robustness, maybe we retry everything? No, "Invalid Image" wont be fixed.
                    }
                }
            }
            console.warn(`[GeminiService] ⚠️ All keys failed for model ${modelName}. Switching to fallback if available...`);
        }

        throw lastError || new Error("All API keys failed for stream extraction.");
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
     * IMPLEMENTS MULTI-PASS REPAIR IF TRUNCATED.
     */
    async repairSection(
        image: string,
        mimeType: string,
        sectionName: string,
        declaredTotal: number,
        currentSum: number,
        pages?: number[]
    ): Promise<any[]> {
        let allItems: any[] = [];
        let lastItemDescription = "";
        let isTruncated = true;
        let attempts = 0;
        const maxAttempts = 3;

        while (isTruncated && attempts < maxAttempts) {
            attempts++;
            const pageFocus = pages && pages.length > 0 ? `FOCUS ON PAGES: ${pages.join(', ')}.` : '';
            const prompt = `
            ACT AS A CLINICAL BILL AUDIT SPECIALIST.
            
            ISSUE:
            In the section "${sectionName}", you previously extracted items that sum up to $${currentSum.toLocaleString('es-CL')}.
            However, the document states that the TOTAL for this section should be $${declaredTotal.toLocaleString('es-CL')}.
            
            ${pageFocus}
            ${attempts > 1 ? `PARTIAL PROGRESS: You already extracted ${allItems.length} items. The last one was "${lastItemDescription}". PLEASE CONTINUE listing the remaining items from there.` : ''}
            CRITICAL INSTRUCTIONS:
            - EXHAUSTIVENESS IS #1: List EVERY item. If the clinician's total is wrong, WE DON'T CARE. We want the full 100% list of products verbatim.
            - DO NOT GROUP ITEMS. If the paper lists it 5 times, you extract it 5 times.
            - FORMAT: index | description | quantity | unitPrice | total
            - IMPORTANT: Some lines are CREDIT/REVERSALS. They have a minus sign (-) or are in parentheses ( ). You MUST extract them as negative (ej: -1, -3006).
            - IVA DETECTION: If unitPrice * quantity doesn't match total, it might be due to 19% tax (IVA). Just extract values as they are.
            - ANTI-FUSION: If a price looks like millions (ej: 2.470500501), it is fused with a code. Clean it to match the total (ej: 2.470).
            - MATH CHECK: sum(items.total) SHOULD equal $${declaredTotal.toLocaleString('es-CL')}, BUT IF THE DOCUMENT IS WRONG, PRIORITIZE LISTING ALL ITEMS.
            - ABSOLUTELY NO decimals in Prices/Totals. INTEGERS ONLY.
            - Return ONLY a CSV-style list using "|" as separator. No markdown.
            - TRUNCATION SAFETY: If the list is too long, end with "CONTINUE|PENDING".
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
            console.log(`[REPAIR] Pass ${attempts} Raw Response (Preview):`, text.substring(0, 200) + "...");

            const lines = text.split('\n').map(l => l.trim()).filter(l => l && l.includes('|'));
            let passTruncated = false;

            for (const line of lines) {
                // Skip header if present
                if (line.toLowerCase().includes('description|quantity')) continue;
                // Skip markdown table separators like |--|--|
                if (line.includes('---')) continue;

                if (line.toUpperCase().includes('CONTINUE|PENDING')) {
                    passTruncated = true;
                    continue;
                }

                const parts = line.split('|').map(p => p.trim()).filter(p => p !== "");
                if (parts.length >= 4) {
                    try {
                        const idx = parseInt(parts[0]);

                        // Standard parser for quantities and prices in repair CSV
                        const parseVal = (v: string): number => {
                            if (!v) return 0;
                            let c = v.trim();

                            // Handle negative parentheses
                            if (c.startsWith('(') && c.endsWith(')')) {
                                c = '-' + c.substring(1, c.length - 1);
                            }

                            c = c.replace(/[^\d.,-]/g, '');
                            if (c.includes(',')) return parseFloat(c.replace(/\./g, '').replace(/,/g, '.')) || 0;
                            const d = (c.match(/\./g) || []).length;
                            if (d === 1) {
                                const p = c.split('.');
                                if (p[1].length !== 3 || (p[1] === "000" && p[0].length <= 2)) return parseFloat(c) || 0;
                                return parseFloat(c.replace(/\./g, '')) || 0;
                            } else if (d > 1) {
                                return parseFloat(c.replace(/\./g, '')) || 0;
                            }
                            return parseFloat(c) || 0;
                        };

                        // ROBUST PARSING: The last 3 columns are always Qty|Price|Total
                        // This makes it immune to IA injecting "Code" or "Date" at the beginning.
                        const lastThree = parts.slice(-3);
                        const qty = parseVal(lastThree[0]);
                        const uprice = parseVal(lastThree[1]);
                        const total = parseVal(lastThree[2]);

                        // Description is everything between the index (parts[0]) and the last three
                        const desc = parts.slice(1, -3).join(' ').trim();

                        if (!isNaN(total)) {
                            allItems.push({
                                index: isNaN(idx) ? allItems.length + 1 : idx,
                                description: desc,
                                quantity: isNaN(qty) ? 1 : qty,
                                unitPrice: uprice || (qty !== 0 ? Math.round(Math.abs(total / qty)) : 0),
                                total: total
                            });
                            lastItemDescription = desc;
                        }
                    } catch (err) { }
                }
            }

            isTruncated = passTruncated;
            if (!isTruncated) break;
            console.log(`[REPAIR] Section "${sectionName}" truncated. Total items so far: ${allItems.length}. Requesting next part...`);
        }

        if (allItems.length > 0) {
            console.log(`[REPAIR SUCCESS] Parsed total of ${allItems.length} items for "${sectionName}" after ${attempts} pass(es).`);
            return allItems;
        }

        return allItems;
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
