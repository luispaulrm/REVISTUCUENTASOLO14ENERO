import { reconstructTableGrid, detectGridColumns } from './server/services/contractEngine.service.js';
import { transformToCanonical } from './server/services/canonicalTransform.service.ts';
import { Token, GridColumn, ContractV3Output } from './server/services/contractTypes.js';

async function testGrid() {
    console.log('--- TEST 1: Grid Assembly & Row Propagation ---');
    const tokens: Token[] = [
        { text: "Día Cama", page: 1, x0: 50, x1: 100, y0: 500, y1: 510 },
        { text: "100%", page: 1, x0: 200, x1: 250, y0: 500, y1: 510 },
        { text: "Sin Tope", page: 1, x0: 300, x1: 350, y0: 500, y1: 510 },
        { text: "Pabellón", page: 1, x0: 50, x1: 100, y0: 480, y1: 490 },
        // Pabellón cell in Col 2 and Col 3 are visually empty but should inherit from row above if it was a merge
        // (Our current propagation logic is contiguous-based)
    ];

    const columns: GridColumn[] = [
        { colId: 'c1', x0: 40, x1: 150, headerHint: 'PRESTACION' },
        { colId: 'c2', x0: 190, x1: 260, headerHint: 'PCT' },
        { colId: 'c3', x0: 290, x1: 400, headerHint: 'TOPE' }
    ];

    const model = reconstructTableGrid(tokens, 1, columns);
    console.log('Rows detected:', model.rows.length);
    model.rows.forEach(r => {
        console.log(`Row ${r.rowId} (y=${r.y0.toFixed(0)}):`,
            columns.map(c => `[${c.colId}: ${r.cells[c.colId]?.raw || 'EMPTY'}]`).join(' | ')
        );
    });

    const pabellonRow = model.rows.find(r => r.cells['c1']?.raw === "Pabellón");
    if (pabellonRow?.cells['c3']?.raw.includes("Sin Tope")) {
        console.log('✅ SUCCESS: Row propagation inherited "Sin Tope" for Pabellón.');
    } else {
        console.log('❌ FAILURE: Row propagation failed for Pabellón.');
    }
}

async function testCanonical() {
    console.log('\n--- TEST 2: Canonical Mapping (V3.5 Bridge) ---');
    const mockV3: ContractV3Output = {
        docMeta: { planType: "PREFERENTE", hasPreferredProviderMode: true, funNumber: "123", rawTitle: "PLAN PRUEBA" },
        coverageBlocks: [
            {
                blockId: "B1",
                blockTitle: "HOSPITALARIO",
                benefitRules: [
                    {
                        ruleId: "R1",
                        blockId: "B1",
                        prestacionLabel: "Día Cama",
                        modalidadPreferente: {
                            bonificacionPct: 100,
                            topePrestacion: {
                                tipo: "SIN_TOPE_EXPLICITO",
                                valor: null,
                                unidad: null,
                                raw: "Sin Tope",
                                razon: "SIN_TOPE_EXPRESO_EN_CONTRATO"
                            },
                            topeAnualBeneficiario: {
                                tipo: "NUMERICO",
                                valor: 50,
                                unidad: "UF",
                                raw: "50 UF Anuales"
                            }
                        },
                        evidence: { anchors: ["Día Cama"] }
                    }
                ]
            }
        ],
        networkRules: [],
        issues: []
    };

    const result = { v3: mockV3 } as any;
    const canonical = transformToCanonical(result);

    const dc = canonical.coberturas.find(c => c.descripcion_textual === "Día Cama");
    const topes = canonical.topes.filter(t => t.fuente_textual.includes("Día Cama"));

    console.log('Cobertura encontrada:', !!dc);
    console.log('Topes encontrados:', topes.length);

    const topeSinTope = topes.find(t => t.razon === "SIN_TOPE_EXPRESO_EN_CONTRATO");
    const topeAnual = topes.find(t => t.aplicacion === "anual");

    if (dc?.porcentaje === 100 && topeSinTope && topeAnual?.valor === 50) {
        console.log('✅ SUCCESS: Canonical bridge correctly mapped V3.5 structure.');
    } else {
        console.log('❌ FAILURE: Canonical bridge mapping errors.');
        console.log('Tope Sin Tope:', !!topeSinTope);
        console.log('Tope Anual Valor:', topeAnual?.valor);
    }
}

testGrid().then(testCanonical);
