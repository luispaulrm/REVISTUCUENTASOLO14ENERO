/**
 * Segmented Medical Extractor v1.5.0 (Family C Specialized)
 * Focus: Solving attention fatigue in complex hybrids via dual-pass scanning.
 */

import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const SOURCE_DIR = './agent/skills/canonizar-contrato-salud';
const MODEL_NAME = "gemini-2.0-flash";

const KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_SECONDARY,
    process.env.GEMINI_API_KEY_TERTIARY,
    process.env.GEMINI_API_KEY_QUATERNARY
].filter(Boolean) as string[];

const PROMPT_HOSPITALARIO = `
You are an expert Health Contract Auditor. 
TASK: Extract ONLY the HOSPITALIZATION benefits (Hospitalario).

# TARGET ROWS
- R_DIA_CAMA (Día Cama, Habitación)
- R_HONORARIOS_MEDICOS (Honorarios Quirúrgicos, Médicos)
- R_PABELLON (Derecho a Pabellón, Gastos Quirófano)
- R_UTI_UCI (Cuidados Intensivos, Intermedios)

# STRATEGY
Find these in the "Prestaciones Hospitalarias" section.
In Family C, these are often the first large table.
Extract both COL_PREF_PCT and COL_PREF_TOPE_EVENTO if they exist.

# OUTPUT FORMAT (Strict JSON)
{
  "spatial_map": { "rows": [...], "columns": [], "zones": [] },
  "assignments": [...]
}
`;

const PROMPT_AMBULATORIO = `
You are an expert Health Contract Auditor.
TASK: Extract ONLY the OUTPATIENT benefits (Ambulatorio).

# TARGET ROWS
- R_CONSULTAS (Consultas generales, Especialidades)
- R_EXAMENES (Laboratorio, Rayos, Imagen)
- R_URGENCIAS (Atención Urgencia)
- R_TELEMEDICINA (Consulta remota)

# STRATEGY
Find these in the "Prestaciones Ambulatorias" section. 
This is usually the SECOND major table or a section further down.
Extract both COL_PREF_PCT and COL_PREF_TOPE_EVENTO if they exist.

# OUTPUT FORMAT (Strict JSON)
{
  "spatial_map": { "rows": [...], "columns": [], "zones": [] },
  "assignments": [...]
}
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

const SOURCE_ABS_DIR = 'C:/REVISATUCUENTASOLO14enero/agent/skills/canonizar-contrato-salud';

async function runPassWithRetry(filename: string, prompt: string, keyIndex: number = 0, attempt: number = 0): Promise<any> {
    const pdfPath = path.join(SOURCE_ABS_DIR, `${filename}.pdf`);
    const apiKey = KEYS[keyIndex % KEYS.length];

    if (!fs.existsSync(pdfPath)) {
        console.warn(`File not found: ${pdfPath}`);
        return null;
    }

    console.log(`  Pass for ${filename} (Key #${keyIndex % KEYS.length}, Attempt #${attempt})...`);

    try {
        const textLayout = await extractTextFromPdf(pdfPath);
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });

        const result = await model.generateContent([
            prompt,
            "--- CONTRACT TEXT LAYOUT ---",
            textLayout
        ]);

        const responseText = result.response.text().replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
        return JSON.parse(responseText);
    } catch (e: any) {
        const errStr = e.toString();
        if ((errStr.includes('403') || errStr.includes('429')) && attempt < 5) {
            console.warn(`  Rate limit hit for ${filename}. Rotating key and retrying...`);
            await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
            return await runPassWithRetry(filename, prompt, keyIndex + 1, attempt + 1);
        }
        console.error(`Error in pass for ${filename}:`, e);
        return null;
    }
}

async function runSegmentedRescue() {
    const targetMembers = [
        '13-CORE406-25',
        'CMBS090625',
        'MX2246050',
        'PLAN VPRLU204B2 VIDA TRES',
        'pleno 847',
        'rse500',
        'VPLU241143',
        'VPTA241079'
    ];

    console.log(`Starting Segmented Rescue for ${targetMembers.length} Family C members...`);

    for (let i = 0; i < targetMembers.length; i++) {
        const docName = targetMembers[i];
        console.log(`Processing ${docName} (Dual-Pass)...`);

        const resHosp = await runPassWithRetry(docName, PROMPT_HOSPITALARIO, i * 2);
        const resAmb = await runPassWithRetry(docName, PROMPT_AMBULATORIO, i * 2 + 1);

        const mapFile = `spatial_map_${docName}.json`;
        const assFile = `assignments_${docName}.json`;

        if (fs.existsSync(mapFile)) {
            try {
                const oldMap = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
                if (!oldMap.rows) oldMap.rows = [];
                const existingRowIds = new Set(oldMap.rows.map((r: any) => r.row_id));

                [resHosp, resAmb].forEach(json => {
                    if (json?.spatial_map?.rows) {
                        json.spatial_map.rows.forEach((r: any) => {
                            if (r.row_id && !existingRowIds.has(r.row_id)) {
                                oldMap.rows.push(r);
                                existingRowIds.add(r.row_id);
                            }
                        });
                    }
                });
                fs.writeFileSync(mapFile, JSON.stringify(oldMap, null, 2));
            } catch (e) {
                console.error(`Failed to merge map for ${docName}:`, e);
            }
        }

        if (fs.existsSync(assFile)) {
            try {
                const oldAss = JSON.parse(fs.readFileSync(assFile, 'utf-8'));
                if (!oldAss.assignments) oldAss.assignments = [];

                [resHosp, resAmb].forEach(json => {
                    if (json?.assignments) {
                        json.assignments.forEach((a: any) => {
                            oldAss.assignments.push(a);
                        });
                    }
                });
                fs.writeFileSync(assFile, JSON.stringify(oldAss, null, 2));
            } catch (e) {
                console.error(`Failed to merge assignments for ${docName}:`, e);
            }
        }

        console.log(`✅ Segmented Rescue complete for ${docName}`);
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("Family C Segmented Rescue Phase Complete.");
}

runSegmentedRescue();
