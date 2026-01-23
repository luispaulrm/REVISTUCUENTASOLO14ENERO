// ============================================================================
// JURISPRUDENCE LAYER - Doctrine Rules
// ============================================================================
// Purpose: Hard-coded canonical rules that don't need precedents
// These are "the law" - they apply regardless of precedent existence

import type { DoctrineRule, Cat, TipoMonto, Recomendacion } from "./jurisprudence.types.js";

/**
 * Canonical doctrine rules (SOVEREIGNTY ENGINE v3.0)
 * Logic is prioritized by 6 layers:
 * 1. CAPA 1: CONTRATO (IC) - Weight 0.5
 * 2. CAPA 2/3: ARQUETIPOS / UNBUNDLING (UB) - Weight 0.3
 * 3. CAPA 4: HOTELERÍA (HT) - Weight 0.1
 * 4. CAPA 6: OPACIDAD (OP) - Weight 0.1
 */
export const DOCTRINE_RULES: DoctrineRule[] = [
    // ========================================================================
    // CAPA 1: CONTRATO (Incumplimiento Contractual - IC) - w=0.5
    // ========================================================================
    {
        id: "L1_CONTRACT_BREACH",
        label: "Incumplimiento Contractual Determinado (Soberanía)",
        requiredFeatures: ["IC_BREACH"],
        weight: 0.5,
        decision: {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 1.0,
            score: 0.5
        },
        rationale: "Existe un incumplimiento contractual probado (Cobertura 100% o explícita). La obligación económica base es nula. Por regla de prevalencia, la opacidad del PAM es irrelevante (Cat A)."
    },

    // ========================================================================
    // CAPA 3: PRÁCTICAS IRREGULARES (Unbundling - UB) - w=0.3
    // ========================================================================
    {
        id: "L3_UNBUNDLING_DETERMINED",
        label: "Práctica Irregular / Unbundling Determinado",
        requiredFeatures: ["UB_DETECTED"],
        weight: 0.3,
        decision: {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.95,
            score: 0.3
        },
        rationale: "Se detecta desglosamiento indebido (unbundling) o doble cobro por literatura técnica. El ítem es inherentemente incluido en cargos base (Cat A)."
    },

    // ========================================================================
    // CAPA 4: HOTELERÍA (HT) - w=0.1
    // ========================================================================
    {
        id: "L4_HOTEL_RECONSTRUCTED",
        label: "Hotelería Identificada por Literatura",
        requiredFeatures: ["HT_DETECTED"],
        weight: 0.1,
        decision: {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.90,
            score: 0.1
        },
        rationale: "El ítem es clasificado como hotelería mediante reconstrucción por literatura. No es exigible como copago clínico (Cat A)."
    },

    // ========================================================================
    // CAPA 6: OPACIDAD RESIDUAL (OP) - w=0.1
    // ========================================================================
    {
        id: "L6_RESIDUAL_OPACITY",
        label: "Opacidad Residual (Ley 20.584)",
        requiredFeatures: ["OP_DETECTED"],
        forbiddenFeatures: ["IC_BREACH", "UB_DETECTED"],
        weight: 0.1,
        decision: {
            categoria_final: "Z",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.85,
            score: 0.1
        },
        rationale: "Indeterminación residual. No se detectó incumplimiento contractual ni técnico previo; la falla es estrictamente de trazabilidad en el PAM (Cat Z)."
    }
];

/**
 * Find the matching doctrine and calculate sovereignty score
 */
export function findMatchingDoctrine(features: Set<string>): DoctrineRule | null {
    // PREVALENCE RULE: If IC or UB is true, we force top priority rules
    if (features.has("IC_BREACH") || features.has("UB_DETECTED")) {
        return DOCTRINE_RULES.find(r =>
            r.requiredFeatures.every(f => features.has(f)) &&
            (r.id.startsWith("L1") || r.id.startsWith("L3"))
        ) || null;
    }

    for (const rule of DOCTRINE_RULES) {
        // Check all required features are present
        const hasAllRequired = rule.requiredFeatures.every(f => features.has(f));
        if (!hasAllRequired) continue;

        // Check no forbidden features are present
        const hasForbidden = (rule.forbiddenFeatures || []).some(f => features.has(f));
        if (hasForbidden) continue;

        return rule;
    }
    return null;
}

/**
 * Get all applicable doctrine rules (not just first match)
 */
export function findAllMatchingDoctrine(features: Set<string>): DoctrineRule[] {
    return DOCTRINE_RULES.filter(rule => {
        const hasAllRequired = rule.requiredFeatures.every(f => features.has(f));
        const hasForbidden = (rule.forbiddenFeatures || []).some(f => features.has(f));
        return hasAllRequired && !hasForbidden;
    });
}

// ============================================================================
// CANONICAL META-RULES: OPACITY NON-COLLAPSE (C-NC)
// ============================================================================
// These are not "doctrine rules" but constitutional principles that govern
// how rules are applied. They cannot be overridden.

/**
 * C-NC-01: Evaluación independiente por línea
 * La improcedencia determinable por naturaleza clínica, cobertura contractual,
 * prohibición normativa, o doctrina administrativa → Cat A
 * CON INDEPENDENCIA del estado de opacidad global.
 */
export const RULE_C_NC_01 = {
    id: "C-NC-01",
    name: "Evaluación Independiente por Línea",
    description: "Si la improcedencia puede determinarse por naturaleza clínica, cobertura contractual explícita, prohibición normativa, o doctrina administrativa → Cat A, independiente de opacidad global."
};

