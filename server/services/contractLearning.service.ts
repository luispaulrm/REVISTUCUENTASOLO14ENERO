import fs from 'fs';
import path from 'path';

export interface TrainingExample {
    id: string; // fingerprints hash or unique ref
    tags: string[]; // e.g. ["ISAPRE_MASVIDA", "PLAN_PLENO"]
    originalTextSnippet: string; // The confusing OCR text
    correctedJson: any; // The human-verified structure
    reason: string; // "Correction of exclusion logic"
    timestamp: string;
}

export interface SemanticDictionary {
    synonyms: Record<string, string[]>;
    patterns: Array<{
        regex: string;
        category: string;
        description: string;
    }>;
    trainingExamples: TrainingExample[];
    processedContracts: string[];
    lastUpdated: string;
}

const DICTIONARY_PATH = path.resolve('server/data/semantic_dictionary.json');
const TRAINING_PATH = path.resolve('server/data/training/examples.json');

function ensureDir(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Loads the semantic dictionary
 */
export function loadDictionary(): SemanticDictionary {
    ensureDir(DICTIONARY_PATH);
    if (!fs.existsSync(DICTIONARY_PATH)) {
        const initialDict: SemanticDictionary = {
            synonyms: {
                "VAM": ["Veces Arancel", "VA", "AC2"],
                "hospitalario": ["Día Cama", "Quirófano"],
                "ambulatorio": ["Consulta", "Examen"]
            },
            patterns: [],
            trainingExamples: [], // New field
            processedContracts: [],
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(initialDict, null, 2));
        return initialDict;
    }
    const data = JSON.parse(fs.readFileSync(DICTIONARY_PATH, 'utf-8'));
    if (!data.trainingExamples) data.trainingExamples = []; // Migration
    return data;
}

/**
 * Saves a new training example (Human Correction)
 */
export async function saveTrainingExample(
    fingerprint: string,
    tags: string[],
    snippet: string,
    correction: any,
    reason: string
) {
    const dict = loadDictionary();

    // Check if duplicate
    const existingIndex = dict.trainingExamples.findIndex(e => e.id === fingerprint || (e.originalTextSnippet === snippet && e.tags.includes(tags[0])));

    const example: TrainingExample = {
        id: fingerprint || Date.now().toString(),
        tags,
        originalTextSnippet: snippet.substring(0, 1000), // Store first 1000 chars of context
        correctedJson: correction,
        reason,
        timestamp: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        dict.trainingExamples[existingIndex] = example; // Update
    } else {
        dict.trainingExamples.push(example);
    }

    dict.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(dict, null, 2));
    console.log(`[LEARNING] Saved training example: ${reason}`);
    return example;
}

/**
 * Retrieves relevant examples for the prompt
 * Simple RAG: Matches tags (Isapre name) or keywords in the text
 */
export async function retrieveRelevantExamples(text: string, tags: string[] = []): Promise<TrainingExample[]> {
    const dict = loadDictionary();
    const candidates = dict.trainingExamples;

    if (candidates.length === 0) return [];

    // Filter by tags (Isapre)
    // CRITICAL: Must be more selective to avoid injecting "massive" dump examples that don't truly match
    const relevant = candidates.filter(c => {
        // Only match if at least one tag is present in the text and the example tags
        const tagMatch = c.tags.some(t => {
            const isKnownTag = tags.includes(t);
            const isPresentInText = text.toUpperCase().includes(t.toUpperCase());
            return isKnownTag && isPresentInText;
        });

        // Avoid "FULL_CONTRACT_CONTEXT" examples unless explicitly requested or very small
        const isNotMassiveDump = c.originalTextSnippet !== "FULL_CONTRACT_CONTEXT_AUTOMATIC_LEARNING";

        return tagMatch && isNotMassiveDump;
    });

    // Return top 2 recent examples to avoid overflowing context
    return relevant.slice(-2);
}

// ... legacy exports for compatibility ...
export async function learnFromContract(result: any) { return loadDictionary(); }
export async function registerProcessedContract(fingerprint: string) { return 0; }
export function getContractCount() { return 0; }
export function applySynonyms(term: string) { return term; }

/**
 * Resets the processed contracts counter (but keeps training examples).
 */
export function resetLearningMemory(): number {
    const dict = loadDictionary();
    const exampleCount = dict.trainingExamples.length;
    dict.processedContracts = [];
    dict.trainingExamples = []; // CRITICAL: Clear training examples to prevent data mixing
    dict.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(dict, null, 2));
    console.log(`[LEARNING] Memory reset. ${exampleCount} examples cleared.`);
    return 0;
}
