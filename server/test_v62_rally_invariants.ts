import { inferUnidadReferencia } from './services/financialValidator.service.ts';
import { finalizeAuditCanonical } from './services/auditEngine.service.ts';
import { Finding } from '../src/types.ts';

async function runTests() {
    console.log("🚀 STARTING V6.2 FORENSIC LOGIC FORMALIZATION TEST\n");

    const baseFinding: Partial<Finding> = {
        action: "IMPUGNAR",
        evidenceRefs: [],
        hypothesisParent: "H1" as any
    };

    // -------------------------------------------------------------------------
    // TEST 1: UnidadEstado Precedence (Opacidad > Contrato)
    // -------------------------------------------------------------------------
    console.log("--- TEST 1: UnidadEstado Precedence (Opacidad > Contrato) ---");

    // Scenario: PAM is Opaque AND Contract anchors are missing/contradictory
    // Opacity should take precedence in the report label.
    const toxicPam = {
        folios: [{
            desglosePorPrestador: [{
                items: [
                    { valorTotal: "$500.000", descripcion: "CARGOS GLOBALES OPACOS" }
                ]
            }]
        }]
    };

    const resPrecedence = await inferUnidadReferencia({}, toxicPam);
    console.log(`- Mixed Failure (Opacity + No Anchors): ${resPrecedence.estado === "NO_VERIFICABLE_POR_OPACIDAD" ? "✅ PASS" : "❌ FAIL"} (State: ${resPrecedence.estado})`);
    console.log("");

    // -------------------------------------------------------------------------
    // TEST 2: UnitDependency (Protecting Unbundling/Codificación)
    // -------------------------------------------------------------------------
    console.log("--- TEST 2: UnitDependency Protection ---");

    const findingsDep: Finding[] = [
        {
            ...baseFinding,
            id: "unbundling_1",
            category: "A",
            label: "UNBUNDLING",
            amount: 100000,
            rationale: "Servicio base cobrado por separado."
        } as Finding,
        {
            ...baseFinding,
            id: "tope_1",
            category: "A",
            label: "EXCESO_TOPE_ARANCELARIO",
            amount: 50000,
            rationale: "Supera tope según AC2."
        } as Finding
    ];

    // Scenario: Unit is NO_VERIFICABLE
    // Unbundling should remain A (Protected)
    // Exceso tope should be downgraded to Z (Requires unit)
    const eventosOpaque = [{
        analisis_financiero: {
            unit_type: "AC2",
            tope_cumplido: false // Proxy for state: NO_VERIFICABLE_POR_OPACIDAD
        },
        nivel_confianza: "MEDIA"
    }];

    const auditResDep = finalizeAuditCanonical({
        findings: findingsDep,
        eventos: eventosOpaque as any,
        reconstructible: false,
        totalCopago: 200000
    });

    console.log(`- Findings count: ${auditResDep.findings.length}`);
    auditResDep.findings.forEach(f => console.log(`  * Found: ${f.label} (${f.category})`));

    const fUnbundling = auditResDep.findings.find(f => f.label === "UNBUNDLING");
    const fTope = auditResDep.findings.find(f => f.label === "EXCESO_TOPE_ARANCELARIO");

    console.log(`- Unbundling (Protected): ${fUnbundling.category === "A" ? "✅ PASS" : "❌ FAIL"} (Category: ${fUnbundling.category})`);
    console.log(`- Exceso Tope (Downgraded to Z): ${fTope.category === "Z" ? "✅ PASS" : "❌ FAIL"} (Category: ${fTope.category})`);
    console.log("");

    // -------------------------------------------------------------------------
    // TEST 3: Promotion Gate pattern_scope (MISMO vs MULTI)
    // -------------------------------------------------------------------------
    console.log("--- TEST 3: Promotion Gate Scope ---");

    // Case 1: MISMO_EVENTO requires Jurisprudence (using non-protected label)
    const findingsMismo: Finding[] = [
        { ...baseFinding, id: "m1", label: "ELEMENTO_TEST", category: "B", amount: 1001, rationale: "Patrón repetido en esta línea.", event_id: "E1" } as Finding,
        { ...baseFinding, id: "m2", label: "ELEMENTO_TEST", category: "B", amount: 1002, rationale: "Patrón repetido en esta línea.", event_id: "E1" } as Finding
    ];

    const auditResMismo = finalizeAuditCanonical({
        findings: findingsMismo,
        eventos: [],
        reconstructible: false,
        totalCopago: 2003
    });
    console.log(`- Case 1 (No Juris): ${auditResMismo.findings[0].category} | Count: ${(auditResMismo.findings[0] as any).patternCount} | Scope: ${(auditResMismo.findings[0] as any).patternScope}`);
    console.log(`- Same Event (No Juris): ${auditResMismo.findings[0].category === "B" ? "✅ PASS" : "❌ FAIL"} (Category: ${auditResMismo.findings[0].category})`);

    const findingsMismoJuris: Finding[] = [
        { ...baseFinding, id: "mj1", label: "ELEMENTO_TEST", category: "B", amount: 2001, rationale: "Según JURISPRUDENCIA, cargo improcedente.", event_id: "E1" } as Finding,
        { ...baseFinding, id: "mj2", label: "ELEMENTO_TEST", category: "B", amount: 2002, rationale: "Según JURISPRUDENCIA, cargo improcedente.", event_id: "E1" } as Finding
    ];
    const auditResMismoJuris = finalizeAuditCanonical({
        findings: findingsMismoJuris,
        eventos: [],
        reconstructible: false,
        totalCopago: 4003
    });
    console.log(`- Case 1 (With Juris): ${auditResMismoJuris.findings[0].category} | Count: ${(auditResMismoJuris.findings[0] as any).patternCount} | Scope: ${(auditResMismoJuris.findings[0] as any).patternScope}`);
    console.log(`- Same Event (With Juris): ${auditResMismoJuris.findings[0].category === "A" ? "✅ PASS" : "❌ FAIL"} (Category: ${auditResMismoJuris.findings[0].category})`);

    // Case 2: MULTI_EVENTO requires Contract OR Jurisprudence
    const findingsMulti: Finding[] = [
        { ...baseFinding, id: "mu1", label: "RECARGO_ADM", category: "B", amount: 3001, rationale: "Hay un INCUMPLIMIENTO administrativo.", event_id: "E1" } as Finding,
        { ...baseFinding, id: "mu2", label: "RECARGO_ADM", category: "B", amount: 3002, rationale: "Hay un INCUMPLIMIENTO administrativo.", event_id: "E2" } as Finding,
        { ...baseFinding, id: "mu3", label: "RECARGO_ADM", category: "B", amount: 3003, rationale: "Hay un INCUMPLIMIENTO administrativo.", event_id: "E3" } as Finding
    ];
    const auditResMulti = finalizeAuditCanonical({
        findings: findingsMulti,
        eventos: [],
        reconstructible: false,
        totalCopago: 1000
    });
    console.log(`- Multi Event (Contract Clause): ${auditResMulti.findings[0].category === "A" ? "✅ PASS" : "❌ FAIL"} (Category: ${auditResMulti.findings[0].category})`);

    console.log("\n🏁 ALL V6.2 TESTS COMPLETED");
}

runTests();
