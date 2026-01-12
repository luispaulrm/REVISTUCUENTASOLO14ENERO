import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface OcrResult {
    text: string;
    totalPages: number;
    pages: string[];
}

/**
 * PDF Service
 * High-speed Geometric OCR for rapid document ingestion.
 */
export class PdfService {
    /**
     * Extracts text from a PDF buffer while maintaining visual layout.
     */
    static async extractTextWithLayout(
        buffer: Buffer,
        log: (msg: string) => void = console.log,
        maxPages: number = 999
    ): Promise<OcrResult> {
        try {
            log(`[PdfService] 🔍 Procesando PDF con Reconstructor Geométrico (Fast Mode)...`);
            const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

            // Setup fonts for better extraction
            const fontPathRaw = path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts');
            const fontPath = fontPathRaw.replace(/\\/g, '/') + '/';

            const data = new Uint8Array(buffer);
            const loadingTask = pdfjsLib.getDocument({
                data,
                disableFontFace: true,
                standardFontDataUrl: fontPath
            });

            const pdf = await loadingTask.promise;
            const totalPages = pdf.numPages;
            const pagesToScan = Math.min(totalPages, maxPages);

            log(`[PdfService] 📗 PDF cargado (${totalPages} págs). Procesando ${pagesToScan} manteniendo layout.`);

            const pages: string[] = [];

            for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
                const page = await pdf.getPage(pageNumber);
                const textContent = await page.getTextContent();
                const items: any[] = textContent.items || [];

                // --- GEOMETRIC LAYOUT RECONSTRUCTION ---
                const Y_TOLERANCE = 4.0;
                const lines: { y: number, items: any[] }[] = [];

                for (const item of items) {
                    if (!item.transform || item.transform.length < 6) continue;
                    const y = item.transform[5]; // PDF Y-coordinate

                    const line = lines.find(l => Math.abs(l.y - y) < Y_TOLERANCE);
                    if (line) {
                        line.items.push(item);
                    } else {
                        lines.push({ y, items: [item] });
                    }
                }

                // Sort Lines Top-to-Bottom
                lines.sort((a, b) => b.y - a.y);

                // Sort Items Left-to-Right and Join
                const pageLines = lines.map(line => {
                    line.items.sort((a, b) => (a.transform[4] - b.transform[4])); // Sort by X
                    return line.items.map(i => i.str).join(' ');
                });

                const pageText = pageLines.join('\n');
                pages.push(pageText);
            }

            return {
                text: pages.join('\n\n--- PÁGINA ${pageNumber} ---\n\n'),
                totalPages,
                pages
            };
        } catch (error: any) {
            log(`[PdfService] ❌ Error en extracción PDF: ${error.message}`);
            throw error;
        }
    }
}
