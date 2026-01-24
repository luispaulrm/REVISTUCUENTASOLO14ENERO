
import { ArithmeticReconstructor, reconstructAllOpaque } from './services/reconstruction.service.js';

async function testIntraopMedication() {
    console.log("=== STARTING INTRAOPERATIVE MEDICATION VERIFICATION ===");

    const mockBill = {
        sections: [
            {
                category: "FARMACIA PABELLON",
                items: [
                    { index: 1, description: "ROCURONIO 50MG/5 ML", total: 33042 },
                    { index: 2, description: "FENTANYL 10 ML (ESTUPEF)", total: 5293 },
                    { index: 3, description: "PROPOFOL 200 MG.X 20 ML", total: 27168 }
                ]
            }
        ]
    } as any;

    const findings = [
        { id: "A", label: "Pabellón", amount: 65503, rationale: "Base" } // Sum of 1+2+3
    ] as any;

    console.log("\n[Test] Running reconstructAllOpaque for intraoperative meds...");
    const results = reconstructAllOpaque(mockBill, findings);

    results.forEach(f => {
        console.log(`\nFinding: ${f.label}`);
        console.log(`- Amount: ${f.amount}`);
        if (f.rationale.includes("intraoperatoria desagregada")) {
            console.log("  [PASS] Correct intraoperative drug normative text found.");
        } else {
            console.log("  [FAIL] Missing expected normative text for intraoperative meds.");
        }

        if (f.label.includes("Identificado Forense")) {
            console.log("  [PASS] Label correctly updated.");
        }
    });

    console.log("\n=== INTRAOPERATIVE MEDICATION TEST COMPLETE ===");
}

testIntraopMedication().catch(console.error);
