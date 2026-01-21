
import { AlphaFoldService } from './services/alphaFold.service.js';

const mockPamOpaque = {
    items: [
        { descripcion: "MATERIALES CLINICOS AGRUPADOS", copago: 100000 }, // Opaque
        { descripcion: "MEDICAMENTOS", copago: 50000 }
    ]
};

const mockCuentaUnbundled = {
    sections: [
        { items: [{ description: "DIA CAMA", total: 100000 }] },
        { description: "HOTELERIA", items: [{ description: "TOALLA DE BAÑO", total: 5000 }] } // Unbundling
    ]
};

const mockContrato = { coberturas: [{ modalidad: "HOSPITALARIO" }] };

async function runTest() {
    console.log("=== PH3 TEST 1: OPACITY FINDINGS & BALANCE ===");
    const input1 = { pam: mockPamOpaque, cuenta: { sections: [] }, contrato: mockContrato };
    const signals1 = AlphaFoldService.extractSignals(input1);
    const pamState1 = AlphaFoldService.detectPamState(signals1);
    const ranking1 = AlphaFoldService.scoreHypotheses(signals1, pamState1);
    const active1 = AlphaFoldService.activateContexts(ranking1, pamState1);
    const findings1 = AlphaFoldService.buildFindings(input1, pamState1, active1);
    const balance1 = AlphaFoldService.buildBalance(150000, findings1); // Total copay matches items

    console.log("Active Hypotheses:", active1);
    console.log("Findings:", findings1.map(f => `${f.id} ($${f.amount})`));
    console.log("Balance:", balance1);

    if (active1.includes("H_OPACIDAD_ESTRUCTURAL") && balance1.Z === 150000 && balance1.OK === 0) {
        console.log("✅ PASS: Correctly classified 100% as Opacity (Z)");
    } else {
        console.log("❌ FAIL");
    }

    console.log("\n=== PH3 TEST 2: UNBUNDLING FINDINGS ===");
    const input2 = { pam: { items: [] }, cuenta: mockCuentaUnbundled, contrato: mockContrato };
    const signals2 = AlphaFoldService.extractSignals(input2);
    const pamState2 = "DETALLADO"; // Force detailed for this test
    const ranking2 = AlphaFoldService.scoreHypotheses(signals2, pamState2);
    const active2 = AlphaFoldService.activateContexts(ranking2, pamState2);
    const findings2 = AlphaFoldService.buildFindings(input2, pamState2, active2);

    console.log("Active Hypotheses:", active2);
    console.log("Findings:", findings2.map(f => `${f.id} ($${f.amount})`));

    const fHotel = findings2.find(f => f.id === "F_UNBUNDLING_HOTELERIA");
    if (active2.includes("H_UNBUNDLING_IF319") && fHotel && fHotel.category === "A" && fHotel.amount === 5000) {
        console.log("✅ PASS: Correctly punished Hotel as Cat A");
    } else {
        console.log("❌ FAIL: " + JSON.stringify(findings2));
    }
}

runTest();
