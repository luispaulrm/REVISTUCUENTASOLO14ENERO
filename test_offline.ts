import fs from 'fs';

const filePath = 'C:\\Users\\drlui\\Downloads\\canonical_BSLU2109B4 (1) (3) (2).json';

try {
    const canonical = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    canonical.topes.forEach((t: any) => {
        const text = (t.fuente_textual || t.raw || "").toUpperCase();

        if (t.razon === "SIN_TOPE_EXPRESO_EN_CONTRATO" || text.includes("SIN TOPE") || text.includes("ILIMITADO")) {
            t.tipo = "SIN_TOPE_EXPLICITO";
            t.valor = null;
            t.unidad = null;
            t.tope_existe = false;
            t.razon = "SIN_TOPE_EXPRESO_EN_CONTRATO";
        }
        else if (t.valor !== null && t.valor !== undefined) {
            t.tipo = "NUMERICO";
            t.tope_existe = true;

            if (!t.unidad || t.unidad === "DESCONOCIDO") {
                if (text.includes("UF") || text.includes("U.F.")) t.unidad = "UF";
                else if (text.includes("AC2")) t.unidad = "AC2";
                else if (text.match(/\b(VAM|V20|V10|VA|V.A|VECES ARANCEL)\b/)) t.unidad = "VAM";
                else if (text.includes("PESOS") || text.includes("$") || text.includes("CLP") || text.includes("CL$")) t.unidad = "PESOS";
                else t.unidad = null;
            }
        }
        else {
            t.tipo = "NO_ENCONTRADO";
            t.valor = null;
            t.unidad = null;
            t.tope_existe = false;
            if (!t.razon) t.razon = "CELDA_VACIA_OCR";
        }
    });

    fs.writeFileSync('C:\\Users\\drlui\\Downloads\\canonical_BSLU2109B4_FIXED.json', JSON.stringify(canonical, null, 2));
    console.log('✅ Fixes applied retroactively to test file.');

    // Quick validation print
    const diaCama = canonical.topes.filter((t: any) => t.fuente_textual && t.fuente_textual.toLowerCase().includes('cama'));
    console.log('\n--- VERIFICACIÓN DE DÍA CAMA ---');
    console.log(JSON.stringify(diaCama, null, 2));

    const urgencias = canonical.topes.filter((t: any) => t.fuente_textual && t.fuente_textual.toLowerCase().includes('urgencia'));
    console.log(`\n--- VERIFICACIÓN DE URGENCIAS (${urgencias.length} topes) ---`);
    console.log(JSON.stringify(urgencias.slice(0, 2), null, 2)); // Print first two

} catch (e) {
    console.error('Error reading file:', e);
}
