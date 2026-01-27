
import { inferUnidadReferencia } from './server/services/financialValidator.service.js';

const mockContrato = (isapre: string) => ({
    diseno_ux: { nombre_isapre: isapre },
    coberturas: [
        { item: 'Honorarios', valor: '70' }
    ]
});

const mockPam = {
    folios: [
        {
            desglosePorPrestador: [
                {
                    items: [
                        {
                            codigoGC: '1802081',
                            descripcion: 'COLECISTECTOMIA',
                            bonificacion: '1.200.000',
                            copago: '400.000'
                        }
                    ]
                }
            ]
        }
    ]
};

console.log("=== VERIFICACIÓN DE MAPEOS DE ARANCEL ===");

const cases = [
    { name: "Nueva Masvida", expected: "VAM" },
    { name: "Masvida", expected: "VAM" },
    { name: "Consalud", expected: "AC2" },
    { name: "Colmena", expected: "VAM" },
    { name: "Banmédica", expected: "VA" },
    { name: "Unknown", expected: "VA" }
];

for (const c of cases) {
    const res = await inferUnidadReferencia(mockContrato(c.name), mockPam, c.name);
    console.log(`Isapre: ${c.name} -> Tipo Detectado: ${res.tipo} (Esperado: ${c.expected})`);
    if (res.tipo === c.expected) {
        console.log("✅ OK");
    } else {
        console.log("❌ FALLO");
    }
}
