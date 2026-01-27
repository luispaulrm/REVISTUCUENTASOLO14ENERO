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

    // Watchdog for connection health
    let watchdogTimer: number | null = null;
    let lastActivity = Date.now();

    const checkHealth = () => {
        if (Date.now() - lastActivity > 20000) { // 20 seconds silence
            // This might be normal for slow AI thinking, but we should at least log it
            onLog?.('[SYSTEM] ⏳ Esperando respuesta del modelo...');
        }
    };

    watchdogTimer = window.setInterval(checkHealth, 5000);

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            partialBuffer += decoder.decode(value, { stream: true });
            lastActivity = Date.now(); // Update activity
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

                        case 'log':
                            // Handle log messages from backend
                            onLog?.(update.message);
                            break;

                        case 'progress':
                            // Handle progress updates from backend
                            if (update.progress !== undefined) {
                                onProgress?.(update.progress);
                            }
                            break;

                        case 'phase':
                            // Handle workflow phases (legacy multi-pass)
                            const phaseName = update.name || 'unknown';

                            if (phaseName === 'discovery') {
                                onLog?.(`[PHASE 1] 🔍 Discovery: Buscando folios en el documento...`);
                                onProgress?.(10);
                            } else if (phaseName === 'discovery_complete') {
                                const count = update.count || 0;
                                onLog?.(`[PHASE 1] ✅ Folios encontrados: ${count}`);
                                onProgress?.(20);
                            } else if (phaseName === 'extraction_start') {
                                const current = update.current;
                                const total = update.total;
                                const folio = update.folio;
                                onLog?.(`[PHASE 2] 🚀 (${current}/${total}) Extrayendo detalles folio: ${folio}...`);

                                // Dynamic progress between 20% and 90%
                                const percent = 20 + ((current / total) * 70);
                                onProgress?.(percent);
                            } else if (phaseName === 'extraction_success') {
                                onLog?.(`[PHASE 2] ✅ Extracción exitosa folio: ${update.folio}`);
                            } else if (phaseName === 'extraction_error') {
                                onLog?.(`[PHASE 2] ⚠️ Error en folio ${update.folio}: ${update.error}`);
                            }
                            break;

                        case 'chunk':
                            // Enable text streaming visualization
                            if (update.text) {
                                onLog?.(update.text);
                                totalReceived += update.text.length;
                            }
                            break;

                        case 'final':
                            onProgress?.(95);
                            resultData = update.data;
                            break;

                        case 'error':
                            throw new Error(update.message);
                    }
                } catch (e: any) {
                    console.error("Error parsing NDJSON:", e);
                    // Critical: if it was a throw from the switch (e.g. type error), re-throw to abort stream
                    if (e.message && !e.message.includes('JSON')) {
                        throw e;
                    }
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
        if (watchdogTimer) clearInterval(watchdogTimer);
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
