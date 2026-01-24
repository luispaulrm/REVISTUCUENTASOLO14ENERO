import { resolveDecision } from './auditEngine.service.js';
import { Finding, Signal } from '../../types.js';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`✅ PASSED: ${message}`);
}

async function runTests() {
    console.log('--- STARTING V6 AUDIT ENGINE VERIFICATION ---\n');

    // Test Case 1: Balance Invariant A + B + Z + OK == TOTAL
    console.log('Test Case 1: Balance Invariant');
    const totalCopago = 100000;
    const findings: Finding[] = [
        { id: '1', category: 'A', amount: 20000, label: 'Cobro Indebido', rationale: '', action: 'IMPUGNAR', hypothesisParent: 'H_PRACTICA_IRREGULAR', evidenceRefs: [] },
        { id: '2', category: 'Z', amount: 50000, label: 'Opacidad', rationale: '', action: 'SOLICITAR_ACLARACION', hypothesisParent: 'H_OPACIDAD_ESTRUCTURAL', evidenceRefs: [] },
        { id: '3', category: 'B', amount: 10000, label: 'Controversia', rationale: '', action: 'SOLICITAR_ACLARACION', hypothesisParent: 'H_OK_CUMPLIMIENTO', evidenceRefs: [] },
    ];

    const result = resolveDecision({
        totalCopagoInformado: totalCopago,
        findings: findings,
        violations: [],
        signals: []
    });

    const sum = result.balance.A + result.balance.B + result.balance.Z + result.balance.OK;
    assert(sum === totalCopago, `Sum of categories ($${sum}) must equal TOTAL ($${totalCopago})`);
    assert(result.balance.OK === 20000, `OK category should be 20,000 (100k - 20k - 50k - 10k)`);
    assert(result.estado === 'COPAGO_MIXTO_CONFIRMADO_Y_OPACO', `Global state should be MIXTO`);

    // Test Case 2: Opacity Cap (Z > TOTAL)
    console.log('\nTest Case 2: Opacity Cap');
    const findingsExcessive: Finding[] = [
        { id: '1', category: 'A', amount: 20000, label: 'Cobro Indebido', rationale: '', action: 'IMPUGNAR', hypothesisParent: 'H_PRACTICA_IRREGULAR', evidenceRefs: [] },
        { id: '2', category: 'Z', amount: 150000, label: 'Opacidad Excesiva', rationale: '', action: 'SOLICITAR_ACLARACION', hypothesisParent: 'H_OPACIDAD_ESTRUCTURAL', evidenceRefs: [] },
    ];

    const resultExcessive = resolveDecision({
        totalCopagoInformado: totalCopago,
        findings: findingsExcessive,
        violations: [],
        signals: []
    });

    assert(resultExcessive.balance.Z === 80000, `Z should be capped at 80,000 (100k - 20k)`);
    assert(resultExcessive.balance.OK === 0, `OK should be 0 when Z+A >= TOTAL`);
    assert(resultExcessive.errors.some(e => e.includes('ALERTA_BALANCE')), `Should have balance alert error`);

    // Test Case 3: Opacity Percentage
    console.log('\nTest Case 3: Opacity Percentage');
    assert(result.fundamento.includes('Opacidad=50.0%'), `Opacity percentage should be 50.0% (50k/100k)`);
    assert(resultExcessive.fundamento.includes('Opacidad=80.0%'), `Capped opacity should be 80.0% (80k/100k)`);

    console.log('\n--- VERIFICATION COMPLETED SUCCESSFULLY ---');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
