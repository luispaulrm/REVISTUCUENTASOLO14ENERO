export const AI_MODELS = {
    primary: 'gemini-2.5-flash', // Temporarily using 2.5 (quota for 3 exhausted)
    fallback: 'gemini-3-flash-preview'
};

export const GENERATION_CONFIG = {
    temperature: 0,
    topP: 0.1,
    topK: 1,
    maxOutputTokens: 64000,
};

export const AI_CONFIG = {
    // SINGLE SOURCE OF TRUTH FOR THE AI MODEL
    ACTIVE_MODEL: AI_MODELS.primary,
    FALLBACK_MODEL: AI_MODELS.fallback,

    // PRICING (USD per 1 Million Tokens)
    PRICING: {
        'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
        'gemini-2.5-flash': { input: 0.10, output: 0.40 },
        'gemini-2.0-flash-exp': { input: 0.20, output: 0.60 },
        'gemini-1.5-flash': { input: 0.075, output: 0.30 },
        'gemini-1.5-pro': { input: 3.50, output: 10.50 }
    },

    // UI LABEL
    MODEL_LABEL: 'Gemini 3 Flash (Preview)'
};

export function getActivePricing() {
    return AI_CONFIG.PRICING[AI_CONFIG.ACTIVE_MODEL] || AI_CONFIG.PRICING['gemini-3-flash-preview'];
}

export function calculatePrice(inputTokens: number, outputTokens: number) {
    const p = getActivePricing();
    // console.log(`[AI_CONFIG] Price Calc - Model: ${AI_CONFIG.ACTIVE_MODEL}, Input: ${inputTokens}, Output: ${outputTokens}, Pricing:`, p);

    if (!p) {
        console.error('[AI_CONFIG] ❌ ERROR: Pricing not found for model', AI_CONFIG.ACTIVE_MODEL);
        return { costUSD: 0, costCLP: 0 };
    }

    const costUSD = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
    // console.log(`[AI_CONFIG] Cost Result: $${costUSD} USD`);

    return {
        costUSD,
        costCLP: Math.ceil(costUSD * 980) // Approx Exchange Rate
    };
}
