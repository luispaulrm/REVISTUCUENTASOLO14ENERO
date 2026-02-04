/**
 * Deep Scan Extractor v1.5.0 (Family A Specialized)
 * Focus: Capturing Honorarios, Pabellón, and complex financial rows.
 */

import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const SOURCE_DIR = './agent/skills/canonizar-contrato-salud';
const OUTPUT_DIR = '.';
const MODEL_NAME = "gemini-2.0-flash";

const KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_SECONDARY,
    process.env.GEMINI_API_KEY_TERTIARY,
    process.env.GEMINI_API_KEY_QUATERNARY
].filter(Boolean) as string[];

const FAMILY_A_SIG = 'COL_LE_PCT|COL_LE_TOPE_ANUAL|COL_LE_TOPE_EVENTO|COL_PREF_PCT|COL_PREF_TOPE_ANUAL|COL_PREF_TOPE_EVENTO|COL_PRESTACIONES';

const DEEP_SCAN_PROMPT = `
You are an expert Financial Contract Auditor.
Your specific goal is to perform a DEEP SCAN on a dense health contract page to extract HIGH-VALUE rows.

# TARGET ROWS (CRITICAL)
- R_HONORARIOS_MEDICOS (Honorarios Médicos Quirúrgicos, Cirujano, Anestesista)
- R_PABELLON (Derecho a Pabellón, Gastos Quirúrgicos)
- R_UTI_UCI (Tratamientos Intermedios, Intensivos)
- R_DIA_CAMA (Día Cama, Hospitalización)
- R_EXAMENES (Laboratorio, Imagenología)

# EXTRACTION STRATEGY
1. **Look beyond the main table**: These rows are often in a sub-table or preceded by a bold header "PRESTACIONES HOSPITALARIAS".
2. **Find the exact value**: In Family A, there is usually a "Preferente" value (e.g. 80%) and a "Libre Elección" value (e.g. 60%). Both MUST be captured.
3. **Validate Row ID**: Use the "R_" prefix (e.g. R_HONORARIOS).

# OUTPUT FORMAT
Strictly follow the spatial_map + assignments JSON schema.
Ensure COL_PREF_PCT and COL_LE_PCT are populated for these rows.

**DO NOT SKIP THESE ROWS. Audit failure occurs if Honorarios or Pabellón are missing.**
`;

async function extractTextFromPdf(filePath: string): Promise<string> {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items = content.items as any[];
    items.sort((a, b) => b.transform[5] - a.transform[5]);

    let fullText = "";
    let lastY = -9999;
    for (const item of items) {
        if (Math.abs(item.transform[5] - lastY) > 5) {
            fullText += "\n";
            lastY = item.transform[5];
        }
        fullText += item.str + " ";
    }
    return fullText;
}

async function runDeepScan() {
    // 1. Identify Family A Members
    const results = JSON.parse(fs.readFileSync('clustering_results.json', 'utf-8'));
    const familyAMembers: string[] = results[Object.keys(results).find(k => k.includes(FAMILY_A_SIG)) || ''] || [];

    if (familyAMembers.length === 0) {
        console.error("No Family A members found in clustering_results.json");
        return;
    }

    console.log(`Starting Deep Scan for ${familyAMembers.length} members...`);

    for (let i = 0; i < familyAMembers.length; i++) {
        const docName = familyAMembers[i];
        const pdfPath = path.join(SOURCE_DIR, `${docName}.pdf`);
        const apiKey = KEYS[i % KEYS.length];

        if (!fs.existsSync(pdfPath)) {
            console.warn(`File not found: ${pdfPath}`);
            continue;
        }

        console.log(`Deep Scanning ${docName}...`);

        try {
            const textLayout = await extractTextFromPdf(pdfPath);
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: MODEL_NAME });

            const result = await model.generateContent([
                DEEP_SCAN_PROMPT,
                "--- CONTRACT TEXT LAYOUT ---",
                textLayout
            ]);

            const responseText = result.response.text().replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
            const json = JSON.parse(responseText);

            // Merge with existing maps (Priority to Deep Scan)
            const mapFile = `spatial_map_${docName}.json`;
            const assFile = `assignments_${docName}.json`;

            if (fs.existsSync(mapFile)) {
                const oldMap = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
                // Simple merge for rows
                const existingRowIds = new Set(oldMap.rows.map((r: any) => r.row_id));
                json.spatial_map.rows.forEach((r: any) => {
                    if (!existingRowIds.has(r.row_id)) oldMap.rows.push(r);
                });
                fs.writeFileSync(mapFile, JSON.stringify(oldMap, null, 2));
            }

            if (fs.existsSync(assFile)) {
                const oldAss = JSON.parse(fs.readFileSync(assFile, 'utf-8'));
                // Simple merge for assignments (Deep Scan overwrites or adds)
                const existingAssIds = new Set(oldAss.assignments.map((a: any) => a.assignment_id));
                json.assignments.forEach((a: any) => {
                    oldAss.assignments.push(a); // Keep all, compiler will handle precedence
                });
                fs.writeFileSync(assFile, JSON.stringify(oldAss, null, 2));
            }

            console.log(`✅ Deep Scan complete for ${docName}`);
        } catch (e) {
            console.error(`Error deep scanning ${docName}:`, e);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log("Deep Scan Phase Complete.");
}

runDeepScan();
