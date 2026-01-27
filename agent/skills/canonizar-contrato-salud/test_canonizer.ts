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
let logBuffer = '🧪 Running Canonizer Test Suite...\n\n';

function test(name: string, fn: () => boolean, errorMsg?: string): void {
    try {
        const passed = fn();
        const status = passed ? '✅ PASS' : `❌ FAIL: ${errorMsg || 'Assertion failed'}`;
        logBuffer += `${status} - ${name}\n`;
        results.push({
            name,
            passed,
            message: status
        });
    } catch (error) {
        const errorStr = `❌ ERROR: ${error instanceof Error ? error.message : String(error)}`;
        logBuffer += `${errorStr} - ${name}\n`;
        results.push({
            name,
            passed: false,
            message: errorStr
        });
    }
}

// Load canonical contract
if (!fs.existsSync(CANONICAL_PATH)) {
    console.error('❌ canonical_contract.json not found. Run the canonizer first.');
    process.exit(1);
}

const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'));

// ============================================================
// LAYER 1 TESTS (Linear Representation)
// ============================================================
logBuffer += '📄 LAYER 1 TESTS (Linear Representation)\n';

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

test('L1.5: Prestaciones have preferente with aplica flag',
    () => {
        const lines = canonical.contrato?.tabla_prestaciones?.lineas || [];
        const prestacion = lines.find((l: any) => l.tipo === 'prestacion');
        return prestacion?.preferente?.aplica !== undefined;
    },
    'Missing preferente.aplica flag in prestacion'
);

// ============================================================
// LAYER 2 TESTS (Consolidated Prestations)
// ============================================================
logBuffer += '\n🔍 LAYER 2 TESTS (Consolidated Prestations)\n';

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

test('L2.4: Each prestation has opciones array',
    () => {
        const prest = canonical.prestaciones_consolidadas?.[0];
        return prest && Array.isArray(prest.opciones);
    },
    'Prestations missing opciones array'
);

test('L2.5: Regimes have fuente traceability',
    () => {
        const prest = canonical.prestaciones_consolidadas?.find((p: any) => p.opciones?.length > 0);
        const regime = prest?.opciones?.[0];
        return regime && Array.isArray(regime.fuente) && regime.fuente.length > 0;
    },
    'Regimes missing fuente array'
);

// ============================================================
// LAYER 3 TESTS (Audit Schema)
// ============================================================
logBuffer += '\n⚖️ LAYER 3 TESTS (Audit Schema)\n';

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
logBuffer += '\n🔬 CONSOLIDATION & DEDUPLICATION TESTS\n';

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
        return honorarios?.opciones?.length >= 2;
    },
    `HONORARIOS has insufficient regimes`
);

test('C3: HONORARIOS has preferente regime',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        return honorarios?.opciones?.some((r: any) => r.modalidad === 'preferente');
    },
    'Missing preferente regime'
);

test('C4: HONORARIOS has libre_eleccion regime',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        return honorarios?.opciones?.some((r: any) => r.modalidad === 'libre_eleccion');
    },
    'Missing libre_eleccion regime'
);

test('C5: Oferta preferente has multiple explicit regimes (BCC)',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS') && p.nombre?.includes('QUIRÚRGICOS')
        );
        // Should have at least 2 preferential regimes (e.g. one for 80% and one for 90%)
        const prefRegimes = honorarios?.opciones?.filter((r: any) => r.modalidad === 'preferente');
        return prefRegimes && prefRegimes.length >= 2;
    },
    'Honorarios should have multiple explicit preferential regimes (BCC explosion)'
);

test('C6: DIA CAMA CUIDADOS INTENSIVOS has 3 preferential options (BCC Decision Tree)',
    () => {
        const diaCama = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('DIA CAMA CUIDADOS INTENSIVOS')
        );
        const prefOptions = diaCama?.opciones?.filter((o: any) => o.modalidad === 'preferente');
        return prefOptions && prefOptions.length === 3;
    },
    'DIA CAMA CUIDADOS INTENSIVOS should have 3 preferential options'
);

