export const AI_MODELS = {
    primary: 'gemini-1.5-flash-latest',
    fallback: 'gemini-2.0-flash-exp', // Using more stable identifiers
    fallback2: 'gemini-2.5-flash',
    fallback3: 'gemini-3-flash-preview',
    pro: 'gemini-1.5-pro-latest',
    pro_preview: 'gemini-3.1-pro-preview',
    extractor: 'gemini-1.5-flash-latest',
    reasoner: 'gemini-1.5-flash-latest'
};

export const AI_CONFIG = {
    ACTIVE_MODEL: AI_MODELS.primary,
    FALLBACK_MODELS: [
        AI_MODELS.fallback,
        AI_MODELS.fallback2,
        AI_MODELS.fallback3,
        AI_MODELS.pro,
        AI_MODELS.pro_preview
    ],
    MAX_TOKENS: 35000,
    TEMPERATURE: 0.1,
    PRICING: {
        'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
        'gemini-3-flash-preview': { input: 0.1, output: 0.4 },
        'gemini-2.5-flash': { input: 0.1, output: 0.4 },
        'gemini-2.5-pro': { input: 1.25, output: 5.0 },
        'gemini-2.0-flash': { input: 0.1, output: 0.4 },
        'gemini-1.5-pro': { input: 1.25, output: 5.0 },
        'gemini-1.5-flash': { input: 0.075, output: 0.3 } // 1.5 Flash is even cheaper now
    }
};

export const GENERATION_CONFIG = {
    maxOutputTokens: 35000,
    temperature: 0.1,
    topP: 0.95,
    topK: 40
};

export function calculatePrice(promptTokens: number, candidateTokens: number, modelName: string = AI_CONFIG.ACTIVE_MODEL) {
    const pricing = AI_CONFIG.PRICING[modelName as keyof typeof AI_CONFIG.PRICING] || AI_CONFIG.PRICING['gemini-3-flash-preview'];
    const costUSD = (promptTokens / 1_000_000) * pricing.input + (candidateTokens / 1_000_000) * pricing.output;
    const costCLP = costUSD * 1000; // Simplified conversion
    return { costUSD, costCLP };
}
