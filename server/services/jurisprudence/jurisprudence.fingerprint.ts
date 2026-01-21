// ============================================================================
// JURISPRUDENCE LAYER - Fingerprinting Utilities
// ============================================================================
// Purpose: Generate deterministic fingerprints for contracts and PAM lines
// These fingerprints are used to match precedents across audits

import crypto from "node:crypto";
import type { PAMLineFeatures } from "./jurisprudence.types.js";

/**
 * Generate SHA1 hash of a string
 */
export function sha1(s: string): string {
    return crypto.createHash("sha1").update(s).digest("hex");
}

/**
 * Stable JSON stringification with sorted keys
 */
function stableJson(obj: any): string {
    const allKeys: string[] = [];
    JSON.stringify(obj, (k, v) => (allKeys.push(k), v));
    allKeys.sort();
    return JSON.stringify(obj, allKeys);
}

/**
 * Normalize text for comparison:
 * - Uppercase
 * - Remove accents
 * - Remove special characters
 * - Collapse whitespace
 */
export function normalizeText(s: string): string {
    return (s || "")
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove accents
        .replace(/[^A-Z0-9\s]/g, " ")                       // Keep only alphanumeric
        .replace(/\s+/g, " ")                                // Collapse whitespace
        .trim();
}

/**
 * Generate a fingerprint for a contract based on its coverage map
 * This creates a stable hash that identifies "equivalent" contracts
 */
export function contractFingerprint(contratoJson: any): string {
    const coberturas = contratoJson?.coberturas || contratoJson?.coverages || [];

    const normalized = coberturas.map((c: any) => ({
        categoria: normalizeText(c.categoria || c.category || ""),
        item: normalizeText(c.item || c.name || ""),
        modalidad: normalizeText(c.modalidad || c.modality || ""),
        cobertura: String(c.cobertura ?? c.coverage ?? ""),
        tope: String(c.tope ?? c.limit ?? ""),
        restr: normalizeText(c.nota_restriccion || c.restriction || "")
    }));

    // Sort for determinism
    normalized.sort((a: any, b: any) =>
        (a.categoria + a.item + a.modalidad).localeCompare(b.categoria + b.item + b.modalidad)
    );

    return sha1(stableJson({ cob: normalized }));
}

/**
 * Classify a description into a kind category
 */
function classifyKind(desc: string): PAMLineFeatures["kind"] {
    const upper = (desc || "").toUpperCase();
    if (/MEDIC|FARMAC|DROGA/.test(upper)) return "MED";
    if (/MATER/.test(upper)) return "MAT";
    if (/INSUM/.test(upper)) return "INS";
    if (/VARIOS|OTROS|MISCELAN/.test(upper)) return "VAR";
    return "OTRO";
}

/**
 * Check if a description represents a generic/opaque line
 */
function isGenericLine(desc: string): boolean {
    return /MATERIAL|MEDICAMENTO|INSUMO|VARIOS|PRESTACIONES SIN BONIF|MATERIAL CLINICO/i.test(desc);
}

/**
 * Extract features from a PAM line for fingerprinting and matching
 */
export function extractPamLineFeatures(line: {
    codigo?: string;
    desc?: string;
    descripcion?: string;
    bonif?: any;
    bonificacion?: any;
    copago?: any;
}): PAMLineFeatures {
    const desc = normalizeText(line.desc || line.descripcion || "");
    const code = String(line.codigo || "NO_CODE");
    const bonif = Number(line.bonif ?? line.bonificacion ?? 0);
    const copago = Number(line.copago ?? 0);

    return {
        code,
        kind: classifyKind(desc),
        bonif0: bonif === 0,
        copagoPos: copago > 0,
        generic: isGenericLine(line.desc || line.descripcion || ""),
        description: desc
    };
}

/**
 * Generate a fingerprint for a PAM line based on its features
 * This creates a stable hash that identifies "equivalent" billing patterns
 */
export function pamLineFingerprint(line: {
    codigo?: string;
    desc?: string;
    descripcion?: string;
    bonif?: any;
    bonificacion?: any;
    copago?: any;
}): string {
    const features = extractPamLineFeatures(line);

    const fingerprintData = {
        code: features.code,
        kind: features.kind,
        bonif0: features.bonif0 ? 1 : 0,
        copagoPos: features.copagoPos ? 1 : 0,
        generic: features.generic ? 1 : 0
    };

    return sha1(stableJson(fingerprintData));
}

/**
 * Extract a Set of feature strings for decision matching
 */
export function extractFeatureSet(
    pamLine: { codigo?: string; desc?: string; descripcion?: string; bonif?: any; bonificacion?: any; copago?: any },
    contratoJson: any,
    hypothesisResult?: any
): Set<string> {
    const features = new Set<string>();
    const lineFeatures = extractPamLineFeatures(pamLine);

    // Basic line features
    if (lineFeatures.bonif0) features.add("BONIF_0");
    if (lineFeatures.copagoPos) features.add("COPAGO_POS");
    if (lineFeatures.generic) features.add("GENERIC_PAM_LINE");

    // Kind-based features
    if (lineFeatures.kind === "MED" || lineFeatures.kind === "INS") {
        features.add("MED_OR_INS");
    }

    // Contract coverage features
    const coverages = contratoJson?.coberturas || contratoJson?.coverages || [];
    const has100Coverage = coverages.some((c: any) => {
        const cov = Number(c.cobertura ?? c.coverage ?? 0);
        return cov === 100 || cov === 1; // 100% or 1.0
    });
    if (has100Coverage) features.add("COV_100");

    // Check if this specific item category has 100% coverage
    const itemCat = lineFeatures.kind === "MED" ? "MEDICAMENTOS" :
        lineFeatures.kind === "INS" ? "INSUMOS" :
            lineFeatures.kind === "MAT" ? "MATERIALES" : "";

    const hasCat100 = coverages.some((c: any) => {
        const catNorm = normalizeText(c.categoria || c.category || "");
        const cov = Number(c.cobertura ?? c.coverage ?? 0);
        return catNorm.includes(itemCat) && (cov === 100 || cov === 1);
    });
    if (hasCat100) features.add(`COV_100_${lineFeatures.kind}`);

    // Hypothesis-based features
    if (hypothesisResult?.hypotheses) {
        for (const h of hypothesisResult.hypotheses) {
            if (h.id === "H1_STRUCTURAL_OPACITY") features.add("OPACIDAD_ESTRUCTURAL");
            if (h.id === "H2_UNBUNDLING") features.add("UNBUNDLING_DETECTED");
            if (h.id === "H3_HOTELERIA") features.add("HOTELERIA_DETECTED");
        }
    }

    // Opacity at line level
    if (lineFeatures.generic && lineFeatures.copagoPos) {
        features.add("OPACIDAD_LINEA");
    }

    return features;
}
