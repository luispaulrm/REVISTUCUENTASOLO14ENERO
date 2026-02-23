import { parseTopeStrict, normalizeVAUnit } from './canonicalTransform.service.js';

function testV36() {
    console.log('--- TEST V3.6: Strict Parsing & Normalization ---');

    const testCasesToken = [
        { input: "", expectedTipo: "NO_ENCONTRADO", expectedReason: "CELDA_VACIA_OCR" },
        { input: "-", expectedTipo: "NO_ENCONTRADO", expectedReason: "CELDA_VACIA_OCR" },
        { input: "—", expectedTipo: "NO_ENCONTRADO", expectedReason: "CELDA_VACIA_OCR" },
        { input: "Sin Tope", expectedTipo: "SIN_TOPE_EXPLICITO", expectedReason: "SIN_TOPE_EXPRESO_EN_CONTRATO" },
        { input: "Ilimitado", expectedTipo: "SIN_TOPE_EXPLICITO", expectedReason: "SIN_TOPE_EXPRESO_EN_CONTRATO" },
        { input: "5 UF", expectedTipo: "NUMERICO", expectedValor: 5, expectedUnidad: "UF" },
        { input: "6 V.A.", expectedTipo: "NUMERICO", expectedValor: 6, expectedUnidad: "VA" },
        { input: "6 VAM", expectedTipo: "NUMERICO", expectedValor: 6, expectedUnidad: "VA" },
        { input: "6 VA", expectedTipo: "NUMERICO", expectedValor: 6, expectedUnidad: "VA" },
        { input: "10.5 UF", expectedTipo: "NUMERICO", expectedValor: 10.5, expectedUnidad: "UF" },
        { input: "10,5 UF", expectedTipo: "NUMERICO", expectedValor: 10.5, expectedUnidad: "UF" },
        { input: "Something unknown", expectedTipo: "NO_ENCONTRADO", expectedReason: "FORMATO_NO_RECONOCIDO" }
    ];

    let passed = 0;
    testCasesToken.forEach(tc => {
        const res = parseTopeStrict(tc.input);
        const okTipo = res.tipo === tc.expectedTipo;
        const okVal = tc.expectedValor === undefined || res.valor === tc.expectedValor;
        const okUnidas = tc.expectedUnidad === undefined || res.unidad === tc.expectedUnidad;
        const okReason = tc.expectedReason === undefined || res.razon === tc.expectedReason;

        if (okTipo && okVal && okUnidas && okReason) {
            console.log(`✅ Passed: "${tc.input}" -> ${res.tipo} ${res.valor || ''} ${res.unidad || ''}`);
            passed++;
        } else {
            console.log(`❌ Failed: "${tc.input}"`);
            console.log(`   Expected: ${tc.expectedTipo} ${tc.expectedValor || ''} ${tc.expectedUnidad || ''} (${tc.expectedReason || ''})`);
            console.log(`   Actual:   ${res.tipo} ${res.valor || ''} ${res.unidad || ''} (${res.razon || ''})`);
        }
    });

    console.log(`\nResults: ${passed}/${testCasesToken.length} passed.`);
    if (passed === testCasesToken.length) {
        console.log('✅ ALL V3.6 PARSING TESTS PASSED');
    } else {
        process.exit(1);
    }
}

testV36();
