// ============================================================================
// Hypothesis-Aware Balance Calculator (V5)
// ============================================================================
//
// Purpose: Create a single source of truth for copago categorization that
// respects the hypothesis engine's capability matrix to avoid contradictions.
//
// Key Innovation: Scope-based categorization. Each PAM line is evaluated
// independently to determine if fine-grained analysis is allowed (H1 check).
//
// ============================================================================

import { Balance, ScopeBalance } from '../../types.js';
import { CapabilityMatrix, HypothesisScope, RuleContext, isCapabilityAllowed } from './hypothesisRouter.service.js';

export interface PAMLineInput {
    key: string;
    desc: string;
    copago: number;
}

/**
 * Hypothesis-aware balance calculation.
 * 
 * This function is the SINGLE SOURCE OF TRUTH for copago categorization.
 * It respects the hypothesis engine's capability matrix to ensure:
 * - Opaque sections → Cat Z
 * - Traceable sections with findings → Cat A/B
 * - Traceable sections without findings → Cat OK
 * 
 * CRITICAL: No other part of the code should recalculate these amounts.
 */
export function computeBalanceWithHypotheses(
    hallazgos: any[],  // Using any[] for now since HallazgoInternal is not exported from types.ts
    totalCopagoReal: number,
    capabilityMatrix: CapabilityMatrix,
    pamLines: PAMLineInput[]
): Balance {

    const balance: Balance = {
        totalCopago: totalCopagoReal,
        categories: { A: 0, B: 0, OK: 0, Z: 0 },
        rationaleByCategory: { A: [], B: [], OK: [], Z: [] },
        scopeBreakdown: []
    };

    console.log('[Balance] Starting hypothesis-aware balance calculation');
    console.log(`[Balance] Total Copago: $${totalCopagoReal.toLocaleString()}`);
    console.log(`[Balance] PAM Lines: ${pamLines.length}`);
    console.log(`[Balance] Hallazgos: ${hallazgos.length}`);

    // Log PAM lines for debugging
    if (pamLines.length > 0) {
        console.log('[Balance] PAM Lines Detail:');
        pamLines.forEach((line, idx) => {
            console.log(`  [${idx}] key='${line.key}', desc='${line.desc}', copago=$${line.copago.toLocaleString()}`);
        });
    } else {
        console.warn('[Balance] ⚠️ PAM Lines array is EMPTY - Will use global fallback');
    }

    // Log hallazgos for debugging
    if (hallazgos.length > 0) {
        console.log('[Balance] Hallazgos Detail:');
        hallazgos.slice(0, 3).forEach((h, idx) => {
            console.log(`  [${idx}] titulo='${h.titulo}', monto=$${(h.montoObjetado || 0).toLocaleString()}, cat=${h.categoria_final || 'N/A'}`);
        });
    }

    // FALLBACK: If PAM is empty/unusable, treat entire copago as indeterminate
    if (pamLines.length === 0) {
        console.log('[Balance] ⚠️ FALLBACK MODE: PAM absent - entire copago → Cat Z');
        balance.categories.Z = totalCopagoReal;
        balance.rationaleByCategory.Z.push(
            `Copago total ($${totalCopagoReal.toLocaleString()}): Indeterminable por ausencia de PAM`
        );
        return balance;
    }

    // Step 1: For each PAM line, check if analysis is allowed
    for (const line of pamLines) {
        const scope: HypothesisScope = { type: 'PAM_LINE', pamLineKey: line.key };
        const ctx: RuleContext = { capabilities: capabilityMatrix, currentScope: scope };

        // Check if fine-grained analysis capabilities are available
        const canCalculateTopes = isCapabilityAllowed(ctx, "CALCULO_TOPES_UF_VA_VAM");
        const canValidatePrices = isCapabilityAllowed(ctx, "VALIDACION_PRECIOS_UNITARIOS");
        const canAnalyze = canCalculateTopes && canValidatePrices;

        const scopeBalance: ScopeBalance = {
            scope: { type: 'PAM_LINE', pamLineKey: line.key },
            A: 0,
            B: 0,
            OK: 0,
            Z: 0
        };

        if (!canAnalyze) {
            // BLOCKED BY OPACITY (H1) → Entire line goes to Cat Z
            balance.categories.Z += line.copago;
            scopeBalance.Z = line.copago;

            balance.rationaleByCategory.Z.push(
                `PAM '${line.desc}' ($${line.copago.toLocaleString()}): Indeterminable debido a opacidad estructural (H1 activa)`
            );
            scopeBalance.motivo = "OPACIDAD ESTRUCTURAL (H1): Ítem agrupado sin desglose verificable";

            console.log(`[Balance] PAM '${line.key}': BLOCKED → Cat Z ($${line.copago.toLocaleString()})`);
        } else {
            // ANALYSIS ALLOWED → Apply findings
            console.log(`[Balance] PAM '${line.key}': ALLOWED → Applying findings`);

            // Find hallazgos that apply to this scope (Hardening V6)
            // Priority 1: Explicit FindingScope (New AlphaFold Standard)
            // Priority 2: Legacy Heuristic (Fallback)
            const hallazgosInScope = hallazgos.filter(h => {
                if (h.scope?.type === 'PAM_LINE') {
                    return h.scope.pamLineKey === line.key;
                }
                // Fallback to legacy heuristic if no scope defined
                return isPAMLineRelated(h, line.key);
            });

            let scopeObjetado = 0;

            for (const h of hallazgosInScope) {
                const cat = h.categoria_final || categorizeFinding(h);
                const monto = h.montoObjetado || 0;

                if (cat === 'A') {
                    balance.categories.A += monto;
                    scopeBalance.A += monto;
                    balance.rationaleByCategory.A.push(`${h.titulo || 'Hallazgo'}: $${monto.toLocaleString()}`);
                } else if (cat === 'B') {
                    balance.categories.B += monto;
                    scopeBalance.B += monto;
                    balance.rationaleByCategory.B.push(`${h.titulo || 'Hallazgo'}: $${monto.toLocaleString()}`);
                } else if (cat === 'Z') {
                    balance.categories.Z += monto;
                    scopeBalance.Z += monto;
                    balance.rationaleByCategory.Z.push(`${h.titulo || 'Hallazgo'}: $${monto.toLocaleString()}`);
                }

                scopeObjetado += monto;
            }

            // The rest is Cat OK (no findings)
            let scopeOK = Math.max(0, line.copago - scopeObjetado);

            // 🚨 HARDENING RULE (Z-INFECTION): 
            // If there is ANY Opacity (Cat Z) or partial blocking in this scope, 
            // the remainder CANNOT be "OK". It must be "Z" (Residual Indeterminacy).
            // A line cannot be "Partially Opaque and Partially Clean". Opacity poisons the well.
            if (scopeBalance.Z > 0 && scopeOK > 0) {
                console.log(`[Balance] ☣️ Z-Infection applied to PAM '${line.key}': ${scopeOK} moved from OK to Z.`);
                balance.categories.Z += scopeOK;
                scopeBalance.Z += scopeOK;
                balance.rationaleByCategory.Z.push(
                    `RESIDUAL PAM '${line.desc}': $${scopeOK.toLocaleString()} (Indeterminado por contaminación de Opacidad)`
                );
                scopeBalance.motivo = "CONTAMINACIÓN ESTRUCTURAL: Opacidad parcial invalida el resto del ítem";
                scopeOK = 0; // Wiped
            } else if (scopeOK > 0) {
                balance.categories.OK += scopeOK;
                scopeBalance.OK = scopeOK;
                scopeBalance.motivo = "TRAZABLE: Ítem validado sin hallazgos";
                balance.rationaleByCategory.OK.push(
                    `PAM '${line.desc}': $${scopeOK.toLocaleString()} sin observaciones`
                );
            }

            console.log(`[Balance] PAM '${line.key}': A=$${scopeBalance.A.toLocaleString()}, B=$${scopeBalance.B.toLocaleString()}, OK=$${scopeBalance.OK.toLocaleString()}, Z=$${scopeBalance.Z.toLocaleString()}`);
        }

        balance.scopeBreakdown?.push(scopeBalance);
    }

    // Step 2: Validate closure
    const sum = balance.categories.A + balance.categories.B + balance.categories.OK + balance.categories.Z;
    const diff = Math.abs(sum - totalCopagoReal);

    if (diff > 1) {
        console.error(`[Balance] CLOSURE ERROR: Sum=$${sum.toLocaleString()} vs Total=$${totalCopagoReal.toLocaleString()} (diff=$${diff})`);
        // Adjust Cat OK to force closure (safety mechanism)
        balance.categories.OK += (totalCopagoReal - sum);
        balance.rationaleByCategory.OK.push(`Ajuste de cierre: $${(totalCopagoReal - sum).toLocaleString()}`);
    }

    console.log('[Balance] Final Categories:');
    console.log(`  Cat A (Improcedente): $${balance.categories.A.toLocaleString()}`);
    console.log(`  Cat B (Controversia): $${balance.categories.B.toLocaleString()}`);
    console.log(`  Cat OK (No Observado): $${balance.categories.OK.toLocaleString()}`);
    console.log(`  Cat Z (Indeterminado): $${balance.categories.Z.toLocaleString()}`);

    return balance;
}

