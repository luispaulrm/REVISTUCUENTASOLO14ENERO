
import { TaxonomyPhase1_5Service } from "./server/services/taxonomyPhase1_5.service.js";
import { TaxonomyResult, TaxonomyContextAnchors } from "./server/types/taxonomy.types.js";

// Mocking GeminiService since we are testing deterministic logic mainly, 
// and for LLM we might need to mock if we run this in CI. 
// For this script, we will test the deterministic path which uses enableLLM: false 
// or ensure our inputs trigger the deterministic logic.

// We need a mock Gemini Service even if we don't use it for deterministic tests
const mockGeminiService = {
    extractText: async () => "{}"
} as any;

const MockEtiologyService = new TaxonomyPhase1_5Service(mockGeminiService, { enableLLM: false });

async function runTests() {
    console.log("Starting Phase 1.5 Etiology Tests...");
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, msg: string) {
        if (condition) {
            console.log(`✅ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${msg}`);
            failed++;
        }
    }

    // Test 1: INSTALACION DE VIA VENOSA => ACTO_NO_AUTONOMO
    try {
        const anchors: TaxonomyContextAnchors = {
            hasPabellon: true,
            hasDayBed: true,
            hasUrgencia: false,
            sectionNames: ["OTROS PROC.DIAG.Y TERAPEUTICOS"]
        };
        const items: TaxonomyResult[] = [{
            id: "x1",
            item_original: "INSTALACION DE VIA VENOSA 99-00-028-01",
            text: "INSTALACION DE VIA VENOSA 99-00-028-01",
            grupo: "INSUMOS", // Dummy group
            sub_familia: "N_A", // Dummy subfamilia
            atributos: {},
            confidence: 1,
            rationale_short: ""
        }];

        const out = await MockEtiologyService.run(items, anchors);
        assert(out[0].etiologia?.tipo === "ACTO_NO_AUTONOMO", "Via Venosa detectado como ACTO_NO_AUTONOMO");
        assert(out[0].etiologia?.impacto_previsional === "REBOTE_ISAPRE_PREVISIBLE", "Impacto REBOTE_ISAPRE_PREVISIBLE correcto");

    } catch (e) {
        console.error("Test 1 Error:", e);
        failed++;
    }

    // Test 2: APENDICECTOMIA (prestación arancelaria) => CORRECTO
    try {
        const anchors: TaxonomyContextAnchors = {
            hasPabellon: true,
            hasDayBed: true,
            hasUrgencia: false,
            sectionNames: ["Pabellon"]
        };
        const items: TaxonomyResult[] = [{
            id: "x2",
            item_original: "APENDICECTOMIA POR VI 18-02-053-09",
            text: "APENDICECTOMIA POR VI 18-02-053-09",
            grupo: "Pabellon" as any,
            sub_familia: "N_A" as any,
            atributos: {},
            confidence: 1,
            rationale_short: ""
        }];

        const out = await MockEtiologyService.run(items, anchors);
        assert(out[0].etiologia?.tipo === "CORRECTO", "Apendicectomia es CORRECTO");
        assert(out[0].etiologia?.impacto_previsional === "BONIFICABLE", "Impacto BONIFICABLE correcto");

    } catch (e) {
        console.error("Test 2 Error:", e);
        failed++;
    }

    // Test 3: Anestesia fuera de Pabellon => DESCLASIFICACION_CLINICA absorcion=PABELLON
    try {
        const anchors: TaxonomyContextAnchors = {
            hasPabellon: true,
            hasDayBed: true,
            hasUrgencia: false,
            sectionNames: ["Medicamentos y Materiales MEDICAMENTOS", "Pabellon"]
        };
        const items: TaxonomyResult[] = [{
            id: "x3",
            item_original: "SEVOFLURANE QF 11050003",
            text: "SEVOFLURANE QF 11050003",
            grupo: "INSUMOS",  // Simulated wrong group
            sub_familia: "FARMACOS",
            atributos: { section: "Medicamentos y Materiales MEDICAMENTOS" }, // fuera de pabellón
            confidence: 1,
            rationale_short: ""
        }];

        const out = await MockEtiologyService.run(items, anchors);
        assert(out[0].etiologia?.tipo === "DESCLASIFICACION_CLINICA", "Sevoflurane fuera de pabellon detectado como DESCLASIFICACION_CLINICA");
        assert(out[0].etiologia?.absorcion_clinica === "PABELLON", "Absorcion PABELLON correcta");

    } catch (e) {
        console.error("Test 3 Error:", e);
        failed++;
    }

    console.log(`\nTests Completed. Passed: ${passed}, Failed: ${failed}`);
}

runTests();
