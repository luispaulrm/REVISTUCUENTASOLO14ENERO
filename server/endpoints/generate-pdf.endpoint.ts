import { Request, Response } from 'express';
import { PdfGeneratorService } from '../services/pdf.generator.service.js';

interface PdfRequest {
    html: string;
    styles?: string;
    filename?: string;
}

export async function handleGeneratePdf(req: Request, res: Response) {
    console.log('[PDF Endpoint] Received PDF generation request');

    try {
        const { html, styles = '', filename = 'Auditoria_Forense.pdf' }: PdfRequest = req.body;

        // Validate payload
        if (!html || typeof html !== 'string') {
            console.error('[PDF Endpoint] Invalid HTML payload');
            return res.status(400).json({
                error: 'Invalid request: HTML content is required'
            });
        }

        // Check payload size (limit to ~10MB of HTML)
        const sizeInMB = Buffer.byteLength(html, 'utf8') / (1024 * 1024);
        if (sizeInMB > 10) {
            console.error(`[PDF Endpoint] Payload too large: ${sizeInMB.toFixed(2)}MB`);
            return res.status(413).json({
                error: `HTML payload too large (${sizeInMB.toFixed(2)}MB). Maximum is 10MB.`
            });
        }

        console.log(`[PDF Endpoint] Processing ${sizeInMB.toFixed(2)}MB of HTML`);

        // Prepare complete HTML document with inlined styles
        const completeHtml = PdfGeneratorService.prepareHtml(html, styles);

        // Generate PDF
        const pdfBuffer = await PdfGeneratorService.generatePdf(completeHtml, {
            filename,
            format: 'A4',
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            }
        });

        // Set response headers for file download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        console.log(`[PDF Endpoint] Sending ${(pdfBuffer.length / 1024).toFixed(2)}KB PDF`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('[PDF Endpoint] Error generating PDF:', error);

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({
            error: 'PDF generation failed',
            details: errorMessage
        });
    }
}
