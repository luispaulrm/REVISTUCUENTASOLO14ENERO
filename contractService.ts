import { Contract, UsageMetrics } from './types';

export interface ContractExtractionResult {
    data: Contract;
    usage?: UsageMetrics;
}

export async function extractContractData(
    imageData: string,
    mimeType: string,
    onLog?: (msg: string) => void,
    onUsageUpdate?: (usage: UsageMetrics) => void,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
): Promise<ContractExtractionResult> {
    onLog?.('[SYSTEM] Iniciando análisis forense del Plan de Salud...');
    onProgress?.(5);
    onLog?.('[SYSTEM] Aplicando mandato de interpretación de coberturas...');
    onProgress?.(10);

    const response = await fetch('/api/extract-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, mimeType: mimeType }),
        signal
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error en servidor de Contratos');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No se pudo establecer stream');

    const decoder = new TextDecoder();
    let resultData: Contract | null = null;
    let partialBuffer = '';
    let latestUsage: UsageMetrics | null = null;
    let totalReceived = 0;
    const EXPECTED_SIZE = 60000; // Contratos suelen ser más largos

    try {
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
                            onLog?.(`[API] Tokens: ${update.usage.totalTokens} | Costo Est.: $${update.usage.estimatedCostCLP} CLP`);
                            break;

                        case 'chunk':
                            totalReceived += update.text?.length || 0;
                            const chunkProgress = Math.min(15 + (totalReceived / EXPECTED_SIZE) * 70, 85);
                            onProgress?.(chunkProgress);
                            if (update.text) onLog?.(update.text.trim());
                            break;

                        case 'final':
                            onProgress?.(95);
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
    } catch (err: any) {
        if (err.name === 'AbortError') {
            onLog?.('[SYSTEM] ✋ Proceso cancelado por el usuario.');
            throw err;
        }
        throw err;
    } finally {
        reader.releaseLock();
    }

    if (!resultData) throw new Error('No se recibió resultado forense del contrato');

    onLog?.('[SYSTEM] ✅ Análisis de Contrato completado con éxito');
    onLog?.(`[SYSTEM] Isapre: ${resultData.diseno_ux.nombre_isapre}`);
    onLog?.(`[SYSTEM] Plan: ${resultData.diseno_ux.titulo_plan}`);

    return {
        data: resultData,
        usage: latestUsage || undefined
    };
}
