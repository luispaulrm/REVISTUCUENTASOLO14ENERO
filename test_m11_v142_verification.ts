import { runSkill } from './src/m11/engine.ts';
import type { SkillInput, ContractDomain } from './src/m11/types.ts';
import * as fs from 'fs';

const contract = {
    rules: [
        { id: 'R1', domain: 'MEDICAMENTOS_HOSP' as ContractDomain, coberturaPct: 0, textLiteral: 'Medicamentos 0%' },
        { id: 'R2', domain: 'MATERIALES_CLINICOS' as ContractDomain, coberturaPct: 0, textLiteral: 'Materiales 0%' },
        { id: 'R3', domain: 'PABELLON' as ContractDomain, coberturaPct: 100, textLiteral: 'Pabellon 100%' }
    ]
};

const pam = {
    folios: [{
        folioPAM: 'PAM-M11-V142',
        items: [
            { id: 'pam_1', codigoGC: '3101001', descripcion: 'MEDICAMENTOS CLINICOS', valorTotal: 134100, bonificacion: 0, copago: 134100 },
            { id: 'pam_2', codigoGC: '3101002', descripcion: 'MATERIALES CLINICOS', valorTotal: 32716, bonificacion: 0, copago: 32716 },
            { id: 'pam_3', codigoGC: '3201001', descripcion: 'GASTOS NO CUBIERTOS POR EL PLAN', valorTotal: 184653, bonificacion: 0, copago: 184653 }
        ]
    }]
};

const bill = {
    items: [
        // Case 1 ($134,100) - Missing sections
        { id: 'b1.1', description: 'CEFTRIAXONA 1G', total: 102588, originalIndex: 10, section: '' },
        { id: 'b1.2', description: 'METRONIDAZOL 500 MG', total: 4587, originalIndex: 11, section: '' },
        { id: 'b1.3', description: 'ONDANSETRON 4 MG', total: 15716, originalIndex: 12, section: '' },
        { id: 'b1.4', description: 'SUERO FISIOLOGICO 500 CC', total: 2344, originalIndex: 13, section: '' },
        { id: 'b1.5', description: 'FENTANYL 2 ML', total: 3048, originalIndex: 14, section: '' },
        { id: 'b1.6', description: 'SUERO FISIOLOGICO 100 ML', total: 5817, originalIndex: 15, section: '' }, // Total $134,100

        // Case 3 ($184,653) - Generic line that MUST NOT take Clinical items
        { id: 'b3.1', description: 'MANGAS TALLA S PARA COMPRESOR', total: 97862, originalIndex: 20, section: '' },
        { id: 'b3.2', description: 'MEDIAS ANTIEMBOLICAS S', total: 34768, originalIndex: 21, section: '' },
        { id: 'b3.3', description: 'DELANTAL ESTERIL TALLA L', total: 29686, originalIndex: 22, section: '' },
        { id: 'b3.4', description: 'SET ASEO PERSONAL PACIENTE', total: 22337, originalIndex: 23, section: '' } // Total $184,653
    ]
};

const result = runSkill({ contract, pam, bill });
console.log("=== FINAL AUDIT REPORT M11 V1.4.2 ===");
console.log(result.reportText);

// Verification Logic
const rowM2 = result.pamRows.find(r => r.codigoGC === '3101001');
const rowM3 = result.pamRows.find(r => r.codigoGC === '3201001');

console.log("\n--- VERIFICATION ---");
console.log(`M2 (Drugs) Status: ${rowM2?.trace.status} (Expected: OK)`);
console.log(`M2 (Drugs) Matched Items: ${rowM2?.trace.matchedBillItemIds.length} (Expected: 6)`);
console.log(`M3 (Generic) Status: ${rowM3?.trace.status} (Expected: OK/PARTIAL)`);

if (rowM2?.trace.status === 'OK' && rowM2.trace.matchedBillItemIds.length === 6) {
    console.log("SUCCESS: Case 1 (Missing Sections) recovered via Contiguous Matching & Inference.");
} else {
    console.log("FAILURE: Case 1 recovery failed.");
}

fs.writeFileSync('V142_M11_REPORT.json', JSON.stringify(result, null, 2));
