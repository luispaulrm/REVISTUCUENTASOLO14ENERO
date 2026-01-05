/**
 * Script de análisis para identificar ítems faltantes en la extracción
 * Compara la salida real con la lista esperada de v10.3
 */

// Lista esperada según PROMPT_COBERTURAS_HOSP v10.3 (56 ítems)
const expectedHospitalario = [
    // Día Cama (8)
    "Día Cama - Clínica Alemana (Pref)",
    "Día Cama - Clínica Universidad de los Andes (Pref)",
    "Día Cama - Clínica San Carlos de Apoquindo (Pref)",
    "Día Cama - Clínica Santa María (Pref)",
    "Día Cama - Hospital Clínico UC (Pref)",
    "Día Cama - Clínica Las Condes (Pref)",
    "Día Cama - Clínica Indisa (Pref)",
    "Día Cama (LE)",

    // UTI/UCI (8)
    "Día Cama UTI/UCI - Clínica Alemana (Pref)",
    "Día Cama UTI/UCI - Clínica Universidad de los Andes (Pref)",
    "Día Cama UTI/UCI - Clínica San Carlos de Apoquindo (Pref)",
    "Día Cama UTI/UCI - Clínica Santa María (Pref)",
    "Día Cama UTI/UCI - Hospital Clínico UC (Pref)",
    "Día Cama UTI/UCI - Clínica Las Condes (Pref)",
    "Día Cama UTI/UCI - Clínica Indisa (Pref)",
    "Día Cama UTI/UCI (LE)",

    // Derecho Pabellón (8)
    "Derecho Pabellón - Clínica Alemana (Pref)",
    "Derecho Pabellón - Clínica Universidad de los Andes (Pref)",
    "Derecho Pabellón - Clínica San Carlos de Apoquindo (Pref)",
    "Derecho Pabellón - Clínica Santa María (Pref)",
    "Derecho Pabellón - Hospital Clínico UC (Pref)",
    "Derecho Pabellón - Clínica Las Condes (Pref)",
    "Derecho Pabellón - Clínica Indisa (Pref)",
    "Derecho Pabellón (LE)",

    // Honorarios (8)
    "Honorarios Médicos Quirúrgicos - Clínica Alemana (Pref)",
    "Honorarios Médicos Quirúrgicos - Clínica Universidad de los Andes (Pref)",
    "Honorarios Médicos Quirúrgicos - Clínica San Carlos de Apoquindo (Pref)",
    "Honorarios Médicos Quirúrgicos - Clínica Santa María (Pref)",
    "Honorarios Médicos Quirúrgicos - Hospital Clínico UC (Pref)",
    "Honorarios Médicos Quirúrgicos - Clínica Las Condes (Pref)",
    "Honorarios Médicos Quirúrgicos - Clínica Indisa (Pref)",
    "Honorarios Médicos Quirúrgicos (LE)",

    // Medicamentos (8)
    "Medicamentos - Clínica Alemana (Pref)",
    "Medicamentos - Clínica Universidad de los Andes (Pref)",
    "Medicamentos - Clínica San Carlos de Apoquindo (Pref)",
    "Medicamentos - Clínica Santa María (Pref)",
    "Medicamentos - Hospital Clínico UC (Pref)",
    "Medicamentos - Clínica Las Condes (Pref)",
    "Medicamentos - Clínica Indisa (Pref)",
    "Medicamentos (LE)",

    // Insumos (8)
    "Materiales e Insumos Clínicos - Clínica Alemana (Pref)",
    "Materiales e Insumos Clínicos - Clínica Universidad de los Andes (Pref)",
    "Materiales e Insumos Clínicos - Clínica San Carlos de Apoquindo (Pref)",
    "Materiales e Insumos Clínicos - Clínica Santa María (Pref)",
    "Materiales e Insumos Clínicos - Hospital Clínico UC (Pref)",
    "Materiales e Insumos Clínicos - Clínica Las Condes (Pref)",
    "Materiales e Insumos Clínicos - Clínica Indisa (Pref)",
    "Materiales e Insumos Clínicos (LE)",

    // Anestesia (8)
    "Anestesia - Clínica Alemana (Pref)",
    "Anestesia - Clínica Universidad de los Andes (Pref)",
    "Anestesia - Clínica San Carlos de Apoquindo (Pref)",
    "Anestesia - Clínica Santa María (Pref)",
    "Anestesia - Hospital Clínico UC (Pref)",
    "Anestesia - Clínica Las Condes (Pref)",
    "Anestesia - Clínica Indisa (Pref)",
    "Anestesia (LE)",
];

