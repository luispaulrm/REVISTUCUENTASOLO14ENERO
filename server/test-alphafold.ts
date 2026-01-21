
import { AlphaFoldService } from './services/alphaFold.service.ts';

const mockPamOpaque = {
    items: [
        { descripcion: "MATERIALES CLINICOS", copago: 50000 },
        { descripcion: "MEDICAMENTOS", copago: 30000 }
    ]
};

const mockPamDetailed = {
    items: [
        { descripcion: "JERINGA 5ML", copago: 500 },
        { descripcion: "PARACETAMOL", copago: 300 }
    ]
};

const mockCuentaUnbundled = {
    sections: [
        { items: [{ description: "DIA CAMA", total: 100000 }] },
        { items: [{ description: "TOALLA DESECHABLE", total: 5000 }] } // Hotel item
    ]
};

const mockCuentaClean = {
    sections: [
        { items: [{ description: "DIA CAMA", total: 100000 }] }
    ]
};

const mockContrato = { coberturas: [{ modalidad: "HOSPITALARIO" }] };

async function runTest() {
    console.log("=== TEST 1: OPAQUE PAM ===");
    const signals1 = AlphaFoldService.extractSignals({ pam: mockPamOpaque, cuenta: mockCuentaClean, contrato: mockContrato });
    const pamState1 = AlphaFoldService.detectPamState(signals1);
    const hypo1 = AlphaFoldService.scoreHypotheses(signals1, pamState1);

    console.log("PAM State:", pamState1);
    console.log("H_OPACIDAD_ESTRUCTURAL:", hypo1.find(h => h.hypothesis === "H_OPACIDAD_ESTRUCTURAL")?.confidence);

    if (pamState1 === "OPACO" && (hypo1.find(h => h.hypothesis === "H_OPACIDAD_ESTRUCTURAL")?.confidence || 0) > 0.8) {
        console.log("✅ PASS");
    } else {
        console.log("❌ FAIL");
    }

    console.log("\n=== TEST 2: DETAILED PAM ===");
    const signals2 = AlphaFoldService.extractSignals({ pam: mockPamDetailed, cuenta: mockCuentaClean, contrato: mockContrato });
    const pamState2 = AlphaFoldService.detectPamState(signals2);
    const hypo2 = AlphaFoldService.scoreHypotheses(signals2, pamState2);

    console.log("PAM State:", pamState2);
    if (pamState2 === "DETALLADO" && (hypo2.find(h => h.hypothesis === "H_OPACIDAD_ESTRUCTURAL")?.confidence || 0) < 0.5) {
        console.log("✅ PASS");
    } else {
        console.log("❌ FAIL");
    }

    console.log("\n=== TEST 3: UNBUNDLING (Hotel Items) ===");
    const signals3 = AlphaFoldService.extractSignals({ pam: mockPamDetailed, cuenta: mockCuentaUnbundled, contrato: mockContrato });
    const hypo3 = AlphaFoldService.scoreHypotheses(signals3, "DETALLADO");
    const unbundling = hypo3.find(h => h.hypothesis === "H_UNBUNDLING_IF319")?.confidence;

    console.log("Unbundling Confidence:", unbundling);
    if ((unbundling || 0) > 0.5) {
        console.log("✅ PASS");
    } else {
        console.log("❌ FAIL");
    }
}

runTest();
