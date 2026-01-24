
const fs = require('fs');

function subsetSum(target, items) {
    const n = items.length;
    // Using a map for DP to handle large sums if needed, but here amounts are manageable
    // However, since we need to find the specific items, DFS with pruning is better.

    let result = null;
    let nodes = 0;
    const MAX_NODES = 2000000;

    function dfs(idx, currentSum, chosen) {
        if (result) return;
        nodes++;
        if (nodes > MAX_NODES) return;

        if (Math.abs(currentSum - target) <= 1) { // 1 unit tolerance
            result = chosen;
            return;
        }

        if (currentSum > target + 10) return; // Pruning
        if (idx === n) return;

        // Try including item
        dfs(idx + 1, currentSum + items[idx].total, [...chosen, items[idx]]);
        // Try excluding item
        dfs(idx + 1, currentSum, chosen);
    }

    // Sort items descending to prune faster
    const sortedItems = [...items].sort((a, b) => b.total - a.total);
    dfs(0, 0, []);
    return result;
}

// Data from user request
const accountStructure = {
    "sections": [
        {
            "category": "CONVENCIONAL - Dias Cama",
            "items": [{ "id": 1, "description": "DIA CAMA INDIVIDUAL S1", "total": 452075 }]
        },
        {
            "category": "Medicamentos y Materiales ESTERILIZACION INTERNO",
            "items": [{ "id": 2, "description": "BANDEJA ALUSA ESTERIL", "total": 633 }]
        },
        {
            "category": "Medicamentos y Materiales INSUMOS",
            "items": [
                { "id": 3, "description": "CALZON CLINICO", "total": 1641 },
                { "id": 4, "description": "SET DE ASEO PERSONAL ADULTO", "total": 10785 },
                { "id": 5, "description": "BRANULA VIALON 20GX1,16", "total": 872 },
                { "id": 6, "description": "BRANULA VIALON 22GX1", "total": 872 },
                { "id": 7, "description": "LIGADURA LIBRE DE LATEX", "total": 614 },
                { "id": 8, "description": "JERINGA 10 cc. LUER LOCK", "total": 551 },
                { "id": 9, "description": "MASCARILLA MULTIVEN", "total": 9132 },
                { "id": 10, "description": "BIGOTERA ADULTO", "total": 4034 },
                { "id": 11, "description": "AQUAPACK 340 C/ADAP H2O", "total": 5495 },
                { "id": 80, "description": "BRANULA VIALON 18GX1,16", "total": 872 },
                { "id": 81, "description": "ESPONJA CON JABON NEUTRO", "total": 2105 },
                { "id": 82, "description": "DELANTAL PACIENTE AZUL", "total": 2334 },
                { "id": 83, "description": "CHATA HONDA DESECH.CARTON", "total": 1058 },
                { "id": 84, "description": "FRASCOS ESTERILES 100 CC", "total": 434 },
                { "id": 85, "description": "JERINGA 5 cc. EMBUTIDA", "total": 376 },
                { "id": 86, "description": "EQUIPO FLEBOCLISIS REF", "total": 729 },
                { "id": 87, "description": "TUBO ROJO 4,0 ML VACUET", "total": 340 },
                { "id": 88, "description": "ADAPTADOR BRAND LUER", "total": 478 },
                { "id": 89, "description": "TUBO VERDE 4,0 ML/HEPARI", "total": 243 },
                { "id": 90, "description": "JERINGA 10 cc. EMBUTIDA", "total": 421 },
                { "id": 91, "description": "JERINGA 10 cc. EMBUTIDA", "total": 421 },
                { "id": 92, "description": "EQUIPO FLEBOCLISIS REF", "total": 729 },
                { "id": 93, "description": "TUBO GRIS 4,0 ML VACUET", "total": 367 },
                { "id": 94, "description": "TUBO CELESTE 2,7-3,0 ML", "total": 367 },
                { "id": 95, "description": "TUBO LILA 3,0 ML (454246)", "total": 680 },
                { "id": 96, "description": "LLAVE 3 PASOS C/ EXT. DI", "total": 2455 },
                { "id": 97, "description": "JERINGA INYECTORA MONO", "total": 17525 },
                { "id": 98, "description": "JERINGA 20 cc. LUER LOCK", "total": 864 }
            ]
        },
        {
            "category": "Medicamentos y Materiales INSUMOS KARDEX",
            "items": [
                { "id": 12, "description": "TERMOMETRO DIGITAL CON LOGO", "total": 8605 },
                { "id": 13, "description": "REMOVEDOR DE ADHESIVOS SACHET", "total": 638 },
                { "id": 99, "description": "APOSITO TRANSP IV (7239)", "total": 2451 },
                { "id": 100, "description": "TERMOMETRO DIGITAL CON LOGO", "total": 8605 }
            ]
        },
        {
            "category": "Medicamentos y Materiales MEDICAMENTOS",
            "items": [
                { "id": 14, "description": "CEFTRIAXONA 1G (ACANTEX)", "total": 102588 },
                { "id": 15, "description": "METRONIDAZOL 500 MG. INY", "total": 9174 },
                { "id": 16, "description": "PARACETAMOL 1G/100ML", "total": 31148 },
                { "id": 17, "description": "KETOPROFENO 100MG EV", "total": 20268 },
                { "id": 18, "description": "LEVOSULPIRIDE 25 MG (DISP)", "total": 19635 },
                { "id": 19, "description": "SUERO FISIOLOGICO 20 ML", "total": 1208 },
                { "id": 20, "description": "CEFTRIAXONA 1G (ACANTEX)", "total": 51294 },
                { "id": 101, "description": "CEFTRIAXONA 1G (ACANTEX)", "total": 102588 },
                { "id": 102, "description": "METRONIDAZOL 500 MG. INY", "total": 4587 },
                { "id": 103, "description": "SUERO FISIOLOGICO 20 ML", "total": 1208 },
                { "id": 104, "description": "ONDANSETRON 4 MG", "total": 15716 },
                { "id": 105, "description": "SUERO FISIOLOGICO 500 CC", "total": 2344 },
                { "id": 106, "description": "SUERO FISIOLOGICO 100 ML", "total": 3401 },
                { "id": 107, "description": "SUERO FISIOLOGICO 20 ML", "total": 1208 }
            ]
        },
        {
            "category": "Farmacia En Pabellon INSUMOS",
            "items": [
                { "id": 23, "description": "JERINGA 3 cc EMBUTIDA", "total": 964 },
                { "id": 24, "description": "AGUJA DESECHABLE 18G", "total": 261 },
                { "id": 25, "description": "EQUIPO FLEBOCLISIS REF", "total": 729 },
                { "id": 26, "description": "ASPIRADOR ELEFANT/IRRIGAC", "total": 211312 },
                { "id": 27, "description": "ESTILETE DE INTUBACION", "total": 21737 },
                { "id": 28, "description": "ELECTRODO ADULTO ECG", "total": 3213 },
                { "id": 29, "description": "MONOCRYL 4/0 AGUJA PS-2", "total": 25687 },
                { "id": 30, "description": "PAQUETE CIRUG.UNIVERSAL", "total": 56042 },
                { "id": 31, "description": "DELANTAL ESTERIL TALLA L", "total": 29686 },
                { "id": 32, "description": "SURGITIE POLYSORB LOOP", "total": 127726 },
                { "id": 33, "description": "CLIP HEMOLOCK L MORADO", "total": 103524 },
                { "id": 34, "description": "TROCARES CON CLIPLER/VALV", "total": 263214 },
                { "id": 35, "description": "JERINGA 5 cc. EMBUTIDA", "total": 752 },
                { "id": 36, "description": "JERINGA 10 cc. EMBUTIDA", "total": 2105 },
                { "id": 37, "description": "JERINGA 20 cc. EMBUTIDA", "total": 3714 },
                { "id": 38, "description": "CANULA MAYO 90MM GDE", "total": 2054 },
                { "id": 39, "description": "CANULA ENDOTRAQUEAL C/B", "total": 4929 },
                { "id": 40, "description": "LIMPIA ELECTRODO", "total": 3518 },
                { "id": 41, "description": "VICRYL C/A 0 CT-2 334 H", "total": 5683 },
                { "id": 42, "description": "MEDIVAC 3000 ML. (CANISTER)", "total": 16494 },
                { "id": 43, "description": "SPONGEN PACK(5)", "total": 14865 },
                { "id": 44, "description": "ENDO BAGS 3\"X6\" REF:D", "total": 63470 },
                { "id": 45, "description": "BOLSA ORDENADORA DE GASAS", "total": 5960 },
                { "id": 46, "description": "CAJA CONTADORA DE AGUJAS", "total": 8123 },
                { "id": 47, "description": "MANGAS TALLA S PARA COMPR", "total": 97862 },
                { "id": 48, "description": "BOLSA ORGANIZADORA DE IN", "total": 9280 },
                { "id": 49, "description": "HOJA LARINGOSCOPIO DESC", "total": 25003 },
                { "id": 50, "description": "SONDA ASPIRACION N16", "total": 1094 },
                { "id": 51, "description": "CIRCUITO ANESTESIA ADULTO", "total": 15752 },
                { "id": 52, "description": "HOJA VIDEOLARING. DESC", "total": 21274 }
            ]
        },
        {
            "category": "Farmacia En Pabellon MEDICAMENTOS",
            "items": [
                { "id": 56, "description": "ATROPINA SULFATO 1 MG", "total": 862 },
                { "id": 57, "description": "METAMIZOL 1G/2 ML.", "total": 1800 },
                { "id": 58, "description": "EFEDRINA 60 MG/ML", "total": 1885 },
                { "id": 59, "description": "KETOPROFENO 100MG EV", "total": 6756 },
                { "id": 60, "description": "ROCURONIO 50MG/5 ML.", "total": 33042 },
                { "id": 61, "description": "ONDANSETRON 4 MG", "total": 15716 },
                { "id": 62, "description": "DEXAMETASONA 4 MG. INY", "total": 1790 },
                { "id": 63, "description": "SUERO FISIOLOGICO 1000 ML", "total": 3589 },
                { "id": 64, "description": "SUERO FISIOLOGICO 250 CC", "total": 2330 },
                { "id": 65, "description": "SEVOFLURANE QF", "total": 177680 },
                { "id": 66, "description": "LUBRICANTE OCULAR (THEAL", "total": 668 },
                { "id": 67, "description": "SUCCINIL COLINA 100 MG", "total": 4853 },
                { "id": 68, "description": "SUERO FISIOLOGICO 20 ML", "total": 6040 },
                { "id": 69, "description": "PROPOFOL 200 MG.X 20 ML", "total": 27168 },
                { "id": 70, "description": "LIDOCAINA 2 % 10 ML.", "total": 721 },
                { "id": 71, "description": "BUPIVACAINA 0.5%/10 ML", "total": 15820 },
                { "id": 72, "description": "SUERO RINGER LACTATO 500", "total": 4800 },
                { "id": 73, "description": "SUGAMMADEX 200 MG/2 ML", "total": 240713 },
                { "id": 74, "description": "PARACETAMOL 1G/100ML", "total": 15574 }
            ]
        }
    ]
};

const allItems = accountStructure.sections.flatMap(s => s.items);

const targets = [
    { label: "Meds Opaque", value: 134100 },
    { label: "Mats Opaque", value: 32716 },
    { label: "GNC 1", value: 184653 },
    { label: "GNC 2", value: 13044 }
];

console.log("Searching for subsets...");
let usedIds = new Set();

targets.forEach(target => {
    // We try to find a subset among items NOT already used for a higher priority match
    // although technically they could overlap if the PAM is weird, but we assume parts of a whole.
    const availableItems = allItems.filter(i => !usedIds.has(i.id));
    const result = subsetSum(target.value, availableItems);

    if (result) {
        console.log(`\n\u2705 MATCH FOUND for ${target.label} ($${target.value}):`);
        result.forEach(item => {
            console.log(`  - [Idx ${item.id}] ${item.description}: $${item.total}`);
            usedIds.add(item.id);
        });
    } else {
        console.log(`\n\u274c NO MATCH for ${target.label} ($${target.value})`);
    }
});
