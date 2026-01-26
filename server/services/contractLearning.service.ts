import fs from 'fs';
import path from 'path';

export interface SemanticDictionary {
    synonyms: Record<string, string[]>; // e.g. { "VAM": ["Veces Arancel", "VA", "AC2"], "hospitalario": ["Día Cama", "Quirófano"] }
    patterns: Array<{
        regex: string;
        category: string;
        description: string;
    }>;
    lastUpdated: string;
}

const DICTIONARY_PATH = path.resolve('server/data/semantic_dictionary.json');

/**
 * Ensures the data directory exists
 */
function ensureDir() {
    const dir = path.dirname(DICTIONARY_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Loads the semantic dictionary from disk
 */
export function loadDictionary(): SemanticDictionary {
    ensureDir();
    if (!fs.existsSync(DICTIONARY_PATH)) {
        const initial: SemanticDictionary = {
            synonyms: {
                "VAM": ["Veces Arancel", "VA", "AC2", "V20"],
                "hospitalario": ["Día Cama", "Estadía Diaria", "Intensivo"],
                "ambulatorio": ["Consulta", "Exámenes", "Laboratorio"]
            },
            patterns: [],
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DICTIONARY_PATH, 'utf-8'));
}

/**
 * Updates the dictionary with new knowledge extracted from a contract
 */
export async function learnFromContract(result: any) {
    const dict = loadDictionary();

    // Learning Logic (v1.0): 
    // 1. If we see a new Isapre name, add it to source patterns
    // 2. If we see items in 'items_no_clasificados', we might want to flag them for future patterns
    // 3. Extract common terms from high-fidelity result

    console.log('[LEARNING] Processing contract to update semantic dictionary...');

    // Update timestamp
    dict.lastUpdated = new Date().toISOString();

    fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(dict, null, 2));
    return dict;
}

/**
 * Applies synonyms to a term using the dictionary
 */
export function applySynonyms(term: string): string {
    const dict = loadDictionary();
    const cleanTerm = term.toLowerCase().trim();

    for (const [canonical, variants] of Object.entries(dict.synonyms)) {
        if (variants.some(v => cleanTerm.includes(v.toLowerCase()))) {
            return canonical;
        }
    }
    return term;
}
