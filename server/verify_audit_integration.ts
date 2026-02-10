
import { AuditEngineRefactored } from './services/auditEngineRefactored.service.js';
import { TaxonomyResult } from './types/taxonomy.types.js';

// --- MOCK DATA GENERATOR ---
// Simulates what Phase 1 would output for a "Case Study"
function getMockCaseStudy_HoteleraDuplicity(): TaxonomyResult[] {
    return [
        {
            id: "1",
            item_original: "DIA CAMA INTEGRAL",
            grupo: "HOTELERA", // Context trigger!
            sub_familia: "N_A",
            atributos: {
                es_cargo_fijo: true
            } as any, // Partial match for brevity in mock
            confidence: 0.99,
            rationale_short: "Mocked Truth"
        },
        {
            id: "2",
            item_original: "JERINGA 10CC (INHERENTE)",
            grupo: "INSUMOS",
            sub_familia: "MATERIALES",
            atributos: {
                // The Evidence
                potencial_inherente_dia_cama: true
            } as any,
            confidence: 0.95,
            rationale_short: "Mocked Truth"
        },
        {
            id: "3",
            item_original: "HONORARIO MEDICO",
            grupo: "HONORARIOS",
            sub_familia: "N_A",
            atributos: {} as any,
            confidence: 0.99,
            rationale_short: "Mocked Truth"
        }
    ];
}

async function runTest() {
    console.log("=== VERIFICACIÓN INTEGRACIÓN FASE 2 (AUDITOR / JUEZ) ===");

    // 1. Setup
    const auditor = new AuditEngineRefactored();
    const mockData = getMockCaseStudy_HoteleraDuplicity();

    console.log(`Input: ${mockData.length} ítems clasificados (Phase 1 Output).`);
    console.log(`Contexto Esperado: Existe Hotelera? SI`);

    // 2. Execution
    const result = auditor.performAudit(mockData);

    // 3. Assertions
    console.log("\n--- RESULTADOS ---");
    console.log("Contexto Detectado:", JSON.stringify(result.context));
    console.log("Hallazgos:", JSON.stringify(result.findings, null, 2));

    // Validations
    const ctxOk = result.context.existe_dia_cama === true;
    const ruleOk = result.findings.some(f => f.code === 'DUPLICIDAD_HOTELERA' && f.itemId === '2');

    if (ctxOk && ruleOk) {
        console.log("\n✅ ÉXITO TOTAL: El auditor dedujo el contexto y aplicó la regla R-HOT-01 correctamente sobre el ítem 2.");
    } else {
        console.error("\n❌ FALLO: No se detectó la duplicidad esperada o el contexto.");
    }
}

runTest();
