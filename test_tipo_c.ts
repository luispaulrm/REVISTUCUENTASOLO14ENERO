
import { TaxonomyPhase1_5Service } from './server/services/taxonomyPhase1_5.service.js';
import { TaxonomyResult, TaxonomyContextAnchors } from './server/types/taxonomy.types.js';

// Mock Gemini Service (empty object cast to any)
const mockGeminiService = {} as any;
const service = new TaxonomyPhase1_5Service(mockGeminiService);

// Mock Anchors (Pabellon active)
const anchors: TaxonomyContextAnchors = {
    hasPabellon: true,
    hasDayBed: true,
    hasUrgencia: false
};

async function testAdministrativeUnbundling() {
    console.log("--- TESTING ADMINISTRATIVE UNBUNDLING (TIPO C) ---");

    const testItems = [
        { name: "MEDIAS ANTIEMBOLICAS", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
        { name: "SET DE ASEO PERSONAL", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
        { name: "CALZON CLINICO DESECHABLE", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
        { name: "TERMOMETRO DIGITAL", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
        { name: "METAMIZOL SODICO (FARMACIA)", expected: null }, // Should NOT match Type C (it's a drug)
        { name: "APENDICECTOMIA", expected: null } // Should NOT match Type C (it's a procedure)
    ];

    for (const item of testItems) {
        const mockInput: TaxonomyResult = {
            id: "test",
            item_original: item.name,
            text: item.name,
            rationale_short: "test",
            grupo: "INSUMOS",
            sub_familia: "GENERAL" as any,
            confidence: 1.0,
            atributos: {}
        };

        // We only test the deterministic part here
        // In the real service, 'run' calls buildDeterministicEtiology first
        // We can simulate this by instantiating the service (logic is private/internal but exposed via run)

        // Actually, we can just run the full service 'run' method with empty list and see logic
        // But since logic is inside 'run' -> 'buildDeterministicEtiology', let's just run 'run'

        // NOTE: reliable way is to run the service with disabled LLM if possible, or just expect the regex to catch it before LLM
        // The service implementation puts regex check BEFORE LLM, so it should be fast and deterministic.

        const results = await service.run([mockInput], anchors);
        const result = results[0];

        if (result.etiologia?.tipo === item.expected) {
            console.log(`✅ ${item.name} -> ${result.etiologia.tipo}`);
        } else if (item.expected === null && result.etiologia === undefined) {
            console.log(`✅ ${item.name} -> Pasó (No es Tipo C)`);
        } else {
            // Allow for other types if not specifically expecting null (e.g., Metamizol might be 'CORRECTO' or 'DESCLASIFICACION_CLINICA' depending on other logic)
            // But strictly for *Type C check*, we want to ensure it IS Type C for the target items
            // and NOT Type C for others.
            if (item.expected !== null && result.etiologia?.tipo !== item.expected) {
                console.error(`❌ ${item.name} -> Esperaba ${item.expected}, obtuvo ${result.etiologia?.tipo}`);
            } else if (item.expected === null && result.etiologia?.tipo === "DESCLASIFICACION_ADMINISTRATIVA") {
                console.error(`❌ ${item.name} -> Falso Positivo Tipo C`);
            } else {
                console.log(`✅ ${item.name} -> Correcto (No es Tipo C)`);
            }
        }
    }
}

testAdministrativeUnbundling().catch(console.error);
