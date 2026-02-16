
import fs from 'fs';
import path from 'path';
import { runSkill } from './src/m10/engine.ts';
import type { SkillInput, SkillOutput, CanonicalBillItem, CanonicalPamLine, CanonicalContractRule, ContractDomain } from './src/m10/types.ts';

// --- Paths ---
const DOWNLOADS_DIR = 'C:/Users/drlui/Downloads';
const CONTRACT_PATH = path.join(DOWNLOADS_DIR, 'canonical_pleno 847.json');
const OCR_PATH = path.join(DOWNLOADS_DIR, 'CUENTA INDISA_compressed-1-22.pdf.json');
const OUTPUT_PATH = 'm10_real_audit_result.json';

// --- Adapters ---

function mapDomain(rawDomain: string, rawDesc: string = ''): ContractDomain {
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

function adaptContract(raw: any): { rules: CanonicalContractRule[] } {
    const rules: CanonicalContractRule[] = [];
    raw.coberturas.forEach((cob: any, idx: number) => {
        if (cob.porcentaje !== null) {
            rules.push({
                id: `rule-cob-${idx}`,
                domain: mapDomain(cob.ambito, cob.descripcion_textual),
                textLiteral: cob.descripcion_textual,
                coberturaPct: cob.porcentaje,
            });
        }
    });
    raw.topes.forEach((tope: any, idx: number) => {
        if (tope.valor !== null && tope.tipo_modalidad === 'preferente') {
            rules.push({
                id: `rule-tope-${idx}`,
                domain: mapDomain(tope.ambito, ""),
                textLiteral: "TOPE GENERAL " + tope.ambito,
                tope: {
                    kind: tope.unidad === 'UF' ? 'UF' : 'VAM',
                    value: tope.valor,
                    currency: tope.unidad === 'UF' ? 'UF' : 'CLP'
                }
            });
        }
    });
    return { rules };
}


function parseBillItems(content: string): CanonicalBillItem[] {
    const items: CanonicalBillItem[] = [];
    const lines = content.split('\n');
    let currentId = 1;

    // Regex: Code ... Date
    const headerRegex = /^(\d{2}-\d{2}-\d{3}-\d{2}|\d+)\s+(.+?)\s+(\d{2}-\d{2}-\d{4})/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const headerMatch = line.match(headerRegex);

        if (headerMatch) {
            const code = headerMatch[1];
            let desc = headerMatch[2];
            const dateStr = headerMatch[3];

            const fonasaMatch = desc.match(/(.+?)\s+(\d{2}-\d{2}-\d{3}-\d{2})$/);
            if (fonasaMatch) desc = fonasaMatch[1];

            const dateIndex = line.indexOf(dateStr);
            const suffix = line.substring(dateIndex + dateStr.length).trim();

            let foundNumbers: number[] = [];

            if (suffix.length > 0) {
                const nums = suffix.match(/(\d{1,3}(\.\d{3})*)/g);
                if (nums) {
                    nums.forEach(n => {
                        const val = parseInt(n.replace(/\./g, ''), 10);
                        if (!isNaN(val)) foundNumbers.push(val);
                    });
                }
            }

            // Look ahead further (15 lines) to accommodate wide dispersed tables
            let j = i + 1;
            while (j < lines.length && j < i + 15) {
                const nextLine = lines[j].trim();
                if (nextLine.match(/^(\d{2}-\d{2}-\d{3}-\d{2}|\d{7,8})\s+/)) break;

                const nums = nextLine.match(/(\d{1,3}(\.\d{3})*)/g);
                if (nums) {
                    nums.forEach(n => {
                        const val = parseInt(n.replace(/\./g, ''), 10);
                        if (!isNaN(val)) foundNumbers.push(val);
                    });
                }
                j++;
            }

            if (foundNumbers.length > 0) {
                let qty = 1;
                let total = 0;
                if (foundNumbers.length >= 2) {
                    qty = foundNumbers[0];
                    total = foundNumbers[foundNumbers.length - 1];
                } else {
                    total = foundNumbers[0];
                }

                // Only add if Total looks valid (>0)
                if (total > 0) {
                    items.push({
                        id: `itm-${currentId++}`,
                        codeInternal: code,
                        description: desc.trim(),
                        qty: qty,
                        total: total,
                        unitPrice: Math.round(total / (qty || 1))
                    });
                }
                // Skip processed lines
                i = j - 1;
            }
        }
    }
    return items;
}

