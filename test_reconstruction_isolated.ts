
import { reconstructAllOpaque } from './server/services/reconstruction.service.js';
import { Finding } from './src/types.js';

const mockBill: any = {
    sections: [
        {
            category: "Medicamentos y Materiales MEDICAMENTOS",
            items: [
                { description: "CEFTRIAXONA 1G (ACANTEX)", total: 102588, index: 14, calculatedTotal: 0, hasCalculationError: false },
                { description: "METRONIDAZOL 500 MG. INY", total: 9174, index: 15, calculatedTotal: 0, hasCalculationError: false },
                { description: "PARACETAMOL 1G/100ML", total: 31148, index: 16, calculatedTotal: 0, hasCalculationError: false },
                { description: "KETOPROFENO 100MG EV", total: 20268, index: 17, calculatedTotal: 0, hasCalculationError: false },
                { description: "LEVOSULPIRIDE 25 MG (DISP)", total: 19635, index: 18, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 20 ML", total: 1208, index: 19, calculatedTotal: 0, hasCalculationError: false },
                { description: "CEFTRIAXONA 1G (ACANTEX)", total: 51294, index: 20, calculatedTotal: 0, hasCalculationError: false },
                { description: "CEFTRIAXONA 1G (ACANTEX)", total: 102588, index: 101, calculatedTotal: 0, hasCalculationError: false },
                { description: "METRONIDAZOL 500 MG. INY", total: 4587, index: 102, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 20 ML", total: 1208, index: 103, calculatedTotal: 0, hasCalculationError: false },
                { description: "ONDANSETRON 4 MG", total: 15716, index: 104, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 500 CC", total: 2344, index: 105, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 100 ML", total: 3401, index: 106, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 20 ML", total: 1208, index: 107, calculatedTotal: 0, hasCalculationError: false }
            ]
        },
        {
            category: "Farmacia En Pabellon MEDICAMENTOS",
            items: [
                { description: "ATROPINA SULFATO 1 MG", total: 862, index: 56, calculatedTotal: 0, hasCalculationError: false },
                { description: "EFEDRINA 60 MG/ML", total: 1885, index: 58, calculatedTotal: 0, hasCalculationError: false },
                { description: "DEXAMETASONA 4 MG. INY", total: 1790, index: 62, calculatedTotal: 0, hasCalculationError: false },
                { description: "SUERO FISIOLOGICO 1000 ML", total: 3589, index: 63, calculatedTotal: 0, hasCalculationError: false },
                { description: "LIDOCAINA 2 % 10 ML.", total: 721, index: 70, calculatedTotal: 0, hasCalculationError: false }
            ]
        },
        {
            category: "Farmacia En Pabellon INSUMOS",
            items: [
                { description: "JERINGA 3 cc EMBUTIDA", total: 964, index: 23, calculatedTotal: 0, hasCalculationError: false },
                { description: "EQUIPO FLEBOCLISIS REF", total: 729, index: 25, calculatedTotal: 0, hasCalculationError: false },
                { description: "JERINGA 20 cc. EMBUTIDA", total: 3714, index: 37, calculatedTotal: 0, hasCalculationError: false },
                { description: "CANULA MAYO 90MM GDE", total: 2054, index: 38, calculatedTotal: 0, hasCalculationError: false },
                { description: "SONDA ASPIRACION N16", total: 1094, index: 50, calculatedTotal: 0, hasCalculationError: false },
                { description: "AGUJA DESECHABLE 18G", total: 261, index: 24, calculatedTotal: 0, hasCalculationError: false },
                { description: "JERINGA 5 cc. EMBUTIDA", total: 752, index: 35, calculatedTotal: 0, hasCalculationError: false },
                { description: "LUBRICANTE OCULAR (THEAL", total: 668, index: 66, calculatedTotal: 0, hasCalculationError: false }
            ]
        }
    ]
};

const mockFindings: Finding[] = [
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

console.log("Running ISOLATED Reconstruction Verification for finding $184,653...");

const finalFindings = reconstructAllOpaque(mockBill, mockFindings);

finalFindings.forEach(f => {
    console.log(`Finding: ${f.label} [Cat ${f.category}]`);
    if (f.category === 'A') {
        console.log("✅ Successfully Reconstructed!");
    } else {
        console.log("❌ Failed to Reconstruct");
    }
});
