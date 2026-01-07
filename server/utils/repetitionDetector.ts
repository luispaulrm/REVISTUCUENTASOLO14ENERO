/**
 * Repetition Detector
 * 
 * Detects when AI models enter repetition loops (hallucination).
 * Uses sliding window algorithm to find repeated phrases.
 */

export interface RepetitionResult {
    hasRepetition: boolean;
    repeatedPhrase: string | null;
    count: number;
}

const MIN_PHRASE_LENGTH = 10; // Minimum words in a phrase
const REPETITION_THRESHOLD = 5; // Number of times a phrase must repeat to be flagged

/**
 * Detects if text contains repeated phrases indicating an AI loop
 */
export function detectRepetition(text: string): RepetitionResult {
    if (!text || text.length < 100) {
        return { hasRepetition: false, repeatedPhrase: null, count: 0 };
    }

    // Split into words
    const words = text.split(/\s+/).filter(w => w.length > 0);

    if (words.length < MIN_PHRASE_LENGTH * 2) {
        return { hasRepetition: false, repeatedPhrase: null, count: 0 };
    }

    // Track phrase frequencies
    const phraseMap = new Map<string, number>();
    let maxCount = 0;
    let maxPhrase: string | null = null;

    // Sliding window to extract phrases
    for (let i = 0; i <= words.length - MIN_PHRASE_LENGTH; i++) {
        const phrase = words.slice(i, i + MIN_PHRASE_LENGTH).join(' ');
        const normalized = phrase.toLowerCase().trim();

        // Skip if too short after normalization
        if (normalized.length < 20) continue;

        const currentCount = (phraseMap.get(normalized) || 0) + 1;
        phraseMap.set(normalized, currentCount);

        if (currentCount > maxCount) {
            maxCount = currentCount;
            maxPhrase = phrase;
        }
    }

    const hasRepetition = maxCount >= REPETITION_THRESHOLD;

    return {
        hasRepetition,
        repeatedPhrase: hasRepetition ? maxPhrase : null,
        count: maxCount
    };
}

/**
 * Truncates text at the first detected repetition
 */
export function truncateAtRepetition(text: string): string {
    const result = detectRepetition(text);

    if (!result.hasRepetition || !result.repeatedPhrase) {
        return text;
    }

    // Find first occurrence of the repeated phrase
    const firstIndex = text.indexOf(result.repeatedPhrase);
    if (firstIndex === -1) return text;

    // Find second occurrence (start of repetition)
    const secondIndex = text.indexOf(result.repeatedPhrase, firstIndex + result.repeatedPhrase.length);
    if (secondIndex === -1) return text;

    // Truncate before the second occurrence
    return text.substring(0, secondIndex).trim();
}
