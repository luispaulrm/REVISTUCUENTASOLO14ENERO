import { transformToCanonical } from './services/canonicalTransform.service.js';
import { ContractAnalysisResult } from './services/contractTypes.js';

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
                    unidad_normalizada: "SIN_TOPE",
                    evidencia_literal: "SIN TOPE",
                    tipoTope: "ILIMITADO"
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
                    tope: "4.5 UF",
                    tope_normalizado: 4.5,
                    unidad_normalizada: "UF",
                    evidencia_literal: "4.5 UF",
                    tipoTope: "POR_EVENTO"
                }
            ]
        },
        {
            categoria: "AMBULATORIO",
            item: "Consulta Médica",
            ambito: "AMBULATORIO",
            modalidades: [
                {
                    tipo: "LIBRE_ELECCION",
                    porcentaje: 80,
                    tope: "1.2 UF",
                    unidadTope: "UF",
                    evidencia_literal: "1.2 UF",
                    tipoTope: "POR_EVENTO"
                }
            ]
        },
        {
            categoria: "RESTRINGIDAS",
            item: "Psicología",
            ambito: "UNDETERMINED" as any,
            modalidades: [
                {
                    tipo: "LIBRE_ELECCION",
                    porcentaje: "50%",
                    tope: "0.5 UF",
                    unidadTope: "UF",
                    evidencia_literal: "0.5 UF",
                    tipoTope: "ANUAL"
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

    console.log("\n--- VERIFICATION RESULTS ---");

    // 1. Check "Sin Tope" handling
    const diaCamaTope = canonical.topes.find(t => t.fuente_textual.includes("Día Cama"));
    console.log("Dia Cama Tope:", JSON.stringify(diaCamaTope, null, 2));
    if (diaCamaTope && (diaCamaTope as any).tope_existe === false && (diaCamaTope as any).razon === "SIN_TOPE_EXPRESO_EN_CONTRATO") {
        console.log("✅ Sin Tope Rule (v2.0) applied correctly.");
    } else {
        console.log("❌ Sin Tope Rule failed.");
    }

    // 2. Check numeric extraction from tope_normalizado
    const medTope = canonical.topes.find(t => t.fuente_textual.includes("Medicamentos"));
    console.log("Medicamentos Tope:", JSON.stringify(medTope, null, 2));
    if (medTope && medTope.valor === 4.5) {
        console.log("✅ Numeric extraction from tope_normalizado success.");
    } else {
        console.log("❌ Numeric extraction from tope_normalizado failed.");
    }

    // 3. Check legacy extraction (percentage parsing)
    const psicCobertura = canonical.coberturas.find(c => c.descripcion_textual.includes("Psicología"));
    console.log("Psicoterapia Cobertura:", JSON.stringify(psicCobertura, null, 2));
    if (psicCobertura && psicCobertura.porcentaje === 50) {
        console.log("✅ Percentage string parsing success.");
    } else {
        console.log("❌ Percentage string parsing failed.");
    }

    // 4. Check scope inference
    console.log("Scope Inference checks:");
    canonical.coberturas.forEach(c => {
        console.log(` - ${c.descripcion_textual}: ${c.ambito}`);
    });

} catch (e) {
    console.error("Verification crashed:", e);
}
