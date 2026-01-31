const fs = require('fs');
const path = require('path');
const contractPath = path.join(__dirname, 'canonical_contract.json');
if (!fs.existsSync(contractPath)) { console.error("No Contract"); process.exit(1); }
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

let passed = true;

// 1. PABELLÓN AMBULATORIO (Consolidated Check for AC2)
const pab = contract.prestaciones_consolidadas ? contract.prestaciones_consolidadas.find(p => p.nombre.includes("PABELLÓN AMBULATORIO")) : null;
if (!pab) { console.error("FAIL: Pabellón not found in Consolidated"); passed = false; }
else {
    const le = pab.opciones.find(o => o.modalidad === 'libre_eleccion');
    if (!le) { console.error("FAIL: Pabellón LE missing"); passed = false; }
    else {
        // Strict Check for AC2
        if (le.tope && (le.tope.tipo === 'AC2' || le.tope.unidad === 'AC2' || (le.tope.tipo === 'TOPE_ARANCELARIO' && le.tope.unidad === 'AC2'))) {
            console.log("PASS: Pabellón Tope = AC2 (Factor " + (le.tope.factor || le.tope.valor) + ")");
        } else {
            console.error("FAIL: Pabellón Tope Type =", le.tope.tipo, "Unit =", le.tope.unidad);
            passed = false;
        }

        // Coverage Check (80% vs 90%)
        // If user expects 80%, we warn if 90%
        console.log("INFO: Pabellón Coverage =", le.porcentaje + "%");
    }
}

// 2. RADIOTERAPIA (Lineal Check for Sticky 80%)
const lineal = contract.contrato.tabla_prestaciones.lineas;
// Safe navigation
if (!lineal) { console.error("No tabla_prestaciones in lineal"); process.exit(1); }

const radio = lineal.find(l => l.nombre && l.nombre.includes("RADIOTERAPIA"));
if (radio && radio.libre_eleccion.porcentaje === 80) console.log("PASS: Radioterapia LE = 80%");
else { console.error("FAIL: Radioterapia =", radio ? radio.libre_eleccion.porcentaje : "Not Found"); passed = false; }

if (!passed) process.exit(1);
