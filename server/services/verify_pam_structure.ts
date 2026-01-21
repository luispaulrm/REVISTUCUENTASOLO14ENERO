
interface PamItem {
    codigoGC: string;
    descripcion: string;
    cantidad: string;
    valorTotal: number;
    bonificacion: number;
    copago: number;
}

interface PamProvider {
    nombrePrestador: string;
    items: PamItem[];
}

interface PamFolio {
    folioPAM: string;
    desglosePorPrestador: PamProvider[];
}

interface PamDocument {
    folios: PamFolio[];
}

// 1. Mock structure from pam.endpoint.ts
const mockEndpointPam: PamDocument = {
    folios: [
        {
            folioPAM: "12345",
            desglosePorPrestador: [
                {
                    nombrePrestador: "CLINICA TEST",
                    items: [
                        {
                            codigoGC: "01-01-001",
                            descripcion: "CONSULTA MEDICA",
                            cantidad: "1",
                            valorTotal: 50000,
                            bonificacion: 40000,
                            copago: 10000
                        },
                        {
                            codigoGC: "03-01-045",
                            descripcion: "HEMOGRAMA",
                            cantidad: "1",
                            valorTotal: 5000,
                            bonificacion: 4000,
                            copago: 1000
                        }
                    ]
                }
            ]
        }
    ]
};

// 2. Extraction Logic from auditEngine.service.ts
function extractPamLines(cleanedPam: any) {
    console.log("Checking structure...");
    if (cleanedPam.folios) console.log(`- folios: ${cleanedPam.folios.length}`);
    if (cleanedPam.items) console.log(`- items: ${cleanedPam.items.length}`);

    // LOGIC COPY-PASTED FROM auditEngine.service.ts (simplified for verification)
    const lines = cleanedPam.folios?.flatMap((folio: any) =>
        folio.desglosePorPrestador?.flatMap((prest: any) =>
            (prest.items || []).map((item: any) => ({
                key: item.codigo || 'UNKNOWN', // Match the property mismatch?
                desc: item.descripcion || '',
                amount: item.copago || 0,
                isGeneric: (item.descripcion || '').toUpperCase().includes("MATERIAL")
            }))
        ) || []
    ) || [];

    return lines;
}

// 3. Fallback Logic from auditEngine.service.ts (Simulated)
function extractPamLinesFallback(cleanedPam: any) {
    let pamLines = extractPamLines(cleanedPam);

    if (pamLines.length === 0) {
        console.log("⚠️ Primary extraction failed. Attempting fallback...");

        // Try direct items
        if (cleanedPam.items && Array.isArray(cleanedPam.items)) {
            pamLines = cleanedPam.items.map((item: any) => ({
                key: item.codigo || 'UNKNOWN',
                desc: item.descripcion || '',
                amount: item.copago || 0,
                isGeneric: false
            }));
        }
    }
    return pamLines;
}

// 4. Run Test
console.log("--- TEST START ---");
const result = extractPamLinesFallback(mockEndpointPam);
console.log(`Extracted Lines: ${result.length}`);
result.forEach((l, i) => console.log(`[${i}] key=${l.key}, amount=${l.amount}`));

if (result.length === 2 && result[0].amount === 10000) {
    console.log("✅ SUCCESS: Extraction logic works with Endpoint structure.");
    console.log("ℹ️ Note: key is 'UNKNOWN' because property mismatch (codigo vs codigoGC).");
} else {
    console.error("❌ FAILURE: Logic failed to extract lines.");
}
