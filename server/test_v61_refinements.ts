import { inferUnidadReferencia } from './services/financialValidator.service.js';
import { finalizeAuditCanonical } from './services/auditEngine.service.js';
import { Finding } from '../src/types.js';

async function runTests() {
    console.log("🚀 STARTING V6.1 FORENSIC REFINEMENTS TEST\n");

    const baseFinding: Partial<Finding> = {
        action: "IMPUGNAR",
        evidenceRefs: [],
        hypothesisParent: "H1" as any
    };

    // -------------------------------------------------------------------------
    // TEST 1: UnidadEstado - Transitions (Opacidad vs Contrato)
    // -------------------------------------------------------------------------
    console.log("--- TEST 1: UnidadEstado - Transitions ---");

    // Scenario 1: Opaque PAM (aggregated lines)
    const opaquePam = {
        folios: [{
            desglosePorPrestador: [{
                items: [
                    { valorTotal: "$250.000", descripcion: "INSUMOS VARIOS" }, // Large opaque block
                    { valorTotal: "$10.000", codigoGC: "1001" },
                    { valorTotal: "$5.000", descripcion: "GASAS" }
                ]
            }]
        }]
    };

    const resOpaque = await inferUnidadReferencia({}, opaquePam);
    console.log(`- Aggregated PAM: ${resOpaque.estado === "NO_VERIFICABLE_POR_OPACIDAD" ? "✅ PASS" : "❌ FAIL"} (State: ${resOpaque.estado})`);
    console.log(`  Confidence Score: ${resOpaque.vam_confidence_score.toFixed(2)}`);

    // Scenario 2: Missing Contract Anchors
    const cleanPam = {
        folios: [{
            desglosePorPrestador: [{
                items: [
                    { valorTotal: "$1.000", codigoGC: "9001" },
                    { valorTotal: "$2.000", codigoGC: "9002" }
                ]
            }]
        }]
    };

    const resContract = await inferUnidadReferencia({}, cleanPam);
    console.log(`- Missing Anchors: ${resContract.estado === "NO_VERIFICABLE_POR_CONTRATO" ? "✅ PASS" : "❌ FAIL"} (State: ${resContract.estado})`);

    // Scenario 3: Clean PAM + Anchors
    const perfectPam = {
        folios: [{
            desglosePorPrestador: [{
                items: [
                    { valorTotal: "$267.776", codigoGC: "1103057", bonificacion: "$267.776" }, // Rizotomia (AC2 anchor)
                    { valorTotal: "$1.338.880", codigoGC: "1802081", bonificacion: "$1.338.880" } // Colecist (AC2 anchor)
                ]
            }]
        }]
    };

    const resPerfect = await inferUnidadReferencia({ diseno_ux: { nombre_isapre: "CONSALUD" } }, perfectPam);
    console.log(`- Perfect Anchors: ${resPerfect.estado === "VERIFICABLE" ? "✅ PASS" : "❌ FAIL"} (State: ${resPerfect.estado})`);
    console.log(`  Confidence Score: ${resPerfect.vam_confidence_score.toFixed(2)}`);
    console.log("");

    // -------------------------------------------------------------------------
    // TEST 2: Thresholds + Blocked Conclusions
    // -------------------------------------------------------------------------
    console.log("--- TEST 2: Thresholds & Blocked Conclusions ---");

    const mockFindings: Finding[] = [
        {
            ...baseFinding,
            id: "f1",
            category: "B",
            amount: 100000,
            label: "HONORARIO QUIRURGICO",
            rationale: "Opacidad detectada."
        } as Finding
    ];

    // Case 1: Opaque unit should block math validation
    const eventosOpaque = [{
        analisis_financiero: {
            tope_cumplido: false,
            unit_type: "AC2",
            valor_unidad_inferido: 223147
        },
        nivel_confianza: "MEDIA"
    }];

    const auditRes1 = finalizeAuditCanonical({
        findings: mockFindings,
        eventos: eventosOpaque as any,
        reconstructible: false,
        totalCopago: 100000
    });

    const f1Result = auditRes1.findings[0];
    console.log(`- Blocked Conclusion (Opacidad): ${f1Result.rationale.includes("[V6.1 BLOQUEO]") ? "✅ PASS" : "❌ FAIL"}`);

    // Case 2: Threshold Check (TOPE_EXPLICITO=0.7)
    // Label must match isSpecificFinance keywords
    const eventosLowScore = [{
        analisis_financiero: {
            tope_cumplido: true,
            unit_type: "AC2"
        },
        nivel_confianza: "BAJA" // 0.6 score in proxy
    }];

    const auditRes2 = finalizeAuditCanonical({
        findings: [{ ...mockFindings[0], category: "A", label: "HONORARIO (TOPE_EXPLICITO)" }],
        eventos: eventosLowScore as any,
        reconstructible: false,
        totalCopago: 100
    });
    console.log(`- Failed Threshold (0.6 < 0.7): ${auditRes2.findings[0].rationale.includes("Score insuficiente") ? "✅ PASS" : "❌ FAIL"}`);
    console.log("");

    // -------------------------------------------------------------------------
    // TEST 3: Evidence Promotion Gate (B -> A)
    // -------------------------------------------------------------------------
    console.log("--- TEST 3: Promotion Gate (B -> A) ---");

    const findingsGate: Finding[] = [
        {
            ...baseFinding,
            id: "g1",
            category: "B",
            amount: 50000,
            label: "SERVICIO_DUPLICADO",
            rationale: "Patrón detectado según JURISPRUDENCIA."
        } as Finding,
        {
            ...baseFinding,
            id: "g2",
            category: "B",
            amount: 50000,
            label: "SERVICIO_DUPLICADO",
            rationale: "Patrón detectado según JURISPRUDENCIA."
        } as Finding
    ];

    // Scenario: 2 items with same label + Jurisprudencia keyword -> Promote
    const auditRes3 = finalizeAuditCanonical({
        findings: findingsGate,
        eventos: [],
        reconstructible: false,
        totalCopago: 100000
    });

    console.log(`- Promoted B -> A (Double Anchor): ${auditRes3.findings[0].category === "A" ? "✅ PASS" : "❌ FAIL"}`);

    // Scenario: Single item -> NO promote
    const auditRes4 = finalizeAuditCanonical({
        findings: [findingsGate[0]],
        eventos: [],
        reconstructible: false,
        totalCopago: 50000
    });
    console.log(`- Blocked Single Event Promotion: ${auditRes4.findings[0].category === "B" ? "✅ PASS" : "❌ FAIL"}`);

    console.log("\n🏁 ALL TESTS COMPLETED");
}

runTests();
