const fs = require('fs');
const cuent = JSON.parse(fs.readFileSync('c:/Users/drlui/OneDrive/Documentos/INDISA/APENDICITIS/CUENT APENDICITIS.json', 'utf8'));

// User's proposed list of 12 items that sum to $32.716
const userItems = [
    { keyword: 'BRANULA', unitPrice: 872, expectedTotal: 872, note: 'x3 = 2616' },
    { keyword: 'JERINGA 10 cc. LUER LOCK', unitPrice: 551, expectedTotal: 551, note: '' },
    { keyword: 'BIGOTERA', unitPrice: 4034, expectedTotal: 4034, note: '' },
    { keyword: 'AQUAPACK', unitPrice: 5495, expectedTotal: 5495, note: '' },
    { keyword: 'CHATA', unitPrice: 1058, expectedTotal: 1058, note: '' },
    { keyword: 'TUBO ENDOTRAQUEAL', unitPrice: 510, expectedTotal: 510, note: 'NEED TO FIND' },
    { keyword: 'BANDEJA ALUSA', unitPrice: 633, expectedTotal: 1266, note: 'qty 2' },
    { keyword: 'BANDEJA ALUSA', unitPrice: 633, expectedTotal: 633, note: 'qty 1' },
    { keyword: 'TORULA', unitPrice: 23, expectedTotal: 92, note: 'qty 4' },
    { keyword: 'AGUJA', unitPrice: 261, expectedTotal: 261, note: '' },
    { keyword: 'ADAPTADOR', unitPrice: 478, expectedTotal: 210, note: 'user says 210 but JSON has 478?' },
    { keyword: 'JERINGA INYECTORA MONOJECT', unitPrice: 17525, expectedTotal: 17525, note: '' },
];

// First, list ALL items with their section, index, description, qty, unitPrice, total
console.log("=== ALL ITEMS IN CUENTA ===");
let allItems = [];
cuent.sections.forEach(s => {
    s.items.forEach(i => {
        allItems.push({
            section: s.category,
            index: i.index,
            desc: i.description,
            qty: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total
        });
    });
});

// Now search for each user item
console.log("\n=== SEARCHING FOR USER'S 12 ITEMS ===\n");

let runningTotal = 0;

// 1. BRANULA x3
const branulas = allItems.filter(i => i.desc.includes('BRANULA'));
console.log("BRANULA matches:");
branulas.forEach(b => {
    console.log("  Idx " + b.index + " | " + b.desc + " | qty=" + b.qty + " | unit=" + b.unitPrice + " | total=" + b.total + " | section=" + b.section);
});
const branulaSum = branulas.reduce((a, b) => a + b.total, 0);
console.log("  BRANULA total across all: $" + branulaSum);
// User says 872 x 3 = 2616. Each branula in JSON has qty=1, total=872. There are 3 branula entries.
runningTotal += branulaSum;

// 2. JERINGA 10cc LUER LOCK
const jeringaLock = allItems.filter(i => i.desc.includes('JERINGA 10 cc. LUER LOCK'));
console.log("\nJERINGA 10cc LUER LOCK:");
jeringaLock.forEach(j => console.log("  Idx " + j.index + " | total=" + j.total + " | section=" + j.section));
if (jeringaLock.length > 0) runningTotal += jeringaLock[0].total;

// 3. BIGOTERA
const bigotera = allItems.filter(i => i.desc.includes('BIGOTERA'));
console.log("\nBIGOTERA:");
bigotera.forEach(b => console.log("  Idx " + b.index + " | total=" + b.total + " | section=" + b.section));
if (bigotera.length > 0) runningTotal += bigotera[0].total;

// 4. AQUAPACK
const aquapack = allItems.filter(i => i.desc.includes('AQUAPACK'));
console.log("\nAQUAPACK:");
aquapack.forEach(a => console.log("  Idx " + a.index + " | total=" + a.total + " | section=" + a.section));
if (aquapack.length > 0) runningTotal += aquapack[0].total;

