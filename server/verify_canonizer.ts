import { transformToCanonical } from './services/canonicalTransform.service.js';
import { ContractAnalysisResult } from './services/contractTypes.js';
import fs from 'fs';

const mockResult: ContractAnalysisResult = {
    diseno_ux: {
        nombre_isapre: "Banmédica",
        titulo_plan: "Plan Lite",
        layout: "modular_phased_v13",
        funcionalidad: "visual_hierarchy_v20",
        salida_json: "unified"
    },
    coberturas_enriquecidas: [
        {
            categoria: "HOSPITALIZACIÓN",
            item: "Día Cama",
            ambito: "HOSPITALARIO",
            modalidades: [
                {
                    tipo: "PREFERENTE",
                    porcentaje: 100,
                    tope: "SIN TOPE",
                    tope_anual: "SIN TOPE",
                    unidad_normalizada: "SIN_TOPE",
                    evidencia_literal: "100% Sin Tope (Merged Rule)",
                    tipoTope: "ILIMITADO"
                },
                {
                    tipo: "LIBRE_ELECCION",
                    porcentaje: 90,
                    tope: "5 UF",
                    tope_anual: "SIN TOPE",
                    unidad_normalizada: "UF",
                    evidencia_literal: "90% 5 UF / Sin Tope",
                    tipoTope: "POR_EVENTO"
                }
            ]
        },
        {
            categoria: "HOSPITALIZACIÓN",
            item: "Medicamentos",
            ambito: "HOSPITALARIO",
            modalidades: [
                {
                    tipo: "PREFERENTE",
                    porcentaje: 100,
                    tope: "SIN TOPE",
                    tope_anual: "SIN TOPE",
                    unidad_normalizada: "SIN_TOPE",
                    evidencia_literal: "100% Sin Tope (Propagated from Día Cama block)",
                    tipoTope: "ILIMITADO"
                }
            ]
        }
    ],
    coberturas_evidencia: [],
    get coberturas() { return this.coberturas_enriquecidas; },
    reglas: [],
    metrics: {
        executionTimeMs: 100,
        tokenUsage: { input: 0, output: 0, total: 0, costClp: 0 },
        extractionBreakdown: { totalReglas: 0, totalCoberturas: 4, totalItems: 4 }
    }
} as any;

try {
    console.log("Starting verification...");
    const canonical = transformToCanonical(mockResult);
    fs.writeFileSync('verification_result.json', JSON.stringify(canonical, null, 2));
    console.log("✅ Verification result saved to verification_result.json");

    console.log("\n--- VERIFICATION RESULTS ---");

    // Helper to normalize for matching
    const normMatch = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. Check "Sin Tope" handling for Merged Rule
    const diaCamaTopes = canonical.topes.filter(t => normMatch(t.fuente_textual).includes("dia cama"));
    console.log(`Dia Cama Topes Found: ${diaCamaTopes.length}`);

    const prefTopes = diaCamaTopes.filter(t => t.tipo_modalidad === "preferente");
    const eventTope = prefTopes.find(t => t.aplicacion !== "anual");
    const annualTope = prefTopes.find(t => t.aplicacion === "anual");

    if (prefTopes.length >= 2 && (eventTope as any)?.tope_existe === false && (annualTope as any)?.tope_existe === false) {
        console.log("✅ Geometric/Merged Sin Tope Rule applied correctly (Pref Event & Pref Annual).");
    } else {
        console.log("❌ Geometric/Merged Sin Tope Rule failed for Preferente.");
        console.log("   Pref Topes Detail:", JSON.stringify(prefTopes, null, 2));
    }

    // 2. Check Libre Elección Dual Topes
    const leTopes = diaCamaTopes.filter(t => t.tipo_modalidad === "libre_eleccion");
    const leEvent = leTopes.find(t => t.aplicacion !== "anual");
    const leAnnual = leTopes.find(t => t.aplicacion === "anual");

    const leEventOk = leEvent?.valor === 5 && leEvent?.unidad === "UF";
    const leAnnualOk = (leAnnual as any)?.tope_existe === false;

    if (leTopes.length >= 2 && leEventOk && leAnnualOk) {
        console.log("✅ Libre Elección Dual Topes success (5 UF Event / Sin Tope Annual).");
    } else {
        console.log("❌ Libre Elección Dual Topes failed.");
        console.log("   LE Event Detail:", JSON.stringify(leEvent, null, 2));
        console.log("   LE Annual Detail:", JSON.stringify(leAnnual, null, 2));
    }

    // 3. Scope Inference
    const diaCamaCob = canonical.coberturas.find(c => normMatch(c.descripcion_textual).includes("dia cama"));
    if (diaCamaCob?.ambito === "hospitalario") {
        console.log("✅ Scope Inference for 'Día Cama' is hospitalario.");
    } else {
        console.log("❌ Scope Inference failed for 'Día Cama'. Got:", diaCamaCob?.ambito);
    }

} catch (e) {
    console.error("Verification crashed:", e);
}
