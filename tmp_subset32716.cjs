// Find which subset of the 12 confirmed items sums to exactly $32,716
const items = [
    { name: 'Branula 20G (Idx 5)', val: 872 },
    { name: 'Branula 22G (Idx 6)', val: 872 },
    { name: 'Branula 18G (Idx 80)', val: 872 },
    { name: 'Jeringa 10cc Luer Lock (Idx 8)', val: 551 },
    { name: 'Bigotera Adulto (Idx 10)', val: 4034 },
    { name: 'Aquapack 340 (Idx 11)', val: 5495 },
    { name: 'Chata Honda (Idx 83)', val: 1058 },
    { name: 'Bandeja Alusa x1 (Idx 2)', val: 633 },
    { name: 'Bandeja Alusa x2 (Idx 77)', val: 1266 },
    { name: 'Torula Algodon (Idx 79)', val: 92 },
    { name: 'Aguja 18G (Idx 24)', val: 261 },
    { name: 'Jeringa Monoject (Idx 97)', val: 17525 },
];

const TARGET = 32716;
const total12 = items.reduce((a, b) => a + b.val, 0);
console.log("Total de los 12 items: $" + total12);
console.log("Target: $" + TARGET);
console.log("Exceso: $" + (total12 - TARGET));
console.log("");

// Find ALL subsets that sum to TARGET
let found = 0;

function findSubsets(idx, currentSum, included, excluded) {
    if (currentSum === TARGET) {
        found++;
        console.log("=== MATCH #" + found + " ===");
        console.log("ISAPRE NO PAGO estos (excluidos del copago $32.716):");
        excluded.forEach(e => console.log("  EXCLUIDO: " + e.name + " ($" + e.val + ")"));
        console.log("ISAPRE SI COBRO como copago (suman $32.716):");
        included.forEach(i => console.log("  INCLUIDO: " + i.name + " ($" + i.val + ")"));
        const checkSum = included.reduce((a, b) => a + b.val, 0);
        console.log("  CHECK SUM: $" + checkSum);
        console.log("");
        return; // Don't stop, find all matches
    }
    if (idx >= items.length) return;
    if (currentSum > TARGET) return;

    // Include item[idx]
    findSubsets(idx + 1, currentSum + items[idx].val, [...included, items[idx]], excluded);
    // Exclude item[idx]
    findSubsets(idx + 1, currentSum, included, [...excluded, items[idx]]);
}

findSubsets(0, 0, [], []);

if (found === 0) {
    console.log("NO HAY SUBCONJUNTO EXACTO DE ESTOS 12 ITEMS QUE SUME $32.716");
}
console.log("Total matches found: " + found);