// 5. CHATA
const chata = allItems.filter(i => i.desc.includes('CHATA'));
console.log("\nCHATA:");
chata.forEach(c => console.log("  Idx " + c.index + " | total=" + c.total + " | section=" + c.section));
if (chata.length > 0) runningTotal += chata[0].total;

// 6. TUBO ENDOTRAQUEAL (user says $510 - need to find)
const tuboEndo = allItems.filter(i => i.desc.includes('TUBO') && i.desc.includes('ENDOTRAQUEAL'));
console.log("\nTUBO ENDOTRAQUEAL:");
if (tuboEndo.length > 0) {
    tuboEndo.forEach(t => console.log("  Idx " + t.index + " | total=" + t.total + " | section=" + t.section));
    runningTotal += tuboEndo[0].total;
} else {
    // Search broader - maybe it has a different name
    const tuboAny = allItems.filter(i => i.desc.includes('TUBO') && i.total <= 600 && i.total >= 400);
    console.log("  NOT FOUND. Searching TUBO with total ~510:");
    tuboAny.forEach(t => console.log("  Idx " + t.index + " | " + t.desc + " | total=" + t.total));
    // Also search anything with total = 510
    const any510 = allItems.filter(i => i.total === 510);
    console.log("  Items with total exactly 510:");
    any510.forEach(a => console.log("  Idx " + a.index + " | " + a.desc + " | total=" + a.total));
}

// 7 & 8. BANDEJA ALUSA (user says $1266 + $633)
const bandeja = allItems.filter(i => i.desc.includes('BANDEJA ALUSA'));
console.log("\nBANDEJA ALUSA:");
bandeja.forEach(b => console.log("  Idx " + b.index + " | qty=" + b.qty + " | total=" + b.total + " | section=" + b.section));
const bandejaSum = bandeja.reduce((a, b) => a + b.total, 0);
console.log("  BANDEJA total: $" + bandejaSum);
runningTotal += bandejaSum;

// 9. TORULA
const torula = allItems.filter(i => i.desc.includes('TORULA'));
console.log("\nTORULA:");
torula.forEach(t => console.log("  Idx " + t.index + " | qty=" + t.qty + " | total=" + t.total + " | section=" + t.section));
if (torula.length > 0) runningTotal += torula[0].total;

// 10. AGUJA 
const aguja = allItems.filter(i => i.desc.includes('AGUJA'));
console.log("\nAGUJA:");
aguja.forEach(a => console.log("  Idx " + a.index + " | " + a.desc + " | total=" + a.total + " | section=" + a.section));
if (aguja.length > 0) runningTotal += aguja[0].total;

// 11. ADAPTADOR (user says $210 but JSON has $478)
const adaptador = allItems.filter(i => i.desc.includes('ADAPTADOR'));
console.log("\nADAPTADOR:");
adaptador.forEach(a => console.log("  Idx " + a.index + " | " + a.desc + " | total=" + a.total + " | section=" + a.section));
if (adaptador.length > 0) runningTotal += adaptador[0].total;

// 12. JERINGA INYECTORA MONOJECT
const monoject = allItems.filter(i => i.desc.includes('MONOJECT'));
console.log("\nJERINGA INYECTORA MONOJECT:");
monoject.forEach(m => console.log("  Idx " + m.index + " | total=" + m.total + " | section=" + m.section));
if (monoject.length > 0) runningTotal += monoject[0].total;

// Also search for anything with total = 210 (user's Adaptador value)
const any210 = allItems.filter(i => i.total === 210);
console.log("\nItems with total exactly 210:");
any210.forEach(a => console.log("  Idx " + a.index + " | " + a.desc + " | total=" + a.total));

console.log("\n=== RUNNING TOTAL (without Tubo Endo & with JSON Adaptador $478): $" + runningTotal);
console.log("=== TARGET: $32716");
console.log("=== DELTA: $" + (runningTotal - 32716));

// User's math check
const userMath = 2616 + 551 + 4034 + 5495 + 1058 + 510 + 1266 + 633 + 92 + 261 + 210 + 17525;
console.log("\nUser's stated sum: $" + userMath);
