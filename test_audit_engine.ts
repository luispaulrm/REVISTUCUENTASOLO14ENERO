
import { DOCTRINE_RULES, findMatchingDoctrine } from "./server/services/jurisprudence/jurisprudence.doctrine.js";
import { finalizeAudit } from "./server/services/auditEngine.service.js";

async function testCanonicalRules() {
    console.log("🧪 Testing Canonical Rules (C01-C05)...");

    const failures = [];

    // Test 1: C01 - Contract Breach (100% Coverage)
    const setC01 = new Set(["IC_BREACH", "COV_100", "COPAGO_POS"]);
    const ruleC01 = findMatchingDoctrine(setC01);

    if (ruleC01?.id !== "C01_INCUMPLIMIENTO_CONTRATO") {
        failures.push(`❌ C01 Failed: Expected 'C01_INCUMPLIMIENTO_CONTRATO', got '${ruleC01?.id}'`);
    } else {
        console.log("✅ C01 Correctly Identified");
    }

    // Test 2: Unbundling Override (C02 > C05)
    // Even if we detect opacidad (OP_DETECTED), UB_DETECTED should win
    const setC02 = new Set(["UB_DETECTED", "OP_DETECTED", "COPAGO_POS"]);
    const ruleC02 = findMatchingDoctrine(setC02);

    if (ruleC02?.id !== "C02_UNBUNDLING") {
        failures.push(`❌ C02 Override Failed: Expected 'C02_UNBUNDLING', got '${ruleC02?.id}'`);
    } else {
        console.log("✅ C02 Correctly Overrides Opacity");
    }

    // Test 3: Technical Inference (C03)
    const setC03 = new Set(["HT_DETECTED", "COPAGO_POS"]);
    const ruleC03 = findMatchingDoctrine(setC03);

    if (ruleC03?.id !== "C03_INFERENCIA_TECNICA") {
        failures.push(`❌ C03 Failed: Expected 'C03_INFERENCIA_TECNICA', got '${ruleC03?.id}'`);
    } else {
        console.log("✅ C03 Correctly Identified");
    }

    // Test 4: Pure Opacity (C05) - Should strictly fail if C01/C02/C03 flags are present
    const setC05 = new Set(["OP_DETECTED", "COPAGO_POS"]);
    const ruleC05 = findMatchingDoctrine(setC05);

    if (ruleC05?.id !== "C05_OPACIDAD_REAL") {
        failures.push(`❌ C05 Failed: Expected 'C05_OPACIDAD_REAL', got '${ruleC05?.id}'`);
    } else {
        console.log("✅ C05 Correctly Identified as Residual");
    }

    // Test 5: Global Decision Logic (A > 0 and Z > 0 -> CUENTA_IMPUGNABLE_COMPLETA)
    console.log("\n🧪 Testing Global Decision Logic...");

    const mockFindingsA = [{ categoria_final: "A", montoObjetado: 1000 }];
    const mockFindingsZ = [{ categoria_final: "Z", montoObjetado: 1000 }];
    const mockFindingsMixed = [...mockFindingsA, ...mockFindingsZ];

    const resultMixed = finalizeAudit({ hallazgos: mockFindingsMixed }, 2000);

    if (resultMixed.decisionGlobal.estado !== "CUENTA_IMPUGNABLE_COMPLETA") {
        failures.push(`❌ Global Decision Failed: Expected 'CUENTA_IMPUGNABLE_COMPLETA', got '${resultMixed.decisionGlobal.estado}'`);
    } else {
        console.log("✅ Global Decision 'CUENTA_IMPUGNABLE_COMPLETA' Correct");
    }

    if (failures.length > 0) {
        console.error("\n❌ TESTS FAILED:");
        failures.forEach(f => console.error(f));
        process.exit(1);
    } else {
        console.log("\n🎉 ALL TESTS PASSED!");
    }
}

testCanonicalRules().catch(console.error);
