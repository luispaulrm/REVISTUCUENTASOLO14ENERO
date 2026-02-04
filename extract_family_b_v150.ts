/**
 * Paragraph Mode Extractor v1.5.0 (Family B Specialized)
 * Focus: Rescuing financial data from non-table (paragraph) layouts.
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

const PARAGRAPH_SCAN_PROMPT = `
You are an expert Health Contract Auditor specializing in "Lite" or "Paragraph-style" contracts.
Family B contracts often describe coverage in plain text paragraphs rather than visible grid tables.

# MISSION
Your mission is to find the financial values for core medical benefits even if they are hidden in long sentences.

# TARGET ROWS (EXTRACT EVEN IF IN TEXT)
- R_CIRUGIAS (Cirugías, intervenciones)
- R_CONSULTAS (Consultas médicas, especialidades)
- R_URGENCIAS (Atención de urgencia)
- R_TELEMEDICINA (Atenciones remotas)
- R_SALUD_DENTAL (Duo, dental, urgencia odontológica)

# SCANNING RULES
1. **Financial Answering**: Look for currency symbols ($) or percentages (%) following benefit names.
2. **Standard Columns**: Even if the page doesn't have "columns", map the values to:
   - COL_PREF_PCT (The percentage mentioned for Red/Preferente)
   - COL_PREF_TOPE_EVENTO (The fixed amount or Tope mentioned)
3. **Geometry**: Since there is no grid, use a reasonable rectangle (y_range) that covers the sentence or paragraph containing the rule.

# OUTPUT FORMAT
Strictly follow this structure:
{
  "spatial_map": {
    "columns": [{ "column_id": "COL_PREF_PCT", "x_range": [0,1], "label": "Preferente %" }],
    "rows": [{ "row_id": "R_CIRUGIAS", "y_range": [0.1, 0.15], "raw_text": "Las cirugías tienen..." }],
    "zones": []
  },
  "assignments": [
    { "row_id": "R_CIRUGIAS", "column_id": "COL_PREF_PCT", "pointer": { "type": "TEXT_DIRECT_CELL", "bbox": [0.1, 0.1, 0.2, 0.2] }, "value": "80", "unit": "%" }
  ]
}

**DO NOT SKIP A BENEFIT JUST BECAUSE IT IS IN A PARAGRAPH. This is a Financial Deep Scan.**
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

async function processFile(filename: string, keyIndex: number = 0): Promise<boolean> {
    const pdfPath = path.join(SOURCE_DIR, `${filename}.pdf`);
    const apiKey = KEYS[keyIndex % KEYS.length];

    console.log(`Paragraph Scanning ${filename} (Key #${keyIndex % KEYS.length})...`);

    try {
        const textLayout = await extractTextFromPdf(pdfPath);
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });

        const result = await model.generateContent([
            PARAGRAPH_SCAN_PROMPT,
            "--- CONTRACT TEXT LAYOUT ---",
            textLayout
        ]);

        const responseText = result.response.text().replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
        const json = JSON.parse(responseText);

        // Merge with existing maps
        const mapFile = `spatial_map_${filename}.json`;
        const assFile = `assignments_${filename}.json`;

        if (fs.existsSync(mapFile) && json.spatial_map) {
            const oldMap = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
            const existingRowIds = new Set(oldMap.rows.map((r: any) => r.row_id));
            json.spatial_map.rows.forEach((r: any) => {
                if (!existingRowIds.has(r.row_id)) oldMap.rows.push(r);
            });
            fs.writeFileSync(mapFile, JSON.stringify(oldMap, null, 2));
        }

        if (fs.existsSync(assFile) && json.assignments) {
            const oldAss = JSON.parse(fs.readFileSync(assFile, 'utf-8'));
            json.assignments.forEach((a: any) => {
                oldAss.assignments.push(a);
            });
            fs.writeFileSync(assFile, JSON.stringify(oldAss, null, 2));
        }

        console.log(`✅ Paragraph Scan complete for ${filename}`);
        return true;
    } catch (e: any) {
        if (e.toString().includes('403') || e.toString().includes('429')) {
            console.warn(`Key #${keyIndex} failed (${e.message}). Rotating...`);
            if (keyIndex < KEYS.length * 3) {
                return await processFile(filename, keyIndex + 1);
            }
        }
        console.error(`Error paragraph scanning ${filename}:`, e);
        return false;
    }
}

async function runParagraphScan() {
    const targetMembers = [
        '13-EFS0510-24',
        '13-LFS409-24',
        'BFDC241122',
        'Contrato 13-RSE500-17-2 (5)'
    ];

    console.log(`Starting Paragraph Scan for ${targetMembers.length} Family B members...`);

    for (let i = 0; i < targetMembers.length; i++) {
        await processFile(targetMembers[i], i % KEYS.length);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log("Paragraph Scan Phase Complete.");
}

runParagraphScan();
