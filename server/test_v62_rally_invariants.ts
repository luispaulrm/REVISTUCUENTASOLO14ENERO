

// VANILLA TEST RUNNER
const test = async (name: string, fn: () => void) => {
    try {
        console.log(`⏳ Running: ${name}`);
        fn();
        console.log(`✅ PASS: ${name}`);
    } catch (e: any) {
        console.error(`❌ FAIL: ${name}`);
        console.error(e);
        process.exit(1);
    }
};

const assert = {
    is: (actual: any, expected: any, msg?: string) => {
        if (actual !== expected) throw new Error(`${msg || 'Assertion failed'}: Expected ${expected}, got ${actual}`);
    },
    ok: (value: any, msg?: string) => {
        if (!value) throw new Error(`${msg || 'Assertion failed'}: Expected truthy`);
    }
};

import { buildRally, renderRallyMarkdown, generateExecutiveSummary, generateFinancialSummary, Rally, RallyLine, Rubro } from './services/rallyBuilder.service';

// --- MOCK DATA ---
const mockRawCuenta = {
    sections: [
        {
            category: "Medicamentos y Materiales INSUMOS",
            items: [
                { index: 1, description: "TERMOMETRO DIGITAL", copago: 8605 },    // I
                { index: 2, description: "MANGA LAPAROSCOPICA", copago: 1370 },   // I
                { index: 3, description: "MASCARILLA MULTIVEN", copago: 9132 },   // II
                { index: 4, description: "BIGOTERA ADULTO", copago: 4034 },       // II
                { index: 5, description: "CEFTRIAXONA 1G", copago: 102588 },      // III
                { index: 6, description: "PARACETAMOL", copago: 31148 },          // III
                { index: 7, description: "CONSULTA URGENCIA", copago: 12106 }     // IV
            ]
        }
    ]
};

const mockPam = {
    folios: [
        {
            desglosePorPrestador: [
                {
                    items: [
                        { codigo: '1', descripcion: 'TERMOMETRO DIGITAL', copago: 8605 },
                        { codigo: '7', descripcion: 'CONSULTA URGENCIA', copago: 12106 }
                    ]
                }
            ]
        }
    ]
};

const EXPECTED_TOTAL = 8605 + 1370 + 9132 + 4034 + 102588 + 31148 + 12106; // 168983
const PAM_TOTAL = 8605 + 12106; // 20711

(async () => {
    await test('Rally Builder: Sum Invariant & Delta Zero (Legacy Mode)', () => {
        const rally = buildRally(mockRawCuenta, EXPECTED_TOTAL);

        console.log('Rally Delta:', rally.delta);
        console.log('Rally Total:', rally.total_rubros_sum);

        assert.is(rally.delta, 0, 'Delta must be exactly zero');
        assert.is(rally.total_rubros_sum, EXPECTED_TOTAL, 'Total sum must match input exactly');
    });

    await test('Rally Builder: PAM-First Strategy (New Logic)', () => {
        // Here we simulate the mismatch: Bill says 168k, but PAM says only 20k.
        // We create a specific mock for this test to avoid polluting the global mock.
        const mockRawWithGhost = JSON.parse(JSON.stringify(mockRawCuenta));
        mockRawWithGhost.sections[0].items.push({ index: 8, description: "ITEM FANTASMA NO EN PAM", copago: 999999 });

        // The RallyBuilder MUST trust the PAM.
        const rally = buildRally(mockRawWithGhost, PAM_TOTAL, mockPam);

        console.log('PAM Rally Total:', rally.total_rubros_sum);

        assert.is(rally.total_rubros_sum, PAM_TOTAL, 'Rally must use PAM totals');
        assert.is(rally.delta, 0, 'Delta must be zero regarding PAM input');

        // TERMOMETRO should be present
        assert.ok(rally.rubros.flatMap(r => r.lineas).some(l => l.descripcion.includes('TERMOMETRO')), 'PAM item present');

        // ITEM FANTASMA should NOT be present
        assert.ok(!rally.rubros.flatMap(r => r.lineas).some(l => l.descripcion.includes('FANTASMA')), 'Ghost item from Bill excluded');
    });

    await test('Rally Builder: Classification Logic', () => {
        const rally = buildRally(mockRawCuenta, EXPECTED_TOTAL);

        const rubroI = rally.rubros.find(r => r.id === 'I');
        const rubroII = rally.rubros.find(r => r.id === 'II');
        const rubroIII = rally.rubros.find(r => r.id === 'III');
        const rubroIV = rally.rubros.find(r => r.id === 'IV');

        // Rubro I: Termometro, Manga
        assert.ok(rubroI?.lineas.some(l => l.descripcion.includes('TERMOMETRO')), 'Termometro in Rubro I');
        assert.ok(rubroI?.lineas.some(l => l.descripcion.includes('MANGA')), 'Manga in Rubro I');

        // Rubro II: Mascarilla
        assert.ok(rubroII?.lineas.some(l => l.descripcion.includes('MASCARILLA')), 'Mascarilla in Rubro II');

        // Rubro III: Ceftriaxona
        assert.ok(rubroIII?.lineas.some(l => l.descripcion.includes('CEFTRIAXONA')), 'Ceftriaxona in Rubro III');

        // Rubro IV: Consulta Urgencia
        assert.ok(rubroIV?.lineas.some(l => l.descripcion.includes('CONSULTA')), 'Consulta in Rubro IV');
    });

    await test('Rally Builder: Markdown Rendering', () => {
        const rally = buildRally(mockRawCuenta, EXPECTED_TOTAL);
        const md = renderRallyMarkdown(rally);

        console.log(md);

        assert.ok(md.includes('# DETALLE DE OBJECCIONES (FORMATO RALLY)'), 'Header present');
        assert.ok(md.includes('### I. Fragmentación'), 'Rubro I present');
        assert.ok(md.includes('**TOTAL COPAGO RECLAMADO**: $168.983'), 'Total line correct');
    });

    await test('Rally Builder: Handle Ghost Items (Unclassified)', () => {
        const cuentaGhost = {
            sections: [{
                items: [{ index: 99, description: "ITEM RARO ESPACIAL", copago: 5000 }]
            }]
        };

        const rally = buildRally(cuentaGhost, 5000);
        const rubroIV = rally.rubros.find(r => r.id === 'IV');

        assert.is(rally.delta, 0);
        assert.ok(rubroIV?.lineas.some(l => l.descripcion.includes('ITEM RARO')), 'Unclassified items go to IV by default (or logic update)');
    });

    await test('Rally Builder: Summary Unification', () => {
        const rally = buildRally(mockRawCuenta, EXPECTED_TOTAL);

        // Executive Summary
        const execSum = generateExecutiveSummary(rally);
        assert.ok(execSum.includes('100% del copago informado'), 'Exec Summary mentions 100% coverage');

        // Flexible string search because logic might have subtle wording changes
        assert.ok(execSum.includes('Rubros I y II') || execSum.includes('Fragmentación'), 'Exec Summary mentions Rubros/Fragmentacion');

        // Financial Summary
        const finSum = generateFinancialSummary(rally);
        console.log('Financial Summary:', finSum);

        assert.is(finSum.totalCopagoReal, EXPECTED_TOTAL, 'Financial Summary total correct');
        assert.is(finSum.estado_copago, "OBJETADO_TOTAL", 'State is firmly Objected');
        assert.is(finSum.auditor_score, 100, 'Confidence is 100%');
    });

})();
