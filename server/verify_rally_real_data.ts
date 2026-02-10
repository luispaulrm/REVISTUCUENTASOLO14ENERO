
import { buildRally, renderRallyMarkdown } from './services/rallyBuilder.service';
import fs from 'fs';

// 1. Load the User's Real Data
const fileContent = fs.readFileSync('c:/Users/drlui/Downloads/audit_forense_1770331998207.json', 'utf8');
const json = JSON.parse(fileContent);

const rawCuenta = json._rawCuenta;
const findings = json.findings || [];

// 2. Reconstruct "cleanedPam" from valid findings
// The user wants "Rally" to match the PAM totals.
// In the current architecture, meaningful PAM items are often captured as findings.
// We'll simulate the PAM structure that `buildRally` expects.

const totalInput = 452175; // From the JSON header

// We extract items that start with PAM reference or are clearly PAM based
// Helper to parse markdown table from rationale
function parseRationaleTable(rationale: string): { descripcion: string, copago: number }[] {
    const items: { descripcion: string, copago: number }[] = [];
    if (!rationale) return items;

    // Regex to find table rows: | Col 1 | Col 2 | ... | $Amount | ... |
    // We look for lines starting with | and containing $
    const lines = rationale.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('|') && line.includes('$') && !line.includes('---')) {
            const parts = line.split('|').map(p => p.trim());
            // Expected format often: | Zona | Familia | Item Detalle | Monto | ...
            // We need to identify which column has the description and amount
            // Based on JSON samples: Index 3 is Description (Item Detalle), Index 4 is Amount (Monto)
            // Let's protect against variations.

            // Find column with $ amount
            const amountIdx = parts.findIndex(p => p.includes('$'));
            if (amountIdx !== -1 && amountIdx > 1) {
                const amountStr = parts[amountIdx].replace(/[$.]/g, '').trim(); // Remove $ and dots
                const amount = parseInt(amountStr, 10);

                // Description usually 1 column before amount, or 2.
                // In sample: | PABELLON | MEDICAMENTOS | LIDOCAINA ... | $721 |
                // parts[0]='', parts[1]='PABELLON', parts[2]='MEDICAMENTOS', parts[3]='LIDOCAINA...', parts[4]='$721'
                const descIdx = amountIdx - 1;
                let description = parts[descIdx];

                // Clean up description (remove codes if messy)
                description = description.split(' 22')[0].split(' 11')[0]; // Simple heuristic to chop trailing codes if present

                if (!isNaN(amount)) {
                    items.push({ descripcion: description, copago: amount });
                }
            }
        }
    }
    return items;
}

const simulatedPamItems: any[] = [];

// 1. Extract from DELTA findings (Priority)
findings.forEach((f: any) => {
    if (f.id.startsWith('DELTA')) {
        const subItems = parseRationaleTable(f.rationale || f.hallazgo); // Check rationale or hallazgo field
        if (subItems.length > 0) {
            const tableSum = subItems.reduce((acc, i) => acc + i.copago, 0);
            console.log(`[DEBUG] Extracted ${subItems.length} items from ${f.id} (Rubro: ${f.rubro_rally}) (Sum Table: $${tableSum} vs Finding: $${f.amount})`);

            // Robust Fallback if rubro_rally is missing
            let rubro = f.rubro_rally;
            if (!rubro) {
                if (f.id.includes('DELTA-001')) rubro = 'I';
                if (f.id.includes('DELTA-002')) rubro = 'II';
                if (f.id.includes('DELTA-003')) rubro = 'III';
            }

            subItems.forEach(item => {
                simulatedPamItems.push({
                    codigo: 'FORENSIC_ITEM',
                    descripcion: item.descripcion,
                    copago: item.copago,
                    agrupador: 'PAM_RECONSTRUCTED',
                    rubroForced: rubro
                });
            });
        } else {
            // Fallback if no table found: use main finding
            simulatedPamItems.push({
                codigo: f.codigos || f.id,
                descripcion: f.label || f.glosa,
                copago: f.amount,
                agrupador: 'PAM_RECONSTRUCTED'
            });
        }
    }
});

// 2. Secondary Logic Removed.
// We have confirmed that DELTA findings sum to exactly $452,175.
// Any other findings are either subsets of these or "OK" items that don't contribute to the actionable copay.

const totalFindingsSum = simulatedPamItems.reduce((sum: number, item: any) => sum + (item.copago || 0), 0);
console.log(`[DEBUG] Sum of Reconstructed Findings: $${totalFindingsSum}`);

// If findings strictly sum to $452,175, then we are good.
// If not, we are missing data in the input JSON itself.

const cleanedPam = {
    folios: [{
        items: simulatedPamItems
    }]
};

console.log(`[DEBUG] Reconstructed ${simulatedPamItems.length} PAM items from findings.`);
console.log(`[DEBUG] Total Input Target: $${totalInput}`);

// 3. Run Build Rally
try {
    const rally = buildRally(rawCuenta, totalInput, cleanedPam);

    // 4. Output Results
    console.log('\n--- RALLY BUILDER OUTPUT ---\n');
    console.log(`Total Calculated: $${rally.total_rubros_sum}`);
    console.log(`Delta: $${rally.delta}`);
    console.log('Rubros:', rally.rubros.map(r => `${r.id}: $${r.monto}`).join(', '));

    console.log('\n--- MARKDOWN RENDER ---\n');
    console.log(renderRallyMarkdown(rally));

} catch (error) {
    console.error('Error running buildRally:', error);
}
