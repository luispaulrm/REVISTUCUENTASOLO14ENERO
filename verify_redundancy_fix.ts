
import { finalizeAuditCanonical } from './server/services/auditEngine.service.js';
import { Finding } from './types.js';

console.log("=== VERIFYING REDUNDANCY FIX (ARITHMETIC NETTING) ===");

const totalCopago = 1000000;

const mockFindings: Finding[] = [
    {
        id: "Micro1",
        category: "A",
        label: "Doble Cobro / Unbundling Específico",
        amount: 200000,
        action: "IMPUGNAR",
        evidenceRefs: ["PAM:3201001", "BILL:1"],
        rationale: "Unbundling detected",
        hypothesisParent: "H_UNBUNDLING_IF319"
    },
    {
        id: "Macro1",
        category: "Z",
        label: "OPACIDAD GLOBAL MATERIALES",
        amount: 800000,
        action: "SOLICITAR_ACLARACION",
        evidenceRefs: ["PAM:3201001"],
        rationale: "Materiales sin detalle",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    }
];

const result = finalizeAuditCanonical({
    findings: mockFindings,
    totalCopago: totalCopago,
    reconstructible: false,
    signals: []
});

console.log("\nResults:");
console.log(`Cat A: $${result.balance.A}`);
console.log(`Cat Z: $${result.balance.Z}`);
console.log(`Total informed: $${result.balance.TOTAL}`);

// Expected:
// Micro1 stays as $200k (A)
// Macro1 is netted: $800k - $200k = $600k (Z)
// Total Copago Balanced: 200k + 600k + 200k (OK) = 1,000,000

if (result.balance.A === 200000 && result.balance.Z === 600000) {
    console.log("\n[PASS] Arithmetic netting worked! Macro finding was reduced by the Micro overlap.");
} else {
    console.log(`\n[FAIL] Arithmetic netting failed. A=${result.balance.A}, Z=${result.balance.Z}`);
}

const macroFinding = result.findings.find(f => f.id === "Macro1");
if (macroFinding && macroFinding.label.includes("Neto / Remanente")) {
    console.log("[PASS] Label updated to show netting.");
}

console.log("\nFinancial Summary Mapping Check:");
console.log(`copagos_bajo_controversia: ${result.resumenFinanciero.copagos_bajo_controversia}`);
console.log(`monto_indeterminado: ${result.resumenFinanciero.monto_indeterminado}`);

if (result.resumenFinanciero.monto_indeterminado === result.balance.Z) {
    console.log("[PASS] Property 'monto_indeterminado' correctly mapped to balance.Z");
} else {
    console.log("[FAIL] Property mapping error.");
}
