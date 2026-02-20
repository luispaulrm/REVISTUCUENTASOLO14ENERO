import { runSkill } from './src/m11/engine.ts';
import type { SkillInput, ContractDomain } from './src/m11/types.ts';

const contract = {
    rules: [
        { id: 'R1', domain: 'MEDICAMENTOS_HOSP' as ContractDomain, coberturaPct: 0, textLiteral: 'Medicamentos 0%' },
        { id: 'R2', domain: 'MATERIALES_CLINICOS' as ContractDomain, coberturaPct: 0, textLiteral: 'Materiales 0%' },
        { id: 'R3', domain: 'PABELLON' as ContractDomain, coberturaPct: 100, textLiteral: 'Pabellon 100%' }
    ]
};

const pam = {
    folios: [{
        folioPAM: 'PAM-M11-MATH-TEST',
        items: [
            { id: 'pam_1', codigoGC: '3101001', descripcion: 'MEDICAMENTOS CLINICOS', valorTotal: 134100, bonificacion: 0, copago: 134100 },
            { id: 'pam_3', codigoGC: '3201001', descripcion: 'GASTOS NO CUBIERTOS POR EL PLAN', valorTotal: 184653, bonificacion: 0, copago: 184653 }
        ]
    }]
};

const bill = {
    items: [
        // Case 1 ($134,100) - REAL 8 items from Clinica Indisa bill (PDF verified)
        // SECTION: MEDICAMENTOS
        { id: 'b1.1', description: 'CEFTRIAXONA 1G (ACANT) x2', total: 102588, originalIndex: 37, section: 'FARMACIA', qty: 2, unitPrice: 51294 },
        { id: 'b1.2', description: 'METRONIDAZOL 500 MG', total: 4587, originalIndex: 38, section: 'FARMACIA' },
        { id: 'b1.3', description: 'SUERO FISIOLOGICO 20 ML', total: 1208, originalIndex: 39, section: 'FARMACIA' },
        { id: 'b1.4', description: 'ONDANSETRON 4 MG', total: 15716, originalIndex: 40, section: 'FARMACIA' },
        { id: 'b1.5', description: 'SUERO FISIOLOGICO 500 C', total: 2344, originalIndex: 41, section: 'FARMACIA' },
        { id: 'b1.6', description: 'SUERO FISIOLOGICO 100 ML', total: 3401, originalIndex: 42, section: 'FARMACIA' },
        { id: 'b1.7', description: 'SUERO FISIOLOGICO 20 ML', total: 1208, originalIndex: 43, section: 'FARMACIA' },
        // SECTION: SICOTROPICOS Y ESTUPEFACIENTES
        { id: 'b1.8', description: 'FENTANYL 2 ML (ESTUPEF.)', total: 3048, originalIndex: 44, section: 'ESTUPEFACIENTES' },

        // Case 3 ($184,653) - Gastos no cubiertos EXACT MATCH from Clinica Indisa bill
        { id: 'b3.1', description: 'MANGAS TALLA S PARA COMPRESOR NEUMATICO', total: 97862, originalIndex: 10, section: 'INSUMOS' },
        { id: 'b3.2', description: 'DELANTAL ESTERIL TALLA L COD:2701', total: 29686, originalIndex: 11, section: 'INSUMOS' },
        { id: 'b3.3', description: 'SET DE ASEO PERSONAL ADULTO', total: 10785, originalIndex: 12, section: 'INSUMOS' },
        { id: 'b3.4', description: 'TERMOMETRO DIGITAL CON LOGO', total: 8605, originalIndex: 13, section: 'INSUMOS' },
        { id: 'b3.5', description: 'MEDIAS ANTIEMBOLICAS S (5064)', total: 34768, originalIndex: 14, section: 'INSUMOS' },
        { id: 'b3.6', description: 'CALZON CLINICO', total: 1641, originalIndex: 15, section: 'INSUMOS' },
        { id: 'b3.7', description: 'REMOVEDOR DE ADHESIVOS SACHET', total: 638, originalIndex: 16, section: 'INSUMOS' },
        { id: 'b3.8', description: 'LUBRICANTE OCULAR (THEALOZ DUO GEL)', total: 668, originalIndex: 17, section: 'INSUMOS' },

        // These two items below (Total: 4.439) are intentionally left out by the exact DP match to reach 184.653
        { id: 'b3.9', description: 'ESPONJA CON JABON NEUTRO', total: 2105, originalIndex: 18, section: 'INSUMOS' },
        { id: 'b3.10', description: 'DELANTAL PACIENTE AZUL SIN MANGAS', total: 2334, originalIndex: 19, section: 'INSUMOS' }
    ]
};

const result = runSkill({ contract, pam, bill });

console.log("\n>>> DESGLOSE MATEMÁTICO M11 (V1.4.2) <<<\n");

result.pamRows.forEach(row => {
    console.log(`==================================================`);
    console.log(`PAM ITEM: [${row.codigoGC}] ${row.descripcion}`);
    console.log(`OBJETIVO A CUADRAR: $${row.montoCopago.toLocaleString()}`);
    console.log(`MÉTODO DE CALCE: ${row.trace.attempts.find(a => a.status === 'OK')?.step || 'N/A'}`);
    console.log(`ESTADO: ${row.trace.status}`);

    if (row.trace.matchedBillItemIds.length > 0) {
        console.log(`\n--- DESGLOSE ENCONTRADO EN LA CUENTA ---`);
        let sum = 0;

        // Find the matched items from the original bill using the IDs
        const matchedItems = row.trace.matchedBillItemIds.map(id => bill.items.find(i => i.id === id)).filter(Boolean);

        matchedItems.forEach(item => {
            if (item) {
                console.log(` + $${item.total.toLocaleString().padStart(8)} | ${item.description}`);
                sum += item.total;
            }
        });

        console.log(`--------------------------------------------------`);
        console.log(`   $${sum.toLocaleString().padStart(8)} | SUMA TOTAL CALCULADA`);

        const diff = row.montoCopago - sum;
        if (diff === 0) {
            console.log(`   $       0 | DIFERENCIA (CUADRATURA EXACTA ✅)`);
        } else {
            console.log(`   $${diff.toLocaleString().padStart(8)} | DIFERENCIA (NO CUADRA ❌)`);
        }
    } else {
        console.log(`\n--- SIN DESGLOSE (NO SE ENCONTRARON ÍTEMS) ---`);
    }
    console.log(`==================================================\n`);
});