/**
 * Determine if a hallazgo is related to a specific PAM line.
 * Heuristic: check if the glosa/description mentions the PAM line key or common keywords.
 */
function isPAMLineRelated(hallazgo: any, pamLineKey: string): boolean {
    const glosa = (hallazgo.glosa || '').toLowerCase();
    const titulo = (hallazgo.titulo || '').toLowerCase();
    const key = pamLineKey.toLowerCase();

    // Check for direct PAM line key mention
    if (glosa.includes(key) || titulo.includes(key)) return true;

    // Check for common category mappings
    if (key.includes('material') && /material|insumo/i.test(glosa + titulo)) return true;
    if (key.includes('medicamento') && /medicamento|farmac/i.test(glosa + titulo)) return true;
    if (key.includes('honorario') && /honorario|medico/i.test(glosa + titulo)) return true;
    if (key.includes('sin_bonif') && /sin bonif|prestacion.*bonif/i.test(glosa + titulo)) return true;

    // Default: assume related if hallazgo doesn't specify a different scope
    // (This is conservative; in production, use explicit pamLineKey in hallazgos)
    return false;
}

/**
 * Legacy categorization logic for findings without categoria_final.
 * 
 * This is a fallback for compatibility with old findings.
 * New code should set categoria_final explicitly.
 */
function categorizeFinding(h: any): 'A' | 'B' | 'Z' {
    // Opacity-related findings → Cat B (controversy)
    if (h.categoria === 'OPACIDAD' || h.codigos === 'OPACIDAD_ESTRUCTURAL') {
        return 'B';
    }

    // Definitive improcedent charges → Cat A
    if (h.tipo_monto === 'COBRO_IMPROCEDENTE' && h.nivel_confianza !== 'BAJA') {
        return 'A';
    }

    // Nutrition with exact match → Cat A
    const isNutrition = h.codigos?.includes('3101306') || /ALIMENTA|NUTRICI/i.test(h.glosa || '');
    if (isNutrition && h.anclajeJson?.includes('MATCH_EXACTO')) {
        return 'A';
    }

    // Gap reconciliation → Cat Z
    if (h.codigos === 'GAP_RECONCILIATION') {
        return 'Z';
    }

    // Default: indeterminate
    return 'Z';
}
