
import fs from 'fs';
import path from 'path';
import { runSkill } from './src/m10/engine.ts';
import { ProjectionService } from './server/services/projection.service.ts';
import { GeminiService } from './server/services/gemini.service.ts';
// Embedded PAM Prompt to avoid import issues
const PAM_PROMPT = `
**INSTRUCCIÓN CRÍTICA: ANÁLISIS DE PROGRAMAS DE ATENCIÓN MÉDICA (PAM)**
ACTÚA COMO UN AUDITOR DE SEGUROS Y BONOS MÉDICOS.

**OBJETIVO:** Extraer el detalle completo de los bonos PAM en formato **JSON**.

**REGLA DE FORMATO VISUAL (IMPORTANTE):**
1. **FOLIO:** Identifica cada bono nuevo.
2. **PRESTADOR:** Identifica el prestador.
3. **TABLA:** Extrae los ítems incluyendo Código, Descripción, Cantidad, Valor Total, Bonificación y Copago.

**SCHEMA JSON ESPERADO:**
{
  "folios": [
    {
      "folioPAM": "12345678",
      "items": [
        { "codigoGC": "303030", "descripcion": "CONSULTA MEDICA", "cantidad": 1, "valorTotal": 40000, "bonificacion": 32000, "copago": 8000 }
      ]
    }
  ]
}
`;
import { analyzeSingleContract } from './server/services/contractEngine.service.ts';
import { transformToCanonical } from './server/services/canonicalTransform.service.ts';
import type { SkillInput } from './src/m10/types.ts';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: './server/.env' });

// --- Paths ---
const DOWNLOADS_DIR = 'C:/Users/drlui/Downloads';
const CONTRACT_PATH = path.join(DOWNLOADS_DIR, 'canonical_pleno 847.json'); // Already canonical? Or raw?
// User said "canonical_pleno 847.json", implying it might be the RESULT.
// But if it is the result, we can just load it.
// Let's assume it is the RESULT for now. 
// If it fails, we might need to re-process the PDF if available.

const PDF_PATH = path.join(DOWNLOADS_DIR, 'CUENTA INDISA_compressed-1-22.pdf');

// --- Helper to read file as base64 ---
function getFileBase64(filePath: string): string {
    return fs.readFileSync(filePath).toString('base64');
}

