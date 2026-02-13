// Test: Verify opacity detection against real PAM data
const fs = require('fs');
const pam = JSON.parse(fs.readFileSync('c:/Users/drlui/OneDrive/Documentos/INDISA/APENDICITIS/PAM APENDICITIS.json', 'utf8'));

// Simulate PAM line extraction (same logic as auditEngine STEP 1)
const pamLines = [];
if (pam.folios && Array.isArray(pam.folios)) {
    pam.folios.forEach((folio, folioIdx) => {
        const desglose = folio.desglosePorPrestador || [];
        desglose.forEach((prest, prestadorIdx) => {
            const items = prest.items || [];
            items.forEach((item, itemIdx) => {
                const desc = (item.descripcion || '').toString();
                const bonif = Number(item.bonificacion || 0);
                const copago = Number(item.copago || 0);
                const code = (item.codigoGC || item.codigo || '').toString().trim();

                pamLines.push({
                    uniqueId: "PAM_" + folioIdx + "_" + prestadorIdx + "_" + itemIdx + "_" + code,
                    codigo: code,
                    descripcion: desc,
                    bonificacion: bonif,
                    copago: copago
                });
            });
        });
    });
}

console.log("Total PAM lines extracted: " + pamLines.length);
console.log("");

// Now manually implement the opacity detection logic (same as opacityDetector.service.ts)
const CODIGOS_AGRUPADORES = new Set([
    "3101001", "3101002", "3101302", "3101304", "3101104", "3201001", "3201002"
]);
const CODIGOS_GASTOS_GENERICOS = new Set(["3201001", "3201002"]);

const linesByCode = new Map();
for (const line of pamLines) {
    const norm = line.codigo.replace(/[\.\-\s]/g, '').trim();
    if (!linesByCode.has(norm)) linesByCode.set(norm, []);
    linesByCode.get(norm).push(line);
}

const declarations = [];

for (const line of pamLines) {
    const norm = line.codigo.replace(/[\.\-\s]/g, '').trim();
    if (line.copago <= 0) continue;

    // TIPO 1
    if (CODIGOS_AGRUPADORES.has(norm) && line.bonificacion === 0 && !CODIGOS_GASTOS_GENERICOS.has(norm)) {
        declarations.push({
            tipo: "AGRUPADOR_SIN_DESGLOSE",
            tipoNumero: 1,
            codigoGC: line.codigo,
            descripcion: line.descripcion,
            montoAfectado: line.copago,
            bonificacion: line.bonificacion
        });
    }

    // TIPO 2
    if (CODIGOS_GASTOS_GENERICOS.has(norm) && line.copago > 0) {
        declarations.push({
            tipo: "GASTOS_NO_CUBIERTOS_GENERICOS",
            tipoNumero: 2,
            codigoGC: line.codigo,
            descripcion: line.descripcion,
            montoAfectado: line.copago,
            bonificacion: line.bonificacion
        });
    }

    // TIPO 3
    if (CODIGOS_AGRUPADORES.has(norm) && line.bonificacion === 0 && line.copago > 0) {
        const siblings = linesByCode.get(norm) || [];
        const hasBonifiedSibling = siblings.some(s => s.uniqueId !== line.uniqueId && s.bonificacion > 0);
        if (hasBonifiedSibling) {
            const alreadyAdded = declarations.some(d => d.tipo === "FRAGMENTACION_INTERNA" && d.pamLineId === line.uniqueId);
            if (!alreadyAdded) {
                declarations.push({
                    tipo: "FRAGMENTACION_INTERNA",
                    tipoNumero: 3,
                    codigoGC: line.codigo,
                    descripcion: line.descripcion,
                    montoAfectado: line.copago,
                    bonificacion: line.bonificacion,
                    pamLineId: line.uniqueId
                });
            }
        }
    }
}

console.log("=== OPACITY DECLARATIONS FOUND: " + declarations.length + " ===");
console.log("");

let totalOpaco = 0;
for (const d of declarations) {
    console.log("TIPO " + d.tipoNumero + " - " + d.tipo);
    console.log("  Codigo: " + d.codigoGC);
    console.log("  Descripcion: " + d.descripcion);
    console.log("  Monto Afectado: $" + d.montoAfectado.toLocaleString('es-CL'));
    console.log("  Bonificacion: $" + d.bonificacion.toLocaleString('es-CL'));
    console.log("");
    totalOpaco += d.montoAfectado;
}

console.log("TOTAL OPACO: $" + totalOpaco.toLocaleString('es-CL'));
console.log("TOTAL COPAGO PAM: $" + pam.global.totalCopago.toLocaleString('es-CL'));
console.log("RATIO OPACIDAD: " + (totalOpaco / pam.global.totalCopago * 100).toFixed(1) + "%");
