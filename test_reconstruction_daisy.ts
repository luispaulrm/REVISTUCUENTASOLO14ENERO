
import { ArithmeticReconstructor, reconstructAllOpaque } from './server/services/reconstruction.service.js';
import { ExtractedAccount, Finding } from './src/types.js';

const mockBill: any = {
    clinicName: "CLINICA INDISA",
    patientName: "MUÑOZ VILUGRON DAYSI ESTER",
    invoiceNumber: "862.271",
    date: "26-09-2025",
    currency: "CLP",
    sections: [
        {
            category: "Medicamentos y Materiales MEDICAMENTOS",
            items: [
                { description: "CEFTRIAXONA 1G (ACANTEX)", total: 102588, quantity: 2, unitPrice: 51294, calculatedTotal: 0, hasCalculationError: false },
                { description: "METRONIDAZOL 500 MG. INY", total: 9174, quantity: 2, unitPrice: 4587, calculatedTotal: 0, hasCalculationError: false },
                { description: "PARACETAMOL 1G/100ML", total: 31148, quantity: 2, unitPrice: 15574, calculatedTotal: 0, hasCalculationError: false },
                { description: "KETOPROFENO 100MG EV", total: 20268, quantity: 3, unitPrice: 6756, calculatedTotal: 0, hasCalculationError: false },
                { description: "LEVOSULPIRIDE 25 MG (DISP)", total: 19635, quantity: 3, unitPrice: 6545, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 20 ML", total: 1208, quantity: 1, unitPrice: 1208, calculatedTotal: 0, hasCalculationError: false },
                { description: "CEFTRIAXONA 1G (ACANTEX)", total: 51294, quantity: 1, unitPrice: 51294, calculatedTotal: 0, hasCalculationError: false },
                { description: "CETRIAXONA 1G (ACANTEX)", total: 102588, quantity: 2, unitPrice: 51294, calculatedTotal: 0, hasCalculationError: false },
                { description: "METRONIDAZOL 500 MG. INY", total: 4587, quantity: 1, unitPrice: 4587, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 20 ML", total: 1208, quantity: 1, unitPrice: 1208, calculatedTotal: 0, hasCalculationError: false },
                { description: "ONDANSETRON 4 MG", total: 15716, quantity: 1, unitPrice: 15716, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 500 CC", total: 2344, quantity: 1, unitPrice: 2344, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 100 ML", total: 3401, quantity: 1, unitPrice: 3401, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 20 ML", total: 1208, quantity: 1, unitPrice: 1208, calculatedTotal: 0, hasCalculationError: false }
            ],
            sectionTotal: 0, calculatedSectionTotal: 0, hasSectionError: false
        },
        {
            category: "Farmacia En Pabellon MEDICAMENTOS",
            items: [
                { description: "ATROPINA SULFATO 1 MG", total: 862, quantity: 1, unitPrice: 862, calculatedTotal: 0, hasCalculationError: false },
                { description: "EFEDRINA 60 MG/ML", total: 1885, quantity: 1, unitPrice: 1885, calculatedTotal: 0, hasCalculationError: false },
                { description: "DEXAMETASONA 4 MG. INY", total: 1790, quantity: 2, unitPrice: 895, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 1000 ML", total: 3589, quantity: 1, unitPrice: 3589, calculatedTotal: 0, hasCalculationError: false },
                { description: "LIDOCAINA 2 % 10 ML.", total: 721, quantity: 1, unitPrice: 721, calculatedTotal: 0, hasCalculationError: false }
            ],
            sectionTotal: 0, calculatedSectionTotal: 0, hasSectionError: false
        },
        {
            category: "Farmacia En Pabellon INSUMOS",
            items: [
                { description: "JERINGA 3 cc EMBUTIDA", total: 964, quantity: 2, unitPrice: 482, calculatedTotal: 0, hasCalculationError: false },
                { description: "EQUIPO FLEBOCLISIS REF", total: 729, quantity: 1, unitPrice: 729, calculatedTotal: 0, hasCalculationError: false },
                { description: "JERINGA 20 cc. EMBUTIDA", total: 3714, quantity: 6, unitPrice: 619, calculatedTotal: 0, hasCalculationError: false },
                { description: "CANULA MAYO 90MM GDE", total: 2054, quantity: 1, unitPrice: 2054, calculatedTotal: 0, hasCalculationError: false },
                { description: "DELANTAL ESTERIL TALLA L", total: 29686, quantity: 2, unitPrice: 14843, calculatedTotal: 0, hasCalculationError: false }
            ],
            sectionTotal: 0, calculatedSectionTotal: 0, hasSectionError: false
        }
    ],
    clinicStatedTotal: 0, extractedTotal: 0, totalItems: 0, isBalanced: true, discrepancy: 0
};



const mockFindings: Finding[] = [
    {
        id: "f1",
        category: "Z",
        label: "MEDICAMENTOS CLINICOS EN HOSPITALIZACION",
        amount: 134100,
        action: "SOLICITAR_ACLARACION",
        evidenceRefs: [],
        rationale: "Opacidad detectada.",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    },
    {
        id: "f2",
        category: "Z",
        label: "GASTOS NO CUBIERTOS POR EL PLAN",
        amount: 184653,
        action: "SOLICITAR_ACLARACION",
        evidenceRefs: [],
        rationale: "Opacidad detectada.",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    }
];

console.log("Running Reconstruction Verification...");

const finalFindings = reconstructAllOpaque(mockBill, mockFindings);

finalFindings.forEach(f => {
    console.log(`Finding: ${f.label} [Cat ${f.category}]`);
    if (f.category === 'A') {
        console.log("✅ Successfully Reconstructed!");
        console.log("Rationale Snippet:", f.rationale.substring(f.rationale.indexOf("DETALLE")));
    } else {
        console.log("❌ Failed to Reconstruct");
    }
});

if (finalFindings.every(f => f.category === 'A')) {
    console.log("\n🎉 ALL TARGETS RECONSTRUCTED SUCCESSFULLY!");
} else {
    console.log("\n⚠️ SOME TARGETS FAILED RECONSTRUCTION.");
    process.exit(1);
}
