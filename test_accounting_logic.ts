
import { reconstructAllOpaque } from './server/services/reconstruction.service.js';
import { finalizeAuditCanonical } from './server/services/auditEngine.service.js';
import { Finding } from './types.js';

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

const totalCopago = 452175;

const mockFindings: Finding[] = [
    // SPECIFIC PAM LINES (Z)
    { id: "PAM_1", category: "Z", label: "MEDICAMENTOS CLINICOS EN HOSPITALIZACION", amount: 134100, action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: ".", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL" },
    { id: "PAM_2", category: "Z", label: "MATERIALES CLINICOS EN HOSPITALIZACION", amount: 32716, action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: ".", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL" },
    { id: "PAM_3", category: "Z", label: "GASTOS NO CUBIERTOS POR EL PLAN", amount: 184653, action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: ".", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL" },
    { id: "PAM_4", category: "Z", label: "GASTOS NO CUBIERTOS POR EL PLAN", amount: 13044, action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: ".", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL" },
    { id: "PAM_5", category: "Z", label: "CONSULTA DE URGENCIA", amount: 12106, action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: ".", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL" },

    // REDUNDANT GLOBAL FINDING (The sum of the above is ~376k)
    { id: "GLOBAL_1", category: "Z", label: "GENERICO / GNC || MEDICAMENTOS, MATERIALES Y GASTOS NO CUBIERTOS", amount: 376619, action: "SOLICITAR_ACLARACION", evidenceRefs: [], rationale: ".", hypothesisParent: "H_OPACIDAD_ESTRUCTURAL" },

    // OTHER FINDING (Unbundling A)
    { id: "UNB_1", category: "A", label: "INSTALACION DE VIA VENOSA / FLEBOCLISIS", amount: 66942, action: "IMPUGNAR", evidenceRefs: [], rationale: ".", hypothesisParent: "H_UNBUNDLING_IF319" }
];

console.log("Running Invariant & Subsumption Verification...");

const result = finalizeAuditCanonical({
    findings: mockFindings,
    totalCopago: totalCopago,
    reconstructible: true,
    accountContext: mockBill,
    signals: [],
    violations: []
});

console.log("Final Balance:", result.balance);
console.log("Findings Count:", result.findings.length);

const aSum = result.balance.A;
const totalAplusZ = result.balance.A + result.balance.Z + result.balance.B + result.balance.OK;

console.log(`TOTAL A+Z+...: ${totalAplusZ} (Target: ${totalCopago})`);

const globalFindingFound = result.findings.some(f => f.label.includes("GENERICO"));

if (globalFindingFound) {
    console.log("❌ FAIL: Global redundant finding was NOT subsumed!");
} else {
    console.log("✅ SUCCESS: Global redundant finding was properly subsumed.");
}

if (Math.abs(totalAplusZ - totalCopago) <= 1) {
    console.log("✅ SUCCESS: Accounting Invariant maintained.");
} else {
    console.log(`❌ FAIL: Invariant broken! Gap: ${totalAplusZ - totalCopago}`);
    process.exit(1);
}

if (result.balance.A > totalCopago) {
    console.log("❌ FAIL: Confirmed Savings A exceeds Total Copay!");
    process.exit(1);
} else {
    console.log("✅ SUCCESS: Savings A is within physical limits.");
}
