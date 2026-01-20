import puppeteer from 'puppeteer';

export class PdfGeneratorService {
    /**
     * Generate a PDF from HTML content using Puppeteer
     * @param html - Complete HTML string with inline styles
     * @param options - Additional configuration
     * @returns PDF buffer
     */
    static async generatePdf(
        html: string,
        options: {
            filename?: string;
            format?: 'A4' | 'Letter';
            margin?: { top?: string; right?: string; bottom?: string; left?: string };
        } = {}
    ): Promise<Buffer> {
        const {
            format = 'A4',
            margin = { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        } = options;

        console.log('[PDF Generator] Launching Puppeteer...');

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });

            const page = await browser.newPage();

            console.log('[PDF Generator] Setting HTML content...');
            await page.setContent(html, {
                waitUntil: ['networkidle0', 'load'],
                timeout: 30000
            });

            console.log('[PDF Generator] Generating PDF...');
            const pdfBuffer = await page.pdf({
                format,
                margin,
                printBackground: true,
                preferCSSPageSize: false
            });

            console.log('[PDF Generator] PDF generated successfully');
            return pdfBuffer;

        } catch (error) {
            console.error('[PDF Generator] Error:', error);
            throw new Error(`PDF generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            if (browser) {
                await browser.close();
                console.log('[PDF Generator] Browser closed');
            }
        }
    }

    /**
     * Prepare HTML for PDF generation by inlining all styles
     * @param html - HTML fragment
     * @param styles - CSS styles to inline
     * @returns Complete HTML document
     */
    static prepareHtml(html: string, styles: string): string {
        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Auditoría Forense</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            color: #1f2937;
        }
        
        ${styles}
        
        /* PDF-specific adjustments */
        @page {
            size: A4;
            margin: 10mm;
        }
        
        @media print {
            .no-print {
                display: none !important;
            }
            
            /* Prevent page breaks inside elements */
            h1, h2, h3, h4, h5, h6 {
                page-break-after: avoid;
            }
            
            table {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    ${html}
</body>
</html>
        `.trim();
    }
}
