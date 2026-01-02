import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { PAM_PROMPT, PAM_ANALYSIS_SCHEMA } from '../prompts/pam.prompt.js';

// Helper para obtener env vars (reutilizado del server.ts)
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handlePamExtraction(req: Request, res: Response) {
    console.log('[PAM] New PAM extraction request (Structured JSON Array)');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType } = req.body;

        // Validaciones
        if (!image || !mimeType) {
            console.error('[PAM] Missing payload');
            return res.status(400).json({ error: 'Missing image data or mimeType' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) {
            console.error('[PAM] No API Key');
            return res.status(500).json({ error: 'API Key not configured' });
        }

        // Inicializar servicio Gemini
        const gemini = new GeminiService(apiKey);
        let fullText = "";

        // Llamada a Gemini con Schema
        console.log('[PAM] Starting Gemini extraction with PAM_ANALYSIS_SCHEMA...');

        const stream = await gemini.extractWithStream(image, mimeType, PAM_PROMPT, {
            responseMimeType: 'application/json',
            responseSchema: PAM_ANALYSIS_SCHEMA,
            maxTokens: 30000
        });

        for await (const chunk of stream) {
            fullText += chunk.text;

            // Enviar chunk al frontend
            sendUpdate({ type: 'chunk', text: chunk.text });

            // Enviar métricas si disponibles
            if (chunk.usageMetadata) {
                const usage = chunk.usageMetadata;
                const { estimatedCost, estimatedCostCLP } = GeminiService.calculateCost("gemini-3-pro-preview", usage.promptTokenCount, usage.candidatesTokenCount);

                sendUpdate({
                    type: 'usage',
                    usage: {
                        promptTokens: usage.promptTokenCount,
                        candidatesTokens: usage.candidatesTokenCount,
                        totalTokens: usage.totalTokenCount,
                        estimatedCost,
                        estimatedCostCLP
                    }
                });
            }
        }

        console.log(`[PAM] Extraction complete: ${fullText.length} chars`);

        // Convertir el texto acumulado a JSON
        try {
            const cleanedText = fullText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
            const rawPamData: any[] = JSON.parse(cleanedText);

            // --- CONSOLIDACIÓN DE FOLIOS DUPLICADOS ---
            // A veces Gemini emite el mismo folio varias veces si está fragmentado pág por pág
            const mergedFoliosMap = new Map<string, any>();

            rawPamData.forEach(item => {
                const id = item.folioPAM;
                if (!id) return;

                if (mergedFoliosMap.has(id)) {
                    const existing = mergedFoliosMap.get(id);
                    // Combinar desgloses
                    existing.desglosePorPrestador = [
                        ...(existing.desglosePorPrestador || []),
                        ...(item.desglosePorPrestador || [])
                    ];
                    // Si el nuevo tiene un periodo o prestador más completo, podrías actualizarlo
                    // Pero lo más importante es el acumulado de items
                } else {
                    mergedFoliosMap.set(id, { ...item });
                }
            });

            const pamData = Array.from(mergedFoliosMap.values());

            // --- VALIDACIÓN ARITMÉTICA GLOBAL ---
            let globalValor = 0;
            let globalBonif = 0;
            let globalCopago = 0;
            let globalDeclarado = 0;

            const parseMoney = (val: string | number) => {
                if (!val) return 0;
                if (typeof val === 'number') return val;
                return parseInt(val.replace(/[^\d]/g, '')) || 0;
            };

            const validatedFolios = pamData.map(folio => {
                let calcTotalValor = 0;
                let calcTotalBonif = 0;
                let calcTotalCopago = 0;

                folio.desglosePorPrestador = (folio.desglosePorPrestador || []).map((prestador: any) => {
                    let pValor = 0, pBonif = 0, pCopago = 0;

                    prestador.items = (prestador.items || []).map((item: any) => {
                        const vt = parseMoney(item.valorTotal);
                        const bn = parseMoney(item.bonificacion);
                        const cp = parseMoney(item.copago);

                        pValor += vt;
                        pBonif += bn;
                        pCopago += cp;

                        const expected = vt - bn;
                        const itemAudit = Math.abs(expected - cp) > 10 ? '❌ ERROR' : '✅ OK';
                        return { ...item, _audit: itemAudit };
                    });

                    calcTotalValor += pValor;
                    calcTotalBonif += pBonif;
                    calcTotalCopago += pCopago;

                    return {
                        ...prestador,
                        _totals: { valor: pValor, bonif: pBonif, copago: pCopago }
                    };
                });

                const declaredCopago = parseMoney(folio.resumen?.totalCopagoDeclarado || "");
                const diff = Math.abs(calcTotalCopago - declaredCopago);

                // Si cuadra con un margen de 20 pesos (común en redondeos de Isapre)
                const isCorrect = diff <= 50;
                const auditStatus = isCorrect
                    ? '✅ Totales cuadran'
                    : `⚠️ Diferencia detectada: Suma Calc $${calcTotalCopago.toLocaleString()} vs Declarado $${declaredCopago.toLocaleString()}`;

                // Acumular globales
                globalValor += calcTotalValor;
                globalBonif += calcTotalBonif;
                globalCopago += calcTotalCopago;
                globalDeclarado += declaredCopago;

                return {
                    ...folio,
                    resumen: {
                        ...(folio.resumen || {}),
                        totalCopagoCalculado: calcTotalCopago,
                        auditoriaStatus: auditStatus,
                        cuadra: isCorrect
                    }
                };
            });

            const globalDiff = Math.abs(globalCopago - globalDeclarado);
            const globalAuditStatus = globalDiff > 50
                ? `❌ La cuenta consolidada NO CUADRA por $${globalDiff.toLocaleString()}`
                : `✅ TODO CUADRA: Total consolidado $${globalCopago.toLocaleString()}`;

            // Enviar resultado final estructurado
            sendUpdate({
                type: 'final',
                data: {
                    folios: validatedFolios,
                    global: {
                        totalValor: globalValor,
                        totalBonif: globalBonif,
                        totalCopago: globalCopago,
                        totalCopagoDeclarado: globalDeclarado,
                        cuadra: globalDiff <= 50,
                        discrepancia: globalDiff,
                        auditoriaStatus: globalAuditStatus
                    }
                }
            });

        } catch (parseError) {
            console.error('[PAM] JSON Parse Error:', parseError);
            throw new Error('No se pudo procesar la respuesta estructurada.');
        }

        res.end();

    } catch (error: any) {
        console.error('[PAM] Error en endpoint PAM:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}
