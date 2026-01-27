
import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Point to the PDF file
const PDF_PATH = path.join(process.cwd(), 'agent', 'skills', 'extraccion-lineal-contrato', 'Contrato 13-RSE500-17-2 (5).pdf');

interface Cell {
    indice_columna: number;
    texto: string;
}

interface Linea {
    pagina: number;
    indice_linea: number;
    tipo: "titulo" | "cabecera_tabla" | "fila_tabla" | "texto_libre";
    cabecera_activa: string[];
    celdas: Cell[];
    texto_plano: string;
}

interface OutputModel {
    metadata: {
        origen: string;
        fuente: string;
        paginas_total: number;
    };
    lineas: Linea[];
}

async function extractLinearContract() {
    if (!fs.existsSync(PDF_PATH)) {
        console.error(`PDF not found at ${PDF_PATH}`);
        process.exit(1);
    }

    const data = new Uint8Array(fs.readFileSync(PDF_PATH));
    const loadingTask = pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
    });

    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;

    const output: OutputModel = {
        metadata: {
            origen: "contrato_pdf",
            fuente: path.basename(PDF_PATH),
            paginas_total: numPages
        },
        lineas: []
    };

    let globalLineIndex = 1;
    let activeHeader: string[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        // Group items by Y coordinate (line)
        // pdfjs y is 0 at bottom, so we invert or just sort descending
        const items = textContent.items as any[];

        // Sort by Y descending (top to bottom), then X ascending (left to right)
        items.sort((a, b) => {
            const yDiff = b.transform[5] - a.transform[5];
            if (Math.abs(yDiff) > 5) return yDiff; // Different lines
            return a.transform[4] - b.transform[4]; // Same line, sort by X
        });

        const lines: any[][] = [];
        let currentLine: any[] = [];
        let lastY = -9999;

        for (const item of items) {
            if (currentLine.length === 0) {
                currentLine.push(item);
                lastY = item.transform[5];
            } else {
                if (Math.abs(item.transform[5] - lastY) < 5) {
                    // Same line
                    currentLine.push(item);
                } else {
                    // New line
                    lines.push(currentLine);
                    currentLine = [item];
                    lastY = item.transform[5];
                }
            }
        }
        if (currentLine.length > 0) lines.push(currentLine);

        // Process lines
        for (const lineItems of lines) {
            // Reconstruct text
            const lineText = lineItems.map(i => i.str).join(' ').trim();
            if (!lineText) continue;

            let tipo: "titulo" | "cabecera_tabla" | "fila_tabla" | "texto_libre" = "texto_libre";
            let celdas: Cell[] = [];
            let cabeceraActivaForLine = [...activeHeader];

            // Heuristic for table: multiple items with significant spacing or specific keywords?
            // For this demo, let's look for known headers or just dense columns
            // "PRESTACIONES" "BONIFICACION" etc.

            const isHeaderCandidate = lineItems.length > 2 && (lineText.includes("PRESTACIONES") || lineText.includes("BONIFICACION") || lineText.includes("TOPE"));

            if (isHeaderCandidate) {
                tipo = "cabecera_tabla";
                activeHeader = lineItems.map(i => i.str.trim()).filter(s => s);
                cabeceraActivaForLine = activeHeader;
                // Create cells
                celdas = lineItems.map((item, idx) => ({
                    indice_columna: idx + 1,
                    texto: item.str
                }));
            } else if (activeHeader.length > 0) {
                // If we have an active header, assume subsequent lines are table rows until... valid condition?
                // Let's assume if it looks like columns (multiple items), it's a row
                if (lineItems.length > 1) {
                    tipo = "fila_tabla";
                    celdas = lineItems.map((item, idx) => ({
                        indice_columna: idx + 1,
                        texto: item.str
                    }));
                } else {
                    // Maybe back to text? Or just a single cell row?
                    // Let's stick to text_libre if it's just one item, unless it's very short (like a number)
                    if (lineItems.length === 1 && lineText.length > 50) {
                        tipo = "texto_libre";
                        activeHeader = []; // Reset header?
                        cabeceraActivaForLine = [];
                    } else {
                        tipo = "fila_tabla"; // Single column row
                        celdas = [{ indice_columna: 1, texto: lineText }];
                    }
                }
            }

            output.lineas.push({
                pagina: pageNum,
                indice_linea: globalLineIndex++,
                tipo,
                cabecera_activa: cabeceraActivaForLine,
                celdas,
                texto_plano: lineText
            });
        }
    }

    fs.writeFileSync('extraction_result.json', JSON.stringify(output, null, 2), 'utf-8');
    console.log('Extraction complete. Saved to extraction_result.json');
}

extractLinearContract().catch(err => {
    console.error(err);
    process.exit(1);
});
