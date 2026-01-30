const fs = require('fs');
const raw = fs.readFileSync('./canonical_contract.json', 'utf8');
const data = JSON.parse(raw);

// Find in Lineas
const lineas = data.contrato.tabla_prestaciones.lineas;
const mat = lineas.find(l => l.nombre && l.nombre.includes("MATERIALES CLÍNICOS"));
const med = lineas.find(l => l.nombre && l.nombre.includes("MEDICAMENTOS"));

console.log("=== VERIFICACION FINAL ===");
if (mat) {
    console.log(`MATERIALES (Evento): ${JSON.stringify(mat.libre_eleccion.tope)}`);
    // Check local source override
    if (mat.libre_eleccion.tope.valor === 20 || (mat.libre_eleccion.tope.factor === 20 && mat.libre_eleccion.tope.unidad === 'UF')) {
        console.log("✅ OK: 20 detected");
    } else {
        console.log("❌ REGENERATION FAILED: Value is", mat.libre_eleccion.tope);
    }
} else {
    console.log("❌ MATERIALES NOT FOUND");
}

if (med) {
    console.log(`MEDICAMENTOS (Evento): ${JSON.stringify(med.libre_eleccion.tope)}`);
}
