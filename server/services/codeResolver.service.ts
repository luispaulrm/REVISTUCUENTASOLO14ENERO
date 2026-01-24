import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARANCEL_PATH = path.join(__dirname, '../knowledge/Libro Arancel MLE 2025 FONASA.txt');

interface ArancelEntry {
    code: string;
    description: string;
    fullLine: string;
}

let indexedArancel: ArancelEntry[] = [];

async function ensureIndexed() {
    if (indexedArancel.length > 0) return;
    try {
        const content = await fs.readFile(ARANCEL_PATH, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
            // Match pattern like "11 03 057"
            const codeMatch = line.match(/(\d{2}\s\d{2}\s\d{3})/);
            if (codeMatch) {
                const spacedCode = codeMatch[0];
                const cleanCode = spacedCode.replace(/\s/g, '');

                const parts = line.split(spacedCode);
                if (parts.length < 2) continue;

                const remaining = parts[1].trim();
                const amountMatch = remaining.match(/\d{1,3}\.\d{3}/);
                let description = remaining;
                if (amountMatch && amountMatch.index !== undefined) {
                    description = remaining.substring(0, amountMatch.index).trim();
                }
                description = description.replace(/^\d+/, '').trim();

                indexedArancel.push({
                    code: cleanCode,
                    description,
                    fullLine: line.trim()
                });
            }
        }
    } catch (error) {
        console.error('[CodeResolver] Indexing error:', error);
    }
}

/**
 * Deterministic Fonasa Code Resolver
 */
export async function resolveFonasaCode(code: string): Promise<ArancelEntry | null> {
    await ensureIndexed();
    const cleanCode = code.replace(/[^0-9]/g, '');
    return indexedArancel.find(e => e.code === cleanCode) || null;
}

/**
 * Normalize string: Uppercase and remove accents
 */
function normalize(str: string): string {
    return str.toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

/**
 * Resolve by description (fuzzy)
 */
export async function resolveByDescription(text: string): Promise<ArancelEntry | null> {
    await ensureIndexed();
    const query = normalize(text);
    if (!query || query.length < 3) return null;

    // 1. Exact match (normalized)
    let bestMatch = indexedArancel.find(e => normalize(e.description) === query);
    if (bestMatch) return bestMatch;

    // 2. Substring match (query in description)
    bestMatch = indexedArancel.find(e => normalize(e.description).includes(query));
    if (bestMatch) return bestMatch;

    // 3. Reverse substring (description in query)
    bestMatch = indexedArancel.find(e => {
        const normDesc = normalize(e.description);
        return normDesc.length > 5 && query.includes(normDesc);
    });
    if (bestMatch) return bestMatch;

    // 4. Token match (if 70% of query tokens exist in description)
    const queryTokens = query.split(/\s+/).filter(t => t.length > 3);
    if (queryTokens.length > 0) {
        bestMatch = indexedArancel.find(e => {
            const normDesc = normalize(e.description);
            const matches = queryTokens.filter(t => normDesc.includes(t)).length;
            return matches / queryTokens.length >= 0.7;
        });
        if (bestMatch) return bestMatch;
    }

    return null;
}
