
// Mock types
type HallazgoCategoria = "A" | "B" | "Z";

interface HallazgoInternal {
    id?: string;
    titulo: string;
    glosa?: string;
    hallazgo: string;
    montoObjetado: number;
    categoria?: string;
    categoria_final?: HallazgoCategoria;
    match_quality?: string;
    basis?: string;
    recomendacion_accion?: string;
    nivel_confianza?: string;
    tipo_monto?: "COBRO_IMPROCEDENTE" | "COPAGO_OPACO";
    anclajeJson?: string;
    normaFundamento?: string;
    estado_juridico?: string;
    codigos?: string;
    isSubsumed?: boolean;
    [key: string]: any;
}

// Logic from auditEngine.service.ts

function classifyFinding(h: any): "A" | "B" {
    const gl = (h.glosa || "").toUpperCase();
    const text = (h.hallazgo || "").toUpperCase();

    const isCuentaOpaca = /VARIOS|AJUSTE|DIFERENCIA/.test(gl) || /VARIOS|AJUSTE/.test(text);
    if (isCuentaOpaca) return "A";

    const isPamCajaNegra = /MATERIALES|MEDICAMENTOS|INSUMO|FARMAC/.test(gl) && /DESGLOSE|OPACIDAD|CAJA/.test(text);
    if (isPamCajaNegra) return "B";

    return "A";
}

function finalizeAudit(result: any, totalCopagoReal: number = 0): any {
    const hallazgos = result.hallazgos || [];

    // 0. Detect Structural Opacity Parent
    const hasCanonicalOpacity = hallazgos.some((h: any) => h.codigos === "OPACIDAD_ESTRUCTURAL");

    // 1. Freeze Categories
    const hallazgosFrozen = hallazgos.map((h: HallazgoInternal) => {
        let cat: HallazgoCategoria = "Z";

        const isOpacityParent = h.codigos === "OPACIDAD_ESTRUCTURAL";
        const isGenericMaterialOrMed = (h.glosa && /MATERIAL|INSUMO|MEDICAMENTO|FARMAC/i.test(h.glosa));

        // Logic: If we have the Canonical Parent, then any other generic material/med finding is a "Child" 
        // that is technically subsumed by the structural opacity. We mark it so we don't double sum.
        // BUT: If the finding is explicitly CAT A (e.g. "Sin Bonificación" or "Varios"), we DO NOT subsume it.
        const isExplicitA = h.categoria_final === "A" || h.tipo_monto === "COBRO_IMPROCEDENTE";

        if (hasCanonicalOpacity && isGenericMaterialOrMed && !isOpacityParent && !isExplicitA) {
            h.isSubsumed = true;
            cat = "B";
            console.log(`Subsumed: ${h.glosa}`);
        } else if (isOpacityParent) {
            cat = "B";
        } else if (h.categoria === "OPACIDAD") {
            cat = "B";
        } else {
            // NUTRITION & OTHERS
            const isNutrition = h.codigos?.includes("3101306") || /ALIMENTA|NUTRICI/i.test(h.glosa || "");
            const isGap = h.codigos === "GAP_RECONCILIATION";

            if (isNutrition) {
                if (h.anclajeJson?.includes("MATCH_EXACTO")) {
                    cat = "A";
                } else {
                    cat = "Z";
                }
            } else if (isGap) {
                cat = "Z";
            } else {
                // Check if explicitly "COBRO_IMPROCEDENTE" and high confidence
                if (h.tipo_monto === "COBRO_IMPROCEDENTE" && h.nivel_confianza !== "BAJA") {
                    cat = "A";
                } else {
                    cat = "B";
                }
            }
        }

        // Strict Override
        if ((h.titulo?.includes("ALIMENTACION") || h.glosa?.includes("SIN BONIF")) && cat !== "A") {
            cat = "Z";
            console.log(`Forced to Z: ${h.glosa}`);
        }

        h.categoria_final = cat;

        if (cat === "A") {
            h.tipo_monto = "COBRO_IMPROCEDENTE";
            h.estado_juridico = "CONFIRMADO_EXIGIBLE";
        } else if (cat === "B") {
            h.tipo_monto = "COPAGO_OPACO";
            h.estado_juridico = "EN_CONTROVERSIA";
        } else {
            h.tipo_monto = "COPAGO_OPACO";
            h.estado_juridico = "INDETERMINADO";
        }

        return h;
    });

    // 2. Compute KPI Totals
    const sumA = hallazgosFrozen
        .filter((h: any) => h.categoria_final === "A" && !h.isSubsumed)
        .reduce((acc: number, h: any) => acc + (h.montoObjetado || 0), 0);

    const sumB = hallazgosFrozen
        .filter((h: any) => h.categoria_final === "B" && !h.isSubsumed)
        .reduce((acc: number, h: any) => acc + (h.montoObjetado || 0), 0);

    const sumZ = hallazgosFrozen
        .filter((h: any) => h.categoria_final === "Z" && !h.isSubsumed)
        .reduce((acc: number, h: any) => acc + (h.montoObjetado || 0), 0);

    // 3. Update Result
    result.hallazgos = hallazgosFrozen;

    if (!result.resumenFinanciero) result.resumenFinanciero = {};

    const totalObjetado = sumA + sumB + sumZ;

    let catOK = 0;
    if (totalCopagoReal > 0) {
        catOK = totalCopagoReal - totalObjetado;
        if (catOK < 0) catOK = 0;
    }

    result.resumenFinanciero.ahorro_confirmado = sumA;
    result.resumenFinanciero.cobros_improcedentes_exigibles = sumA;
    result.resumenFinanciero.copagos_bajo_controversia = sumB;
    result.resumenFinanciero.monto_indeterminado = sumZ;
    result.resumenFinanciero.monto_no_observado = catOK;
    result.resumenFinanciero.totalCopagoObjetado = totalObjetado;
    result.resumenFinanciero.totalCopagoReal = totalCopagoReal;

    return result;
}

// Test Case
const findings = [
    {
        codigos: "OPACIDAD_ESTRUCTURAL",
        glosa: "MATERIALES/MEDICAMENTOS SIN APERTURA",
        montoObjetado: 3788122,
        categoria: "OPACIDAD",
        tipo_monto: "COPAGO_OPACO",
        nivel_confianza: "ALTA"
    },
    // The missing finding (Mocked):
    {
        codigos: "MOCK_CAT_A",
        glosa: "Prestaciones sin bonificación",
        hallazgo: "Cobro improcedente de 'Prestaciones sin bonificación' por $66.752.",
        montoObjetado: 66752,
        tipo_monto: "COBRO_IMPROCEDENTE", // Assuming this is set
        nivel_confianza: "ALTA"
    }
];

const totalCopagoReal = 20495113;

const result = { hallazgos: findings, resumenFinanciero: {} };
const final = finalizeAudit(result, totalCopagoReal);

console.log("Resumen Financiero:");
console.log(JSON.stringify(final.resumenFinanciero, null, 2));

console.log("Findings Final Status:");
final.hallazgos.forEach((h: any) => {
    console.log(`- ${h.glosa}: Cat=${h.categoria_final}, Monto=${h.montoObjetado}, Subsumed=${h.isSubsumed}`);
});
