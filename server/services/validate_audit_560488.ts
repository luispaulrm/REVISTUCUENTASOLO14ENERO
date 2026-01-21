
import dotenv from 'dotenv';
import { performForensicAudit } from '../services/auditEngine.service.js';

// Load Environment
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "dummy";

// 1. MOCK INVOICE (Data for Refined Rules)
const mockInvoice = {
    "clinicName": "CLINICA TEST REGLAS REFINADAS",
    "patientName": "MOISES RETAMAL",
    "invoiceNumber": "V-2025-REFINED",
    "total": 5000000,
    "sections": [
        {
            "category": "PABELLON",
            "items": [
                { "description": "DER. PABELLON CIRUGIA", "quantity": 1, "unitPrice": 800000, "total": 800000 },
                { "description": "RECUPERACION", "quantity": 1, "unitPrice": 150000, "total": 150000 }
                // NO HM surgical honors here -> Should trigger C-02 Violation
            ]
        },
        {
            "category": "LABORATORIO",
            "items": [
                { "description": "HEMOGRAMA", "quantity": 1, "unitPrice": 15000, "total": 15000 },
                { "description": "HEMOGRAMA", "quantity": 1, "unitPrice": 15000, "total": 15000 },
                { "description": "HEMOGRAMA", "quantity": 1, "unitPrice": 15000, "total": 15000 },
                { "description": "HEMOGRAMA", "quantity": 1, "unitPrice": 15000, "total": 15000 },
                { "description": "HEMOGRAMA", "quantity": 1, "unitPrice": 15000, "total": 15000 }, // > 4
                { "description": "PERFIL BIOQUIMICO", "quantity": 1, "unitPrice": 35000, "total": 35000 },
                { "description": "PERFIL BIOQUIMICO", "quantity": 1, "unitPrice": 35000, "total": 35000 },
                { "description": "PERFIL BIOQUIMICO", "quantity": 1, "unitPrice": 35000, "total": 35000 },
                { "description": "PERFIL BIOQUIMICO", "quantity": 1, "unitPrice": 35000, "total": 35000 },
                { "description": "PERFIL BIOQUIMICO", "quantity": 1, "unitPrice": 35000, "total": 35000 } // > 4 -> Trigger F-03
            ]
        },
        {
            "category": "FARMACIA",
            "items": Array(60).fill(null).map((_, i) => ({
                "description": `INSUMO MEDICO ${i}`,
                "quantity": 1,
                "unitPrice": 2000,
                "total": 2000
            })) // > 50 -> Trigger C-03 (if contract has clause)
        },
        {
            "category": "HOTELERIA",
            "items": [
                { "description": "DIA CAMA", "quantity": 1, "unitPrice": 200000, "total": 200000 }
            ]
        }
    ]
};

// 2. MOCK PAM
const mockPam = {
    "patient": "MOISES RETAMAL",
    "global": { "totalCopago": 500000, "totalBonif": 1500000, "totalValor": 2000000 },
    "folios": []
};

// 3. MOCK CONTRACT
const mockContract = {
    "coberturas": [
        { "PRESTACIÓN CLAVE": "HOSPITALIZACION", "cobertura": "100%" }, // C-02 OK for hosp, but PABELLON has issue
        { "PRESTACIÓN CLAVE": "MEDICAMENTOS POR EVENTO", "cobertura": "100%", "tope": "100 UF" } // Trigger C-03 logic
    ]
};

async function runTest() {
    console.log("🚀 Testing Refined Canonical Rules (C-02, C-03, F-03)...");

    try {
        const result = await performForensicAudit(
            mockInvoice,
            mockPam,
            mockContract,
            API_KEY,
            (msg) => console.log(msg)
        );

        console.log("\n\n📊 REPORTE CANÓNICO ENCONTRADO:");
        console.log("------------------------------------------");
        console.log(JSON.stringify(result.data.canonical_rules_output, null, 2));

        const output = result.data.canonical_rules_output;

        // Assertions
        const hasC02 = output.fundamento.some((f: string) => f.includes("Pabellón") && f.includes("Honorarios"));
        const hasC03 = output.fundamento.some((f: string) => f.includes("Fragmentación"));
        const hasF03 = output.fundamento.some((f: string) => f.includes("HEMOGRAMA (x5)"));

        if (hasC02) console.log("✅ C-02 Detected: Surgical incoherence found.");
        if (hasC03) console.log("✅ C-03 Detected: Indue fragmentation of medications.");
        if (hasF03) console.log("✅ F-03 Detected: Iterative lab consumption detected.");

        if (hasC02 && hasC03 && hasF03) {
            console.log("\n🔥 ALL REFINED RULES VERIFIED SUCCESSFULLY.");
        } else {
            console.error("\n❌ Some rules were NOT triggered as expected.");
        }

    } catch (error) {
        console.error("❌ Test Failed:", error);
    }
}

runTest();
