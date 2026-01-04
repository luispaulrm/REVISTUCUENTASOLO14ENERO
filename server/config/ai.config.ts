export const AI_CONFIG = {
    // SINGLE SOURCE OF TRUTH FOR THE AI MODEL
    ACTIVE_MODEL: 'gemini-3-flash-preview',
    FALLBACK_MODEL: 'gemini-2.5-flash',

    // PRICING (USD per 1 Million Tokens) - Updated for Flash 3
    PRICING: {
        'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
        'gemini-2.5-flash': { input: 0.10, output: 0.40 }, // Estimated Lower Cost
        'gemini-3-pro-preview': { input: 2.00, output: 12.00 } // Keep for reference
    },

    // UI LABEL
    MODEL_LABEL: 'Gemini 3 Flash (w/ 2.5 Fallback)'
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
