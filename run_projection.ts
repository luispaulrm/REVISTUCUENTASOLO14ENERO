
import fs from 'fs';
import path from 'path';
import { executeCanonizer } from './agent/skills/canonizar-contrato-salud/execute_canonizer';
import { buildMentalModel } from './agent/skills/canonizar-contrato-salud/ProjectionEngine';

const EXTRACTION_PATH = path.resolve('./extraction_result.json');
const CANONICAL_PATH = path.resolve('./canonical_contract.json');
const MENTAL_MODEL_PATH = path.resolve('./mental_model.json');

async function main() {
    console.log("🚀 Starting Projection Pipeline...");

    // 1. Load Extraction Data
    if (!fs.existsSync(EXTRACTION_PATH)) {
        console.error(`❌ Data not found: ${EXTRACTION_PATH}`);
        process.exit(1);
    }
    const extractionData = JSON.parse(fs.readFileSync(EXTRACTION_PATH, 'utf-8'));
    console.log("✅ Extraction data loaded.");

    // 2. Run Atomic Canonizer (Brain)
    console.log("🧠 Running Atomic Canonizer...");
    const atomicContract = executeCanonizer(extractionData);

    // 3. Save Atomic Truth
    fs.writeFileSync(CANONICAL_PATH, JSON.stringify(atomicContract, null, 2), 'utf-8');
    console.log(`💾 Atomic data saved to: ${CANONICAL_PATH}`);

    // 4. Run Projection Engine (Mental Model)
    console.log("🔮 Running Projection Engine...");
    const mentalModel = buildMentalModel(atomicContract);

    // 5. Save Mental Model
    fs.writeFileSync(MENTAL_MODEL_PATH, JSON.stringify(mentalModel, null, 2), 'utf-8');
    console.log(`✨ Mental Model saved to: ${MENTAL_MODEL_PATH}`);

    // 6. Preview Specific Items (Validation)
    console.log("\n--- MENTAL MODEL PREVIEW ---");
    const previewItems = ["MATERIALES CLÍNICOS (2)", "MEDICAMENTOS HOSPITALARIOS (2)", "QUIMIOTERAPIA (8)"];

    const findings = mentalModel.prestaciones.filter(p => previewItems.some(i => p.titulo.includes(i) || normalize(p.titulo).includes(normalize(i))));

    findings.forEach(f => {
        console.log(`\n📌 [${f.titulo}]`);
        console.log(`   Cobertura Base: ${f.esquema_mental.cobertura_base}`);
        console.log(`   LE: ${f.modalidades.libre_eleccion.detalle_cobertura}`);
        if (f.modalidades.preferente?.activa) {
            console.log(`   PREF: ${f.modalidades.preferente.detalle_cobertura} en ${f.modalidades.preferente.prestadores_resumen.join(", ")}`);
        } else {
            console.log(`   PREF: 🔒 Bloqueado / No Aplica`);
        }
        console.log(`   Alertas: ${f.alertas_forenses.join(" | ")}`);
    });
}

function normalize(s: string) { return s.toLowerCase().trim(); }

main().catch(err => console.error(err));
