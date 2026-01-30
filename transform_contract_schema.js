const fs = require('fs');

try {
    const raw = fs.readFileSync('./canonical_contract.json', 'utf8');
    const data = JSON.parse(raw);
    const lineas = data.contrato.tabla_prestaciones.lineas.filter(l => l.tipo === 'prestacion');

    // Transformation Logic (Line -> Cobertura)
    const coberturas = lineas.map(l => {
        // Derive Tope Value for Audit Engine Parsing
        let topeDisplay = "SIN_TOPE";
        if (l.libre_eleccion && l.libre_eleccion.tope) {
            const t = l.libre_eleccion.tope;
            if (t.tipo === 'AC2') topeDisplay = `${t.factor} AC2`;
            if (t.tipo === 'UF') topeDisplay = `${t.valor} UF`;
            if (t.tipo === 'VARIABLE') topeDisplay = "VARIABLE";
        }

        // Derive NFE Tope
        let topeNfe = "SIN_TOPE";
        if (l.nfe && l.nfe.aplica) {
            if (l.nfe.valor) topeNfe = `${l.nfe.valor} ${l.nfe.unidad}`;
            else if (l.nfe.bloque_id) topeNfe = `Expandido (${l.nfe.bloque_id})`;
        }

        return {
            "descripcion_textual": l.nombre,
            "PRESTACIÓN CLAVE": l.nombre, // Legacy compat
            "ambito": "Hospitalario",
            "categoria": "Hospitalario",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "% BONIFICACIÓN": `${l.libre_eleccion?.porcentaje || 0}%`,
            "TOPE LOCAL 1 (VAM/EVENTO)": topeDisplay,
            "TOPE LOCAL 2 (ANUAL/UF)": topeNfe,
            "RESTRICCIÓN Y CONDICIONAMIENTO": l.nfe?.razon || "",
            "anclaje_linea": l.linea_id,
            "original_node": l
        };
    });

    data.contrato.coberturas = coberturas;

    // Ensure metadata validation helper is happy
    if (!data.contrato.reglas) data.contrato.reglas = [];

    fs.writeFileSync('./canonical_contract.json', JSON.stringify(data, null, 2));
    console.log(`Successfully transformed ${lineas.length} lines into ${coberturas.length} coverage clauses.`);

} catch (e) {
    console.error("Transformation Failed:", e);
    process.exit(1);
}
