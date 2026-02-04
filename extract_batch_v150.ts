/**
 * Batch Spatial Extractor v1.5.0
 * 1. Reads PDF (pdfjs-dist)
 * 2. Extracts Text Layout
 * 3. Prompts Gemini Flash to generate spatial_map and assignments
 * 4. Saves JSONs for Compiler
 */

import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

// CONFIG
const SOURCE_DIR = './agent/skills/canonizar-contrato-salud';
const OUTPUT_DIR = '.';
const MODEL_NAME = "gemini-2.0-flash";

const SYSTEM_PROMPT = `
You are an expert Spatial Contract Extractor (v1.5.0 Industrial Strict).
Your task is to analyze health contract pages (Isapre) and extract TWO JSON objects:
1. "spatial_map": Columns, Rows, Zones
2. "assignments": Text/Zone pointers to (row, column) cells

# CRITICAL RULES (Learned from 12-Contract Industrial Batch)

## 1. ROW IDs (MANDATORY PREFIX)
- **EVERY row_id MUST start with "R_"**
- Examples: R_DIA_CAMA, R_HONORARIOS, R_QUIMIOTERAPIA, R_PABELLON
- **NEVER** output: "DIA_CAMA", "Honorarios" (missing R_)
- If unsure, use: R_PRESTACION_01, R_PRESTACION_02

## 2. COLUMN IDs (Standard Names)
- COL_PRESTACIONES (leftmost, procedure names)
- COL_PREF_PCT (Preferente %)
- COL_PREF_TOPE_EVENTO (Preferente Tope Evento)
- COL_PREF_TOPE_ANUAL (Preferente Tope Anual)
- COL_LE_PCT (Libre Elección %)
- COL_LE_TOPE_EVENTO (Libre Elección Tope Evento)
- COL_LE_TOPE_ANUAL (Libre Elección Tope Anual)
- **x_range**: [0.0-1.0] normalized. NO overlap between columns.

## 3. BBOX ALIGNMENT (Geometric Truth)
- If assignment.pointer.type === "TEXT_DIRECT_CELL":
  - bbox MUST be INSIDE the column's x_range
  - Example: If column is [0.76, 0.81], bbox CANNOT be [0.36, 0.45]
  - **Validate**: (bbox[0] + bbox[2])/2 is within column x_range ± 0.01
- If uncertain, use "ZONE_REFERENCE" instead

## 4. NO OVERLAPS (One Rule Per Cell)
- Each (row_id, column_id) pair can have AT MOST ONE active assignment
- If you detect multiple rules for same cell:
  - Choose the MOST SPECIFIC (TEXT_DIRECT > ZONE)
  - OR create separate assignments for different columns
- **NEVER** create duplicate (row, col) pairs

## 5. ZONES (Optional but Precise)
- zone_type: "ZONE_GRAPHIC_RULE" (most), "ZONE_EXCLUSION" (kill switches)
- scope_mode: "RECT_FALL" (box) or "ROW_BAND" (horizontal stripe)
- contains_text: COPY EXACTLY from visual (e.g., "70% Sin Tope Clínica UC")
- has_conditions: true if mentions providers/exceptions

# OUTPUT FORMAT
{
  "spatial_map": {
    "columns": [{ "column_id": "COL_...", "x_range": [num, num], "label": "..." }],
    "rows": [{ "row_id": "R_...", "y_range": [num, num], "raw_text": "..." }],
    "zones": [{ "zone_id": "ZONE_...", "zone_type": "...", "scope_mode": "...", "contains_text": "...", "geometric_scope": { "x": [...], "y": [...] } }]
  },
  "assignments": [
    { "row_id": "R_...", "column_id": "COL_...", "pointer": { "type": "TEXT_DIRECT_CELL" | "ZONE_REFERENCE", "bbox": [...] }, "value": "...", "unit": "..." }
  ]
}

**NO markdown, NO explanation, ONLY the JSON.**
`;

// KEY POOL
const KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_SECONDARY,
    process.env.GEMINI_API_KEY_TERTIARY,
    process.env.GEMINI_API_KEY_QUATERNARY
].filter(Boolean) as string[];

async function extractTextFromPdf(filePath: string): Promise<string> {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    let fullText = "";

    // Industrial contracts usually have relevant data on Page 1 or 2. 
    // We will extract Page 1 for this audit batch.
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items = content.items as any[];

    // Simple Layout Dump: Y-sorted
    items.sort((a, b) => b.transform[5] - a.transform[5]); // Top to Bottom

    let lastY = -9999;
    let currentLine = "";

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
    const baseName = filename.replace('.pdf', '');
    const pdfPath = path.join(SOURCE_DIR, filename);
    const apiKey = KEYS[keyIndex % KEYS.length];

    if (fs.existsSync(path.join(OUTPUT_DIR, `spatial_map_${baseName}.json`))) {
        console.log(`Skipping ${baseName} (Already exists)`);
        return true;
    }

    console.log(`Processing ${baseName} (Key #${keyIndex % KEYS.length})...`);

    try {
        const textLayout = await extractTextFromPdf(pdfPath);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });

        const result = await model.generateContent([
            SYSTEM_PROMPT,
            "--- CONTRACT TEXT LAYOUT ---",
            textLayout
        ]);

        const responseText = result.response.text().replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
        const json = JSON.parse(responseText);

        if (json.spatial_map && json.assignments) {
            fs.writeFileSync(path.join(OUTPUT_DIR, `spatial_map_${baseName}.json`), JSON.stringify(json.spatial_map, null, 2));
            fs.writeFileSync(path.join(OUTPUT_DIR, `assignments_${baseName}.json`), JSON.stringify({ assignments: json.assignments }, null, 2));
            console.log(`✅ Generated maps for ${baseName}`);
            return true;
        } else {
            console.error(`❌ Invalid JSON for ${baseName}`);
            return false;
        }
    } catch (e: any) {
        if (e.toString().includes('403') || e.toString().includes('429')) {
            console.warn(`Key #${keyIndex} failed (${e.message}). Rotating...`);
            if (keyIndex < KEYS.length * 2) { // Allow 2 full cycles
                return await processFile(filename, keyIndex + 1);
            }
        }
        console.error(`ERROR processing ${baseName}:`, e);
        return false;
    }
}

async function runBatch() {
    const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.pdf'));
    console.log(`Found ${files.length} PDFs. Using ${KEYS.length} API keys.`);

    for (let i = 0; i < files.length; i++) {
        await processFile(files[i], i % KEYS.length); // Distribute load
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log("Extraction Batch Complete.");
}

runBatch();