function parsePamLines(content: string): CanonicalPamLine[] {
    const items: CanonicalPamLine[] = [];
    const lines = content.split('\n');
    let currentId = 1;

    const pamHeaderRegex = /^(\d{7}|\d{2}-\d{2}-\d{3}-\d{2})\s+(.+)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const headerMatch = line.match(pamHeaderRegex);

        if (headerMatch) {
            const code = headerMatch[1];
            const desc = headerMatch[2];

            const selfNumbers = line.substring(line.indexOf(desc) + desc.length).match(/(\d{1,3}(\.\d{3})*)/g) || [];
            let foundNumbers: number[] = [];

            if (selfNumbers.length >= 2) {
                foundNumbers = selfNumbers.map(n => parseInt(n.replace(/\./g, ''), 10));
            } else {
                let j = i + 1;
                while (j < lines.length && j < i + 10) { // Increased for PAM too just in case
                    const nextLine = lines[j].trim();
                    if (nextLine.match(/^(\d{7}|\d{2}-\d{2}-\d{3}-\d{2})\s+/)) break;

                    const nums = nextLine.match(/(\d{1,3}(\.\d{3})*)/g);
                    if (nums) {
                        nums.forEach(n => {
                            const val = parseInt(n.replace(/\./g, ''), 10);
                            if (!isNaN(val)) foundNumbers.push(val);
                        });
                    }
                    j++;
                }
                if (foundNumbers.length > 0) i = j - 1;
            }

            if (foundNumbers.length >= 2) {
                let total = 0;
                let bonif = 0;

                if (foundNumbers.length >= 3) {
                    total = foundNumbers[1];
                    bonif = foundNumbers[2];
                } else if (foundNumbers.length === 2) {
                    if (foundNumbers[0] <= 100) {
                        total = foundNumbers[1];
                        bonif = 0;
                    } else {
                        total = foundNumbers[0];
                        bonif = foundNumbers[1];
                    }
                }

                if (total > 0) {
                    items.push({
                        folioPAM: 'OCR-PAM',
                        id: `pam-${currentId++}`,
                        codigoGC: code,
                        descripcion: desc.trim(),
                        valorTotal: total,
                        copago: total - bonif,
                        bonificacion: bonif
                    });
                }
            }
        }
    }
    return items;
}

// --- Main Execution ---

async function main() {
    console.log("Loading real data files...");

    if (!fs.existsSync(CONTRACT_PATH)) {
        console.error(`Contract file not found: ${CONTRACT_PATH}`);
        return;
    }
    if (!fs.existsSync(OCR_PATH)) {
        console.error(`OCR file not found: ${OCR_PATH}`);
        return;
    }

    const rawContract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf-8'));
    const ocrData = JSON.parse(fs.readFileSync(OCR_PATH, 'utf-8'));

    const fullText = (ocrData.analyzeResult?.content || "") + "\n" + (JSON.stringify(ocrData.analyzeResult?.paragraphs || []));

    console.log(`Parsing contract...`);
    const contract = adaptContract(rawContract);
    console.log(`- Loaded ${contract.rules.length} contract rules.`);

    console.log(`Parsing bill items from OCR text (${fullText.length} chars)...`);
    const billItems = parseBillItems(fullText);
    console.log(`- Extracted ${billItems.length} bill items.`);

    if (billItems.length > 0) {
        console.log("DEBUG: Sample Bill Items:");
        console.log(JSON.stringify(billItems.slice(0, 5), null, 2));
    }


    console.log(`Parsing PAM items from OCR text...`);
    const pamItems = parsePamLines(fullText);
    console.log(`- Extracted ${pamItems.length} PAM items.`);

    if (pamItems.length > 0) {
        console.log("DEBUG: Sample PAM Items:");
        console.log(JSON.stringify(pamItems.slice(0, 5), null, 2));
    }

    if (billItems.length === 0 || pamItems.length === 0) {
        console.warn("WARNING: Extraction yielded 0 items for Bill or PAM.");
    }

    const input: SkillInput = {
        contract: contract,
        bill: { items: billItems },
        pam: { folios: [{ folioPAM: 'OCR-PAM', items: pamItems }] }
    };

    console.log("Executing M10 Engine...");
    const result = runSkill(input);

    console.log("Audit complete. Summary:");
    console.log(`- Findings: ${result.matrix.length}`);
    console.log(`- Total Impact: ${result.summary.totalImpactoFragmentacion}`);
    console.log(`- Opacidad Global: ${result.summary.opacidadGlobal.applies}`);

    if (result.matrix.length > 0) {
        console.log("Findings:");
        console.log(JSON.stringify(result.matrix, null, 2));
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
    console.log(`Result saved to ${OUTPUT_PATH}`);
}

main().catch(console.error);
