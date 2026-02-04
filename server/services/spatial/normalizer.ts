/**
 * Normalizer: Atom Parsing & Tagging (Deterministic)
 * 
 * This module parses raw text values into structured atoms.
 * It does NOT interpret contractual meaning - only parses patterns.
 * 
 * SPEC: v1.3-AUDIT-GRADE
 */

export interface NormalizedAtom {
    value: number | string | boolean;
    unit: string;
    original_text: string;
    parse_confidence: number;
}

export interface NormalizerResult {
    atoms: NormalizedAtom[];
    warnings: string[];
}

const PATTERNS = {
    UF: /^(\d+(?:[.,]\d+)?)\s*(UF)$/i,
    VAM: /^(\d+(?:[.,]\d+)?)\s*(VAM)$/i,
    VA: /^(\d+(?:[.,]\d+)?)\s*(V\.?A\.?)$/i,
    AC2: /^(\d+(?:[.,]\d+)?)\s*(AC2)$/i,
    PERCENT: /^(\d+(?:[.,]\d+)?)\s*%$/,
    SIN_TOPE: /^sin\s*tope$/i,
    EXCLUSION: /^solo\s+cobertura\s+libre\s+elecci[óo]n$/i,
};

function parseNumber(str: string): number {
    return parseFloat(str.replace(',', '.'));
}

export function normalizeAtom(rawText: string): NormalizerResult {
    const atoms: NormalizedAtom[] = [];
    const warnings: string[] = [];
    const text = rawText.trim();

    if (PATTERNS.SIN_TOPE.test(text)) {
        atoms.push({ value: 'SIN_TOPE', unit: 'NONE', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    if (PATTERNS.EXCLUSION.test(text)) {
        atoms.push({ value: false, unit: 'EXCLUSION', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    const ufMatch = PATTERNS.UF.exec(text);
    if (ufMatch) {
        atoms.push({ value: parseNumber(ufMatch[1]), unit: 'UF', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    const vamMatch = PATTERNS.VAM.exec(text);
    if (vamMatch) {
        atoms.push({ value: parseNumber(vamMatch[1]), unit: 'VAM', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    const vaMatch = PATTERNS.VA.exec(text);
    if (vaMatch) {
        atoms.push({ value: parseNumber(vaMatch[1]), unit: 'V.A.', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    const ac2Match = PATTERNS.AC2.exec(text);
    if (ac2Match) {
        atoms.push({ value: parseNumber(ac2Match[1]), unit: 'AC2', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    const pctMatch = PATTERNS.PERCENT.exec(text);
    if (pctMatch) {
        atoms.push({ value: parseNumber(pctMatch[1]), unit: '%', original_text: text, parse_confidence: 1.0 });
        return { atoms, warnings };
    }

    warnings.push(`Unable to parse: "${text}"`);
    atoms.push({ value: text, unit: 'UNKNOWN', original_text: text, parse_confidence: 0.0 });
    return { atoms, warnings };
}

export function normalizeAll(rawTexts: string[]): { atoms: NormalizedAtom[]; warnings: string[]; } {
    const allAtoms: NormalizedAtom[] = [];
    const allWarnings: string[] = [];
    for (const text of rawTexts) {
        const result = normalizeAtom(text);
        allAtoms.push(...result.atoms);
        allWarnings.push(...result.warnings);
    }
    return { atoms: allAtoms, warnings: allWarnings };
}

export default { normalizeAtom, normalizeAll };
