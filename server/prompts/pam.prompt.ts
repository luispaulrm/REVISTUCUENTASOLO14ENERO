import { SchemaType } from "@google/generative-ai";

export const PAM_ANALYSIS_SCHEMA = {
   type: SchemaType.ARRAY,
   description: 'Una lista de cada Folio PAM encontrado en los documentos.',
   items: {
      type: SchemaType.OBJECT,
      properties: {
         folioPAM: { type: SchemaType.STRING, description: 'El número de folio exacto del PAM.' },
         prestadorPrincipal: { type: SchemaType.STRING, description: 'Nombre y RUT del prestador principal en ese PAM.' },
         periodoCobro: { type: SchemaType.STRING, description: 'Fechas de inicio y fin de cobro de ese PAM.' },
         desglosePorPrestador: {
            type: SchemaType.ARRAY,
            description: 'Una lista de tablas de desglose, una por cada prestador dentro de este Folio PAM.',
            items: {
               type: SchemaType.OBJECT,
               properties: {
                  nombrePrestador: { type: SchemaType.STRING, description: 'El nombre del prestador para esta tabla de desglose.' },
                  items: {
                     type: SchemaType.ARRAY,
                     description: 'La lista de prestaciones para este prestador.',
                     items: {
                        type: SchemaType.OBJECT,
                        properties: {
                           codigoGC: { type: SchemaType.STRING, description: 'Código/G/C.' },
                           descripcion: { type: SchemaType.STRING, description: 'Descripción Prestación.' },
                           cantidad: { type: SchemaType.STRING, description: 'Cant. / N°.' },
                           valorTotal: { type: SchemaType.STRING, description: 'Valor Total del Ítem ($).' },
                           bonificacion: { type: SchemaType.STRING, description: 'Bonificación del Ítem ($).' },
                           copago: { type: SchemaType.STRING, description: 'Copago del Ítem ($).' },
                        },
                        required: ['codigoGC', 'descripcion', 'cantidad', 'valorTotal', 'bonificacion', 'copago']
                     }
                  }
               },
               required: ['nombrePrestador', 'items']
            }
         },
         resumen: {
            type: SchemaType.OBJECT,
            description: 'Resumen y totales para este Folio PAM.',
            properties: {
               totalCopago: { type: SchemaType.STRING, description: 'Monto total de copago en Prestador/Clínica (Calculado o general).' },
               totalCopagoDeclarado: { type: SchemaType.STRING, description: 'El valor literal exacto del "Total Copago" o "Total a Pagar" que aparece impreso en el resumen o pie de página del documento. Úsalo para detectar discrepancias.' },
               revisionCobrosDuplicados: { type: SchemaType.STRING, description: 'Observaciones sobre cobros duplicados.' },
            }
         }
      },
      required: ['folioPAM', 'prestadorPrincipal', 'periodoCobro', 'desglosePorPrestador', 'resumen']
   }
};

export const PAM_PROMPT = `
**INSTRUCCIÓN CRÍTICA: ANÁLISIS DE PROGRAMAS DE ATENCIÓN MÉDICA (PAM)**
ACTÚA COMO UN AUDITOR DE SEGUROS Y BONOS MÉDICOS.

**OBJETIVO:** Extraer el detalle completo de los bonos PAM en formato **TEXTO ESTRUCTURADO (NO JSON)**.

**REGLA DE FORMATO VISUAL (IMPORTANTE):**
1. **FOLIO:** Identifica cada bono nuevo con "FOLIO: [Numero]"
2. **PRESTADOR:** Identifica el prestador con "PROVIDER: [Nombre]"
3. **TABLA:** Extrae los ítems línea por línea usando el símbolo "|" como separador.
   Formato: [Código]|[Descripción]|[Cantidad]|[ValorTotal]|[Bonificación]|[Copago]
4. **TOTALES:** Si ves un total declarado, usa "TOTAL_COPAGO_DECLARADO: [Monto]"

**ESTRUCTURA DE SALIDA ESPERADA:**
FOLIO: 12345678
PROVIDER: CLINICA ALEMANA
DATE_START: 12/05/2024
DATE_END: 13/05/2024
SECTION: DETALLE PRESTACIONES
[Código]|[Descripción]|[Cantidad]|[ValorTotal]|[Bonificación]|[Copago]
303030|CONSULTA MEDICA|1|40000|32000|8000
... (todas las filas) ...
SECTION_TOTAL: 8000
TOTAL_COPAGO_DECLARADO: 8000

FOLIO: 87654321
...

**MANDATOS DE EXTRACCIÓN:**
1. **EXHAUSTIVIDAD:** Extrae TODAS las líneas. Si hay 50 ítems, extrae 50 líneas.
2. **VALORES:** Usa solo números enteros. Si es $0, escribe "0".
3. **LIMPIEZA:** Elimina puntos de mil en la salida (ej: 40000, no 40.000).
4. **CONTINUIDAD:** No te detengas. Si el documento es largo, continúa hasta el final.
`;
