import * as fs from 'fs';

// Read V141 report (the one with 8 matched items for 134100)
const data = JSON.parse(fs.readFileSync('c:/REVISATUCUENTASOLO14enero/V141_FINAL_REPORT.json', 'utf8'));
const pamRows = data.pamRows || [];
const billItems: any[] = data.bill?.items || [];

console.log(`Total bill items: ${billItems.length}`);
console.log(`Total PAM rows: ${pamRows.length}`);

// Find the row for $134,100
const row = pamRows.find((r: any) => Math.round(r.montoCopago) === 134100);
if (!row) {
    console.log("No PAM row found for $134,100");
    process.exit(1);
}

console.log(`\n=== PAM ROW: ${row.descripcion} ===`);
console.log(`Matched Item IDs (${row.trace.matchedBillItemIds.length}):`, JSON.stringify(row.trace.matchedBillItemIds));

// Cross-reference with bill items
console.log(`\n--- REAL ITEMS (from V141 bill) ---`);
let sum = 0;
row.trace.matchedBillItemIds.forEach((id: string) => {
    const item = billItems.find((i: any) => i.id === id);
    if (item) {
        const code = item.codeInternal || item.id;
        console.log(`{ id: '${item.id}', description: '${item.description}', total: ${item.total}, originalIndex: ${(item as any).originalIndex ?? 'N/A'}, section: '${item.section || ''}' },  // Code: ${code}`);
        sum += item.total;
    } else {
        console.log(`ITEM NOT FOUND: ${id}`);
    }
});

console.log(`\nSUM: $${sum.toLocaleString()}`);
console.log(`DIFFERENCE: $${(134100 - sum).toLocaleString()}`);
