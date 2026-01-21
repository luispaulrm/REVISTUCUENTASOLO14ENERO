// ============================================================================
// JURISPRUDENCE LAYER - Decision Engine
// ============================================================================
// Purpose: Precedent-first decision resolver
// Order: PRECEDENT → DOCTRINE → HEURISTIC (LLM never decides categories)

import { JurisprudenceStore } from "./jurisprudence.store.js";
import { contractFingerprint, pamLineFingerprint } from "./jurisprudence.fingerprint.js";
import { findMatchingDoctrine } from "./jurisprudence.doctrine.js";
import type { Decision, DecisionInput, Precedent, Cat } from "./jurisprudence.types.js";

export class JurisprudenceEngine {
    constructor(private store: JurisprudenceStore) { }

    /**
     * Make a decision for a given input following precedent-first logic
     */
    decide(input: DecisionInput): Decision {
        const contractFp = contractFingerprint(input.contratoJson);

        // If no PAM line, decide based on global context only
        if (!input.pamLine) {
            return this.decideGlobalContext(input.features);
        }

        const factFp = pamLineFingerprint({
            codigo: input.pamLine.codigo,
            desc: input.pamLine.descripcion,
            bonif: input.pamLine.bonificacion,
            copago: input.pamLine.copago
        });

        // ====================================================================
        // 1) PRECEDENT LOOKUP (Highest priority)
        // ====================================================================
        const precedentHits = this.store.findByFingerprints(contractFp, factFp);
        const usablePrecedent = precedentHits.find(p => this.guardsPass(p, input.features));

        if (usablePrecedent) {
            console.log(`[JurisprudenceEngine] Precedent match: ${usablePrecedent.id} (confidence: ${usablePrecedent.decision.confidence})`);
            return {
                categoria_final: usablePrecedent.decision.categoria_final,
                tipo_monto: usablePrecedent.decision.tipo_monto,
                recomendacion: usablePrecedent.decision.recomendacion,
                confidence: usablePrecedent.decision.confidence,
                source: "PRECEDENTE",
                precedentId: usablePrecedent.id
            };
        }

        // ====================================================================
        // 2) DOCTRINE LOOKUP (Second priority)
        // ====================================================================
        const doctrineMatch = findMatchingDoctrine(input.features);

        if (doctrineMatch) {
            console.log(`[JurisprudenceEngine] Doctrine match: ${doctrineMatch.id} - ${doctrineMatch.label}`);
            return {
                categoria_final: doctrineMatch.decision.categoria_final,
                tipo_monto: doctrineMatch.decision.tipo_monto,
                recomendacion: doctrineMatch.decision.recomendacion,
                confidence: doctrineMatch.decision.confidence,
                source: "DOCTRINA"
            };
        }

        // ====================================================================
        // 3) HEURISTIC (Default fallback)
        // ====================================================================
        console.log(`[JurisprudenceEngine] No precedent/doctrine match. Applying heuristic.`);
        return this.heuristicDecision(input.features);
    }

    /**
     * Decide for global context (no specific PAM line)
     */
    private decideGlobalContext(features: Set<string>): Decision {
        // Check for structural opacity
        if (features.has("OPACIDAD_ESTRUCTURAL")) {
            return {
                categoria_final: "B",
                tipo_monto: "COPAGO_OPACO",
                recomendacion: "SOLICITAR_ACLARACION",
                confidence: 0.85,
                source: "DOCTRINA"
            };
        }

        // Default global decision
        return {
            categoria_final: "B",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.60,
            source: "HEURISTICA"
        };
    }

    /**
     * Heuristic decision when no precedent or doctrine matches
     */
    private heuristicDecision(features: Set<string>): Decision {
        // If bonificación is 0 and there's copago, lean towards controversy
        if (features.has("BONIF_0") && features.has("COPAGO_POS")) {
            return {
                categoria_final: "B",
                tipo_monto: "COPAGO_OPACO",
                recomendacion: "SOLICITAR_ACLARACION",
                confidence: 0.65,
                source: "HEURISTICA"
            };
        }

        // Generic line with copago → controversy
        if (features.has("GENERIC_PAM_LINE") && features.has("COPAGO_POS")) {
            return {
                categoria_final: "B",
                tipo_monto: "COPAGO_OPACO",
                recomendacion: "SOLICITAR_ACLARACION",
                confidence: 0.60,
                source: "HEURISTICA"
            };
        }

        // Default: Indeterminate
        return {
            categoria_final: "Z",
            tipo_monto: "COPAGO_OPACO",
            recomendacion: "SOLICITAR_ACLARACION",
            confidence: 0.50,
            source: "HEURISTICA"
        };
    }

    /**
     * Check if a precedent's guards pass given the current features
     */
    private guardsPass(precedent: Precedent, features: Set<string>): boolean {
        const required = precedent.guards?.requires || [];
        const forbidden = precedent.guards?.forbids || [];

        // All required features must be present
        if (required.some(r => !features.has(r))) {
            return false;
        }

        // No forbidden features can be present
        if (forbidden.some(f => features.has(f))) {
            return false;
        }

        return true;
    }

    /**
     * Get engine statistics
     */
    getStats(): { precedentCount: number; doctrineRuleCount: number } {
        return {
            precedentCount: this.store.list().length,
            doctrineRuleCount: 6 // Hardcoded for now
        };
    }
}
