
import { runCanonicalRules, generateExplainableOutput } from './canonicalRulesEngine.service.js';
import { preProcessEventos } from './eventProcessor.service.js';
import * as fs from 'fs';
import { BillingItem, Contract } from '../../src/types.js';

// Paths
const DATA_PAM_PATH = 'c:/Users/drlui/Downloads/pam_coberturas_1769439956434.json';
const CONTRACT_PATH = 'C:/Users/drlui/.gemini/antigravity/brain/015583a2-a4a1-4df6-a676-36139e64032a/contrato_canonico_consalud.json';

async function executeCanonicalModule() {
    console.log("🚀 EJECUTANDO MÓDULO DE ANÁLISIS CANÓNICO (SKILL EXECUTION)\n");

    try {
        // 1. Load Data
        const pamData = JSON.parse(fs.readFileSync(DATA_PAM_PATH, 'utf-8'));
        const contractJson = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf-8'));

        console.log(`📄 Contrato: ${contractJson.metadata?.fuente}`);
        console.log(`🏥 PAM: ${pamData.clinicName || 'CLINICA MEDS'}`);

        // 2. Mock Contract Object (Type Adaptation)
        // The Canonical Engine expects a 'Contract' interface which matches our JSON structure mostly.
        const contract: Contract = contractJson as Contract;

        // 3. Prepare Billing Items (Raw Input)
        // We need to flatten the PAM structure into BillingItems
        let rawItems: BillingItem[] = [];
        if (pamData.folios) {
            rawItems = pamData.folios[0].desglosePorPrestador[0].items.map((i: any) => ({
                code: i.codigoGC,
                description: i.descripcion,
                quantity: Number(i.cantidad),
                unitPrice: Number(i.valorTotal) / Number(i.cantidad),
                totalPrice: Number(i.valorTotal),
                date: pamData.date || new Date().toISOString()
            }));
        } else if (pamData.sections) {
            // Fallback for Billing View Format
            rawItems = pamData.sections.flatMap((s: any) => s.items.map((i: any) => ({
                code: i.code || "0000000",
                description: i.description,
                quantity: Number(i.quantity),
                unitPrice: Number(i.price), // Assuming price is unit
                totalPrice: Number(i.total),
                date: new Date().toISOString()
            })));
        }

        // 4. Pre-process Events (to get Structured Episodes)
        // We reuse the event processor to get the 'eventos' array required by the engine
        // We need to adapt PAM again for preProcessEventos if strictly needed, 
        // but let's assume valid structure if pamData.folios exists.

        let processedPam = pamData;
        if (!pamData.folios) {
            console.log("⚠️ Adapting PAM for Event Processor...");
            processedPam = {
                folios: [{
                    folioPAM: "1986742",
                    prestadorPrincipal: "CLINICA MEDS LA DEHESA SPA",
                    desglosePorPrestador: [{
                        nombrePrestador: "CLINICA MEDS LA DEHESA SPA",
                        items: pamData.sections.flatMap((s: any) => s.items.map((i: any) => ({
                            codigoGC: i.description.match(/\d+$/)?.[0] || "0000000",
                            descripcion: i.description,
                            cantidad: String(i.quantity),
                            valorTotal: i.total,
                            bonificacion: i.bonificacion || 0,
                            copago: i.copago || i.total,
                            fecha: new Date().toISOString()
                        })))
                    }]
                }]
            };
        }

        const eventos = await preProcessEventos(processedPam, contract);

        // 5. RUN ENGINE
        console.log("\n⚡ Corriendo Reglas Canónicas (C-01, C-02, ...)...");
        const result = runCanonicalRules(rawItems, eventos, contract);

        // 6. Generate Explainable Output
        const explanation = generateExplainableOutput(result.decision, result.rules, result.flags);

        console.log("\n📊 RESULTADO DEL ANÁLISIS CANÓNICO:\n");
        console.log(`⚖️  Decisión Global: ${explanation.decisionGlobal}`);
        console.log(`📜 Principio: ${explanation.principioAplicado}`);

        if (explanation.fundamento.length > 0) {
            console.log("\n🔍 Fundamentos:");
            explanation.fundamento.forEach(f => console.log(`   - ${f}`));
        } else {
            console.log("\n✅ Sin hallazgos negativos (Cumplimiento Contractual)");
        }

        // 7. Save Artifact
        const artifact = {
            timestamp: new Date().toISOString(),
            contract_source: contract.metadata.fuente,
            canonical_validation: result,
            explanation
        };
        fs.writeFileSync('c:/REVISATUCUENTASOLO14enero/server/services/canonical_analysis_result.json', JSON.stringify(artifact, null, 2));
        console.log("\n💾 Artefacto guardado: canonical_analysis_result.json");

    } catch (e: any) {
        console.error("❌ Error running canonical module:", e.message);
        console.error(e.stack);
    }
}

executeCanonicalModule();
