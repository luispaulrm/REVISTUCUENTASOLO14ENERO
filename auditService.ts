export async function runForensicAudit(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any,
    log: (msg: string) => void
) {
    try {
        log('[AuditService] 🚀 Enviando datos para auditoría forense...');

        const response = await fetch('/api/audit/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cuentaJson,
                pamJson,
                contratoJson
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error en la respuesta del servidor');
        }

        const result = await response.json();
        log('[AuditService] ✅ Auditoría completada satisfactoriamente.');
        return result;

    } catch (error: any) {
        log(`[AuditService] ❌ Error: ${error.message}`);
        throw error;
    }
}
