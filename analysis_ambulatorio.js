// Análisis de ítems ambulatorios faltantes

const expectedAmbulatorio = [
    // SECCIÓN 1: CONSULTAS (4 filas)
    "Consulta Médica General (Pref)",
    "Consulta Médica General (LE)",
    "Consulta Pediatría (Pref)",
    "Consulta Pediatría (LE)",

    // SECCIÓN 2: LABORATORIO (14 filas)
    "Exámenes de Laboratorio (Pref)",
    "Exámenes de Laboratorio (LE)",
    "Hemograma (Pref)",
    "Hemograma (LE)",
    "Perfil Bioquímico (Pref)",
    "Perfil Bioquímico (LE)",
    "Orina Completa (Pref)",
    "Orina Completa (LE)",
    "Cultivos (Pref)",
    "Cultivos (LE)",
    "Glucosa en Sangre (Pref)",
    "Glucosa en Sangre (LE)",
    "Perfil Lipídico (Pref)",
    "Perfil Lipídico (LE)",

    // SECCIÓN 3: IMAGENOLOGÍA (16 filas)
    "Imagenología (Pref)",
    "Imagenología (LE)",
    "Rayos X (Pref)",
    "Rayos X (LE)",
    "Ecotomografía (Pref)",
    "Ecotomografía (LE)",
    "TAC/Scanner (Pref)",
    "TAC/Scanner (LE)",
    "Resonancia Magnética (Pref)",
    "Resonancia Magnética (LE)",
    "Mamografía (Pref)",
    "Mamografía (LE)",
    "Densitometría Ósea (Pref)",
    "Densitometría Ósea (LE)",
    "Ecografía Doppler (Pref)",
    "Ecografía Doppler (LE)",

    // SECCIÓN 4: PROCEDIMIENTOS (12 filas)
    "Procedimientos Diagnósticos (Pref)",
    "Procedimientos Diagnósticos (LE)",
    "Procedimientos Terapéuticos (Pref)",
    "Procedimientos Terapéuticos (LE)",
    "Endoscopía Digestiva (Pref)",
    "Endoscopía Digestiva (LE)",
    "Colonoscopía (Pref)",
    "Colonoscopía (LE)",
    "Biopsia (Pref)",
    "Biopsia (LE)",
    "Electrocardiograma (Pref)",
    "Electrocardiograma (LE)",

    // SECCIÓN 5: TERAPIAS (8 filas)
    "Kinesiología (Pref)",
    "Kinesiología (LE)",
    "Fonoaudiología (Pref)",
    "Fonoaudiología (LE)",
    "Terapia Ocupacional (Pref)",
    "Terapia Ocupacional (LE)",
    "Nutricionista (Pref)",
    "Nutricionista (LE)",

    // SECCIÓN 6: URGENCIAS (4 filas)
    "Urgencia Simple Adulto (Pref)",
    "Urgencia Simple Adulto (LE)",
    "Urgencia Compleja Adulto (Pref)",
    "Urgencia Compleja Adulto (LE)",

    // SECCIÓN 7: SALUD MENTAL (4 filas)
    "Consulta Psiquiatría (Pref)",
    "Consulta Psiquiatría (LE)",
    "Consulta Psicología (Pref)",
    "Consulta Psicología (LE)",

    // SECCIÓN 8: DENTAL (4 filas)
    "PAD Dental (Pref)",
    "PAD Dental (LE)",
    "Tratamiento Dental General (Pref)",
    "Tratamiento Dental General (LE)",

    // SECCIÓN 9: ÓPTICA Y PRÓTESIS (4 filas)
    "Lentes Ópticos (LE)",
    "Lentes de Contacto (LE)",
    "Audífonos (LE)",
    "Prótesis y Órtesis (LE)",
];

