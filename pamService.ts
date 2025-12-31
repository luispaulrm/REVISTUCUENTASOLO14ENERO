// Types para documentos PAM
export interface PamMedication {
    index: number;
    name: string;
    concentration: string;
    form: string;
    dose: string;
    frequency: string;
    duration: string;
    totalQuantity: string;
    observations: string;
}

export interface PamDocument {
    patient: string;
    rut: string;
    doctor: string;
    specialty: string;
    date: string;
    validity: string;
    diagnosis: string;
    medications: PamMedication[];
    totalMedications: number;
    usage?: UsageMetrics;
}

export interface UsageMetrics {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost: number;
    estimatedCostCLP: number;
}

// Función para extraer datos PAM
export async function extractPamData(
    imageData: string,
    mimeType: string,
    onLog?: (msg: string) => void,
    onUsageUpdate?: (usage: UsageMetrics) => void
): Promise<PamDocument> {
    onLog?.('[SYSTEM] Iniciando análisis de PAM...');
    onLog?.('[SYSTEM] Conectando con Gemini API...');

    const response = await fetch('/api/extract-pam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, mimeType: mimeType }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error en servidor PAM');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No se pudo establecer stream');

    const decoder = new TextDecoder();
    let resultData: any = null;
    let partialBuffer = '';
    let latestUsage: UsageMetrics | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        partialBuffer += decoder.decode(value, { stream: true });
        const lines = partialBuffer.split('\n');
        partialBuffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const update = JSON.parse(line);

                switch (update.type) {
                    case 'usage':
                        latestUsage = update.usage;
                        onUsageUpdate?.(update.usage);
                        onLog?.(`[API] Tokens: ${update.usage.totalTokens} | Costo: $${update.usage.estimatedCostCLP} CLP`);
                        break;

                    case 'chunk':
                        onLog?.(update.text);
                        break;

                    case 'final':
                        resultData = update.data;
                        break;

                    case 'error':
                        throw new Error(update.message);
                }
            } catch (e) {
                console.error("Error parsing NDJSON:", e);
            }
        }
    }

    if (!resultData) throw new Error('No se recibió resultado PAM');

    onLog?.('[SYSTEM] ✅ Análisis PAM completado');
    onLog?.(`[SYSTEM] Paciente: ${resultData.patient}`);
    onLog?.(`[SYSTEM] Medicamentos: ${resultData.totalMedications}`);

    return {
        ...resultData,
        usage: latestUsage
    };
}
