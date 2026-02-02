
import { inferUnidadReferencia } from './server/services/financialValidator.service.ts';

async function verifyFix() {
    console.log("🧪 VERIFYING AC2 INFERENCE FIX (PRECISION CHECK)...");

    const mockContract = {
        diseno_ux: { nombre_isapre: "CONSALUD" },
        coberturas: []
    };

    console.log("\n--- TEST CASE A: Qty = 3.5 (The Bug) ---");
    const pamA = {
        folios: [{
            desglosePorPrestador: [{
                items: [{
                    codigoGC: "1103057",
                    descripcion: "RIZOTOMIA",
                    bonificacion: "267.808",
                    cantidad: "3.5"
                }]
            }]
        }]
    };

    const resultA = await inferUnidadReferencia(mockContract, pamA, "CONSALUD");
    console.log(`Result A (Qty=3.5):`, JSON.stringify(resultA, null, 2));

    console.log("\n--- TEST CASE B: Qty = 1.0 (Standard) ---");
    const pamB = {
        folios: [{
            desglosePorPrestador: [{
                items: [{
                    codigoGC: "1103057",
                    descripcion: "RIZOTOMIA",
                    bonificacion: "267.808",
                    cantidad: "1.0"
                }]
            }]
        }]
    };
    const resultB = await inferUnidadReferencia(mockContract, pamB, "CONSALUD");
    console.log(`Result B (Qty=1.0):`, JSON.stringify(resultB, null, 2));
}

verifyFix();
