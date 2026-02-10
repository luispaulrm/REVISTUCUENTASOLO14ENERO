
// Simplified test for MEP Logic (Motor 3)

const DOMINIO_REGEX = {
    HOTELERIA: /term[oó]metro|calz[oó]n|set.*aseo|chata|pa[ñn]al|confort|hoteler[ií]a|faja.*compresora|medias?.*antiemb[oó]licas?/i,
    INSUMO_ESTANDAR: /mascarilla|bigotera|aquapack|frasco|jeringa|aguja|bajadas?|tegaderm|ap[oó]sito|algod[oó]n|gasas?|t[oó]rulas?/i,
    MATERIAL_CLINICO_ESPECIFICO: /trocar|clip|sutura|hemolock|stapler|grapadora|bistur[ií]|hoja.*bistur[ií]/i
};

// Mock Context
const mockContext = { hasPabellon: true, hasDayBed: true };

function checkMEP(text: string, anchors: typeof mockContext) {
    let dominioFuncional = null;
    if (DOMINIO_REGEX.HOTELERIA.test(text)) dominioFuncional = "HOTELERIA";
    else if (DOMINIO_REGEX.INSUMO_ESTANDAR.test(text)) dominioFuncional = "INSUMO_ESTANDAR";
    else if (DOMINIO_REGEX.MATERIAL_CLINICO_ESPECIFICO.test(text)) dominioFuncional = "MATERIAL_CLINICO_ESPECIFICO";

    if (dominioFuncional === "HOTELERIA") {
        return "DESCLASIFICACION_ADMINISTRATIVA (HOTELERIA)";
    }

    if (dominioFuncional === "INSUMO_ESTANDAR") {
        if (anchors.hasPabellon || anchors.hasDayBed) {
            return "DESCLASIFICACION_ADMINISTRATIVA (INSUMO_ESTANDAR ABSORBIDO)";
        }
    }

    return "PASSED (CLINICAL/SPECIFIC)";
}

console.log("--- TESTING MOTOR 3 (MEP) LOGIC ---");

const testItems = [
    { name: "MEDIAS ANTIEMBOLICAS", expected: "DESCLASIFICACION_ADMINISTRATIVA (HOTELERIA)" },
    { name: "SET DE ASEO PERSONAL", expected: "DESCLASIFICACION_ADMINISTRATIVA (HOTELERIA)" },
    { name: "CALZON CLINICO", expected: "DESCLASIFICACION_ADMINISTRATIVA (HOTELERIA)" },
    { name: "MASCARILLA SIMPLE", expected: "DESCLASIFICACION_ADMINISTRATIVA (INSUMO_ESTANDAR ABSORBIDO)" },
    { name: "JERINGA 20CC", expected: "DESCLASIFICACION_ADMINISTRATIVA (INSUMO_ESTANDAR ABSORBIDO)" },
    { name: "TROCAR", expected: "PASSED (CLINICAL/SPECIFIC)" }, // Should pass as Material Specific
    { name: "CLIP HEMOLOCK", expected: "PASSED (CLINICAL/SPECIFIC)" }, // Should pass matches Material Specific
    { name: "METAMIZOL", expected: "PASSED (CLINICAL/SPECIFIC)" } // Matches none (assumed drug)
];

let passed = true;
for (const item of testItems) {
    const result = checkMEP(item.name, mockContext);
    if (result === item.expected) {
        console.log(`✅ ${item.name} -> ${result}`);
    } else {
        console.error(`❌ ${item.name} -> Esperaba ${item.expected}, obtuvo ${result}`);
        passed = false;
    }
}

if (passed) {
    console.log("\n✅ TODOS LOS CASOS MEP PASARON.");
    process.exit(0);
} else {
    console.error("\n❌ FALLO EN VALIDACION MEP.");
    process.exit(1);
}
