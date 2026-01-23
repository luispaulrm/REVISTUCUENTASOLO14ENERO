
import { finalizeAuditCanonical } from './server/services/auditEngine.service.js';
import { Finding } from './types.js';

// Mock findings based on user's fail case
const mockFindings: Finding[] = [
    {
        id: "A1", category: "A", label: "Instalación vía venosa", amount: 23985,
        action: "IMPUGNAR", evidenceRefs: [], rationale: "Unbundling", hypothesisParent: "H_UNBUNDLING_IF319"
    },
    {
        id: "A2", category: "A", label: "Fleboclisis", amount: 42957,
        action: "IMPUGNAR", evidenceRefs: [], rationale: "Unbundling", hypothesisParent: "H_UNBUNDLING_IF319"
    },
    {
        id: "A3", category: "A", label: "Hotelería", amount: 13044,
        action: "IMPUGNAR", evidenceRefs: [], rationale: "Gasto no médico", hypothesisParent: "H_INCUMPLIMIENTO_CONTRACTUAL"
    },
    {
        id: "Z1", category: "Z", label: "GENERICO OPACIDAD", amount: 351469,
        action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: "Opacidad estructural", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    },
    {
        id: "A_BREACH", category: "Z", label: "MEDICAMENTOS 100% COBERTURA", amount: 50000,
        action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: "Sin desglose pero Cobertura 100% contrato. Opacidad presente.", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    }
];

const TOTAL_COPAGO_INFORMADO = 502175; // Increased by 50k

console.log("=== RUNNING ACCOUNTING VERIFICATION ===");
console.log(`Total Copago: ${TOTAL_COPAGO_INFORMADO}`);
console.log(`Cat A Explicit Sum: ${23985 + 42957 + 13044}`); // Base A
console.log(`Cat A Breach Sum: 50000`); // New A
console.log(`Expected Total A: ${79986 + 50000}`); // 129986

try {
    const result = finalizeAuditCanonical({
        findings: mockFindings,
        totalCopago: TOTAL_COPAGO_INFORMADO,
        reconstructible: false,
        pamState: "OPACO",
        signals: [],
        contract: { coberturas: [] },
        ceilings: { canVerify: false },
        violations: []
    });

    console.log("\n=== RESULT RESOLVED ===");
    console.log(`Estado Global: ${result.estadoGlobal}`);
    console.log("Balance:", result.balance);
    console.log("Resumen Financiero:", result.resumenFinanciero);
    console.log("Debug / Errors:", result.debug);

    // Assertions
    const sumA = result.balance.A;
    const sumZ = result.balance.Z;
    const expectedA = 129986; // 79986 + 50000

    if (sumA !== expectedA) {
        console.error(`[FAIL] A Mismatch! Expected ${expectedA}, got ${sumA}`);
    } else {
        console.log(`[PASS] A Matches matches explicit items + Breach item.`);
    }

    const residual = TOTAL_COPAGO_INFORMADO - expectedA;
    if (sumZ > residual) {
        console.error(`[FAIL] Z Exceeds Residual! Z=${sumZ}, Residual=${residual}`);
    } else {
        console.log(`[PASS] Z=${sumZ} is within residual limits.`);
    }

    if (result.balance.TOTAL !== TOTAL_COPAGO_INFORMADO) {
        console.error(`[FAIL] Invariant Broken! Total=${result.balance.TOTAL}, Expected=${TOTAL_COPAGO_INFORMADO}`);
    } else {
        console.log("[PASS] Total Invariant OK.");
    }

    // Check score
    if (result.resumenFinanciero.auditor_score !== undefined) {
        console.log(`[PASS] Score calculated: ${result.resumenFinanciero.auditor_score}`);
    } else {
        console.error("[FAIL] Score missing!");
    }


} catch (e) {
    console.error("CRITICAL ERROR:", e);
}
