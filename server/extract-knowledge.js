import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractTextFromPdf(filePath) {
    try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

        // Resolve absolute path to standard fonts
        const fontPathRaw = path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts');
        const fontPath = fontPathRaw.replace(/\\/g, '/') + '/';
        const standardFontDataUrl = fontPath;

        const buffer = fs.readFileSync(filePath);
        const data = new Uint8Array(buffer);

        const loadingTask = pdfjsLib.getDocument({
            data,
            disableFontFace: true,
            standardFontDataUrl
        });
        const pdf = await loadingTask.promise;
        console.log(`[OCR] PDF cargado: ${pdf.numPages} páginas.`);

        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            process.stdout.write(`[OCR] Procesando página ${i}/${pdf.numPages}...\r`);
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map(item => item.str || '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            fullText += `\n--- PÁGINA ${i} ---\n${pageText}\n`;
        }

        const outPath = filePath.replace(/\.pdf$/i, '.txt');
        fs.writeFileSync(outPath, fullText.trim());
        console.log(`\n[OCR] Éxito: Guardado en ${outPath}`);
    } catch (error) {
        console.error(`\n[OCR] Error fatal: ${error.message}`);
        process.exit(1);
    }
}

const target = process.argv[2];
if (!target) {
    console.error('Uso: node extract-knowledge.js <ruta_al_pdf>');
    process.exit(1);
}

extractTextFromPdf(path.resolve(target));
