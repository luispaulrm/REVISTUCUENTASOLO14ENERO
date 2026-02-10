
import * as fs from 'fs';
import * as path from 'path';

// --- MEP LOGIC (Inlined for standalone execution) ---
const DOMINIO_REGEX = {
    HOTELERIA: /term[oó]metro|calz[oó]n|set.*aseo|chata|pa[ñn]al|confort|hoteler[ií]a|faja.*compresora|medias?.*antiemb[oó]licas?/i,
    INSUMO_ESTANDAR: /mascarilla|bigotera|aquapack|frasco|jeringa|aguja|bajadas?|tegaderm|ap[oó]sito|algod[oó]n|gasas?|t[oó]rulas?/i,
    MATERIAL_CLINICO_ESPECIFICO: /trocar|clip|sutura|hemolock|stapler|grapadora|bistur[ií]|hoja.*bistur[ií]/i
};

// Heuristic Context (As if we detected typical sections)
const defaultAnchors = { hasPabellon: true, hasDayBed: true };

function checkMEP(text: string, anchors: typeof defaultAnchors) {
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

    return null; // Passed MEP
}

// --- MAIN EXECUTION ---

const filePath = path.join('C:', 'Users', 'drlui', 'OneDrive', 'Documentos', 'INDISA', 'APENDICITIS', 'CUENT APENDICITIS.json');

try {
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const cuenta = JSON.parse(rawData);

    console.log(`\n🔍 SIMULACIÓN MOTOR 3 (MEP) - CUENTA: ${cuenta.invoiceNumber} (${cuenta.patientName})`);
    console.log("--------------------------------------------------------------------------------");

    let totalMEP = 0;
    let countMEP = 0;
    const detalles: any[] = [];

    // Flatten items from sections
    cuenta.sections.forEach((sec: any) => {
        if (!sec.items) return;
        sec.items.forEach((item: any) => {
            const result = checkMEP(item.description, defaultAnchors);
            if (result) {
                totalMEP += (item.total || 0);
                countMEP++;
                detalles.push({
                    item: item.description,
                    section: sec.category,
                    monto: item.total,
                    causa: result
                });
            }
        });
    });

    // Sort by mount descending
    detalles.sort((a, b) => b.monto - a.monto);

    if (detalles.length > 0) {
        console.log(`\n🚨 HALLAZGOS DE 'ADMINISTRATIVE UNBUNDLING' (TIPO C):\n`);
        console.log(`%-50s | %-30s | %-10s | %s`, "ÍTEM", "SECCIÓN", "MONTO", "CAUSA MEP");
        console.log("-".repeat(140));

        detalles.forEach(d => {
            console.log(`%-50s | %-30s | %-10s | %s`,
                d.item.substring(0, 48),
                d.section.substring(0, 28),
                d.monto,
                d.causa.replace('DESCLASIFICACION_ADMINISTRATIVA ', '')
            );
        });

        console.log("-".repeat(140));
        console.log(`\n💰 TOTAL RECHAZADO POR MEP (MOTOR 3): $${totalMEP.toLocaleString('es-CL')}`);
        console.log(`📉 CANTIDAD DE ÍTEMS AFECTADOS: ${countMEP}`);
    } else {
        console.log("✅ No se detectaron ítems rechazados por MEP.");
    }

} catch (error: any) {
    console.error("❌ Error leyendo o procesando el archivo:", error.message);
}
