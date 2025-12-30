
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedAccount, BillingItem, BillingSection, UsageMetrics } from "./types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const billingSchema = {
  type: Type.OBJECT,
  properties: {
    clinicName: { type: Type.STRING },
    patientName: { type: Type.STRING },
    invoiceNumber: { type: Type.STRING },
    date: { type: Type.STRING },
    currency: { type: Type.STRING, description: "Currency symbol or code, e.g., CLP" },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, description: "Categoría (Ej: Pabellón, Insumos, Farmacia)" },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                unitPrice: { type: Type.NUMBER, description: "Precio unitario (preferiblemente bruto/ISA)" },
                total: { type: Type.NUMBER, description: "Valor Total del ítem incluyendo IVA/Impuestos (Valor ISA)" }
              },
              required: ["description", "total"]
            }
          },
          sectionTotal: { type: Type.NUMBER, description: "Total declarado por la clínica para la sección" }
        },
        required: ["category", "items", "sectionTotal"]
      }
    },
    clinicStatedTotal: { type: Type.NUMBER, description: "El Gran Total final de la cuenta" }
  },
  required: ["clinicName", "sections", "clinicStatedTotal"]
};

export async function extractBillingData(
  imageData: string,
  mimeType: string,
  onLog?: (msg: string) => void,
  onUsageUpdate?: (usage: UsageMetrics) => void
): Promise<ExtractedAccount> {
  onLog?.(`[SYSTEM] Iniciando Protocolo de Auditoría vía Streaming.`);
  onLog?.(`[SYSTEM] Conectando con el motor de IA...`);

  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageData, mimeType: mimeType }),
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

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
          // Mostrar el texto extraído directamente en la terminal
          onLog?.(update.text);
        } else if (update.type === 'progress') {
          // Mantener un latido silencioso o loguear tamaño
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

  if (!resultData) throw new Error('No se recibió el resultado final de la auditoría');

  onLog?.(`[API] Extracción completada. Iniciando auditoría matemática final.`);
  onLog?.(`[SYSTEM] Clínica: ${resultData.clinicName || 'Desconocida'} | Paciente: ${resultData.patientName || 'N/A'}`);

  let finalExtractedTotal = 0;
  onLog?.(`[AUDIT] Analizando discrepancias por sección...`);

  const auditedSections: BillingSection[] = (resultData.sections || []).map((section: any) => {
    let sectionRunningTotal = 0;

    const auditedItems: BillingItem[] = (section.items || []).map((item: any) => {
      const qty = item.quantity || 1;
      const statedTotal = Number(item.total);
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
      category: section.category,
      items: auditedItems,
      sectionTotal: sectionDeclaredTotal,
      calculatedSectionTotal: Number(sectionRunningTotal.toFixed(2)),
      hasSectionError,
      isTaxConfusion,
      isUnjustifiedCharge
    };
  });

  const clinicStatedTotal = Number(resultData.clinicStatedTotal || 0);
  const isBalanced = Math.abs(finalExtractedTotal - clinicStatedTotal) < 10;

  onLog?.(`[SYSTEM] Cuadratura Final: ${finalExtractedTotal} (Auditor) vs ${clinicStatedTotal} (Documento)`);
  if (isBalanced) {
    onLog?.(`[SYSTEM] Auditoría completada con éxito.`);
  } else {
    onLog?.(`[WARN] Discrepancia detectada: ${(finalExtractedTotal - clinicStatedTotal).toFixed(0)} CLP.`);
  }

  // Reutilizar la última métrica de uso recibida si está disponible
  return {
    ...resultData,
    sections: auditedSections,
    clinicStatedTotal,
    extractedTotal: Number(finalExtractedTotal.toFixed(2)),
    isBalanced,
    discrepancy: Number((finalExtractedTotal - clinicStatedTotal).toFixed(2)),
    currency: resultData.currency || 'CLP',
    usage: latestUsage
  };
}
