import fs from 'fs';
import path from 'path';

// Test Suite for Contract Canonizer
const CANONICAL_PATH = path.join(process.cwd(), 'canonical_contract.json');

interface TestResult {
    name: string;
    passed: boolean;
    message: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => boolean, errorMsg?: string): void {
    try {
        const passed = fn();
        results.push({
            name,
            passed,
            message: passed ? '✅ PASS' : `❌ FAIL: ${errorMsg || 'Assertion failed'}`
        });
    } catch (error) {
        results.push({
            name,
            passed: false,
            message: `❌ ERROR: ${error instanceof Error ? error.message : String(error)}`
        });
    }
}

// Load canonical contract
if (!fs.existsSync(CANONICAL_PATH)) {
    console.error('❌ canonical_contract.json not found. Run the canonizer first.');
    process.exit(1);
}

const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'));

console.log('🧪 Running Canonizer Test Suite...\n');

// ============================================================
// LAYER 1 TESTS (Linear Representation)
// ============================================================
console.log('📄 LAYER 1 TESTS (Linear Representation)');

test('L1.1: contrato.tabla_prestaciones exists',
    () => !!canonical.contrato?.tabla_prestaciones,
    'Missing tabla_prestaciones'
);

test('L1.2: tabla_prestaciones.lineas is an array',
    () => Array.isArray(canonical.contrato?.tabla_prestaciones?.lineas),
    'lineas is not an array'
);

test('L1.3: tabla_prestaciones has at least 100 lines',
    () => canonical.contrato?.tabla_prestaciones?.lineas?.length >= 100,
    `Only ${canonical.contrato?.tabla_prestaciones?.lineas?.length} lines found`
);

test('L1.4: Lines have correct structure (linea_id, tipo, fuente_visual)',
    () => {
        const lines = canonical.contrato?.tabla_prestaciones?.lineas || [];
        const sampleLine = lines.find((l: any) => l.tipo === 'prestacion');
        return sampleLine &&
            'linea_id' in sampleLine &&
            'tipo' in sampleLine &&
            'fuente_visual' in sampleLine;
    },
    'Lines missing required fields'
);

test('L1.5: Prestaciones have contexto with heredada_desde',
    () => {
        const lines = canonical.contrato?.tabla_prestaciones?.lineas || [];
        const prestacion = lines.find((l: any) => l.tipo === 'prestacion');
        return prestacion?.contexto?.heredada_desde !== undefined;
    },
    'Missing heredada_desde in contexto'
);

// ============================================================
// LAYER 2 TESTS (Consolidated Prestations)
// ============================================================
console.log('\n🔍 LAYER 2 TESTS (Consolidated Prestations)');

test('L2.1: prestaciones_consolidadas exists',
    () => !!canonical.prestaciones_consolidadas,
    'Missing prestaciones_consolidadas'
);

test('L2.2: prestaciones_consolidadas is an array',
    () => Array.isArray(canonical.prestaciones_consolidadas),
    'prestaciones_consolidadas is not an array'
);

test('L2.3: Has at least 30 consolidated prestations',
    () => canonical.prestaciones_consolidadas?.length >= 30,
    `Only ${canonical.prestaciones_consolidadas?.length} prestations found`
);

test('L2.4: Each prestation has regimenes array',
    () => {
        const prest = canonical.prestaciones_consolidadas?.[0];
        return prest && Array.isArray(prest.regimenes);
    },
    'Prestations missing regimenes array'
);

test('L2.5: Regimes have fuente traceability',
    () => {
        const prest = canonical.prestaciones_consolidadas?.find((p: any) => p.regimenes?.length > 0);
        const regime = prest?.regimenes?.[0];
        return regime && Array.isArray(regime.fuente) && regime.fuente.length > 0;
    },
    'Regimes missing fuente array'
);

// ============================================================
// LAYER 3 TESTS (Audit Schema)
// ============================================================
console.log('\n⚖️ LAYER 3 TESTS (Audit Schema)');

test('L3.1: auditoria_schema exists',
    () => !!canonical.auditoria_schema,
    'Missing auditoria_schema'
);

test('L3.2: auditoria_schema has agrupaciones_clinicas',
    () => Array.isArray(canonical.auditoria_schema?.agrupaciones_clinicas),
    'Missing agrupaciones_clinicas'
);

test('L3.3: auditoria_schema has definiciones',
    () => Array.isArray(canonical.auditoria_schema?.definiciones),
    'Missing definiciones'
);

