const fs = require('fs');
const raw = fs.readFileSync('./canonical_contract.json', 'utf8');
const data = JSON.parse(raw);
console.log("LINEAS NAMES:");
data.contrato.tabla_prestaciones.lineas.slice(40, 60).forEach(l => console.log(l.nombre)); // View slice where Materials should be
console.log("COBERTURAS NAMES:");
data.contrato.coberturas.forEach(c => console.log(c['descripcion_textual'] || c['PRESTACIÓN CLAVE']));