test('C7: Options include conditions (e.g. Habitación Individual)',
    () => {
        const diaCama = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('DIA CAMA CUIDADOS INTENSIVOS')
        );
        return diaCama?.opciones?.some((o: any) =>
            Array.isArray(o.condiciones) && o.condiciones.some((c: string) => c.toLowerCase().includes('individual'))
        );
    },
    'Missing condition "Habitación Individual" in Dia Cama options'
);

// ============================================================
// NORMALIZATION TESTS
// ============================================================
logBuffer += '\n🧹 NORMALIZATION TESTS\n';

test('N1: Provider names are uppercase (LE only)',
    () => {
        const leRegime = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.opciones?.some((r: any) => r.modalidad === 'libre_eleccion' && Array.isArray(r.prestadores))
        )?.opciones?.find((r: any) => r.modalidad === 'libre_eleccion');

        if (!leRegime || !Array.isArray(leRegime.prestadores)) return true;
        const provider = leRegime.prestadores[0];
        return provider && provider === provider.toUpperCase();
    },
    'Provider names not normalized to uppercase'
);

test('N2: Provider names are sorted alphabetically (LE only)',
    () => {
        const leRegime = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.opciones?.some((r: any) => r.modalidad === 'libre_eleccion' && Array.isArray(r.prestadores) && r.prestadores.length > 1)
        )?.opciones?.find((r: any) => r.modalidad === 'libre_eleccion');

        if (!leRegime || !Array.isArray(leRegime.prestadores) || leRegime.prestadores.length < 2) return true;
        const providers = leRegime.prestadores;
        const sorted = [...providers].sort();
        return JSON.stringify(providers) === JSON.stringify(sorted);
    },
    'Provider names not sorted alphabetically'
);

test('N3: Provider names cleaned (LE only)',
    () => {
        const leRegime = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.opciones?.some((r: any) => r.modalidad === 'libre_eleccion' && Array.isArray(r.prestadores))
        )?.opciones?.find((r: any) => r.modalidad === 'libre_eleccion');

        if (!leRegime || !Array.isArray(leRegime.prestadores)) return true;
        const provider = leRegime.prestadores[0];
        return provider && !provider.includes('HONORARIOS') && !provider.includes('QUIRÚRGICOS');
    },
    'Provider names contain table noise'
);

// ============================================================
// NFE STRUCTURAL TESTS
// ============================================================
logBuffer += '\n🧪 NFE STRUCTURAL TESTS\n';

test('N4: HONORARIOS has NFE "Sin Tope"',
    () => {
        const honorarios = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('HONORARIOS MÉDICOS QUIRÚRGICOS')
        );
        return honorarios?.nfe_resumen?.aplica === true && honorarios?.nfe_resumen?.razon === 'SIN_TOPE_EXPRESO';
    },
    'Honorarios missing NFE "Sin Tope"'
);

test('N5: MEDICAMENTOS has NFE "60"',
    () => {
        const med = canonical.prestaciones_consolidadas?.find((p: any) =>
            p.nombre?.includes('MEDICAMENTOS HOSPITALARIOS')
        );
        return med?.nfe_resumen?.aplica === true && med?.nfe_resumen?.valor === 60;
    },
    'Medicamentos missing NFE "60"'
);

// ============================================================
// RESULTS SUMMARY
// ============================================================
logBuffer += '\n' + '='.repeat(60) + '\n';
logBuffer += '📊 TEST RESULTS SUMMARY\n';
logBuffer += '='.repeat(60) + '\n';

const passedCount = results.filter(r => r.passed).length;
const failedCount = results.filter(r => !r.passed).length;
const totalCount = results.length;

logBuffer += `\n✅ PASSED: ${passedCount}/${totalCount}\n`;
logBuffer += `❌ FAILED: ${failedCount}/${totalCount}\n`;
logBuffer += '='.repeat(60) + '\n';

fs.writeFileSync('test_results.txt', logBuffer, 'utf-8');
console.log(logBuffer);

if (failedCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
