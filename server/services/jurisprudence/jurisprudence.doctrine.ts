// ============================================================================
// JURISPRUDENCE LAYER - Doctrine Rules
// ============================================================================
// Purpose: Hard-coded canonical rules that don't need precedents
// These are "the law" - they apply regardless of precedent existence

import type { DoctrineRule, Cat, TipoMonto, Recomendacion } from "./jurisprudence.types.js";

/**
 * Canonical doctrine rules for RevisaTuCuenta
 * Order matters: first matching rule wins
 */
export const DOCTRINE_RULES: DoctrineRule[] = [
    // ========================================================================
    // RULE D01: Medicamentos/Insumos con cobertura 100% y bonificación $0
    // ========================================================================
    {
        id: "D01_MED_100_BONIF_0",
        label: "Medicamentos/Insumos 100% sin bonificación",
        requiredFeatures: ["MED_OR_INS", "BONIF_0", "COV_100"],
        decision: {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.92
        },
        rationale: "Medicamentos/insumos con cobertura 100% no pueden quedar con bonificación $0 sin causal (tope/exclusión) acreditada. Constituye cobro improcedente bajo Art. 33 Ley 18.933."
    },

    // ========================================================================
    // RULE D02: Unbundling - Items separados que van incluidos
    // ========================================================================
    {
        id: "D02_UNBUNDLING",
        label: "Unbundling detectado",
        requiredFeatures: ["UNBUNDLING_DETECTED"],
        decision: {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.88
        },
        rationale: "Cobro fragmentado de prestaciones que deben entenderse incluidas en el día cama o pabellón. Constituye doble cobro según jurisprudencia SII y Circular IF/176."
    },

    // ========================================================================
    // RULE D03: Instalación Vía Venosa / Fleboclisis (Siempre A)
    // ========================================================================
    {
        id: "D03_VIA_VENOSA",
        label: "Vía venosa/Fleboclisis separada",
        requiredFeatures: ["VIA_VENOSA_SEPARADA"],
        decision: {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.95
        },
        rationale: "Instalación de vía venosa y fleboclisis están incluidas en el arancel de hospitalización según Tabla VIII Fonasa. Cobro separado es improcedente."
    },

    // ========================================================================
    // RULE D04: Opacidad en líneas genéricas con copago
    // ========================================================================
    {
        id: "D04_GENERIC_OPACITY",
        label: "Opacidad en materiales/medicamentos",
        requiredFeatures: ["GENERIC_PAM_LINE", "COPAGO_POS"],
        forbiddenFeatures: ["BONIF_0", "COV_100"], // Don't apply if D01 would match
        decision: {
            categoria_final: "B",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.80
        },
        rationale: "Línea PAM genérica (material/medicamento/varios) sin desglose detallado impide verificar cobertura. Copago indeterminable: Circular IF/176 exige desglose."
    },

    // ========================================================================
    // RULE D05: Opacidad estructural global
    // ========================================================================
    {
        id: "D05_STRUCTURAL_OPACITY",
        label: "Opacidad estructural del PAM",
        requiredFeatures: ["OPACIDAD_ESTRUCTURAL"],
        forbiddenFeatures: ["UNBUNDLING_DETECTED"], // Unbundling is still Cat A
        decision: {
            categoria_final: "B",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.85
        },
        rationale: "El PAM consolida materiales/medicamentos sin apertura espejo, impidiendo validar topes UF. Estado global de controversia, no invalida hallazgos locales."
    },

    // ========================================================================
    // RULE D06: Hotelería oculta (alimentación, lavandería, etc.)
    // ========================================================================
    {
        id: "D06_HOTELERIA",
        label: "Hotelería oculta en prestaciones",
        requiredFeatures: ["HOTELERIA_DETECTED"],
        decision: {
            categoria_final: "B",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.75
        },
        rationale: "Gastos de hotelería (alimentación, lavandería) deben estar explícitos. Si aparecen consolidados, genera controversia sobre cobertura aplicable."
    }
];

/**
 * Find the first doctrine rule that matches the given features
 */
export function findMatchingDoctrine(features: Set<string>): DoctrineRule | null {
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