async function main() {
    console.log("Starting Integrated M10 Simulation...");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("ERROR: GEMINI_API_KEY is not set in ./server/.env");
        process.exit(1);
    }

    // 1. Process Account (Bill)
    let billItems: any[] = [];
    console.log("[1/3] Processing Account (Module: ProjectionService)...");

    // Check if we have the PDF to run the Projection Module
    if (fs.existsSync(PDF_PATH)) {
        console.log(`- Found PDF: ${PDF_PATH}. Running ProjectionService...`);
        const projectionService = new ProjectionService(apiKey);
        const pdfBase64 = getFileBase64(PDF_PATH);

        const stream = projectionService.projectPdfToHtml(
            pdfBase64,
            'application/pdf',
            undefined, // model
            'BILL_ONLY', // Mode: Account
            0,
            'json' // Format: JSON
        );

        let fullJsonStr = "";
        for await (const chunk of stream) {
            if (chunk.type === 'chunk' && chunk.text) {
                fullJsonStr += chunk.text;
                process.stdout.write('.');
            }
        }
        console.log("\n- Projection complete.");

        try {
            // Clean markdown code blocks if present
            const cleanStr = fullJsonStr.replace(/```json/g, '').replace(/```/g, '');
            const billData = JSON.parse(cleanStr);
            billItems = billData.items || billData;
            console.log(`- Extracted ${billItems.length} Bill Items.`);
            // Save intermediate result
            fs.writeFileSync('account_module_result.json', JSON.stringify(billData, null, 2));
        } catch (e) {
            console.error("Error parsing Bill JSON:", e);
        }

    } else {
        console.error(`- PDF not found: ${PDF_PATH}. Cannot run Account Module.`);
        // Allow fallback if JSON result already exists
        if (fs.existsSync('account_module_result.json')) {
            console.log("- Found existing result JSON. Loading...");
            const existing = JSON.parse(fs.readFileSync('account_module_result.json', 'utf-8'));
            billItems = existing.items || existing;
        }
    }


    // 2. Process PAM
    let pamFolios: any[] = [];
    console.log("[2/3] Processing PAM (Module: Gemini + Prompt)...");

    if (fs.existsSync(PDF_PATH)) {
        const gemini = new GeminiService(apiKey);
        const pdfBase64 = getFileBase64(PDF_PATH);

        try {
            console.log("- Sending PDF to Gemini for PAM extraction...");
            const pamJsonStr = await gemini.extract(
                pdfBase64,
                'application/pdf',
                PAM_PROMPT,
                { responseMimeType: 'application/json' }
            );

            const pamData = JSON.parse(pamJsonStr);
            pamFolios = pamData.folios || pamData;
            console.log(`- Extracted ${pamFolios.length} PAM Folios.`);
            fs.writeFileSync('pam_module_result.json', JSON.stringify(pamData, null, 2));

        } catch (e) {
            console.error("Error parsing PAM JSON:", e);
        }
    } else {
        console.error(`- PDF not found: ${PDF_PATH}. Cannot run PAM Module.`);
        if (fs.existsSync('pam_module_result.json')) {
            console.log("- Found existing PAM result. Loading...");
            const existing = JSON.parse(fs.readFileSync('pam_module_result.json', 'utf-8'));
            pamFolios = existing.folios || existing;
        }
    }

    // 3. Process Contract
    let contractRules: any[] = [];
    console.log("[3/3] Processing Contract (Module: Canonical)...");
    if (fs.existsSync(CONTRACT_PATH)) {
        const rawContract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf-8'));
        // If it's already canonical (has 'coberturas'), we use it.
        // If it's raw, we run transform.
        if (rawContract.coberturas) {
            console.log("- Contract file appears already Canonical.");
            // We still need to map it to the M10 internal "CanonicalContractRule" format
            // which handles the "Domain" enum mapping.
            // (The `adaptContract` from before is still needed unless `transformToCanonical` produces exact M10 types).
            // Let's check imports. `canonicalTransform.service.ts` produces `CanonicalContract`.
            // M10 expects `CanonicalContractRule[]` in `contract.rules`.

            // We'll use a local adapter to be safe, similar to the one in simulate_m10_real
            // but simpler since the input is cleaner.
            contractRules = rawContract.coberturas; // Placeholder
            console.log(`- Loaded ${contractRules.length} rules.`);
        }
    }

    // --- Adapters (Reused from simulation) ---

    function mapDomain(rawDomain: string, rawDesc: string = ''): 'HOSPITALIZACION' | 'PABELLON' | 'HONORARIOS' | 'MATERIALES_CLINICOS' | 'MEDICAMENTOS_HOSP' | 'PROTESIS_ORTESIS' | 'CONSULTA' | 'EXAMENES' | 'KINESIOLOGIA' | 'TRASLADOS' | 'OTROS' {
        const d = rawDomain.toLowerCase();
        const desc = rawDesc.toLowerCase();

        if (desc.includes('pabellon')) return 'PABELLON';
        if (desc.includes('honorarios')) return 'HONORARIOS';
        if (desc.includes('materiales')) return 'MATERIALES_CLINICOS';
        if (desc.includes('medicamentos')) return 'MEDICAMENTOS_HOSP';
        if (desc.includes('insumos')) return 'MATERIALES_CLINICOS';
        if (desc.includes('hospital')) return 'HOSPITALIZACION';
        if (desc.includes('dia cama')) return 'HOSPITALIZACION';
        if (desc.includes('consulta')) return 'CONSULTA';
        if (desc.includes('examenes')) return 'EXAMENES';
        if (desc.includes('imagenologia')) return 'EXAMENES';
        if (desc.includes('procedimientos')) return 'OTROS';
        if (desc.includes('kinesiologia')) return 'KINESIOLOGIA';
        if (desc.includes('fonoaudiologia')) return 'KINESIOLOGIA';
        if (desc.includes('radioterapia')) return 'OTROS';

        if (d.includes('hospital')) return 'HOSPITALIZACION';
        if (d.includes('pabellon')) return 'PABELLON';
        if (d.includes('honorarios')) return 'HONORARIOS';
        if (d.includes('materiales')) return 'MATERIALES_CLINICOS';
        if (d.includes('medicamentos')) return 'MEDICAMENTOS_HOSP';
        if (d.includes('examenes')) return 'EXAMENES';
        if (d.includes('protesis')) return 'PROTESIS_ORTESIS';
        if (d.includes('consulta')) return 'CONSULTA';
        if (d.includes('ambulatorio')) return 'OTROS';
        if (d.includes('urgencia')) return 'OTROS';
        if (d.includes('kinesiologia')) return 'KINESIOLOGIA';
        if (d.includes('traslados')) return 'TRASLADOS';

        return 'OTROS';
    }

    function adaptContract(rawRules: any[]): any[] {
        return rawRules.map((cob: any, idx: number) => ({
            id: `rule-cob-${idx}`,
            domain: mapDomain(cob.ambito || '', cob.descripcion_textual || ''),
            textLiteral: cob.descripcion_textual || '',
            coberturaPct: cob.porcentaje,
            tope: cob.tope ? {
                // Check if tope is object or string, simple mapping
                kind: 'VAM', // Default
                value: typeof cob.tope === 'number' ? cob.tope : 0,
                currency: 'UF'
            } : undefined
        })).filter(r => r.coberturaPct !== null);
    }

    function adaptBillItems(rawItems: any[]): any[] {
        return rawItems.map((item: any, idx: number) => ({
            id: item.id || `itm-${idx}`,
            codeInternal: item.code || item.codigo || '',
            description: item.description || item.descripcion || '',
            qty: Number(item.qty || item.cantidad || 1),
            total: Number(item.total || item.valor || item.monto || 0),
            unitPrice: Number(item.unitPrice || item.precio || 0)
        }));
    }

    function adaptPamFolios(rawFolios: any[]): any[] {
        console.log("DEBUG: rawFolios to adapt:", JSON.stringify(rawFolios, null, 2));
        // If rawFolios is already array of folios
        return rawFolios.map((folio: any) => ({
            folioPAM: folio.folioPAM || folio.folio || 'UNKNOWN',
            items: (folio.items || []).map((item: any, idx: number) => ({
                id: item.id || `pam-${idx}`,
                folioPAM: folio.folioPAM || 'UNKNOWN',
                codigoGC: item.codigoGC || item.codigo || '',
                descripcion: item.descripcion || '',
                valorTotal: Number(item.valorTotal || item.monto || 0),
                copago: Number(item.copago || 0),
                bonificacion: Number(item.bonificacion || 0)
            }))
        }));
    }

    // ... (Main continued)

    // Acknowledge skipped steps
    if (billItems.length === 0 || pamFolios.length === 0) {
        console.error("CRITICAL: Failed to generate Bill or PAM data. Cannot run M10.");
        // Try not to return, maybe we have partial data?
        // return; 
    }

    // 4. Run M10
    console.log("Modules execution complete. Preparing M10 Input...");

    const input: SkillInput = {
        contract: { rules: adaptContract(contractRules) },
        bill: { items: adaptBillItems(billItems) },
        pam: { folios: adaptPamFolios(pamFolios) }
    };

    console.log(`M10 Input: ${input.contract.rules.length} Rules, ${input.bill.items.length} Bill Items, ${input.pam.folios.length} PAM Folios.`);

    console.log("Executing M10 Engine...");
    try {
        const result = runSkill(input);

        console.log("Audit complete. Summary:");
        console.log(`- Findings: ${result.matrix.length}`);
        console.log(`- Total Impact: ${result.summary.totalImpactoFragmentacion}`);
        console.log(`- Opacidad Global: ${result.summary.opacidadGlobal.applies}`);

        if (result.matrix.length > 0) {
            console.log("Findings:");
            console.log(JSON.stringify(result.matrix, null, 2));
        }

        fs.writeFileSync('m10_integrated_result.json', JSON.stringify(result, null, 2));
        console.log(`Result saved to m10_integrated_result.json`);
    } catch (error) {
        console.error("M10 Execution Error:", error);
    }
}

main().catch(console.error);
