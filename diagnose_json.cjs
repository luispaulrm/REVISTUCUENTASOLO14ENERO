const fs = require('fs');
try {
    const raw = fs.readFileSync('./canonical_contract.json', 'utf8');
    const data = JSON.parse(raw);
    const keys = Object.keys(data.contrato);
    console.log("Keys in contrato:", keys);
    if (data.contrato.coberturas) {
        console.log("Coberturas found! Count:", data.contrato.coberturas.length);
        console.log("Sample:", JSON.stringify(data.contrato.coberturas[0], null, 2));
    } else {
        console.log("Coberturas NOT found.");
    }
} catch (e) {
    console.error(e);
}
