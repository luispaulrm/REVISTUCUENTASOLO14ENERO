import * as fs from 'fs';

const files = [
    'c:/Users/drlui/Downloads/audit_m10_mu_oz_vilugron_daysi_ester_2026-02-20 (5).json',
    'c:/REVISATUCUENTASOLO14enero/V141_FINAL_REPORT.json',
    'c:/Users/drlui/Downloads/audit_forense_1769991255662.json'
];

for (const file of files) {
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        let pamRows = data.pamRows || [];

        console.log(`Checking ${file}`);
        let billItems = data.bill?.items || data._rawCuenta || [];

        if (pamRows.length > 0) {
            const row = pamRows.find(r => r.montoCopago === 134100 || Math.round(r.montoCopago) === 134100);
            if (row) {
                console.log(`Found row 134100 in ${file}`);
                console.log(`Matched Items:`, row.trace.matchedBillItemIds.length);
                // If there are candidates, let's see them
                row.trace.attempts.forEach(a => {
                    if (a.candidates) {
                        a.candidates.forEach(c => {
                            if (c.items.length === 8) {
                                console.log(`FOUND AN 8-ITEM COMBINATION! Score: ${c.score}`);
                                c.items.forEach(i => {
                                    console.log(`- ${i.total} | ${i.description}`);
                                });
                            }
                        });
                    }
                });
            }
        }
    } catch (e) { }
}
