
import { DOCTRINE_RULES, findMatchingDoctrine } from "./server/services/jurisprudence/jurisprudence.doctrine.js";
import { finalizeAudit } from "./server/services/auditEngine.service.js";
import { extractFeatureSet } from "./server/services/jurisprudence/jurisprudence.fingerprint.js";

async function testCanonicalRules() {
    console.log("🧪 Testing Canonical Rules (C01-C05)...");

    const failures: string[] = [];

    // Test 1: C01 - Contract Breach (100% Coverage)
    const setC01 = new Set(["IC_BREACH", "COV_100", "COPAGO_POS"]);
    const ruleC01 = findMatchingDoctrine(setC01);

    if (ruleC01?.id !== "C01_INCUMPLIMIENTO_CONTRATO") {
        failures.push(`❌ C01 Failed: Expected 'C01_INCUMPLIMIENTO_CONTRATO', got '${ruleC01?.id}'`);
    } else {
        console.log("✅ C01 Correctly Identified");
    }

    // Test 2: Unbundling Override (C02 > C05)
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

    // Test 4: Pure Opacity (C05)
    const setC05 = new Set(["OP_DETECTED", "COPAGO_POS"]);
    const ruleC05 = findMatchingDoctrine(setC05);

    if (ruleC05?.id !== "C05_OPACIDAD_REAL") {
        failures.push(`❌ C05 Failed: Expected 'C05_OPACIDAD_REAL', got '${ruleC05?.id}'`);
    } else {
        console.log("✅ C05 Correctly Identified as Residual");
    }

    // Test 5: C01 Medicine Breach (Integrated Feature Extraction)
    console.log("\n🧪 Testing C01 Medicine Breach (Feature Extraction)...");

    // FIX MOCK STRUCTURE: Must be { coberturas: [...] } for fingerprint.ts
    const contractMock = {
        coberturas: [
            { item: "MEDICAMENTO", cobertura: 100, tope: 300, categoria: "MEDICAMENTO" },
            { item: "SEGURO_CATASTROFICO", cobertura: 100, tope: 300, categoria: "SEGURO" }
        ]
    };

    // Use specific description "MEDICAMENTO" to match contract key exactly
    const medFeatureSet = extractFeatureSet(
        { descripcion: "MEDICAMENTO", copago: 5000, bonificacion: 0, codigo: "MED001" },
        contractMock
    );

    if (!medFeatureSet.has("IC_BREACH")) {
        failures.push(`❌ C01 Feature Extraction Failed: Missing 'IC_BREACH'. Features: ${Array.from(medFeatureSet).join(', ')}`);
    } else {
        const ruleMed = findMatchingDoctrine(medFeatureSet);
        if (ruleMed?.id !== "C01_INCUMPLIMIENTO_CONTRATO") {
            failures.push(`❌ C01 Rule Match Failed: Expected 'C01_INCUMPLIMIENTO_CONTRATO', got '${ruleMed?.id}'`);
        } else {
            console.log("✅ C01 Medicine Breach Feature & Rule Verified");
        }
    }

    // Test 6: Global Decision Logic (A > 0 -> STRICT STATE)
    console.log("\n🧪 Testing Global Decision Logic (Strict Override)...");

    const mockFindingsA = [{
        titulo: "Breach Item",
        categoria: "A",
        montoObjetado: 1000, // Use montoObjetado as required by finalizeAudit
        tipo_monto: "COBRO_IMPROCEDENTE",
        nivel_confianza: "ALTA",
        categoria_final: "A"
    }];
    const mockFindingsZ = [{
        titulo: "Opaque Item",
        categoria: "Z",
        montoObjetado: 1000,
        categoria_final: "Z"
    }];
    const mockFindingsMixed = [...mockFindingsA, ...mockFindingsZ];

    // Total Copago Real = 2000
    // sumA=1000, sumZ=1000.
    const resultStrict = finalizeAudit({ hallazgos: mockFindingsMixed }, 2000);

    const expectedState = "CUENTA_IMPUGNABLE_POR_INCUMPLIMIENTO_CONTRACTUAL";
    if (resultStrict.decisionGlobal.estado !== expectedState) {
        failures.push(`❌ Global Decision Failed: Expected '${expectedState}', got '${resultStrict.decisionGlobal.estado}'`);
    } else {
        console.log(`✅ Global Decision '${expectedState}' Correctly Enforced`);
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
