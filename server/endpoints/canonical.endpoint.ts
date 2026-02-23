import { Request, Response } from 'express';
import { analyzeSingleContract } from '../services/contractEngine.service.js';
import { transformToCanonical } from '../services/canonicalTransform.service.ts';
import { registerProcessedContract, getContractCount } from '../services/contractLearning.service.ts';
import { ContractLayoutExtractorA } from '../services/contractLayoutExtractorA.service.js';
import { ContractAuditorB } from '../services/contractAuditorB.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { AuditorBResult } from '../services/contractTypes.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

const MAX_PAGES_HIGH_FIDELITY = 15; // Safe limit for high-fidelity extraction

export async function handleCanonicalExtraction(req: Request, res: Response) {
    console.log('[CANONICAL] New Extraction Request');

    // Setup streaming for logs (reusing existing UI logic)
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType, originalname, strategy } = req.body;
        if (!image || !mimeType) {
            return res.status(400).json({ error: 'Missing image/pdf data' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) return res.status(500).json({ error: 'API Key not configured' });

        const buffer = Buffer.from(image, 'base64');
        const file = { buffer, mimetype: mimeType, originalname: originalname || 'contrato.pdf' };
        let pagesToProcess = [{ image, mimeType }];

        if (mimeType === 'application/pdf') {
            try {
                const loadingTask = pdfjsLib.getDocument({
                    data: new Uint8Array(buffer),
                    disableFontFace: true,
                    useSystemFonts: true,
                    disableWorker: true,
                    verbosity: 0,
                } as any);
                const pdf = await loadingTask.promise;
                const totalPages = Math.min(pdf.numPages, MAX_PAGES_HIGH_FIDELITY);
                console.log(`[CANONICAL] PDF detected with ${pdf.numPages} pages. Processing ${totalPages} pages.`);

                if (totalPages > 1) {
                    pagesToProcess = [];
                    for (let i = 1; i <= totalPages; i++) {
                        pagesToProcess.push({ image, mimeType });
                    }
                }
            } catch (err) {
                console.error('[CANONICAL] Error reading PDF page count:', err);
            }
        }

        if (strategy === 'GRID_GEOMETRY') {
            sendUpdate({ type: 'chunk', text: `🚀 ACTIVANDO TECNOLOGÍA A (Geometría Determinista) - ${pagesToProcess.length} páginas detectadas...` });

            const gemini = new GeminiService(apiKey, (msg) => sendUpdate({ type: 'chunk', text: msg }));
            const extractorA = new ContractLayoutExtractorA(gemini, (msg) => sendUpdate({ type: 'chunk', text: `[PASO 1] ${msg}` }));
            const auditorB = new ContractAuditorB(gemini, (msg) => sendUpdate({ type: 'chunk', text: `[PASO 2] ${msg}` }));

            sendUpdate({ type: 'chunk', text: '[PASO 1] Iniciando Extracción de Geometría...' });
            const layoutDoc = await extractorA.extractDocLayout(
                pagesToProcess,
                'DOC_' + Date.now(),
                file.originalname
            );

            sendUpdate({ type: 'chunk', text: '[PASO 2] Ejecutando Auditor Semántico...' });
            const result = await auditorB.auditLayout(layoutDoc);

            // Transform AuditorBResult to the canonical format (simplified for now)
            // or just return the AuditorBResult directly if the UI understands it.
            // For now, let's keep the AuditorBResult as the "final" data.
            sendUpdate({
                type: 'final',
                data: result,
                metrics: { totalCount: 1, strategy: 'GRID_GEOMETRY' },
                totalCount: await registerProcessedContract(`${file.originalname}|${file.buffer.length}`)
            });

        } else {
            // 1. Run full fidelity extraction (Legacy V2)
            const result = await analyzeSingleContract(
                file,
                apiKey,
                (logMsg) => {
                    if (logMsg.startsWith('@@METRICS@@')) {
                        try {
                            const metrics = JSON.parse(logMsg.replace('@@METRICS@@', ''));
                            sendUpdate({ type: 'metrics', metrics });
                        } catch (e) {
                            console.error('[CANONICAL] Failed to parse metrics:', e);
                        }
                    } else {
                        sendUpdate({ type: 'chunk', text: logMsg });
                    }
                }
            );

            // 2. Transform to Canonical JSON
            const canonicalResult = transformToCanonical(result);

            // 3. Register as processed unique contract (fingerprint: name|size)
            const fingerprint = `${file.originalname}|${file.buffer.length}`;
            const totalCount = await registerProcessedContract(fingerprint);

            // 4. Send final canonical data
            sendUpdate({
                type: 'final',
                data: canonicalResult,
                metrics: result.metrics,
                totalCount
            });
        }

        res.end();

    } catch (error: any) {
        console.error('[CANONICAL] Error:', error);
        sendUpdate({ type: 'error', message: error.message });
        res.end();
    }
}
