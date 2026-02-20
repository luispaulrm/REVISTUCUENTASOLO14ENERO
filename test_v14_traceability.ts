import { runSkill } from './src/m10/engine.ts';
import type { SkillInput, ContractDomain } from './src/m10/types.ts';
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
        folioPAM: 'PAM-LIVE-SIM-V142',
        items: [
            { id: 'pam_1', codigoGC: '3101001', descripcion: 'MEDICAMENTOS CLINICOS', valorTotal: 134100, bonificacion: 0, copago: 134100 },
            { id: 'pam_2', codigoGC: '3101002', descripcion: 'MATERIALES CLINICOS', valorTotal: 32716, bonificacion: 0, copago: 32716 },
            { id: 'pam_3', codigoGC: '3201001', descripcion: 'GASTOS NO CUBIERTOS POR EL PLAN', valorTotal: 184653, bonificacion: 0, copago: 184653 },
            { id: 'pam_4', codigoGC: '3201002', descripcion: 'PRESTACION NO CONTEMPLADA', valorTotal: 42957, bonificacion: 0, copago: 42957 },
            { id: 'pam_5', codigoGC: '3201001', descripcion: 'GASTOS NO CUBIERTOS B', valorTotal: 23985, bonificacion: 0, copago: 23985 },
            { id: 'pam_6', codigoGC: '3201001', descripcion: 'GASTOS NO CUBIERTOS C', valorTotal: 13044, bonificacion: 0, copago: 13044 }
        ]
    }]
};

const bill = {
    items: [
        // Case 1 ($134,100) - ALL SECTIONS REMOVED (Empty string)
        { id: 'b1.1', description: 'CEFTRIAXONA 1G (ACANT)', total: 102588, originalIndex: 37, section: '' },
        { id: 'b1.2', description: 'METRONIDAZOL 500 MG. I', total: 4587, originalIndex: 38, section: '' },
        { id: 'b1.3', description: 'SUERO FISIOLOGICO 20 ML', total: 1208, originalIndex: 40, section: '' },
        { id: 'b1.4', description: 'ONDANSETRON 4 MG', total: 15716, originalIndex: 41, section: '' },
        { id: 'b1.5', description: 'SUERO FISIOLOGICO 500 CC', total: 2344, originalIndex: 42, section: '' },
        { id: 'b1.6', description: 'SUERO FISIOLOGICO 100 ML', total: 3401, originalIndex: 43, section: '' },
        { id: 'b1.7', description: 'SUERO FISIOLOGICO 20 ML', total: 1208, originalIndex: 44, section: '' },
        { id: 'b1.8', description: 'FENTANYL 2 ML (ESTUPEF)', total: 3048, originalIndex: 45, section: '' },

        // Case 2 ($32,716) - ALL SECTIONS REMOVED
        { id: 'b2.1', description: 'BANDEJA ALUSA ESTERIL', total: 1266, originalIndex: 2, section: '' },
        { id: 'b2.2', description: 'APOSITO 10 X 10 ESTERIL', total: 548, originalIndex: 3, section: '' },
        { id: 'b2.3', description: 'BRANULA VIALON 20GX1', total: 872, originalIndex: 7, section: '' },
        { id: 'b2.4', description: 'LIGADURA LIBRE DE LATEX', total: 614, originalIndex: 9, section: '' },
        { id: 'b2.5', description: 'JERINGA 10 cc. LUER LOCK', total: 551, originalIndex: 10, section: '' },
        { id: 'b2.6', description: 'MASCARILLA MULTIVENT', total: 9132, originalIndex: 11, section: '' },
        { id: 'b2.7', description: 'CHATA HONDA DESECHABLE', total: 1058, originalIndex: 17, section: '' },
        { id: 'b2.8', description: 'EQUIPO FLEBOCLISIS', total: 729, originalIndex: 20, section: '' },
        { id: 'b2.9', description: 'JERINGA 10 cc. EMBUTIDA', total: 421, originalIndex: 24, section: '' },
        { id: 'b2.10', description: 'JERINGA INYECTORA MONO', total: 17525, originalIndex: 31, section: '' },

        // Case 3 ($184,653) - ALL SECTIONS REMOVED
        { id: 'b3.1', description: 'MANGAS TALLA S PARA COMPRESOR', total: 97862, originalIndex: 77, section: '' },
        { id: 'b3.2', description: 'MEDIAS ANTIEMBOLICAS S', total: 34768, originalIndex: 83, section: '' },
        { id: 'b3.3', description: 'DELANTAL ESTERIL TALLA L', total: 29686, originalIndex: 61, section: '' },
        { id: 'b3.4', description: 'METAMIZOL 1G/2 ML.', total: 1800, originalIndex: 87, section: '' },
        { id: 'b3.5', description: 'LUBRICANTE OCULAR (THEALOZ)', total: 668, originalIndex: 96, section: '' },
        { id: 'b3.6', description: 'JERINGA 5 cc. EMBUTIDA', total: 752, originalIndex: 65, section: '' },
        { id: 'b3.7', description: 'TERMOMETRO DIGITAL CON LOGO', total: 8605, originalIndex: 111, section: '' },
        { id: 'b3.8', description: 'SET ASEO PERSONAL PACIENTE', total: 10512, originalIndex: 112, section: '' },

        // Case 4 ($42,957)
        { id: 'b4', description: 'FLEBOCLISIS 99-00-045-01', total: 42957, originalIndex: 133, section: '' },

        // Case 5 ($23,985)
        { id: 'b5', description: 'INSTALACION DE VIA VENOSA', total: 23985, originalIndex: 132, section: '' },

        // Case 6 ($13,044)
        { id: 'b6.1', description: 'ESPONJA CON JABON NEUTRO', total: 2105, originalIndex: 15, section: '' },
        { id: 'b6.2', description: 'DELANTAL PACIENTE AZUL', total: 2334, originalIndex: 16, section: '' },
        { id: 'b6.3', description: 'TERMOMETRO DIGITAL C', total: 8605, originalIndex: 33, section: '' }
    ]
};

const result = runSkill({ contract, pam, bill });
console.log("=== FINAL AUDIT REPORT V1.4.2 (LIVE SIM) ===");
console.log(result.reportText);
fs.writeFileSync('V142_LIVE_SIM_REPORT.json', JSON.stringify(result, null, 2));
fs.writeFileSync('DEBUG_LIVE.json', JSON.stringify(result.matrix, null, 2));
