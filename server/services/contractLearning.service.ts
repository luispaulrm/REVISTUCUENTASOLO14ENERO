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

    console.log('[LEARNING] Processing contract to update semantic dictionary...');

    // 1. Learn from Metadata (Tipo Contrato)
    if (result.metadata?.tipo_contrato && result.metadata?.fuente) {
        const canonicalType = result.metadata.tipo_contrato;
        const sourceName = result.metadata.fuente.split('-')[0].trim(); // Isapre name

        if (!dict.synonyms[canonicalType]) dict.synonyms[canonicalType] = [];
        if (!dict.synonyms[canonicalType].includes(sourceName)) {
            dict.synonyms[canonicalType].push(sourceName);
        }
    }

    // 2. Learn from Coberturas (Ambitos)
    // If we have items in observations or rule results that consistently map to an ambito,
    // we could add patterns. For now, let's detect common keyword variations.
    const commonKeywords = ["urgencia", "maternidad", "dental", "extranjero"];
    commonKeywords.forEach(kw => {
        // Simple heuristic: if it's there, ensure it's in a relevant group or pattern
        if (!dict.synonyms[kw]) dict.synonyms[kw] = [kw];
    });

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
