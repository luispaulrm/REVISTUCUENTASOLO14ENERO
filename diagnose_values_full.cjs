const fs = require('fs');
try {
    const raw = fs.readFileSync('./canonical_contract.json', 'utf8');
    const data = JSON.parse(raw);
    console.log("JSON Parse Success!");

    // Check Lineas (Processor View)
    const lineas = data.contrato.tabla_prestaciones.lineas;
    const matLine = lineas.find(l => l.nombre.includes("MATERIALES CLÍNICOS"));
    const medLine = lineas.find(l => l.nombre.includes("MEDICAMENTOS"));

    console.log("=== LINEAS (Processor) ===");
    console.log("Materiales:", JSON.stringify(matLine.libre_eleccion.tope));
    console.log("Medicamentos:", JSON.stringify(medLine.libre_eleccion.tope));

    // Check Coberturas (Auditor View)
    const cobs = data.contrato.coberturas;
    const matCob = cobs.find(c => c.descripcion_textual.includes("MATERIALES CLÍNICOS"));
    const medCob = cobs.find(c => c.descripcion_textual.includes("MEDICAMENTOS"));

    console.log("=== COBERTURAS (Auditor) ===");
    console.log("Materiales:", matCob['TOPE LOCAL 1 (VAM/EVENTO)']); // Should be displayed as "20 UF" or similar if logic was custom, wait, transform logic used AC2/UF based on type.
    // In my edit, I set 'factor': 20, 'unidad': 'UF'.
    // The transformation logic I ran initially wouldn't have caught this if I edited the file POST transformation directly. 
    // Wait, I updated Coberturas manually in step 456. So it should be fine.
    console.log("Medicamentos:", medCob['TOPE LOCAL 1 (VAM/EVENTO)']);

} catch (e) {
    console.error("JSON Error:", e.message);
}