/**
 * C-NC-02: Opacidad acotada
 * Solo ítems cuya evaluación dependa ESTRICTAMENTE de información ausente
 * y no tengan cobertura explícita, prohibición directa, ni doctrina aplicable
 * → Cat Z
 */
export const RULE_C_NC_02 = {
    id: "C-NC-02",
    name: "Opacidad Acotada",
    description: "Solo ítems sin cobertura explícita, sin prohibición normativa directa, ni doctrina aplicable, y que dependan de información ausente → Cat Z."
};

/**
 * C-NC-03: Prohibición de colapso global
 * La opacidad NO puede anular, degradar, o reclasificar ítems ya determinados
 * como Cat A o Cat OK. La opacidad no tiene efecto retroactivo ni expansivo.
 */
export const RULE_C_NC_03 = {
    id: "C-NC-03",
    name: "Prohibición de Colapso Global",
    description: "La opacidad NO puede anular, degradar, o reclasificar Cat A o Cat OK. No tiene efecto retroactivo ni expansivo."
};

/**
 * Priority order for decision making (highest to lowest)
 */
export const DECISION_PRIORITY_ORDER = [
    "IMPROCEDENCIA_NORMATIVA_CONTRACTUAL",  // 1st: Explicit contract/legal breach
    "DETERMINACION_CLINICA_OBJETIVA",        // 2nd: Clinical nature (unbundling, etc.)
    "DOCTRINA_ADMINISTRATIVA_REITERADA",     // 3rd: Administrative doctrine (D01-D06)
    "OPACIDAD_DOCUMENTAL"                    // LAST: Opacity (never first)
] as const;

/**
 * Canonical legal text for reports when mixed Cat A + opacity exists
 */
export const CANONICAL_NON_COLLAPSE_TEXT = `La auditoría identifica partidas cuya procedencia o improcedencia puede determinarse con independencia de la opacidad documental existente, así como otras que requieren aclaración adicional. En consecuencia, la opacidad detectada es parcial y no invalida los hallazgos clínicos, contractuales y normativos acreditados.`;

/**
 * Generate the appropriate legal text based on category distribution
 */
export function generateNonCollapseText(catACount: number, catBCount: number, catZCount: number): string {
    if (catACount > 0 && (catBCount > 0 || catZCount > 0)) {
        // Mixed case: Cat A confirmed + opacity exists
        return CANONICAL_NON_COLLAPSE_TEXT;
    } else if (catACount > 0 && catBCount === 0 && catZCount === 0) {
        // Pure Cat A case
        return `La auditoría identifica exclusivamente cobros improcedentes determinables con certeza jurídica. No existe opacidad relevante que afecte las conclusiones.`;
    } else if (catACount === 0 && (catBCount > 0 || catZCount > 0)) {
        // Pure opacity case
        return `La auditoría identifica opacidad documental que impide determinar la procedencia de los cobros. Se requiere aclaración previa a cualquier determinación de improcedencia.`;
    }
    return `No se identificaron hallazgos significativos.`;
}

/**
 * Check if a category decision can be overridden by opacity
 * Implements C-NC-03: Cat A and Cat OK are immune to opacity override
 */
export function canOpacityOverride(currentCategory: 'A' | 'B' | 'Z' | 'OK'): boolean {
    // C-NC-03: Opacity cannot override Cat A or Cat OK
    if (currentCategory === 'A' || currentCategory === 'OK') {
        return false;
    }
    // B and Z can potentially be affected by further opacity analysis
    return true;
}

/**
 * Determine if an item should be Cat A based on C-NC-01 criteria
 * (independent of opacity)
 */
export function isImprocedenteByRule(features: Set<string>): boolean {
    // Check for any Cat A doctrine rule match
    const doctrineMatch = findMatchingDoctrine(features);
    if (doctrineMatch && doctrineMatch.decision.categoria_final === 'A') {
        return true;
    }

    // Additional C-NC-01 checks not covered by doctrine
    // Naturaleza clínica: día cama, pabellón includes
    if (features.has('DIA_CAMA_INCLUDE') || features.has('PABELLON_INCLUDE')) {
        return true;
    }

    // Cobertura contractual explícita incumplida
    if (features.has('COV_100') && features.has('BONIF_0')) {
        return true;
    }

    // Prohibición normativa expresa (IF-319, etc.)
    if (features.has('IF_319_VIOLATION') || features.has('EVENTO_UNICO_VIOLATION')) {
        return true;
    }

    return false;
}

/**
 * Determine if an item should be Cat Z based on C-NC-02 criteria
 */
export function requiresMissingInfo(features: Set<string>): boolean {
    // Only Cat Z if:
    // 1. Has opacity indicator
    // 2. NO explicit coverage
    // 3. NO normative prohibition
    // 4. NO applicable doctrine

    const hasOpacity = features.has('OPACIDAD_LINEA') || features.has('GENERIC_PAM_LINE');
    const hasExplicitCoverage = features.has('COV_100') || features.has('COV_EXPLICIT');
    const hasNormativeProhibition = features.has('UNBUNDLING_DETECTED') || features.has('VIA_VENOSA_SEPARADA') || features.has('IF_319_VIOLATION');
    const hasDoctrine = findMatchingDoctrine(features) !== null;

    return hasOpacity && !hasExplicitCoverage && !hasNormativeProhibition && !hasDoctrine;
}

