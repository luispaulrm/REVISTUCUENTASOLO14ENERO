import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { CONTRACT_PROMPT } from '../prompts/contract.prompt.js';

// Helper para obtener env vars
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handleContractExtraction(req: Request, res: Response) {
    console.log('[CONTRACT] New Contract extraction request (TURBO PROTOCOL)');

    // Setup streaming response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
    };

    try {
        const { image, mimeType } = req.body;

        if (!image || !mimeType) {
            console.error('[CONTRACT] Missing payload');
            return res.status(400).json({ error: 'Missing image/pdf data or mimeType' });
        }

        const apiKey = envGet("GEMINI_API_KEY") || envGet("API_KEY") || '';
        if (!apiKey) {
            console.error('[CONTRACT] No API Key');
            return res.status(500).json({ error: 'API Key not configured' });
        }

        const gemini = new GeminiService(apiKey);
        let fullText = "";

        console.log('[CONTRACT] Starting Gemini TURBO extraction...');

        // IMPORTANT: Removed responseMimeType: 'application/json' to allow raw delimited text (Faster)
        const stream = await gemini.extractWithStream(image, mimeType, CONTRACT_PROMPT, {
            maxTokens: 40000
        });

        for await (const chunk of stream) {
            fullText += chunk.text;
            sendUpdate({ type: 'chunk', text: chunk.text });

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

        console.log(`[CONTRACT] Raw string complete: ${fullText.length} chars. Parsing...`);

        // PARSER TURBO V7.0
        const lines = fullText.split('\n').filter(l => l.trim());
        const result: any = {
            reglas: [],
            coberturas: [],
            diseno_ux: {
                nombre_isapre: 'DESCONOCIDA',
                titulo_plan: 'PLAN DETECTADO',
                subtitulo_plan: ''
            }
        };

        for (const line of lines) {
            const parts = line.split('|').map(p => p.trim());
            const prefix = parts[0]?.toUpperCase();

            if (prefix === 'METADATA') {
                parts.forEach(p => {
                    if (p.startsWith('ISAPRE:')) result.diseno_ux.nombre_isapre = p.replace('ISAPRE:', '').trim();
                    if (p.startsWith('PLAN:')) result.diseno_ux.titulo_plan = p.replace('PLAN:', '').trim();
                    if (p.startsWith('SUB:')) result.diseno_ux.subtitulo_plan = p.replace('SUB:', '').trim();
                });
            } else if (prefix === 'RULE') {
                // Format: RULE|[Pagina]|[Seccion]|[Categoria]|[Extracto]
                result.reglas.push({
                    'PÁGINA ORIGEN': parts[1] || 'N/A',
                    'CÓDIGO/SECCIÓN': parts[2] || 'REGLA',
                    'SUBCATEGORÍA': parts[3] || 'General',
                    'VALOR EXTRACTO LITERAL DETALLADO': parts.slice(4).join('|') || 'Sin extracto'
                });
            } else if (prefix === 'COBER') {
                // Format: COBER|[Prestacion]|[Modalidad]|[Percent]|[Copago]|[Tope1]|[Tope2]|[Restriccion]|[Anclajes]
                const restriction = parts[7] || '';
                result.coberturas.push({
                    'PRESTACIÓN CLAVE': parts[1] || '---',
                    'MODALIDAD/RED': parts[2] || '---',
                    '% BONIFICACIÓN': parts[3] || '---',
                    'COPAGO FIJO': parts[4] || '---',
                    'TOPE LOCAL 1 (VAM/EVENTO)': parts[5] || '---',
                    'TOPE LOCAL 2 (ANUAL/UF)': parts[6] || '---',
                    'RESTRICCIÓN Y CONDICIONAMIENTO': restriction.length > 2 ? restriction : 'Sin restricciones capturadas',
                    'ANCLAJES': parts[8] ? parts[8].split(';').map(a => a.trim()) : []
                });
            }
        }

        console.log(`[CONTRACT] Parse complete: ${result.reglas.length} rules, ${result.coberturas.length} coverages.`);

        sendUpdate({
            type: 'final',
            data: result
        });

        res.end();

    } catch (error: any) {
        console.error('[CONTRACT] Protocol Error:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}
