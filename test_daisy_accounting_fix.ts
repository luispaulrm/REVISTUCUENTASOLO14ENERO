
import { finalizeAuditCanonical } from './server/services/auditEngine.service.js';
import { Finding, ExtractedAccount } from './src/types.js';

const mockBill: ExtractedAccount = {
    clinicName: "CLINICA INDISA",
    patientName: "DAISY MUÑOZ",
    invoiceNumber: "862.271",
    date: "2025-09-26",
    currency: "CLP",
    sections: [
        {
            category: "Medicamentos y Materiales MEDICAMENTOS",
            sectionTotal: 134100,
            calculatedSectionTotal: 134100,
            hasSectionError: false,
            isTaxConfusion: false,
            isUnjustifiedCharge: false,
            items: [
                { description: "SURGITIE POLYSORB LOOP", total: 127726, index: 14, calculatedTotal: 127726, hasCalculationError: false, quantity: 1, unitPrice: 127726, valorIsa: 127726, bonificacion: 0, copago: 0, billingModel: "MULTIPLICATIVE_EXACT", authoritativeTotal: 127726, unitPriceTrust: 1, qtyIsProration: false, suspectedColumnShift: false, toleranceApplied: 0 },
                { description: "SUERO FISIOLOGICO 20 ML", total: 6040, index: 15, calculatedTotal: 6040, hasCalculationError: false, quantity: 1, unitPrice: 6040, valorIsa: 6040, bonificacion: 0, copago: 0, billingModel: "MULTIPLICATIVE_EXACT", authoritativeTotal: 6040, unitPriceTrust: 1, qtyIsProration: false, suspectedColumnShift: false, toleranceApplied: 0 },
                { description: "TUBO VERDE 4,0 ML/HEPARI", total: 243, index: 16, calculatedTotal: 243, hasCalculationError: false, quantity: 1, unitPrice: 243, valorIsa: 243, bonificacion: 0, copago: 0, billingModel: "MULTIPLICATIVE_EXACT", authoritativeTotal: 243, unitPriceTrust: 1, qtyIsProration: false, suspectedColumnShift: false, toleranceApplied: 0 },
                { description: "TORULA ALGODON 0,5GR", total: 92, index: 17, calculatedTotal: 92, hasCalculationError: false, quantity: 1, unitPrice: 92, valorIsa: 92, bonificacion: 0, copago: 0, billingModel: "MULTIPLICATIVE_EXACT", authoritativeTotal: 92, unitPriceTrust: 1, qtyIsProration: false, suspectedColumnShift: false, toleranceApplied: 0 }
            ]
        },
        {
            category: "OTROS PROC.DIAG.Y TERAPEUTICOS",
            sectionTotal: 66942,
            calculatedSectionTotal: 66942,
            hasSectionError: false,
            isTaxConfusion: false,
            isUnjustifiedCharge: false,
            items: [
                { description: "INSTALACION DE VIA VENOSA", total: 23985, index: 133, calculatedTotal: 23985, hasCalculationError: false, quantity: 1, unitPrice: 23985, valorIsa: 23985, bonificacion: 0, copago: 0, billingModel: "MULTIPLICATIVE_EXACT", authoritativeTotal: 23985, unitPriceTrust: 1, qtyIsProration: false, suspectedColumnShift: false, toleranceApplied: 0 },
                { description: "FLEBOCLISIS", total: 42957, index: 134, calculatedTotal: 42957, hasCalculationError: false, quantity: 1, unitPrice: 42957, valorIsa: 42957, bonificacion: 0, copago: 0, billingModel: "MULTIPLICATIVE_EXACT", authoritativeTotal: 42957, unitPriceTrust: 1, qtyIsProration: false, suspectedColumnShift: false, toleranceApplied: 0 }
            ]
        }
    ],
    clinicStatedTotal: 201042,
    extractedTotal: 201042,
    totalItems: 6,
    isBalanced: true,
    discrepancy: 0
};

