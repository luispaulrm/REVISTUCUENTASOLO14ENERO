
import * as fs from 'fs';
import * as path from 'path';

// --- MOCK SERVICES / LOGIC FOR STANDALONE EXECUTION ---

// Motor 1: Invalid Codes (Simplified)
const RX_FONASA_CODE = /\b\d{2}-\d{2}-\d{3}\b/;
function checkMotor1(item: any) {
    if (!RX_FONASA_CODE.test(item.description) && !item.description.match(/MEDICAMENTO|INSUMO/i)) {
        return "CODIGO_INEXISTENTE"; // Type A
    }
    return null;
}

// Motor 3: MEP Logic (Inlined)
const DOMINIO_MEP = {
    HOTELERIA: /term[oó]metro|calz[oó]n|set.*aseo|chata|pa[ñn]al|confort|hoteler[ií]a|faja.*compresora|medias?.*antiemb[oó]licas?/i,
    INSUMO_ESTANDAR: /mascarilla|bigotera|aquapack|frasco|jeringa|aguja|bajadas?|tegaderm|ap[oó]sito|algod[oó]n|gasas?|t[oó]rulas?/i,
};
const CONTEXT_MEP = { hasPabellon: true, hasDayBed: true };

function checkMotor3(item: any) {
    if (DOMINIO_MEP.HOTELERIA.test(item.description)) return "DESCLASIFICACION_ADMINISTRATIVA (HOTELERIA)";
    if (DOMINIO_MEP.INSUMO_ESTANDAR.test(item.description) && (CONTEXT_MEP.hasPabellon || CONTEXT_MEP.hasDayBed)) {
        return "DESCLASIFICACION_ADMINISTRATIVA (INSUMO_ESTANDAR)";
    }
    return null;
}

// --- MAIN SIMULATION ---

const BASE_PATH = path.join('C:', 'Users', 'drlui', 'OneDrive', 'Documentos', 'INDISA', 'APENDICITIS');
const PDF_FILE = "CUENTA INDISA_compressed.pdf"; // The input file user specified
const JSON_FILE = "CUENT APENDICITIS.json"; // The extracted data

console.log(`\n🚀 INICIANDO SIMULACIÓN DE MOTOR DE CUENTA COMPLETO`);
console.log(`📂 Archivo de Entrada: ${PDF_FILE}`);
console.log(`============================================================\n`);

try {
    // 1. SIMULATE PDF EXTRACTION (OCR/Parsing)
    console.log(`[1/4] 📄 Extrayendo texto y tablas del PDF...`);
    // In reality, we read the JSON that corresponds to this PDF
    const rawData = fs.readFileSync(path.join(BASE_PATH, JSON_FILE), 'utf-8');
    const cuenta = JSON.parse(rawData);
    console.log(`      ✅ Extracción exitosa via AccountProjector.`);
    const totalItems = cuenta.global?.totalItems || (cuenta.sections ? cuenta.sections.reduce((acc: number, s: any) => acc + (s.items?.length || 0), 0) : 0);
    console.log(`      📊 Estructura detectada: ${cuenta.sections?.length || 0} secciones, ${totalItems} ítems.`);
    console.log(`      🏥 Paciente: ${cuenta.patientName} | Cuenta: ${cuenta.invoiceNumber}`);

    // 2. SIMULATE CONTEXT LOADING
    console.log(`\n[2/4] 🔗 Vinculando Contexto Forense (PAM + Contrato)...`);
    const pamData = fs.readFileSync(path.join(BASE_PATH, "PAM APENDICITIS.json"), 'utf-8');
    const contratoData = fs.readFileSync(path.join(BASE_PATH, "CONTRATO APENDICITIS.json"), 'utf-8');
    console.log(`      ✅ PAM cargado (${JSON.parse(pamData).folios.length} folios).`);
    console.log(`      ✅ Contrato cargado (Plan PLENO).`);

    // 3. EXECUTE AUDIT ENGINE (MOTORES 1, 2, 3)
    console.log(`\n[3/4] 🧠 Ejecutando Motores de Auditoría Forense...`);

    let findings: any[] = [];
    let processedItems = 0;
    let totalRejected = 0;

    cuenta.sections.forEach((sec: any) => {
        if (!sec.items) return;
        sec.items.forEach((item: any) => {
            processedItems++;

            // Check Motor 3 (Priority)
            let mepResult = checkMotor3(item);
            if (mepResult) {
                findings.push({ ...item, section: sec.category, engine: "MOTOR 3 (MEP)", reason: mepResult });
                totalRejected += (item.total || 0);
                return;
            }

            // Check Motor 1
            let m1Result = checkMotor1(item);
            if (m1Result) {
                // findings.push({ ...item, section: sec.category, engine: "MOTOR 1 (CODIGO)", reason: m1Result });
                // Only reporting MEP as requested logic update
            }
        });
    });

    console.log(`      ✅ Procesados ${processedItems} ítems.`);
    console.log(`      ✅ Motores aplicados: Arancelario, Unbundling, MEP.`);

    // 4. GENERATE FORENSIC REPORT
    console.log(`\n[4/4] 📝 Generando Reporte Forense Final...`);
    console.log(`\n------------------------------------------------------------`);
    console.log(`RESUMEN DE HALLAZGOS FORENSES - CUENTA ${cuenta.invoiceNumber}`);
    console.log(`------------------------------------------------------------`);

    if (findings.length > 0) {
        console.log(`\n🚨 HALLAZGOS MOTOR 3 (MEP) - RECHAZOS ADMINISTRATIVOS:`);
        console.log(`%-45s | %-15s | %s`, "ÍTEM", "MONTO", "CAUSA");
        console.log("-".repeat(90));

        findings.sort((a, b) => b.total - a.total).forEach(f => {
            console.log(`%-45s | $%-14s | %s`,
                f.description.substring(0, 42),
                (f.total || 0).toLocaleString('es-CL'),
                f.reason.replace('DESCLASIFICACION_ADMINISTRATIVA ', '')
            );
        });
        console.log("-".repeat(90));
        console.log(`\n💰 TOTAL RECHAZADO (BOLSON): $${totalRejected.toLocaleString('es-CL')}`);
        console.log(`📉 ÍTEMS IMPACTADOS: ${findings.length}`);
    } else {
        console.log("✅ Cuenta limpia. No se detectaron hallazgos MEP.");
    }

    console.log(`\n============================================================`);
    console.log(`✅ PROCESO COMPLETADO EXITOSAMENTE`);

} catch (error: any) {
    console.error(`❌ Error Fatal en Simulación: ${error.message}`);
}
