
import { runSkill } from './src/m10/engine.ts';
import type { SkillInput, CanonicalContractRule, ContractDomain } from './src/m10/types.ts';
import fs from 'fs';

// Mock Data from AuditorM10App.tsx
const mockContract = {
    rules: [
        { id: 'R1', domain: 'PABELLON', coberturaPct: 100, tope: { value: null, kind: 'SIN_TOPE_EXPRESO' }, textLiteral: 'Derecho Pabellón 100% Sin Tope' },
        { id: 'R2', domain: 'MATERIALES_CLINICOS', coberturaPct: 100, tope: { value: 6000000, kind: 'TOPE_MONTO' }, textLiteral: 'Materiales e Insumos 100% Sin Tope (Simulado)' },
        { id: 'R3', domain: 'HONORARIOS', coberturaPct: 100, tope: { value: 13.26, kind: 'VAM' }, textLiteral: 'Honorarios Médicos 100% Tope 13.26 VAM' },
        { id: 'R4', domain: 'DIA_CAMA', coberturaPct: 100, tope: { value: null, kind: 'SIN_TOPE_EXPRESO' }, textLiteral: 'Día Cama 100% Sin Tope' }
    ]
};

const mockPam = {
    folios: [{
        folioPAM: 'PAM-APENDICITIS-001',
        items: [
            { codigoGC: '1701001', descripcion: 'APENDICECTOMIA', valorTotal: 450000, bonificacion: 450000, copago: 0 },
            { codigoGC: '1101001', descripcion: 'DERECHO PABELLON QUIRURGICO', valorTotal: 300000, bonificacion: 300000, copago: 0 },
            { codigoGC: '1201001', descripcion: 'DIA CAMA DE HOSPITALIZACION', valorTotal: 200000, bonificacion: 200000, copago: 0 },

            // v1.4 COMPLETE TRAPS (M1, M2, M3, M4)

            // M1 Trap: "Derecho de Sala de Recuperación" (Often bundled in Pavilion)
            { codigoGC: '1101999', descripcion: 'DERECHO DE SALA RECUPERACION', valorTotal: 120000, bonificacion: 0, copago: 120000 },

            // M2 Trap: "Kit de Sutura" (Often bundled in Pavilion/Materials)
            { codigoGC: '3101002', descripcion: 'KIT DE SUTURA QUIRURGICA', valorTotal: 35000, bonificacion: 0, copago: 35000 },

            // M3 Trap: "Insumos Generales" (Generic/Opaque) -> IOP High
            { codigoGC: '3101001', descripcion: 'INSUMOS GENERALES VARIOS', valorTotal: 25000, bonificacion: 0, copago: 25000 },
            // M4 Trap: "Alimentación Acompañante" (Should be Hotelery but sometimes argued) -> Discusión Técnica
            { codigoGC: '6001001', descripcion: 'ALIMENTACION ACOMPAÑANTE', valorTotal: 5000, bonificacion: 0, copago: 5000 }
        ]
    }]
};

const mockBill = {
    items: [
        { description: 'Honorario Medico Apendicectomia', total: 450000 },
        { description: 'Pabellon Central', total: 300000 },
        { description: 'Habitación Individual (2 dias)', total: 200000 },
        { description: 'Sala Recuperacion Post-Op', total: 120000 },
        { description: 'Sutura Vicryl', total: 15000 },
        { description: 'Sutura Seda', total: 20000 },
        { description: 'Gasto Insumos Varios', total: 25000 },
        { description: 'Caldos y Sopas', total: 5000 }
    ]
};

// Adapter Logic (simplified from AuditorM10App.tsx)
function mapCategoryToDomain(cat: string, desc: string = ''): ContractDomain {
    const lowerCat = (cat || '').toLowerCase();
    const lowerDesc = (desc || '').toLowerCase();
    const combined = `${lowerCat} ${lowerDesc}`;
    if (lowerCat.includes('hospital') || lowerCat.includes('dias cama')) return 'HOSPITALIZACION';
    if (lowerCat.includes('pabellon') || lowerCat.includes('quirofano')) return 'PABELLON';
    if (lowerCat.includes('honorario') || lowerCat.includes('medico')) return 'HONORARIOS';
    if (lowerCat.includes('medicamento')) return 'MEDICAMENTOS_HOSP';
    if (lowerCat.includes('material')) return 'MATERIALES_CLINICOS';
    return 'OTROS';
}

function adaptToM10Input(rawContract: any, rawPam: any, rawBill: any): SkillInput {
    // 1. Adapt CONTRACT
    const rules = rawContract.rules.map((c: any) => ({
        id: c.id,
        domain: mapCategoryToDomain(c.domain, c.textLiteral),
        coberturaPct: c.coberturaPct,
        tope: c.tope,
        textLiteral: c.textLiteral
    })) as CanonicalContractRule[];

    // 2. Adapt PAM
    const pamFolios = rawPam.folios.map((folio: any) => ({
        folioPAM: folio.folioPAM,
        items: folio.items.map((item: any) => ({
            id: 'pam-' + Math.random().toString(36).substr(2, 5),
            folioPAM: folio.folioPAM,
            codigoGC: item.codigoGC,
            descripcion: item.descripcion,
            valorTotal: Number(item.valorTotal),
            copago: Number(item.copago),
            bonificacion: Number(item.bonificacion)
        }))
    }));

    // 3. Adapt BILL
    const billItems = rawBill.items.map((item: any, i: number) => ({
        id: 'itm-' + Math.random().toString(36).substr(2, 5),
        index: i + 1,
        description: item.description,
        total: Number(item.total),
        unitPrice: 0,
        qty: 1
    }));

    return {
        contract: { rules },
        pam: { folios: pamFolios },
        bill: { items: billItems }
    };
}

// Execution
setTimeout(() => {
    console.log("\n\n\n\n=== SIMULACIÓN FRONTAL EN BACKEND (M10 v1.4) ===");
    console.log("Caso: Apendicitis con Hallazgos de Opacidad (M3) y Renegación (M4)");
    console.log("---------------------------------------------------------------");

    const input = adaptToM10Input(mockContract, mockPam, mockBill);
    const result = runSkill(input);

    console.log("\nRESULTADOS DE AUDITORÍA:");
    console.log(`Evento Detectado: ${result.eventModel.actoPrincipal}`);
    console.log(`Opacidad Global: ${result.summary.opacidadGlobal.applies ? 'CRÍTICA' : 'NORMAL'} (IOP: ${result.summary.opacidadGlobal.maxIOP})`);
    console.log(`Impacto Fragmentación: $${result.summary.totalImpactoFragmentacion.toLocaleString()}`);

    console.log("\nMATRIZ DE HALLAZGOS:");
    result.matrix.forEach(row => {
        console.log(`[${row.motor}] ${row.classification} | $${row.impacto.toLocaleString()} | ${row.itemLabel}`);
        console.log(`    > Fundamento: ${row.fundamento}`);
        if (row.iop > 0) console.log(`    > IOP: ${row.iop}`);
    });

    console.log("\n---------------------------------------------------------------");
    console.log("Simulación completada con éxito.");

    fs.writeFileSync('m10_demo_case_result.json', JSON.stringify(result, null, 2));
    console.log("Resultado guardado en m10_demo_case_result.json");
}, 2000);
