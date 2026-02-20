import * as fs from 'fs';

try {
    const data = JSON.parse(fs.readFileSync('c:/REVISATUCUENTASOLO14enero/V141_FINAL_REPORT.json', 'utf8'));
    const pamRows = data.pamRows || [];
    const billItems = data.bill?.items || data._rawCuenta || [];

    const row = pamRows.find(r => Math.round(r.montoCopago) === 134100);
    if (row && row.trace.matchedBillItemIds.length === 8) {
        console.log(`FOUND THE 8 ITEMS for 134100!`);
        let actualItems = row.trace.matchedBillItemIds.map(id => billItems.find(i => i.id === id) || { description: id, total: '?' });

        let sum = 0;
        actualItems.forEach(i => {
            console.log(`{ id: '${i.id}', description: '${i.description}', total: ${i.total}, originalIndex: ${i.originalIndex}, section: 'FARMACIA' },`);
            sum += Number(i.total);
        });
        console.log(`TOTAL SUM: ${sum}`);
    }
} catch (e) { }
