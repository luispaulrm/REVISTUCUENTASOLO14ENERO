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
    if (!pamLine) return features;

    const lineFeatures = extractPamLineFeatures(pamLine);
    const desc = normalizeText(pamLine.desc || pamLine.descripcion || "");
    const code = String(pamLine.codigo || "");

    // 1. Basic line features
    if (lineFeatures.bonif0) features.add("BONIF_0");
    if (lineFeatures.copagoPos) features.add("COPAGO_POS");
    if (lineFeatures.generic) features.add("GENERIC_PAM_LINE");

    // 2. Nature of Service (Nivel 2 - Unbundling / Inherently Included)
    const INHERENTLY_INCLUDED_REGEX = /(SIGNOS VITALES|CURACION|INSTALACION VIA|FLEBOCLISIS|ENFERMERIA|TOMA DE MUESTRA|PROPOFOL|FENTANILO|SEVOFLURANO|MIDAZOLAM|ANESTESIA|GAZA|SUTURA|JERINGA|EQUIPO PABELLON|IMPLEMENTOS PABELLON|MASCARILLA|COMPRESA|ROPA|BANDEJA|TERMOMETRO|KIT ASEO|KIT PACIENTE|INSUMOS BASICOS|GASAS)/i;
    if (INHERENTLY_INCLUDED_REGEX.test(desc)) {
        features.add("INHERENTLY_INCLUDED");
    }

    // 3. Hotelería (Nivel 3)
    const HOTEL_REGEX = /(ALIMENTA|NUTRICI|HOTEL|CAMA|PENSION|CONFORT|KIT DE ASEO|PANTUFLAS|ROPA|MANTENCION|ESTACIONAMIENTO|TELEVISION|WIFI|ALIMENTACION)/i;
    if (HOTEL_REGEX.test(desc)) {
        features.add("ES_HOTELERIA");
        // If it's a specific, single-purpose hotel line
        const isMixed = /MEDIC|INSUM|MATER|EXAM|LABOR/i.test(desc);
        if (!isMixed) {
            features.add("HOTELERIA_INDIVIDUALIZADA");
        } else {
            features.add("HOTELERIA_MEZCLADA");
        }
    }

    // 4. Exams and Meds (Automatic Relabeling)
    // Expand detection for specific lab terms found in user cases
    const EXAM_REGEX = /03|EXAMEN|LABORATORIO|RADIOLOG|BIOPSIA|DETECCION|ESTUDIO|HISTOPATOLOG|INMUNOLOG|REACCION|CULTIVO|PERFIL|ORINA|SANGRE|HEMOGRAMA/i;
    if (code.startsWith("03") || EXAM_REGEX.test(desc)) {
        features.add("ES_EXAMEN");
    }

    // 4.1 STRATEGIC RECLASSIFICATION DETECTION (NEW)
    // Detect items that appear to be covered categories (Honorarios, Pabellon, Anestesia) 
    // but are labeled as "not covered" or similar.
    const RECLASSIFICATION_TERMS = /(NO CUBIERTO|GASTO NO CUBIERTO|PRESTACION NO CONTEMPLADA|SIN BONIF|SIN COBERTURA|EXCLUIDO)/i;
    const COVERED_CATEGORY_HINT = /(HONORARIO|PABELLON|ANESTESIA|MEDICAMENTO|INSUMO|MATERIAL CLINICO)/i;
    if (RECLASSIFICATION_TERMS.test(desc) && (COVERED_CATEGORY_HINT.test(desc) || /MEDIC|INSUM|MATER/.test(lineFeatures.kind))) {
        features.add("STRATEGIC_RECLASSIFICATION");
    }

    if (lineFeatures.kind === "MED" || lineFeatures.kind === "INS") {
        features.add("MED_OR_INS");
        // For now, assume MED_OR_INS in a hospital audit context is hospital meds
        // The hypothesisResult can confirm if we are in a hospital event
        features.add("ES_MED_HOSP");
    }

    // 5. Contract coverage features (Nivel 1: Capa Contractual)
    const coverages = contratoJson?.coberturas || contratoJson?.coverages || [];

    let hasExplicitCoverage = false;
    let explicitCoverageVal = 0;

    for (const c of coverages) {
        const itemNormal = normalizeText(c.item || c.name || "");
        const catNormal = normalizeText(c.categoria || c.category || "");

        if ((code && itemNormal.includes(code)) ||
            (desc && (itemNormal.includes(desc) || desc.includes(itemNormal)))) {
            hasExplicitCoverage = true;
            explicitCoverageVal = Math.max(explicitCoverageVal, Number(c.cobertura ?? c.coverage ?? 0));
        }

        if (lineFeatures.kind === "MED" && catNormal.includes("MEDICAMENTO")) {
            hasExplicitCoverage = true;
            explicitCoverageVal = Math.max(explicitCoverageVal, Number(c.cobertura ?? c.coverage ?? 0));
        }
        if (lineFeatures.kind === "INS" && catNormal.includes("INSUMO")) {
            hasExplicitCoverage = true;
            explicitCoverageVal = Math.max(explicitCoverageVal, Number(c.cobertura ?? c.coverage ?? 0));
        }
        if (lineFeatures.kind === "MAT" && catNormal.includes("MATERIAL")) {
            hasExplicitCoverage = true;
            explicitCoverageVal = Math.max(explicitCoverageVal, Number(c.cobertura ?? c.coverage ?? 0));
        }
        if (features.has("ES_EXAMEN") && (catNormal.includes("EXAMEN") || itemNormal.includes("EXAMEN"))) {
            hasExplicitCoverage = true;
            explicitCoverageVal = Math.max(explicitCoverageVal, Number(c.cobertura ?? c.coverage ?? 0));
        }
    }

    if (hasExplicitCoverage) features.add("COV_EXPLICIT");
    // FIX: Ensure boolean/numeric comparison is robust. 
    // Usually coverage is 1.0 (100%) or integer 100. Checking both.
    if (explicitCoverageVal >= 100 || explicitCoverageVal >= 1.0) features.add("COV_100");
    features.add("TOPES_NO_ALCANZADOS"); // Pro-patient assumption

    // CAPA 1 Flag: IC_BREACH
    // CRITICAL: If Meds/Mats have 100% coverage and no limit reached, IT IS A BREACH if copay > 0.
    // We add a specific check for generic kinds (MED, MAT, INS) to ensure they are caught.
    const isGenericClinical = ["MED", "MAT", "INS"].includes(lineFeatures.kind);

    // DEBUG LOG
    // console.log(`[FINGERPRINT DEBUG] Item: ${pamLine.descripcion || pamLine.desc} | Kind: ${lineFeatures.kind} | COV_100: ${features.has("COV_100")} (val=${explicitCoverageVal}) | COV_EXPL: ${features.has("COV_EXPLICIT")} | TOPES: ${features.has("TOPES_NO_ALCANZADOS")} | POS: ${lineFeatures.copagoPos} | Generic: ${isGenericClinical}`);

    if ((features.has("COV_100") || (isGenericClinical && features.has("COV_EXPLICIT")) || features.has("STRATEGIC_RECLASSIFICATION")) && features.has("TOPES_NO_ALCANZADOS") && lineFeatures.copagoPos) {
        features.add("IC_BREACH");
    }

    // 6. Hypothesis-based features (Layers 3, 4, 6)
    if (hypothesisResult?.hypotheses) {
        for (const h of hypothesisResult.hypotheses) {
            if (h.id === "H_OPACIDAD_ESTRUCTURAL" || h.id === "H1_STRUCTURAL_OPACITY") features.add("OPACIDAD_ESTRUCTURAL");
            if (h.id === "H_UNBUNDLING_IF319" || h.id === "H2_UNBUNDLING") features.add("UNBUNDLING_DETECTED");
            if (h.id === "H_HOTELERIA" || h.id === "H3_HOTELERIA") features.add("HOTELERIA_DETECTED");
        }
    }

    // CAPA 3 Flag: UB_DETECTED
    if (features.has("INHERENTLY_INCLUDED") || features.has("UNBUNDLING_DETECTED")) {
        features.add("UB_DETECTED");
    }

    // CAPA 4 Flag: HT_DETECTED
    if (features.has("ES_HOTELERIA") || features.has("HOTELERIA_DETECTED")) {
        features.add("HT_DETECTED");
    }

    // 7. Opacity at line level (Capa 6: Opacidad Residual)
    if (lineFeatures.generic && lineFeatures.copagoPos) {
        features.add("OPACIDAD_LINEA");
    }

    // CAPA 6 Flag: OP_DETECTED
    if (features.has("OPACIDAD_ESTRUCTURAL") || features.has("OPACIDAD_LINEA")) {
        // C-NC-02: Only OP_DETECTED if it's NOT an IC_BREACH or UB_DETECTED
        if (!features.has("IC_BREACH") && !features.has("UB_DETECTED") && !features.has("HT_DETECTED")) {
            features.add("OP_DETECTED");
        }
    }

    // 8. Evento Único Flag (NEW)
    if (hypothesisResult?.signals?.some((s: any) => s.id === 'EVENTO_UNICO_VIOLATION' && s.value > 0)) {
        features.add('EVENT_UNIQUE_VIOLATION');
    }

    return features;
}