const mockFindings: Finding[] = [
    // 1. Explicit Clinical Finding (Unbundling)
    {
        id: "f1",
        category: "A",
        label: "ENFERMERÍA BÁSICA (FLEBOCLISIS / VÍA VENOSA)",
        amount: 66942,
        action: "IMPUGNAR",
        evidenceRefs: ["ITEM INDEX: 133", "ITEM INDEX: 134"],
        rationale: "Unbundling detected.",
        hypothesisParent: "H_UNBUNDLING_IF319"
    },
    // 2. Opaque Finding that overlaps with f1 (The root of the bug)
    {
        id: "f2",
        category: "Z",
        label: "PRESTACION NO CONTEMPLADA EN EL ARANCEL",
        amount: 42957, // This is exactly the price of Fleboclisis!
        action: "SOLICITAR_ACLARACION",
        evidenceRefs: [],
        rationale: "Opaque finding.",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    },
    // 3. Another Opaque Finding
    {
        id: "f3",
        category: "Z",
        label: "MEDICAMENTOS CLINICOS EN HOSPITALIZACION",
        amount: 134100,
        action: "SOLICITAR_ACLARACION",
        evidenceRefs: [],
        rationale: "Opacidad detectada.",
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
    }
];

const totalCopagoInformed = 201042; // f1 + f3 = 66942 + 134100 = 201042. f2 is a subset of f1 or is redundant.

console.log("Running Daisy accounting fix verification...");

const result = finalizeAuditCanonical({
    findings: mockFindings,
    totalCopago: totalCopagoInformed,
    reconstructible: true,
    accountContext: mockBill,
    signals: [],
    violations: []
});

console.log("\n--- Audit Result ---");
console.log("Global State:", result.estadoGlobal);
console.log("Balance:", JSON.stringify(result.balance, null, 2));
console.log("Findings Count (Pre-subsumption was 3):", result.findings.length);
console.log("Debug Errors:", result.debug);

const sum = result.balance.A + result.balance.B + result.balance.Z + result.balance.OK;
const satisfiesInvariant = sum === totalCopagoInformed;

console.log(`\nFinal Sum: ${sum} vs Informed: ${totalCopagoInformed}`);

if (satisfiesInvariant) {
    console.log("✅ SUCCESS: Accounting invariant holds!");
} else {
    console.log("❌ FAILURE: Accounting invariant violated!");
    process.exit(1);
}

// Check if f2 was subsumed/blacklisted
const f2Reconstructed = result.findings.find(f => f.label.includes("FLEBOCLISIS") && f.label.includes("Reconstruido"));
const f3Reconstructed = result.findings.find(f => f.label.includes("SURGITIE") && f.label.includes("Reconstruido"));

if (f2Reconstructed || result.findings.some(f => f.label.includes("PRESTACION NO CONTEMPLADA") && f.category === 'Z')) {
    console.log("⚠️ Insight: Finding f2 (42957) was still present or explicitly reconstructed (should have been blacklisted by f1).");
} else {
    console.log("✅ SUCCESS: Finding f2 (42957) was properly blacklisted by explicit clinical finding f1!");
}

if (f3Reconstructed) {
    console.log("\n✅ SUCCESS: Finding f3 (Meds Opaque) was reconstructed!");
    console.log("New Label:", f3Reconstructed.label);
    if (f3Reconstructed.rationale.includes("| Item Detalle |")) {
        console.log("✅ SUCCESS: Finding rationale includes markdown table breakdown!");
        console.log("\n--- Table Output ---");
        const tableStart = f3Reconstructed.rationale.indexOf("| Item Detalle |");
        console.log(f3Reconstructed.rationale.substring(tableStart));
    } else {
        console.log("❌ FAILURE: Rationale missing markdown table!");
    }
} else {
    console.log("❌ FAILURE: Finding f3 was not reconstructed!");
}