// Función para normalizar nombres
function normalize(item, modalidad) {
    const modal = modalidad === "Oferta Preferente" ? "(Pref)" : "(LE)";
    return `${item} ${modal}`;
}

// Función de análisis
function analyzeExtraction(jsonData) {
    console.log("\n📊 ANÁLISIS DE ÍTEMS FALTANTES\n");
    console.log("=".repeat(60));

    const coberturas = jsonData.coberturas || [];

    // Filtrar solo hospitalarios (categoría HOSPITALARIAS)
    const hospitalarios = coberturas.filter(c =>
        c.categoria === "HOSPITALARIAS Y CIRUGÍA MAYOR AMBULATORIA"
    );

    console.log(`\n✅ Total coberturas: ${coberturas.length}`);
    console.log(`✅ Hospitalarios encontrados: ${hospitalarios.length}`);
    console.log(`✅ Esperados: ${expectedHospitalario.length}`);
    console.log(`❌ Faltantes: ${expectedHospitalario.length - hospitalarios.length}\n`);

    // Crear set de ítems encontrados
    const foundItems = new Set(hospitalarios.map(c => normalize(c.item, c.modalidad)));

    // Buscar faltantes
    const missing = expectedHospitalario.filter(expected => !foundItems.has(expected));

    if (missing.length > 0) {
        console.log("❌ ÍTEMS FALTANTES:");
        console.log("=".repeat(60));
        missing.forEach((item, i) => {
            console.log(`${i + 1}. ${item}`);
        });
    } else {
        console.log("✅ Todos los ítems hospitalarios están presentes!");
    }

    // Análisis por sección
    console.log("\n📈 ANÁLISIS POR SECCIÓN:");
    console.log("=".repeat(60));

    const sections = [
        { name: "Día Cama", expected: 8, prefix: "Día Cama -" },
        { name: "UTI/UCI", expected: 8, prefix: "Día Cama UTI/UCI" },
        { name: "Derecho Pabellón", expected: 8, prefix: "Derecho Pabellón" },
        { name: "Honorarios", expected: 8, prefix: "Honorarios Médicos" },
        { name: "Medicamentos", expected: 8, prefix: "Medicamentos" },
        { name: "Insumos", expected: 8, prefix: "Materiales e Insumos" },
        { name: "Anestesia", expected: 8, prefix: "Anestesia" }
    ];

    sections.forEach(section => {
        const count = hospitalarios.filter(c =>
            c.item.startsWith(section.prefix) || c.item === section.prefix
        ).length;

        const status = count === section.expected ? "✅" : "❌";
        console.log(`${status} ${section.name}: ${count}/${section.expected}`);
    });

    console.log("\n" + "=".repeat(60));
}

// Usar con el JSON de la última extracción
// Ejemplo de uso:
// const data = require('./ultima_extraccion.json');
// analyzeExtraction(data);

console.log(`
📋 INSTRUCCIONES:

1. Pega el JSON de la última extracción en un archivo 'ultima_extraccion.json'
2. Ejecuta: node analyze_missing_items.js

O simplemente llama a la función analyzeExtraction(jsonData) con tu JSON.
`);

module.exports = { analyzeExtraction, expectedHospitalario };
