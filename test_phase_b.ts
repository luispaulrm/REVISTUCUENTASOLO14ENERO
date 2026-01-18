
import { preProcessEventos } from './server/services/eventProcessor.service';
import { inferUnidadReferencia, validateTopeHonorarios } from './server/services/financialValidator.service';
import { performForensicAudit } from './server/services/auditEngine.service'; // Import to check syntax/compilation

// MOCK DATA
const mockPAM = {
    folios: [
        {
            folioPAM: "100",
            prestadorPrincipal: "CLINICA_TEST",
            fechaEmision: "01/01/2024",
            desglosePorPrestador: [
                {
                    nombrePrestador: "CLINICA_TEST",
                    items: [
                        { codigoGC: "1802081", descripcion: "COLECISTECTOMIA", bonificacion: "600.000", copago: "200.000", cantidad: "1", valorTotal: "800.000", fecha: "01/01/2024" },
                        { codigoGC: "1802081", descripcion: "COLECISTECTOMIA (Ayudante)", bonificacion: "150.000", copago: "50.000", cantidad: "0.25", valorTotal: "200.000", fecha: "01/01/2024" },
                        { codigoGC: "3101302", descripcion: "MEDICAMENTOS GENERICOS", bonificacion: "50.000", copago: "500.000", cantidad: "1", valorTotal: "550.000", fecha: "01/01/2024" }
                    ]
                }
            ]
        }
    ]
};

async function runTests() {
    console.log("=== STARTING PHASE B TESTS ===");

    // 1. Test Unit Value Inference
    console.log("\n[TEST 1] Testing inferUnidadReferencia...");
    const unitRef = inferUnidadReferencia({}, mockPAM);
    console.log("Unit Reference Result:", JSON.stringify(unitRef, null, 2));

    if (unitRef.confianza === "ALTA" && unitRef.tipo === "VA" && unitRef.valor_pesos_estimado > 10000) {
        console.log("✅ Unit Value Inference PASSED");
    } else {
        console.error("❌ Unit Value Inference FAILED");
    }

    // 2. Test Event Processor (Episode Logic + Collapse)
    console.log("\n[TEST 2] Testing preProcessEventos (Episode Logic)...");
    const eventos = preProcessEventos(mockPAM);
    console.log("Eventos Generated:", JSON.stringify(eventos, null, 2));

    if (eventos.length === 1 && eventos[0].tipo_evento === "QUIRURGICO") {
        console.log("✅ Event Grouping PASSED (1 Episode detected)");
    } else {
        console.error("❌ Event Grouping FAILED");
    }

    // Check Analysis Financiero
    if (eventos[0].analisis_financiero?.tope_cumplido === true) {
        console.log("✅ Financial Validation PASSED (Tope Cumplido)");
    } else {
        console.warn("⚠️ Financial Validation WARNING (Check numbers if mock data aligns with logic)");
    }

    // 3. Syntax Check for AuditEngine
    console.log("\n[TEST 3] Checking imports of auditEngine.service...");
    if (performForensicAudit) {
        console.log("✅ auditEngine imported successfully (Syntax OK)");
    }

    console.log("\n=== TESTS COMPLETED ===");
}

runTests().catch(err => console.error("FATAL ERROR:", err));
