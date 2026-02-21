
import { runSkill } from './engine.js';
import {
    SkillInput,
    CanonicalPAM,
    CanonicalContract,
    ContractDomain,
    CanonicalBill
} from './types.js';

const mockContract: CanonicalContract = {
    rules: [
        {
            id: 'rule-psicoterapia',
            domain: 'OTROS' as ContractDomain,
            textLiteral: 'PSICOTERAPIA INDIVIDUAL O GRUPAL',
            coberturaPct: 50,
            tope: null
        },
        {
            id: 'rule-medicamentos',
            domain: 'MEDICAMENTOS_HOSP' as ContractDomain,
            textLiteral: 'MEDICAMENTOS EN HOSPITALIZACION',
            coberturaPct: 90,
            tope: null
        },
        {
            id: 'rule-radioterapia',
            domain: 'OTROS' as ContractDomain,
            textLiteral: 'RADIOTERAPIA',
            coberturaPct: 70,
            tope: null
        },
        {
            id: 'rule-otros',
            domain: 'OTROS' as ContractDomain,
            textLiteral: 'OTROS BENEFICIOS',
            coberturaPct: 20,
            tope: null
        }
    ]
};

const input: SkillInput = {
    bill: {
        items: [
            {
                id: 'b1',
                description: 'MEROPENEM 1GR (MEDICAMENTO)',
                total: 100000,
                section: 'FARMACIA',
                qty: 1,
                unitPrice: 100000
            },
            {
                id: 'b2',
                description: 'GASAS ESTERILES (MATERIAL)',
                total: 50000,
                section: 'MATERIALES',
                qty: 10,
                unitPrice: 5000
            }
        ]
    },
    pam: {
        folios: [{
            folioPAM: 'F1',
            items: [
                {
                    id: 'p1',
                    codigoGC: '3101001',
                    descripcion: 'MEDICAMENTOS CLINICOS EN HOSPITALIZACION',
                    valorTotal: 100000,
                    bonificacion: 90000,
                    copago: 10000,
                },
                {
                    id: 'p2',
                    codigoGC: '3201001',
                    descripcion: 'GASAS Y MATERIALES VARIOS (CATCH-ALL)',
                    valorTotal: 50000,
                    bonificacion: 25000,
                    copago: 25000,
                }
            ]
        }]
    },
    contract: mockContract,
    config: {
        ufValueCLP: 39750
    }
};

console.log('--- TEST: CONTRACT SAFETY ---');
console.log(`Input PAM lines: ${input.pam.folios[0].items.length}`);
try {
    const result = runSkill(input);
    console.log(`DEBUG: Resulting pamRows.length: ${result.pamRows.length}`);

    result.pamRows.forEach((row, idx) => {
        console.log(`\nRow #${idx + 1}: [${row.codigoGC}] ${row.descripcion}`);
        console.log(`  Rule Used: ${row.contractCheck?.ruleRef}`);
        console.log(`  State: ${row.contractCheck?.state}`);
        console.log(`  Notes: ${row.contractCheck?.notes}`);

        if (row.codigoGC === '3101001' && row.contractCheck?.rulesUsed.includes('rule-psicoterapia')) {
            console.error('FAIL: Medicamento matched to Psicoterapia!');
        }
        if (row.codigoGC === '3201001' && row.contractCheck?.rulesUsed.includes('rule-psicoterapia')) {
            console.warn('WARNING: Catch-all matched to Psicoterapia (Potential bias)');
        }
    });

    if (result.pamRows.length < 2) {
        console.error('ERROR: Missing PAM rows in result!');
    }
} catch (e) {
    console.error('CRITICAL ERROR during test execution:', e);
}
