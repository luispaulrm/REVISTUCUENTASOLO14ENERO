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
        folioPAM: 'PAM-M11-AUDIO-TEST',
        items: [
            { id: 'pam_1', codigoGC: '3101001', descripcion: 'MEDICAMENTOS CLINICOS', valorTotal: 134100, bonificacion: 0, copago: 134100 },
            { id: 'pam_3', codigoGC: '3201001', descripcion: 'GASTOS NO CUBIERTOS POR EL PLAN', valorTotal: 184653, bonificacion: 0, copago: 184653 }
        ]
    }]
};

const bill = {
    items: [
        // Case 1 ($134,100) - Clinical Items
        { id: 'b1.1', description: 'CEFTRIAXONA 1G', total: 102588, originalIndex: 1, section: '' },
        { id: 'b1.2', description: 'METRONIDAZOL 500 MG', total: 4587, originalIndex: 2, section: '' },
        { id: 'b1.3', description: 'ONDANSETRON 4 MG', total: 15716, originalIndex: 3, section: '' },
        { id: 'b1.4', description: 'SUERO FISIOLOGICO 500 CC', total: 2344, originalIndex: 4, section: '' },
        { id: 'b1.5', description: 'FENTANYL 2 ML', total: 3048, originalIndex: 5, section: '' },
        { id: 'b1.6', description: 'SUERO FISIOLOGICO 100 ML', total: 5817, originalIndex: 6, section: '' },

        // Case 3 ($184,653) - Generic items (Hosteleria/Comfort)
        { id: 'b3.1', description: 'MANGAS TALLA S PARA COMPRESOR', total: 97862, originalIndex: 10, section: '' },
        { id: 'b3.2', description: 'MEDIAS ANTIEMBOLICAS S', total: 34768, originalIndex: 11, section: '' },
        { id: 'b3.3', description: 'DELANTAL ESTERIL TALLA L', total: 29686, originalIndex: 12, section: '' },
        { id: 'b3.4', description: 'SET ASEO PERSONAL PACIENTE', total: 22337, originalIndex: 13, section: '' }
    ]
};

const result = runSkill({ contract, pam, bill });

console.log("\n>>> M11 EMISION TEST (V1.4.2) <<<");
result.pamRows.forEach(row => {
    console.log(`\nITEM: ${row.codigoGC} - ${row.descripcion}`);
    console.log(`MONTO: $${row.montoCopago}`);
    console.log(`STATUS: ${row.trace.status}`);
    console.log(`TRAZABILIDAD: ${row.trace.traceability?.level} - ${row.trace.traceability?.reason}`);
    console.log(`HALLAZGO: [${row.fragmentacion.motor}] ${row.fragmentacion.rationale}`);
    console.log(`COMPONENTES: ${row.trace.matchedBillItemIds.length} items`);
});

fs.writeFileSync('AUDIO_TEST_RESULT.json', JSON.stringify(result, null, 2));
