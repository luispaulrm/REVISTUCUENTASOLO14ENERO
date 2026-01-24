
import { finalizeAuditCanonical } from './server/services/auditEngine.service.js';
import { Finding } from './types.js';

console.log("=== VERIFYING FORENSIC INTEGRITY & NON-CONTRADICTION ===");

const totalCopago = 5285788;

const mockFindings: Finding[] = [
    {
        id: "Unbundling1",
        category: "A",
        label: "INSUMOS NO ARANCELADOS (UNBUNDLING)",
        amount: 129930,
        action: "IMPUGNAR",
        evidenceRefs: [],
        rationale: "Unbundling detected. Included in surgical fee.",
        hypothesisParent: "H_UNBUNDLING_IF319"
    },
    {
        id: "Opacity1",
        category: "A", // Initial wrong category (from LLM)
        label: "MATERIALES CLINICOS",
        amount: 1124427,
        action: "IMPUGNAR",
        evidenceRefs: [],
        rationale: "[C05] Indeterminación real. Se aplica Ley 20.584 como norma de cierre (Cat Z).",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    },
    {
        id: "Global1",
        category: "Z",
        label: "OPACIDAD ESTRUCTURAL GLOBAL",
        amount: 5051508,
        action: "SOLICITAR_ACLARACION",
        evidenceRefs: [],
        rationale: "Resumen de opacidad global",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    }
];

const result = finalizeAuditCanonical({
    findings: mockFindings,
    totalCopago: totalCopago,
    reconstructible: false,
    signals: []
});

console.log("\nBalance Results:");
console.log(`Cat A (Confirmed): $${result.balance.A}`);
console.log(`Cat Z (Indeterminate): $${result.balance.Z}`);
console.log(`Cat OK (Legitimate): $${result.balance.OK}`);
console.log(`Total informed: $${result.balance.TOTAL}`);

// ASSERTIONS
console.log("\nAssertions:");

// 1. Cat Z Force (Rule V-01)
const matFinding = result.findings.find(f => f.id === "Opacity1");
if (matFinding && matFinding.category === "Z") {
    console.log("[PASS] 'Opacity1' was strictly forced to Category Z due to 'Ley 20.584' in rationale.");
} else {
    console.log(`[FAIL] 'Opacity1' classification failed. Got: ${matFinding?.category}`);
}

// 2. Arithmetic Netting & No Capping (Rule R-BAL-01)
// In the input: A(129k) + Z(1.1M) + Global(5M) = ~6.2M. Total = 5.2M.
// With aggressive netting:
// A(129k) survives.
// Opacity1(1.1M) survives as Z.
// Global1(5M) nets against A(129k) and Opacity1(1.1M) because it's a GLOBAL macro.
// Global1_Net = 5M - 129k - 1.1M = ~3.7M.
// Total = 129k + 1.1M + 3.7M = ~5.0M.
// Effective OK = 5.2M - 5.0M = ~0.2M.

if (result.balance.OK > 0 && result.balance.TOTAL === totalCopago) {
    console.log(`[PASS] Accounting is balanced without overflows. Residual OK: $${result.balance.OK}`);
} else if (result.balance.TOTAL > totalCopago) {
    console.log("[FAIL] Sum exceeds total. Netting failed.");
}

// 3. No ALERTA_BALANCE (cappingConfess)
const hasCapAlert = result.debug.some(d => d.includes("Capado para balance"));
if (!hasCapAlert) {
    console.log("[PASS] No arithmetic 'fudging' (capping) detected.");
} else {
    console.log("[FAIL] Arithmetic capping still present.");
}

console.log("\n=== VERIFICATION COMPLETE ===");
