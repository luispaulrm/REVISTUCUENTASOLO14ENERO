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
**INSTRUCCIÓN CRÍTICA: ANÁLISIS Y CONSOLIDACIÓN DE PROGRAMAS DE ATENCIÓN MÉDICA (PAM)**

Tu misión es extraer y consolidar la información de los PAM (Programas de Atención Médica / Bonos). 

**REGLA DE CONSOLIDACIÓN (EXTREMADAMENTE IMPORTANTE):**
Es común que un mismo **Folio PAM** esté subdividido en varias hojas o secciones independientes. 
- Si encuentras el mismo número de Folio más de una vez, **DEBES CONSOLIDARLO** en un único objeto JSON.
- Suma todos los items de ese folio aunque aparezcan en imágenes/páginas distintas.
- Identifica cada Prestador dentro de ese folio y agrégalos al array \`desglosePorPrestador\`.

**REGLA DE EXHAUSTIVIDAD (CRÍTICA):**
- Debes extraer **TODOS** los ítems listados en el documento, **INCLUSO SI EL COPAGO ES $0 O LA BONIFICACIÓN ES $0**.
- **PROHIBIDO OMITIR ÍTEMS.** Si aparece en la lista, debe estar en el JSON.
- A veces los ítems con Copago 0 son fundamentales para el historial clínico (ej. exámenes, días cama), por lo que es obligatorio incluirlos.

**REGLA DE AISLAMIENTO:** Solo extrae datos de "Folio PAM" o "Bono". Ignora la Cuenta Paciente Definitiva.

**PROCESO DE EXTRACCIÓN:**

1.  **METADATA:** Extrae el "Folio PAM", "Prestador Principal" y "Período de Cobro".
2.  **DESGLOSE:** Por cada prestador en el folio, llena el array \`items\` con: \`codigoGC\`, \`descripcion\`, \`cantidad\`, \`valorTotal\`, \`bonificacion\`, \`copago\`.
3.  **RESUMEN Y TOTALES:** 
    *   **totalCopagoDeclarado:** Busca etiquetas como "Copago Prestador", "Copago en Prestado" o "Total a Pagar". 
    *   **SI EL FOLIO ESTÁ SUBDIVIDIDO:** Debes identificar todos los sub-totales de copago impresos para ese folio y **SUMARLOS** para obtener el \`totalCopagoDeclarado\` final del objeto folio. 
    *   Ejemplo: Si la pág 1 dice "Copago Prestador: 366.604" y la pág 2 dice "Copago en Prestado 73.465", el \`totalCopagoDeclarado\` debe ser la suma de ambos (440.069).

**SALIDA JSON:** Responde SOLO con el array JSON válido. Sin texto explicativo ni bloques markdown.
`;

// ============================================================================
// MULTI-PASS ARCHITECTURE (GEMINI 3 FLASH OPTIMIZATION)
// ============================================================================

export const PAM_DISCOVERY_SCHEMA = {
   type: SchemaType.OBJECT,
   description: 'Lista de los folios únicos encontrados.',
   properties: {
      folios: {
         type: SchemaType.ARRAY,
         description: 'Lista de números de folio detectados.',
         items: {
            type: SchemaType.OBJECT,
            properties: {
               folioPAM: { type: SchemaType.STRING, description: 'El número de folio completo.' },
               prestador: { type: SchemaType.STRING, description: 'Nombre del prestador principal asociado.' }
            },
            required: ['folioPAM']
         }
      }
   },
   required: ['folios']
};

export const PAM_DISCOVERY_PROMPT = `
   ** FASE 1: RADAR DE FOLIOS(DISCOVERY) **

      Tu única misión es leer todo el documento e identificar ** CADA NÚMERO DE FOLIO PAM ** (o Bono) único que encuentres.
   
   - Ignora los ítems, ignora los montos.
   - Solo busca los identificadores de Folio / Bono.
   - Si un folio aparece en múltiples páginas, ** solo lístalo una vez **.
   
   Responde EXACTAMENTE con el JSON de folios encontrados.
`;

export const PAM_DETAILS_PROMPT = `
   ** FASE 2: EXTRACCIÓN QUIRÚRGICA(DETAILS) **

      OBJETIVO: Extraer el desglose completo y detallado PARA UN SOLO FOLIO ESPECÍFICO.
   
   👉 ** FOLIO TARGET **: "{{TARGET_FOLIO}}"

INSTRUCCIONES:
1.  Busca en TODO el documento las secciones que pertenezcan EXCLUSIVAMENTE al Folio "{{TARGET_FOLIO}}".
   2.  Ignora cualquier otro folio o bono que no coincida.
   3.  Extrae TODOS los ítems de ese folio(Prestaciones, Insumos, Medicamentos, etc.).
   4.  Si el folio está dividido en varias páginas, ** CONSOLIDA ** toda la información en un solo reporte.
   5.  Captura los totales declarados(copago, bonificación) que aparezcan impresos para este folio.

   IMPORTANTE:
- Exhaustividad total: No omitas ítems con valor $0.
   - Precisión: Copia los códigos y descripciones tal como aparecen.
   
   Responde con el JSON detallado para este folio.
`;
