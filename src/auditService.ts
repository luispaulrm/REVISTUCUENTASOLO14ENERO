export async function runForensicAudit(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any,
    onLog?: (msg: string) => void,
    onUsageUpdate?: (usage: any) => void,
    onProgress?: (progress: number) => void,
    htmlContext?: string,
    isAgentMode: boolean = false,
    previousAuditResult: any = null
) {
    onLog?.(isAgentMode ? '[AuditService] 🕵️ Activando Agente de Búsqueda Forense (Modo Enriquecimiento)...' : '[AuditService] 🚀 Iniciando flujo de auditoría forense...');
    onProgress?.(5);

    try {
        const response = await fetch('/api/audit/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cuentaJson, pamJson, contratoJson, htmlContext, isAgentMode, previousAuditResult })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error en la respuesta del servidor');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No se pudo establecer el stream de respuesta');

        const decoder = new TextDecoder();
        let partialBuffer = '';
        let finalResult: any = null;

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
                        case 'log':
                            onLog?.(update.message);
                            break;
                        case 'usage':
                            onUsageUpdate?.(update.usage);
                            break;
                        case 'progress':
                            onProgress?.(update.progress);
                            break;
                        case 'final':
                            finalResult = update.data;
                            onProgress?.(100);
                            break;
                        case 'error':
                            throw new Error(update.message);
                    }
                } catch (e) {
                    console.error("Error parsing NDJSON line:", e);
                }
            }
        }

        if (!finalResult) throw new Error('No se recibió el resultado final de la auditoría');
        return finalResult;

    } catch (error: any) {
        onLog?.(`[AuditService] ❌ Error: ${error.message}`);
        throw error;
    }
}
