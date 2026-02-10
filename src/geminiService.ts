
import { ExtractedAccount, BillingItem, BillingSection, UsageMetrics } from "./types";

// Note: All Gemini API calls are handled by the backend at /api/extract
// The frontend only needs to communicate with our Express server

export async function extractBillingData(
  imageData: string,
  mimeType: string,
  onLog?: (msg: string) => void,
  onUsageUpdate?: (usage: UsageMetrics) => void,
  signal?: AbortSignal
): Promise<ExtractedAccount> {
  onLog?.(`[SYSTEM] Iniciando Protocolo de Auditoría vía Streaming.`);
  onLog?.(`[SYSTEM] Conectando con el motor de IA...`);

  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageData, mimeType: mimeType }),
    signal
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Error en el servidor de auditoría');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo establecer el stream de datos');

  const decoder = new TextDecoder();
  let resultData: any = null;
  let partialBuffer = '';
  let latestUsage: UsageMetrics | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Handle any remaining data in the buffer
        if (partialBuffer.trim()) {
          try {
            const update = JSON.parse(partialBuffer);
            if (update.type === 'final') {
              resultData = update.data;
            } else if (update.type === 'usage' && onUsageUpdate) {
              onUsageUpdate(update.usage);
            }
          } catch (e) {
            console.error("Error parsing residual NDJSON:", e);
          }
        }
        break;
      }

      partialBuffer += decoder.decode(value, { stream: true });
      const lines = partialBuffer.split('\n');
      partialBuffer = lines.pop() || ''; // Guardar la línea incompleta

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const update = JSON.parse(line);
          if (update.type === 'usage') {
            latestUsage = update.usage;
            onUsageUpdate?.(update.usage);
            onLog?.(`[API] Entorno: ${update.usage.promptTokens} | Salida: ${update.usage.candidatesTokens} | Total: ${update.usage.totalTokens} | Costo Est: $${update.usage.estimatedCostCLP} CLP`);
          } else if (update.type === 'chunk') {
            onLog?.(update.text);
          } else if (update.type === 'progress') {
            // Heartbeat
          } else if (update.type === 'final') {
            resultData = update.data;
          } else if (update.type === 'error') {
            throw new Error(update.message);
          }
        } catch (e) {
          console.error("Error parsing NDJSON line:", e);
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      onLog?.('[SYSTEM] ✋ Análisis detenido por el usuario.');
      throw err;
    }
    throw err;
  } finally {
    reader.releaseLock();
  }

  if (!resultData) throw new Error('No se recibió el resultado final de la auditoría');

  console.log('[geminiService] Processing final data...');
  console.log('[geminiService] resultData keys:', Object.keys(resultData));
  console.log('[geminiService] sections count:', resultData.sections?.length);

  onLog?.(`[API] Extracción completada. Iniciando auditoría matemática final.`);
  onLog?.(`[SYSTEM] Clínica: ${resultData.clinicName || 'Desconocida'} | Paciente: ${resultData.patientName || 'N/A'}`);

  let finalExtractedTotal = 0;
  onLog?.(`[AUDIT] Analizando discrepancias por sección...`);

  const auditedSections: BillingSection[] = (resultData.sections || []).map((section: any, sectionIndex: number) => {
    try {
      let sectionRunningTotal = 0;

      const auditedItems: BillingItem[] = (section.items || []).map((item: any, itemIndex: number) => {
        try {
          const qty = item.quantity || 1;
          const statedTotal = Number(item.total) || 0;
          const up = item.unitPrice || (statedTotal / qty);

          const calcTotal = Number((qty * up).toFixed(2));
          const hasCalculationError = Math.abs(calcTotal - statedTotal) > 5;

          if (hasCalculationError) {
            onLog?.(`[WARN] Diferencia en "${item.description}": ${qty} x ${up} = ${calcTotal} (Extracto: ${statedTotal})`);
          }

          sectionRunningTotal += statedTotal;

          return {
            ...item,
            quantity: qty,
            unitPrice: up,
            total: statedTotal,
            calculatedTotal: calcTotal,
            hasCalculationError
          };
        } catch (itemError) {
          console.error(`[AUDIT] Error processing item ${itemIndex} in section ${sectionIndex}:`, itemError);
          onLog?.(`[ERROR] Item corrupto detectado y omitido en sección ${section.category || 'desconocida'}`);
          // Return a safe fallback item
          return {
            index: itemIndex,
            description: `[Error: Item corrupto]`,
            quantity: 0,
            unitPrice: 0,
            total: 0,
            calculatedTotal: 0,
            hasCalculationError: true
          };
        }
      });

      const sectionDeclaredTotal = Number(section.sectionTotal || 0);
      const diff = sectionDeclaredTotal - sectionRunningTotal;
      const hasSectionError = Math.abs(diff) > 5;

      let isTaxConfusion = false;
      let isUnjustifiedCharge = false;

      if (hasSectionError) {
        onLog?.(`[WARN] Error de cuadratura en ${section.category}: Dif ${diff.toFixed(0)}`);
        const expectedGross = sectionRunningTotal * 1.19;
        if (Math.abs(expectedGross - sectionDeclaredTotal) < (sectionDeclaredTotal * 0.05)) {
          isTaxConfusion = true;
          onLog?.(`[AUDIT] Posible confusión de IVA en ${section.category}.`);
        } else if (sectionDeclaredTotal > sectionRunningTotal) {
          isUnjustifiedCharge = true;
          onLog?.(`[WARN] ALERTA: Diferencia no justificada en ${section.category}.`);
        }
      }

      finalExtractedTotal += sectionRunningTotal;

      return {
        category: section.category || `Sección ${sectionIndex + 1}`,
        items: auditedItems,
        sectionTotal: sectionDeclaredTotal,
        calculatedSectionTotal: Number(sectionRunningTotal.toFixed(2)),
        hasSectionError,
        isTaxConfusion,
        isUnjustifiedCharge
      };
    } catch (sectionError) {
      console.error(`[AUDIT] Error processing section ${sectionIndex}:`, sectionError);
      onLog?.(`[ERROR] Sección corrupta detectada y omitida`);
      // Return a safe fallback section
      return {
        category: `[Error: Sección ${sectionIndex + 1} corrupta]`,
        items: [],
        sectionTotal: 0,
        calculatedSectionTotal: 0,
        hasSectionError: true,
        isTaxConfusion: false,
        isUnjustifiedCharge: false
      };
    }
  });

  const clinicStatedTotal = Number(resultData.clinicStatedTotal || 0);
  const isBalanced = Math.abs(finalExtractedTotal - clinicStatedTotal) < 10;
  const totalItemsCount = auditedSections.reduce((acc, s) => acc + s.items.length, 0);

  return {
    ...resultData,
    sections: auditedSections,
    clinicStatedTotal,
    extractedTotal: Number(finalExtractedTotal.toFixed(2)),
    totalItems: totalItemsCount,
    isBalanced,
    discrepancy: Number((finalExtractedTotal - clinicStatedTotal).toFixed(0)),
    currency: resultData.currency || 'CLP',
    usage: latestUsage
  };
}
