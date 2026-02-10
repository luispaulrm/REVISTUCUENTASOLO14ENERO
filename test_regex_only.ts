
// Simplified test for Type C logic - Inlined to bypass module resolution issues

const RX_ADMINISTRATIVE_UNBUNDLING = /set.*aseo|calz[oó]n|term[oó]metro|media.*antiemb[oó]lica|ap[oó]sito.*transparente|mascarilla.*simple|bigotera|aquapack|chata.*pl[aá]stica|confort|hoteler[ií]a/i;

function checkTypeC(text: string) {
    if (RX_ADMINISTRATIVE_UNBUNDLING.test(text)) {
        return "DESCLASIFICACION_ADMINISTRATIVA";
    }
    return null;
}

console.log("--- TESTING ADMINISTRATIVE UNBUNDLING (LOGIC ONLY) ---");

const testItems = [
    { name: "MEDIAS ANTIEMBOLICAS", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "SET DE ASEO PERSONAL", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "CALZON CLINICO DESECHABLE", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "TERMOMETRO DIGITAL", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "MASCARILLA SIMPLE", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "BIGOTERA ADULTO", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "AQUAPACK 22000052", expected: "DESCLASIFICACION_ADMINISTRATIVA" },
    { name: "METAMIZOL SODICO (FARMACIA)", expected: null },
    { name: "APENDICECTOMIA", expected: null }
];

let passed = true;
for (const item of testItems) {
    const result = checkTypeC(item.name);
    if (result === item.expected) {
        console.log(`✅ ${item.name} -> ${result || 'Omitido (Correcto)'}`);
    } else {
        console.error(`❌ ${item.name} -> Esperaba ${item.expected}, obtuvo ${result}`);
        passed = false;
    }
}

if (passed) {
    console.log("\n✅ TODOS LOS CASOS DE PRUEBA PASARON EXITOSAMENTE.");
    process.exit(0);
} else {
    console.error("\n❌ ALGUNOS CASOS FALLARON.");
    process.exit(1);
}
