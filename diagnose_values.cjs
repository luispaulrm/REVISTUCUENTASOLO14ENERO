const fs = require('fs');
const raw = fs.readFileSync('./canonical_contract.json', 'utf8');
const data = JSON.parse(raw);
const cobs = data.contrato.coberturas;

const lab = cobs.find(c => c.descripcion_textual.includes("LABORATORIO"));
const visit = cobs.find(c => c.descripcion_textual.includes("TRATANTE"));
const hmq = cobs.find(c => c.descripcion_textual.includes("HONORARIOS"));

console.log("=== VERIFICACION FINAL ===");
console.log("Laboratorio:", lab ? lab['TOPE LOCAL 1 (VAM/EVENTO)'] : "NOT FOUND");
console.log("Visita Tratante:", visit ? visit['TOPE LOCAL 1 (VAM/EVENTO)'] : "NOT FOUND"); // Should be 0.5 UF
console.log("HMQ:", hmq ? hmq['TOPE LOCAL 1 (VAM/EVENTO)'] : "NOT FOUND");
