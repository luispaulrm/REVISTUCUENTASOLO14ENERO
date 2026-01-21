// ============================================================================
// JURISPRUDENCE LAYER - Precedent Recorder
// ============================================================================
// Purpose: Helper functions to record new precedents from validated cases

import { JurisprudenceStore } from "./jurisprudence.store.js";
import { contractFingerprint, pamLineFingerprint } from "./jurisprudence.fingerprint.js";
import type { Precedent, Cat, TipoMonto, Recomendacion, EvidenceRef } from "./jurisprudence.types.js";

/**
 * Generate a unique precedent ID
 */
function generatePrecedentId(contractFp: string, factFp: string, tag: string): string {
    return `P_${contractFp.slice(0, 8)}_${factFp.slice(0, 8)}_${tag}`;
}

/**
 * Record a precedent for a validated finding
 */
export function recordPrecedent(
    store: JurisprudenceStore,
    contratoJson: any,
    pamLine: { codigo?: string; descripcion?: string; bonificacion?: number; copago?: number },
    decision: {
        categoria_final: Cat;
        tipo_monto: TipoMonto;
        recomendacion: Recomendacion;
        confidence: number;
    },
    rationale: string,
    tags: string[],
    guards?: { requires?: string[]; forbids?: string[] }
): string {
    const contractFp = contractFingerprint(contratoJson);
    const factFp = pamLineFingerprint({
        codigo: pamLine.codigo,
        desc: pamLine.descripcion,
        bonif: pamLine.bonificacion,
        copago: pamLine.copago
    });

    const primaryTag = tags[0] || "GENERIC";
    const id = generatePrecedentId(contractFp, factFp, primaryTag);

    const precedent: Precedent = {
        id,
        createdAt: "",
        updatedAt: "",
        contractFingerprint: contractFp,
        factFingerprint: factFp,
        decision,
        rationale,
        tags,
        guards,
        evidenceTemplate: [{
            kind: "PAM",
            path: "folios[].desglosePorPrestador[].items[]",
            label: `PAM line: ${pamLine.codigo || 'UNKNOWN'}`
        }]
    };

    store.upsert(precedent);
    return id;
}

/**
 * Record a precedent for MED/INS with 100% coverage and $0 bonificación
 */
export function recordMed100Precedent(
    store: JurisprudenceStore,
    contratoJson: any,
    pamLine: { codigo?: string; descripcion?: string; bonificacion?: number; copago?: number }
): string {
    return recordPrecedent(
        store,
        contratoJson,
        pamLine,
        {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.92
        },
        "Medicamentos/insumos con cobertura 100% no pueden quedar con bonificación $0 sin causal (tope/exclusión) acreditada.",
        ["MED_100", "BONIF_0", "INCUMPLIMIENTO_DIRECTO"],
        { requires: ["COV_100", "BONIF_0", "MED_OR_INS"] }
    );
}

/**
 * Record a precedent for unbundling (via venosa, fleboclisis, etc.)
 */
export function recordUnbundlingPrecedent(
    store: JurisprudenceStore,
    contratoJson: any,
    pamLine: { codigo?: string; descripcion?: string; bonificacion?: number; copago?: number },
    unbundlingType: string = "VIA_VENOSA"
): string {
    return recordPrecedent(
        store,
        contratoJson,
        pamLine,
        {
            categoria_final: "A",
            tipo_monto: "COBRO_IMPROCEDENTE",
            recomendacion: "IMPUGNAR",
            confidence: 0.95
        },
        `Cobro fragmentado de ${unbundlingType} está incluido en arancel de hospitalización según Tabla VIII Fonasa.`,
        ["UNBUNDLING", unbundlingType, "DOBLE_COBRO"],
        { requires: ["UNBUNDLING_DETECTED"] }
    );
}

/**
 * Record a precedent for opacity in generic lines
 */
export function recordOpacityPrecedent(
    store: JurisprudenceStore,
    contratoJson: any,
    pamLine: { codigo?: string; descripcion?: string; bonificacion?: number; copago?: number }
): string {
    return recordPrecedent(
        store,
        contratoJson,
        pamLine,
        {
            categoria_final: "B",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.80
        },
        "Línea PAM genérica sin desglose detallado impide verificar cobertura. Copago indeterminable.",
        ["OPACITY", "GENERIC_LINE", "SIN_DESGLOSE"],
        { requires: ["GENERIC_PAM_LINE", "COPAGO_POS"] }
    );
}

/**
 * Learn from a finalized audit - automatically record precedents for strong findings
 */
export function learnFromAudit(
    store: JurisprudenceStore,
    contratoJson: any,
    findings: Array<{
        codigo?: string;
        descripcion?: string;
        bonificacion?: number;
        copago?: number;
        categoria_final?: Cat;
        tipo_monto?: TipoMonto;
        recomendacion?: string;
        confidence?: number;
        rationale?: string;
        tags?: string[];
    }>,
    minConfidenceThreshold: number = 0.85
): string[] {
    const recordedIds: string[] = [];

    for (const finding of findings) {
        // Only learn from high-confidence Cat A findings
        if (finding.categoria_final !== "A") continue;
        if ((finding.confidence || 0) < minConfidenceThreshold) continue;

        const id = recordPrecedent(
            store,
            contratoJson,
            {
                codigo: finding.codigo,
                descripcion: finding.descripcion,
                bonificacion: finding.bonificacion,
                copago: finding.copago
            },
            {
                categoria_final: finding.categoria_final,
                tipo_monto: finding.tipo_monto || "COBRO_IMPROCEDENTE",
                recomendacion: (finding.recomendacion as Recomendacion) || "IMPUGNAR",
                confidence: finding.confidence || 0.85
            },
            finding.rationale || "Precedente aprendido de auditoría validada.",
            finding.tags || ["LEARNED", "AUTO_RECORDED"]
        );

        recordedIds.push(id);
    }

    if (recordedIds.length > 0) {
        console.log(`[JurisprudenceRecorder] Learned ${recordedIds.length} precedent(s) from audit.`);
    }

    return recordedIds;
}
