import { Request, Response } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { PAM_PROMPT } from '../prompts/pam.prompt.js';

// Helper para obtener env vars (reutilizado del server.ts)
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}

export async function handlePamExtraction(req: Request, res: Response) {
    console.log('[PAM] New PAM extraction request');

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

        // Streaming de Gemini
        console.log('[PAM] Starting Gemini extraction...');

        for await (const chunk of await gemini.extractWithStream(image, mimeType, PAM_PROMPT)) {
            fullText += chunk.text;

            // Enviar chunk al frontend
            sendUpdate({ type: 'chunk', text: chunk.text });

            // Enviar métricas si disponibles
            if (chunk.usageMetadata) {
                const usage = chunk.usageMetadata;
                const inputCost = (usage.promptTokenCount / 1000000) * 0.10;
                const outputCost = (usage.candidatesTokenCount / 1000000) * 0.40;
                const estimatedCost = inputCost + outputCost;

                sendUpdate({
                    type: 'usage',
                    usage: {
                        promptTokens: usage.promptTokenCount,
                        candidatesTokens: usage.candidatesTokenCount,
                        totalTokens: usage.totalTokenCount,
                        estimatedCost,
                        estimatedCostCLP: Math.round(estimatedCost * 980)
                    }
                });
            }
        }

        console.log(`[PAM] Extraction complete: ${fullText.length} chars`);

        // Parsear resultado
        const pamData = parsePamText(fullText);

        // Enviar resultado final
        sendUpdate({
            type: 'final',
            data: pamData
        });

        res.end();

    } catch (error: any) {
        console.error('[PAM] Error:', error);
        sendUpdate({ type: 'error', message: error.message || 'Internal Server Error' });
        res.end();
    }
}

// Parser específico para PAM
function parsePamText(text: string): any {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    // Extraer metadata
    let patient = "N/A";
    let rut = "N/A";
    let doctor = "N/A";
    let specialty = "N/A";
    let date = "N/A";
    let validity = "N/A";
    let diagnosis = "N/A";

    const medications: any[] = [];
    let currentSection = "";

    for (const line of lines) {
        if (line.startsWith('PATIENT:')) {
            patient = line.replace('PATIENT:', '').trim();
        } else if (line.startsWith('RUT:')) {
            rut = line.replace('RUT:', '').trim();
        } else if (line.startsWith('DOCTOR:')) {
            doctor = line.replace('DOCTOR:', '').trim();
        } else if (line.startsWith('SPECIALTY:')) {
            specialty = line.replace('SPECIALTY:', '').trim();
        } else if (line.startsWith('DATE:')) {
            date = line.replace('DATE:', '').trim();
        } else if (line.startsWith('VALIDITY:')) {
            validity = line.replace('VALIDITY:', '').trim();
        } else if (line.startsWith('DIAGNOSIS:')) {
            diagnosis = line.replace('DIAGNOSIS:', '').trim();
        } else if (line.startsWith('SECTION:')) {
            currentSection = line.replace('SECTION:', '').trim();
        } else if (line.includes('|')) {
            // Parsear medicamento
            const cols = line.split('|').map(c => c.trim());
            if (cols.length >= 8) {
                medications.push({
                    index: parseInt(cols[0]) || medications.length + 1,
                    name: cols[1],
                    concentration: cols[2],
                    form: cols[3],
                    dose: cols[4],
                    frequency: cols[5],
                    duration: cols[6],
                    totalQuantity: cols[7],
                    observations: cols[8] || ""
                });
            }
        }
    }

    return {
        patient,
        rut,
        doctor,
        specialty,
        date,
        validity,
        diagnosis,
        medications,
        totalMedications: medications.length
    };
}
