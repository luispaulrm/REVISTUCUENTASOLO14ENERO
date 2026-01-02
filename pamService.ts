// Types para documentos PAM basados en el esquema corregido
export interface PAMItem {
    codigoGC: string;
    descripcion: string;
    cantidad: string;
    valorTotal: string;
    bonificacion: string;
    copago: string;
    _audit?: string;
}

export interface PrestadorDesglose {
    nombrePrestador: string;
    items: PAMItem[];
    _totals?: {
        valor: number;
        bonif: number;
        copago: number;
    };
}

export interface PAMResumen {
    totalCopago: string;
    totalCopagoCalculado?: number;
    totalCopagoDeclarado: string;
    revisionCobrosDuplicados: string;
    auditoriaStatus?: string;
    cuadra?: boolean;
}

export interface FolioPAM {
    folioPAM: string;
    prestadorPrincipal: string;
    periodoCobro: string;
    desglosePorPrestador: PrestadorDesglose[];
    resumen: PAMResumen;
}

// El resultado contiene la lista de folios y un resumen global
export interface PamDocument {
    folios: FolioPAM[];
    global: {
        totalValor: number;
        totalBonif: number;
        totalCopago: number;
        totalCopagoDeclarado: number;
        cuadra: boolean;
        discrepancia: number;
        auditoriaStatus: string;
        totalItems?: number;
    };
}

export interface UsageMetrics {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost: number;
    estimatedCostCLP: number;
}

export interface PamExtractionResult {
    data: PamDocument;
    usage?: UsageMetrics;
}

// Función para extraer datos PAM
export async function extractPamData(
    imageData: string,
    mimeType: string,
    onLog?: (msg: string) => void,
    onUsageUpdate?: (usage: UsageMetrics) => void,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
): Promise<PamExtractionResult> {
    onLog?.('[SYSTEM] Iniciando análisis de Coberturas PAM...');
    onProgress?.(5);
    onLog?.('[SYSTEM] Aplicando esquema de bonificación Isapre/Aseguradora...');
    onProgress?.(10);

    const response = await fetch('/api/extract-pam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, mimeType: mimeType }),
        signal
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error en servidor PAM');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No se pudo establecer stream');

    const decoder = new TextDecoder();
    let resultData: PamDocument | null = null;
    let partialBuffer = '';
    let latestUsage: UsageMetrics | null = null;
    let totalReceived = 0;
    const EXPECTED_SIZE = 8000;

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
                            onLog?.(`[API] Tokens: ${update.usage.totalTokens} | Costo: $${update.usage.estimatedCostCLP} CLP`);
                            break;

                        case 'chunk':
                            totalReceived += update.text?.length || 0;
                            // Progreso proporcional entre 15% y 85%
                            const chunkProgress = Math.min(15 + (totalReceived / EXPECTED_SIZE) * 70, 85);
                            onProgress?.(chunkProgress);
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

    if (!resultData) throw new Error('No se recibió resultado PAM estructurado');

    onLog?.('[SYSTEM] ✅ Análisis PAM completado con éxito');
    onLog?.(`[SYSTEM] Folios encontrados: ${resultData.folios.length}`);

    return {
        data: resultData,
        usage: latestUsage || undefined
    };
}
