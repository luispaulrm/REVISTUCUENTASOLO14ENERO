
// Basic test script to verify M10 Adapter Logic locally
// Usage: ts-node scripts/test_m10_adapter.ts

const mockPamInput = {
    folios: [
        {
            folioPAM: "12345",
            desglosePorPrestador: [
                {
                    nombrePrestador: "CLINICA_TEST",
                    items: [
                        { codigoGC: "1101001", descripcion: "PABELLON", valorTotal: 1000, bonificacion: 800, copago: 200 }
                    ]
                }
            ]
        }
    ]
};

const mockBillInput = {
    content: JSON.stringify({
        clinicName: "CLINICA TEST",
        sections: [
            {
                title: "PABELLON",
                items: [
                    { description: "PABELLON CENTRAL", total: 1000 }
                ]
            },
            {
                title: "INSUMOS",
                items: [
                    { description: "GUIDE WIRE", total: 500 }
                ]
            }
        ]
    })
};

const mockContractInput = {
    rules: [
        { item: "R1", categoria: "PABELLON", porcentaje: 100, descripcion_textual: "Cobertura 100%" }
    ]
};

// Paste the function here for testing since we can't import easily from React component file in standalone script
function mapCategoryToDomain(cat: string, desc: string = ''): string {
    const lowerCat = (cat || '').toLowerCase();
    const lowerDesc = (desc || '').toLowerCase();

    if (lowerCat.includes('hospital') || lowerCat.includes('dias cama')) return 'HOSPITALIZACION';
    if (lowerCat.includes('pabellon') || lowerCat.includes('quirofano')) return 'PABELLON';
    return 'OTROS';
}

function adaptToM10Input(rawContract: any, rawPam: any, rawBill: any): any {
    // 1. Adapt CONTRACT
    let rules: any[] = [];
    let sourceArray: any[] = [];

    if (rawContract.rules && Array.isArray(rawContract.rules)) {
        sourceArray = rawContract.rules;
    }

    rules = sourceArray.map((c: any) => ({
        id: c.item || 'rule',
        domain: mapCategoryToDomain(c.categoria || '', c.descripcion_textual || ''),
        coberturaPct: c.porcentaje,
        tope: { kind: 'SIN_TOPE_EXPRESO', value: null, currency: c.tope },
        textLiteral: `${c.item || ''} ${c.descripcion_textual || ''}`.trim()
    }));

    // 2. Adapt PAM
    let pamFolios: any[] = [];
    let pamSource = rawPam;

    if (pamSource.folios && Array.isArray(pamSource.folios)) {
        // Handle nested DesglosePorPrestador (Real PAM App structure)
        pamFolios = pamSource.folios.map((f: any) => {
            let items = f.items || [];
            if (f.desglosePorPrestador && Array.isArray(f.desglosePorPrestador)) {
                // Flatten items from all providers in this folio
                const nestedItems = f.desglosePorPrestador.flatMap((p: any) => p.items || []);
                items = [...items, ...nestedItems];
            }
            return { ...f, items };
        });
    }

    // 3. Adapt BILL (Cuenta)
    let billItems: any[] = [];
    let billSource = rawBill;

    // Unwrap if wrapped (AccountProjectorV7 saves { content: string, ... })
    if (rawBill.content) {
        if (typeof rawBill.content === 'string') {
            try {
                billSource = JSON.parse(rawBill.content);
            } catch (e) {
                console.error("Failed to parse Bill content JSON", e);
            }
        }
    }

    if (billSource.items && Array.isArray(billSource.items)) {
        billItems = billSource.items;
    } else if (billSource.sections && Array.isArray(billSource.sections)) {
        billItems = billSource.sections.flatMap((s: any) => s.items || []);
    }

    return {
        contract: { rules },
        pam: { folios: pamFolios },
        bill: { items: billItems }
    };
}

// Run Test
const result = adaptToM10Input(mockContractInput, mockPamInput, mockBillInput);
console.log("PAM Folios:", result.pam.folios.length);
console.log("PAM Items in Folio 0:", result.pam.folios[0]?.items?.length);
console.log("Bill Items:", result.bill.items.length);

if (result.pam.folios[0]?.items?.length === 1 && result.bill.items.length === 2) {
    console.log("TEST PASS: Adapter correctly flattened PAM and parsed Bill content.");
} else {
    console.error(`TEST FAIL: Adapter did not handle inputs correctly. Expected 1 PAM item and 2 Bill items. Got ${result.pam.folios[0]?.items?.length} and ${result.bill.items.length}.`);
}
