// ============================================================================
// JURISPRUDENCE LAYER - Type Definitions
// ============================================================================
// Purpose: Persistent precedent-based decision making for RevisaTuCuenta
// Shifts from LLM-driven categorization to: Precedent → Doctrine → Heuristic

export type Cat = "A" | "B" | "Z";
export type ScopeType = "GLOBAL" | "PAM_LINE" | "CUENTA_LINE" | "EVENTO";
export type TipoMonto = "COBRO_IMPROCEDENTE" | "COPAGO_OPACO";
export type Recomendacion = "IMPUGNAR" | "SOLICITAR_ACLARACION";
export type DecisionSource = "PRECEDENTE" | "DOCTRINA" | "HEURISTICA";

/**
 * Reference to evidence in source documents
 */
export interface EvidenceRef {
    kind: "PAM" | "CUENTA" | "CONTRATO" | "EVENTO";
    path: string;           // JSONPath or logical path
    label?: string;
}

/**
 * Decision output from the JurisprudenceEngine
 */
export interface Decision {
    categoria_final: Cat;
    tipo_monto: TipoMonto;
    recomendacion: Recomendacion;
    confidence: number;     // 0..1
    source: DecisionSource;
    precedentId?: string;   // If decision came from a precedent
}

/**
 * Precedent guards - conditions that must/must-not be present
 */
export interface PrecedentGuards {
    requires?: string[];    // Features that must be present
    forbids?: string[];     // Features that invalidate this precedent
}

/**
 * A stored precedent (judicial decision)
 */
export interface Precedent {
    id: string;
    createdAt: string;
    updatedAt: string;

    // Fingerprints for matching
    contractFingerprint: string;    // hash(normalized contract coverage map)
    factFingerprint: string;        // hash(normalized fact features)

    // Decision
    decision: {
        categoria_final: Cat;
        tipo_monto: TipoMonto;
        recomendacion: Recomendacion;
        confidence: number;
    };

    // Rationale
    rationale: string;
    tags: string[];                 // ["MED_100", "BONIF_0", "INCUMPLIMIENTO_DIRECTO"]

    // Guards
    guards?: PrecedentGuards;

    // Evidence template for traceability
    evidenceTemplate?: EvidenceRef[];
}

/**
 * Input to the JurisprudenceEngine.decide() method
 */
export interface DecisionInput {
    contratoJson: any;
    pamLine?: {
        codigo?: string;
        descripcion?: string;
        bonificacion?: number;
        copago?: number;
    };
    features: Set<string>;  // Pre-computed features: "COV_100_MED", "BONIF_0", etc.
}

/**
 * Persistent store data structure
 */
export interface JurisprudenceData {
    precedents: Precedent[];
    version?: string;
    lastUpdated?: string;
}

/**
 * Doctrine rule definition (hard-coded rules)
 */
export interface DoctrineRule {
    id: string;
    label: string;
    requiredFeatures: string[];
    forbiddenFeatures?: string[];
    decision: {
        categoria_final: Cat;
        tipo_monto: TipoMonto;
        recomendacion: Recomendacion;
        confidence: number;
    };
    rationale: string;
}

/**
 * Feature extraction result for a PAM line
 */
export interface PAMLineFeatures {
    code: string;
    kind: "MED" | "MAT" | "INS" | "VAR" | "OTRO";
    bonif0: boolean;
    copagoPos: boolean;
    generic: boolean;
    description: string;
}
