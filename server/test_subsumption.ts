
import { finalizeAuditCanonical } from './services/auditEngine.service.js';

async function testSubsumption() {
    console.log("=== STARTING SUBSUMPTION VERIFICATION (DAISY CASE) ===");

    const totalCopagoIn = 452175;

    // Simulate findings from Daisy case that caused double counting
    const findings = [
        { label: "GASTOS NO CUBIERTOS POR EL PLAN (Reconstruido)", amount: 197697, category: "A" },
        { label: "GASTOS NO CUBIERTOS POR EL PLAN", amount: 184653, category: "K" },
        { label: "MEDICAMENTOS Y MATERIALES (COBERTURA 0%) (Reconstruido)", amount: 166816, category: "A" },
        { label: "MATERIALES/MEDICAMENTOS SIN APERTURA (Reconstruido)", amount: 166816, category: "K" },
        { label: "FLEBOCLISIS / INSTALACION DE VIA VENOSA", amount: 66942, category: "A" },
        { label: "MEDICAMENTOS CLINICOS EN HOSPITALIZACION (Reconstruido)", amount: 134100, category: "K" }
    ];

    console.log("\n[Step 1] Running finalizeAuditCanonical...");
    const result = finalizeAuditCanonical({
        totalCopago: totalCopagoIn,
        findings: findings as any,
        reconstructible: true,
        violations: [],
        signals: []
    });

    console.log(`- Total Informado: $${totalCopagoIn}`);
    console.log(`- Final A (Objetado Confirmado): $${result.balance.A}`);
    console.log(`- Final K (Objetado Indeterminado): $${result.balance.K}`);
    console.log(`- Final Z (Residual): $${result.balance.Z}`);
    console.log(`- Final OK: $${result.balance.OK}`);

    const totalAccounted = result.balance.A + result.balance.K + result.balance.OK;
    console.log(`\nAccounted Sum (A+K+OK): $${totalAccounted} (Expected: $${totalCopagoIn})`);

    console.log("\nDebug Foundation Text:");
    console.log(result.fundamentoText);

    // Verify specifically that 166816 was deduplicated
    const a166 = result.findings.filter(f => f.amount === 166816);
    console.log(`\nFindings with amount 166816: ${a166.length} (Expected: 1)`);

    console.log("=== SUBSUMPTION TEST COMPLETE ===");
}

testSubsumption().catch(console.error);
