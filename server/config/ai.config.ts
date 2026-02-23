export const AI_MODELS = {
    primary: 'gemini-3.1-pro-preview',
    fallback: 'gemini-3-flash-preview',
    fallback2: 'gemini-2.5-flash',
    fallback3: 'gemini-1.5-pro',
    fallback4: 'gemini-1.5-flash',
    extractor: 'gemini-3.1-pro-preview',
    reasoner: 'gemini-3.1-pro-preview'
};

export const AI_CONFIG = {
    ACTIVE_MODEL: AI_MODELS.primary,
    FALLBACK_MODEL: AI_MODELS.fallback,
    MAX_TOKENS: 35000,
    TEMPERATURE: 0.1,
    PRICING: {
        'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
        'gemini-3-flash-preview': { input: 0.1, output: 0.4 },
        'gemini-2.5-flash': { input: 0.1, output: 0.4 },
        'gemini-2.5-pro': { input: 1.25, output: 5.0 },
        'gemini-1.5-pro': { input: 1.25, output: 5.0 },
        'gemini-1.5-flash': { input: 0.1, output: 0.4 },
        'gemini-2.0-flash': { input: 0.1, output: 0.4 }
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
