import * as fs from 'fs';

try {
    const rawData = fs.readFileSync('c:/Users/drlui/Downloads/audit_m10_mu_oz_vilugron_daysi_ester_2026-02-20 (5).json', 'utf8');
    const data = JSON.parse(rawData);

    // Extracción de ítems de la cuenta
    let billItems = [];
    if (data.bill && data.bill.items) {
        billItems = data.bill.items;
    } else if (data._rawCuenta) {
        billItems = data._rawCuenta;
    }

    if (billItems.length > 0) {
        console.log(`Total ítems leídos: ${billItems.length}`);

        // Vamos a buscar combinaciones que sumen 134100, especialmente focalizándonos en fármacos.
        const intTarget = 134100;

        // Filtramos para aislar fármacos/insumos que podrían ser los 8 elementos (ignoremos hostelería y cosas grandes).
        // Y tomamos solo de una sección si existe, o contiguos
        const candidates = billItems.map((item, index) => ({
            id: item.codigo || item.id || `item_${index}`,
            desc: item.descripcion || item.glosa || item.description || '',
            total: item.total || item.valor || item.monto || 0,
            originalIndex: index
        })).filter(i => i.total > 0 && i.total <= intTarget);

        // Print all items matching typical drug names or in the relevant range of items to reconstruct manually
        console.log("\\n--- Posibles Fármacos ---");
        const posiblesFarmacos = candidates.filter(i =>
            i.desc.includes('CEFTRIAXONA') ||
            i.desc.includes('METRONIDAZOL') ||
            i.desc.includes('ONDANSETRON') ||
            i.desc.includes('SUERO') ||
            i.desc.includes('FENTANYL') ||
            i.desc.includes('KETOROLA') ||
            i.desc.includes('PROPOFOL') ||
            i.desc.includes('SEVOFLURA') ||
            i.desc.includes('PARACETAMOL') ||
            i.desc.includes('OMEPRAZOL') ||
            i.desc.includes('ENOXAPARIN')
        );

        candidates.slice(0, 30).forEach(i => {
            console.log(`Idx: ${i.originalIndex}, Total: ${i.total}, Desc: ${i.desc}`);
        });

    } else {
        console.log("No se pudieron extraer los ítems.");
    }

} catch (e) {
    console.error("Error", e);
}