test('L3.4: Definiciones include ambito classification',
    () => {
        const def = canonical.auditoria_schema?.definiciones?.[0];
        return def && ('ambito' in def) && ['hospitalario', 'ambulatorio'].includes(def.ambito);
    },
    'Definitions missing valid ambito'
);

test('L3.5: URGENCIA variants are grouped',
    () => {
        const urgenciaGroup = canonical.auditoria_schema?.agrupaciones_clinicas?.find(
            (g: any) => g.nombre_canonico === 'ATENCIÓN DE URGENCIA'
        );
        return urgenciaGroup && urgenciaGroup.variantes?.length >= 3;
    },
    'URGENCIA grouping not found or incomplete'
);

// ============================================================
// CONSOLIDATION TESTS
// ============================================================
console.log('\n🔬 CONSOLIDATION & DEDUPLICATION TESTS');

test('C1: HONORARIOS MÉDICOS QUIRÚRGICOS exists',
    () => {
        return canonical.prestaciones_consolidadas?.some((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
    },
    'HONORARIOS MÉDICOS QUIRÚRGICOS not found'
);

test('C2: HONORARIOS has at least 2 regimes',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        return honorarios?.regimenes?.length >= 2;
    },
    `HONORARIOS has ${canonical.prestaciones_consolidadas?.find((p: any) =>
        p.nombre?.includes('HONORARIOS'))?.regimenes?.length} regimes`
);

test('C3: HONORARIOS has oferta_preferente regime',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        return honorarios?.regimenes?.some((r: any) => r.modalidad === 'oferta_preferente');
    },
    'Missing oferta_preferente regime'
);

test('C4: HONORARIOS has libre_eleccion regime',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        return honorarios?.regimenes?.some((r: any) => r.modalidad === 'libre_eleccion');
    },
    'Missing libre_eleccion regime'
);

test('C5: Oferta preferente regime has subtipo',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        const prefRegime = honorarios?.regimenes?.find((r: any) => r.modalidad === 'oferta_preferente');
        return prefRegime && 'subtipo' in prefRegime;
    },
    'Oferta preferente missing subtipo field'
);

// ============================================================
// NORMALIZATION TESTS
// ============================================================
console.log('\n🧹 NORMALIZATION TESTS');

test('N1: Provider names are uppercase',
    () => {
        const prest = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.regimenes?.some((r: any) => r.prestadores?.length > 0)
        );
        const regime = prest?.regimenes?.find((r: any) => Array.isArray(r.prestadores) && r.prestadores.length > 0);
        const provider = regime?.prestadores?.[0];
        return provider && provider === provider.toUpperCase();
    },
    'Provider names not normalized to uppercase'
);

test('N2: Provider names are sorted alphabetically',
    () => {
        const prest = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.regimenes?.some((r: any) => Array.isArray(r.prestadores) && r.prestadores.length > 1)
        );
        const regime = prest?.regimenes?.find((r: any) => Array.isArray(r.prestadores) && r.prestadores.length > 1);
        const providers = regime?.prestadores;
        if (!providers || providers.length < 2) return true; // Skip if not enough data
        const sorted = [...providers].sort();
        return JSON.stringify(providers) === JSON.stringify(sorted);
    },
    'Provider names not sorted alphabetically'
);

test('N3: Provider names cleaned of table noise',
    () => {
        const prest = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.regimenes?.some((r: any) => Array.isArray(r.prestadores) && r.prestadores.length > 0)
        );
        const regime = prest?.regimenes?.find((r: any) => Array.isArray(r.prestadores) && r.prestadores.length > 0);
        const provider = regime?.prestadores?.[0];
        // Check that provider names don't contain noise words
        return provider && !provider.includes('HONORARIOS') && !provider.includes('QUIRÚRGICOS');
    },
    'Provider names contain table noise'
);

// ============================================================
// RESULTS SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('📊 TEST RESULTS SUMMARY');
console.log('='.repeat(60));

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;

results.forEach(result => {
    console.log(`${result.message} - ${result.name}`);
});

console.log('\n' + '='.repeat(60));
console.log(`✅ PASSED: ${passed}/${total}`);
console.log(`❌ FAILED: ${failed}/${total}`);
console.log('='.repeat(60));

if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Review the output above.');
    process.exit(1);
} else {
    console.log('\n🎉 All tests passed! Canonizer is production-ready.');
    process.exit(0);
}
