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
 * Normalize string: Uppercase, remove accents, and clean multiple spaces
 */
function normalize(str: string): string {
    return str.toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Resolve by description (fuzzy)
 */
export async function resolveByDescription(text: string): Promise<ArancelEntry | null> {
    await ensureIndexed();

    if (!text) return null;

    // 0. PRIORITY: If the text contains a 7-digit code, try resolving it directly
    const codeInText = text.match(/(\d{2}\s?\d{2}\s?\d{3})|(\d{7})/);
    if (codeInText) {
        const found = await resolveFonasaCode(codeInText[0]);
        if (found) return found;
    }

    // Clean query: Remove common prefixes and suffixes
    let query = text.toUpperCase();

    // Remove "GLOSA:", "COD.", "TITULO:", "DESC:", etc.
    query = query.replace(/GLOSA:|COD\.|TITULO:|DESC:|DETALLE:/gi, '');

    // Split by common delimiters and take the core clinical part
    query = query.split('...')[0].split('(')[0].split('-')[0].trim();

    // Remove multiple spaces and normalize
    query = normalize(query);

    // Strip leading/trailing numeric codes (e.g., "1103057 RIZOTOMIA" -> "RIZOTOMIA")
    query = query.replace(/^\d{6,8}\b|\b\d{6,8}$/g, '').trim();

    // Final check for minimum length after all cleaning
    if (!query || query.length < 3) return null;

    // 1. Exact match (normalized)
    let bestMatch = indexedArancel.find(e => normalize(e.description) === query);
    if (bestMatch) return bestMatch;

    // 2. Substring match (query in description OR description in query)
    bestMatch = indexedArancel.find(e => {
        const normDesc = normalize(e.description);
        return normDesc.includes(query) || (normDesc.length > 5 && query.includes(normDesc));
    });
    if (bestMatch) return bestMatch;

    // 3. Token match (Smarter: prioritized by core terms)
    const queryTokens = query.split(/\s+/).filter(t => t.length > 3);
    if (queryTokens.length > 0) {
        // Find entries sharing most tokens
        const scored = indexedArancel.map(e => {
            const normDesc = normalize(e.description);
            const matches = queryTokens.filter(t => normDesc.includes(t)).length;
            return { entry: e, score: matches / queryTokens.length };
        }).filter(s => s.score >= 0.6) // Lower threshold to 60%
            .sort((a, b) => b.score - a.score);

        if (scored.length > 0) return scored[0].entry;
    }

    return null;
}