// Del JSON compartido, conté estos ítems ambulatorios
const extractedAmbulatorio = [
    // CONSULTAS: 4/4 ✅
    "Consulta Médica General (Pref)",
    "Consulta Médica General (LE)",
    "Consulta Pediatría (Pref)",
    "Consulta Pediatría (LE)",

    // LABORATORIO: 14/14 ✅
    "Exámenes de Laboratorio (Pref)",
    "Exámenes de Laboratorio (LE)",
    "Hemograma (Pref)",
    "Hemograma (LE)",
    "Perfil Bioquímico (Pref)",
    "Perfil Bioquímico (LE)",
    "Orina Completa (Pref)",
    "Orina Completa (LE)",
    "Cultivos (Pref)",
    "Cultivos (LE)",
    "Glucosa en Sangre (Pref)",
    "Glucosa en Sangre (LE)",
    "Perfil Lipídico (Pref)",
    "Perfil Lipídico (LE)",

    // IMAGENOLOGÍA: 16/16 ✅
    "Imagenología (Pref)",
    "Imagenología (LE)",
    "Rayos X (Pref)",
    "Rayos X (LE)",
    "Ecotomografía (Pref)",
    "Ecotomografía (LE)",
    "TAC/Scanner (Pref)",
    "TAC/Scanner (LE)",
    "Resonancia Magnética (Pref)",
    "Resonancia Magnética (LE)",
    "Mamografía (Pref)",
    "Mamografía (LE)",
    "Densitometría Ósea (Pref)",
    "Densitometría Ósea (LE)",
    "Ecografía Doppler (Pref)",
    "Ecografía Doppler (LE)",

    // PROCEDIMIENTOS: 12/12 ✅
    "Procedimientos Diagnósticos (Pref)",
    "Procedimientos Diagnósticos (LE)",
    "Procedimientos Terapéuticos (Pref)",
    "Procedimientos Terapéuticos (LE)",
    "Endoscopía Digestiva (Pref)",
    "Endoscopía Digestiva (LE)",
    "Colonoscopía (Pref)",
    "Colonoscopía (LE)",
    "Biopsia (Pref)",
    "Biopsia (LE)",
    "Electrocardiograma (Pref)",
    "Electrocardiograma (LE)",

    // TERAPIAS: 8/8 ✅
    "Kinesiología (Pref)",
    "Kinesiología (LE)",
    "Fonoaudiología (Pref)",
    "Fonoaudiología (LE)",
    "Terapia Ocupacional (Pref)",
    "Terapia Ocupacional (LE)",
    "Nutricionista (Pref)",
    "Nutricionista (LE)",

    // URGENCIAS: 4/4 ✅
    "Urgencia Simple Adulto (Pref)",
    "Urgencia Simple Adulto (LE)",
    "Urgencia Compleja Adulto (Pref)",
    "Urgencia Compleja Adulto (LE)",

    // SALUD MENTAL: 4/4 ✅
    "Consulta Psiquiatría (Pref)",
    "Consulta Psiquiatría (LE)",
    "Consulta Psicología (Pref)",
    "Consulta Psicología (LE)",

    // DENTAL: 4/4 ✅
    "PAD Dental (Pref)",
    "PAD Dental (LE)",
    "Tratamiento Dental General (Pref)",
    "Tratamiento Dental General (LE)",

    // ÓPTICA: 2/4 ❌❌
    "Lentes Ópticos (LE)",
    "Lentes de Contacto (LE)",  // TRUNCADO (nota_restriccion incompleta)
    // FALTANTES:
    // "Audífonos (LE)",          ❌ FALTANTE
    // "Prótesis y Órtesis (LE)", ❌ FALTANTE
];

console.log("═".repeat(80));
console.log("🔍 ANÁLISIS AMBULATORIO - HALLAZGO DE ÍTEMS FALTANTES");
console.log("═".repeat(80));
console.log("");
console.log("✅ Consultas:          4/4 items");
console.log("✅ Laboratorio:       14/14 items");
console.log("✅ Imagenología:      16/16 items");
console.log("✅ Procedimientos:    12/12 items");
console.log("✅ Terapias:           8/8 items");
console.log("✅ Urgencias:          4/4 items");
console.log("✅ Salud Mental:       4/4 items");
console.log("✅ Dental:             4/4 items");
console.log("❌ Óptica y Prótesis:  2/4 items");
console.log("");
console.log("═".repeat(80));
console.log(`📈 TOTAL AMBULATORIO: ${extractedAmbulatorio.length}/70 items`);
console.log("═".repeat(80));
console.log("");
console.log("❌ ÍTEMS FALTANTES IDENTIFICADOS:");
console.log("");
console.log("  68. Audífonos (Libre Elección)");
console.log("  69. Prótesis y Órtesis (Libre Elección)");
console.log("");
console.log("═".repeat(80));
console.log("");
console.log("💡 CAUSA PROBABLE:");
console.log("");
console.log("El AI truncó la generación antes de completar la Sección 9.");
console.log("Los ítems 69-70 (Audífonos y Prótesis) no se generaron.");
console.log("Además, el ítem 68 (Lentes de Contacto) tiene restricción truncada.");
console.log("");
console.log("🔧 SOLUCIÓN:");
console.log("");
console.log("Agregar al PROMPT_COBERTURAS_AMB una instrucción de VERIFICACIÓN FINAL:");
console.log("");
console.log('  "⚠️ VERIFICACIÓN OBLIGATORIA:');
console.log('   Antes de finalizar, confirma que has generado EXACTAMENTE 70 filas.');
console.log('   La última fila DEBE ser: Prótesis y Órtesis (Libre Elección)"');
console.log("");
console.log("═".repeat(80));
