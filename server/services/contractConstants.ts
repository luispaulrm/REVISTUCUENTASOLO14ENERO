import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

// ========================================
// FASE 0: CLASIFICADOR (v10.0 - Universal Architecture)
// ========================================
export { PROMPT_CLASSIFIER, SCHEMA_CLASSIFIER } from './contractConstants_classifier.js';

// ========================================
// SCHEMA & PROMPT FOR ACCOUNT/BILL PROJECTION (Módulo 7)
// ========================================

export const SCHEMA_CUENTA_JSON = {
  type: SchemaType.OBJECT,
  properties: {
    paciente: {
      type: SchemaType.OBJECT,
      properties: {
        nombre: { type: SchemaType.STRING },
        rut: { type: SchemaType.STRING },
        folio: { type: SchemaType.STRING },
        total_cuenta: { type: SchemaType.NUMBER }
      }
    },
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          seccion: { type: SchemaType.STRING, description: "Literal uppercase section header, e.g. '3101 MEDICAMENTOS'" },
          codigo: { type: SchemaType.STRING, nullable: true },
          descripcion: { type: SchemaType.STRING },
          cantidad: { type: SchemaType.NUMBER, nullable: true },
          precioUnitario: { type: SchemaType.NUMBER, nullable: true },
          total: { type: SchemaType.NUMBER },
          index: { type: SchemaType.NUMBER, description: "Sequential line number from the original document" }
        },
        required: ['descripcion', 'total']
      }
    }
  },
  required: ['items']
} as any;

export const PROMPT_CUENTA_JSON = `
  ACT AS A HIGH-FIDELITY MEDICAL BILL PROJECTOR (JSON MODE).

  GOAL:
  Extract every single line item from the clinical bill (Cuenta Médica) into structured JSON.
  
  CRITICAL INSTRUCTIONS:
  1. **FIDELITY**: Capture every item, even if it seems low value.
  2. **SECTIONS**: Maintain the visual grouping. If items are under a header like "3104 INSUMOS", every item in that block must have "seccion": "3104 INSUMOS".
  3. **NUMBERS**: Ensure 'total' is a number (remove dots/commas if needed, e.g. "1.250" -> 1250).
  4. **TRACEABILITY**: Set 'index' to the 1-based line number of the item in the document.
  5. **NO SUMMARIES**: If a list has 200 items, you must output 200 items. DO NOT use ellipsis.
  
  OUTPUT FORMAT: JSON Strict according to the provided schema.
`;


/**
 * PROMPT EXCLUSIVO PARA REGLAS - PARTE 1 (MANDATO FIDELIDAD QUIRÚRGICA v11.3)
 */
export const PROMPT_REGLAS_P1 = `
  ** MANDATO: ESCÁNER TEXTUAL ÍNTEGRO (PARTE 1) v11.3 **
  
  ROL: Transcriptor legal de alta precisión.
  OBJETIVO: Copiar palabra por palabra la PRIMERA MITAD de las "Notas Explicativas" o "Condiciones Generales".
  
  ⚠️ INSTRUCCIONES DE FIDELIDAD:
  1. **NUMERACIÓN EXACTA**: El campo 'CÓDIGO/SECCIÓN' debe ser IDÉNTICO al del PDF (ej: 1.1, 3.2, 5). PROHIBIDO inventar sub-índices (a, b, c) a menos que estén en el papel.
  2. **TRANSCRIPCIÓN QUIRÚRGICA**: Copia cada párrafo íntegramente. Prohibido resumir plazos (ej: "48 horas"), montos o condiciones.
  3. Si una sección es larga, cópiala completa en un solo bloque o sigue la enumeración del contrato.
  4. Enfócate en las secciones iniciales hasta la mitad de las notas.
  
  FORMATO: JSON Strict (Schema Reglas Universal).
`;

/**
 * PROMPT EXCLUSIVO PARA REGLAS - PARTE 2 (MANDATO FIDELIDAD QUIRÚRGICA v11.3)
 */
export const PROMPT_REGLAS_P2 = `
  ** MANDATO: ESCÁNER TEXTUAL ÍNTEGRO (PARTE 2) v11.3 **
  
  ROL: Transcriptor legal de alta precisión.
  OBJETIVO: Copiar la SEGUNDA MITAD de las "Notas Explicativas" hasta el final de dicha sección.
  
  ⚠️ INSTRUCCIONES DE FIDELIDAD:
  1. **NUMERACIÓN EXACTA**: Usa los códigos reales del contrato (ej: 5.8, 6.1). 
  2. **SIN TRUNCAR**: Asegúrate de capturar todas las secciones que siguen después de la 5.8.
  3. **VERBATIM**: Los números y plazos deben ser exactos. Si el contrato dice "48 horas", escribe "48 horas".
  
  FORMATO: JSON Strict (Schema Reglas Universal).
`;


const CHECKLIST_HOSP = `
  **SECCIÓN 1: DÍA CAMA**
  - Día Cama General / Diferenciado
  - Cuidados Intensivos / Coronianos (UCI)
  - Cuidados Intermedios (UTI)
  - Otros tipos de Día Cama

  **SECCIÓN 2: DERECHO PABELLÓN**
  - Derecho de Pabellón
  - Sala de Recuperación

  **SECCIÓN 3: HONORARIOS MÉDICOS QUIRÚRGICOS**
  - Honorarios Médicos Quirúrgicos
  - Visita por Médico Tratante / Interconsultor

  **SECCIÓN 4: MEDICAMENTOS E INSUMOS**
  - Medicamentos (Hospitalización)
  - Materiales e Insumos Clínicos (Hospitalización)

  **SECCIÓN 5: OTROS HOSPITALARIOS**
  - Anestesia
  - Quimioterapia / Radioterapia
  - Traslados Médicos
  - Prótesis y Ortesis

  **SECCIÓN 6: APOYO DIAGNÓSTICO (HOSPITALARIO)**
  - Exámenes de Laboratorio (Perfil, Cultivos, etc.)
  - Imagenología (Rayos, Scanner, Eco)
  - Kinesiología Motor / Respiratoria
`;

const CHECKLIST_AMB = `
  **SECCIÓN 1: CONSULTAS**
  - Consulta Médica General / Especialidad
  - Consulta Psiquiatría / Psicología

  **SECCIÓN 2: LABORATORIO Y EXÁMENES**
  - Exámenes de Laboratorio
  - Hemograma, Perfil Bioquímico, etc.

  **SECCIÓN 3: IMAGENOLOGÍA**
  - Rayos X, Ecotomografía
  - TAC / Scanner
  - Resonancia Magnética
  - Mamografía, Densitometría

  **SECCIÓN 4: PROCEDIMIENTOS Y TERAPIAS**
  - Procedimientos Diagnósticos / Terapéuticos
  - Endoscopía, Colonoscopía
  - Kinesiología, Fonoaudiología
  - Terapia Ocupacional, Nutricionista

  **SECCIÓN 5: OTROS AMBULATORIOS**
  - Urgencia Simple / Compleja
  - PAD Dental / Tratamiento Dental
  - Lentes, Audífonos
  - Prótesis y Órtesis Ambulatorias
`;

// --- PHASE 3: MODULAR MICRO-PROMPTS (v10.0) ---

const SHARED_MANDATE = `
  ** MANDATO FORENSE v18.0: PROYECTOR CARTESIANO (VISIÓN PURA) **
  OBJETIVO: Replicar la estructura geométrica de la tabla sin interpretar el contenido.

  ⚠️ REGLA DE ORO DE LA VISIÓN (ZERO-SHOT PROJECTION):
  - Tú eres un Escáner Óptico Inteligente, NO un auditor.
  - NO clasifiques (no decidas qué es Preferente o Libre Elección).
  - NO interpretes (no conviertas "UF 1.2" a 1.2).
  - NO limpies el texto. Copia lo que ves pixel por pixel (OCR Estructurado).

  ** INSTRUCCIONES DE COORDENADAS (STRICT): **
  1. Imagina una grilla sobre la imagen (Matrix Matrix).
  2. Asigna un índice de Fila (fila_index) y Columna (col_index) a cada celda visible.
  3. Si una celda ocupa varias columnas visualmente (merged), repite el texto en cada coordenada lógica o usa la primera.
  
  ⚠️ PROHIBIDO (DOCTRINA INDUSTRIAL):
  - NO inventes geometría si no ves bordes de tabla o bandas de color.
  - Si no detectas una grilla clara, usa 'tipo: texto_lineal' (Extensión pend.).
  - El uso de 'synthetic_geometry: true' será penalizado en QC Gates.
  
  ** FORMATO DE SALIDA (SCHEMA RAW_CELL): **
  Genera una lista plana de celdas "dispersas" (Sparse Matrix):
  \`\`\`json
  [
    { "tabla_id": "SECCION_1", "fila_index": 0, "col_index": 0, "texto": "Prestaciones" },
    { "tabla_id": "SECCION_1", "fila_index": 0, "col_index": 1, "texto": "Clínica Indisa (Preferente)" },
    { "tabla_id": "SECCION_1", "fila_index": 1, "col_index": 0, "texto": "Día Cama" },
    { "tabla_id": "SECCION_1", "fila_index": 1, "col_index": 1, "texto": "100% (Tope 3.0)" }
  ]
  \`\`\`
  
  ⚠️ PROHIBIDO:
  - No agrupes por "modalidad".
  - No generes objetos anidados ("topes", "unidades").
  - Tu único trabajo es digitalizar la grilla 2D.
`;

export const PROMPT_V3_JSON = `
  Eres CONTRACT_CANONIZER_V3. Tu tarea es extraer y canonizar a JSON una tabla de beneficios.

  ENTRADA:
  Te entregaré un objeto estructurado "tableModel" que contiene:
  - columns: Definición de x-ranges.
  - rows: Celdas pre-agrupadas por proximidad geométrica.
  - ruleBoxes: Cajas de reglas generales (ej: 100% Sin Tope) extraídas mediante lógica determinística.

  TU TAREA:
  1) Analizar semánticamente el contenido de las filas ("rows").
  2) Mapear cada fila a una "benefitRule".
  3) Utilizar los "ruleBoxes" para aplicar porcentajes y topes a los bloques de prestaciones correspondientes.
  4) Resolver ambigüedades: Si una "ruleBox" aplica a un bloque entero (SCOPE="BLOCK"), asociala a todas las prestaciones de ese bloque.
  5) Producir el JSON final siguiendo estrictamente el SCHEMA_V3_JSON.

  REGLA 4 (SIN TOPE):
  - Si una celda contiene exactamente "Sin Tope" (o variantes OCR: "S/Tope", "SinTope"):
    -> tope.tipo = "SIN_TOPE_EXPLICITO"
    -> tope.valor = null
    -> tope.unidad = null
    -> tope.raw = texto original
    -> tope.razon = "SIN_TOPE_EXPRESO_EN_CONTRATO"
  - Si la celda está vacía o ilegible:
    -> tope.tipo = "NO_ENCONTRADO"
    -> tope.valor = null
    -> tope.unidad = null
    -> tope.raw = null
    -> tope.razon = "CELDA_VACIA_OCR"
  - PROHIBIDO: usar unidad="DESCONOCIDO".

  REGLAS DE NEGOCIO Y MODALIDADES (CRÍTICAS):
  - OFERTA PREFERENTE: DEBES extraer la bonificación y el TOPE (por evento y anual) reportado en red.
  - LIBRE ELECCIÓN: DEBES extraer la bonificación y el TOPE (por evento y anual) fuera de red.
  - NUNCA omitas el tope de la libre elección si está especificado en la columna respectiva.
  - TOPE ANUAL: Si la tabla muestra un tope anual, extráelo como topeAnualBeneficiario.

  DETERMINISMO:
  - Usa los valores de "tableModel" tal cual. No inventes prestaciones que no estén en las filas proporcionadas.
  - Si una fila tiene celdas vacías en una modalidad, marca issue MISSING_CELL.

  SALIDA: JSON ESTRICTO.
`;

const SCHEMA_TOPE_VALUE = {
  type: SchemaType.OBJECT,
  properties: {
    tipo: { type: SchemaType.STRING, enum: ["NUMERICO", "SIN_TOPE_EXPLICITO", "NO_ENCONTRADO"] },
    valor: { type: SchemaType.NUMBER, nullable: true },
    unidad: { type: SchemaType.STRING, enum: ["UF", "VA", "CLP", "OTRA"], nullable: true },
    raw: { type: SchemaType.STRING, nullable: true },
    razon: { type: SchemaType.STRING, enum: ["SIN_TOPE_EXPRESO_EN_CONTRATO", "SIN_TOPE_INFERIDO_POR_DISENO", "CELDA_VACIA_OCR", "COLUMNA_NO_EXISTE"], nullable: true }
  }
};

export const SCHEMA_V3_JSON = {
  type: SchemaType.OBJECT,
  properties: {
    docMeta: {
      type: SchemaType.OBJECT,
      properties: {
        planType: { type: SchemaType.STRING, nullable: true },
        hasPreferredProviderMode: { type: SchemaType.BOOLEAN },
        funNumber: { type: SchemaType.STRING, nullable: true },
        rawTitle: { type: SchemaType.STRING, nullable: true }
      }
    },
    coverageBlocks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          blockId: { type: SchemaType.STRING },
          blockTitle: { type: SchemaType.STRING },
          benefitRules: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                ruleId: { type: SchemaType.STRING },
                blockId: { type: SchemaType.STRING },
                prestacionLabel: { type: SchemaType.STRING },
                modalidadPreferente: {
                  type: SchemaType.OBJECT,
                  nullable: true,
                  properties: {
                    bonificacionPct: { type: SchemaType.NUMBER, nullable: true },
                    topePrestacion: SCHEMA_TOPE_VALUE,
                    topeAnualBeneficiario: { ...SCHEMA_TOPE_VALUE, nullable: true }
                  }
                },
                modalidadLibreEleccion: {
                  type: SchemaType.OBJECT,
                  nullable: true,
                  properties: {
                    bonificacionPct: { type: SchemaType.NUMBER, nullable: true },
                    topePrestacion: SCHEMA_TOPE_VALUE,
                    topeAnualBeneficiario: { ...SCHEMA_TOPE_VALUE, nullable: true }
                  }
                },
                networkRuleIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                evidence: {
                  type: SchemaType.OBJECT,
                  properties: {
                    anchors: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                  }
                }
              },
              required: ['ruleId', 'blockId', 'prestacionLabel']
            }
          }
        },
        required: ['blockId', 'blockTitle', 'benefitRules']
      }
    },
    networkRules: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          networkRuleId: { type: SchemaType.STRING },
          blockId: { type: SchemaType.STRING, nullable: true },
          bonificacionPct: { type: SchemaType.NUMBER },
          topePrestacion: SCHEMA_TOPE_VALUE,
          redesPrestador: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          notesRaw: { type: SchemaType.STRING, nullable: true },
          evidence: {
            type: SchemaType.OBJECT,
            properties: {
              anchors: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
            }
          }
        },
        required: ['networkRuleId', 'bonificacionPct', 'redesPrestador']
      }
    },
    issues: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          code: { type: SchemaType.STRING },
          message: { type: SchemaType.STRING },
          path: { type: SchemaType.STRING, nullable: true }
        },
        required: ['code', 'message']
      }
    }
  },
  required: ['coverageBlocks', 'networkRules', 'issues']
};

export const PROMPT_MODULAR_JSON = `
  ACT AS A HIGH-FIDELITY MEDICAL CONTRACT ANALYST (MODULAR MAPPING MODE).

  GOAL:
  Extract a specific segment of the health contract into structured JSON as literal evidence.
  
  ⚠️ RULE #6: VISUAL SECTION DETECTION (CRITICAL):
  Detect visual section headers only when they look like "document headers", not item labels:
  - CHARACTERISTICS: ALL CAPS (or mostly caps), high prominence (bold/spread), often a standalone line.
  - EXAMPLES: "HOSPITALIZACIÓN", "PRESTACIONES RESTRINGIDAS", "ANEXO DE COBERTURA".
  - EMISSION: Output them as objects with tipo="seccion_visual" and seccion_raw exactly as seen.

  ⚠️ AMBITO INVARIANT:
  - The first line of the phase segment defines your current AMBITO.
  - Every item you output is restricted to that ambito by definition.
  - DO NOT mention other scopes. DO NOT infer scope from context.

   ⚠️ ESTRUCTURA DE COLUMNAS ISAPRE (ALINEACIÓN GEOMÉTRICA):
   - Columna 1: Prestación / Item (nombre del servicio).
   - Columna 2: % Bonificación PREFERENTE.
   - Columna 3: Tope PREFERENTE (por prestación/evento).
   - Columna 4: Tope Máximo Anual PREFERENTE (si existe columna separada).
   - Columna 5: % Bonificación LIBRE ELECCIÓN.
   - Columna 6: Tope LIBRE ELECCIÓN (por prestación/evento).
   - Columna 7: Tope Máximo Anual LIBRE ELECCIÓN.

   ⚠️ MANDATO DE FILA IMAGINARIA (PROPAGACIÓN):
   - Tú eres una regla física que baja por el documento.
   - Si una celda está MERGED (combinada visualmente) cubriendo varias filas, DEBES REPETIR el valor en cada fila que caiga bajo su rango.
   - Ejemplo: Si "Día Cama" y "Sala Cuna" están bajo un gran "100% Sin Tope", ambas deben devolver "porcentaje: 100" y "tope: 'SIN TOPE'".
   - NO dejes celdas vacías si visualmente pertenecen a un bloque compartido.

   ⚠️ EXTRACCIÓN DE CLÍNICAS:
   - Captura nombres de clínicas mencionadas en las celdas de bonificación preferente o títulos.
   - Agrégalas al array 'clinicas'.

   ⚠️ DETECCIÓN DE TOPES Y MODALIDADES (CRÍTICO - REGLA V11.4):
   - DEBES extraer el TOPE exacto para la modalidad PREFERENTE y para la modalidad LIBRE ELECCIÓN de la columna correspondiente.
   - Si la celda dice "Sin Tope" o "Ilimitado", extrae textualmente "Sin Tope".
   - Si la celda muestra un número con unidad (ej: "2.5 UF", "100%", "3 VAM"), extrae ese texto EXACTO (ej: "2.5 UF").
   - Es sumamente importante que inspecciones visualmente si hay topes anuales (ej: "Tope Anual 50 UF") y los asignes al campo \`tope_anual\` de la modalidad (preferente o libre_eleccion) correspondiente.
   - 🚨 CELDAS COMBINADAS DE "TOPE ANUAL": Si la columna final ("Tope máx. año contrato" o similar) muestra un gran "Sin Tope" que abarca varias filas de prestaciones hacia abajo, DEBES copiar y pegar "Sin Tope" en el \`tope_anual\` de la modalidad LIBRE_ELECCION para CADA UNA de las prestaciones cubiertas por ese bloque visual.
   - 🚨 REGLA "PREFERENTE": Si Observas "100% Sin Tope" agrupado bajo Preferente, pon "Sin Tope" TANTO en el \`tope\` COMO en el \`tope_anual\` de la modalidad \`preferente\`.
   - NO OMITAS LOS TOPES. La extracción del \`tope\` y \`tope_anual\` para "preferente" y "libre_eleccion" debe ser exhaustiva.

   ⚠️ DOCTRINA DE SILENCIO (ANTI-HALLUCINATION):
   - PROHIBIDO inventar frases de relleno como "Sin restricciones adicionales" o "Sujeto a condiciones generales".
   - Si una celda está vacía, el valor debe ser null. 
   - Si un ítem no tiene tope explícito, NO asumas "Sin Tope" a menos que lo veas explícitamente combinado.
   - Tu output debe ser una digitalización SECA del contrato.

  CHECKLIST SEGMENT TO EXTRACT:
  {{SEGMENT}}
`;

export const SCHEMA_MODULAR_JSON = {
  type: SchemaType.OBJECT,
  properties: {
    coberturas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tipo: {
            type: SchemaType.STRING,
            enum: ["prestacion", "seccion_visual", "texto_no_prestacion"],
            description: "Category of the extracted line"
          },
          seccion_raw: {
            type: SchemaType.STRING,
            description: "The literal uppercase text if tipo is 'seccion_visual', or the nearest header otherwise."
          },
          item: { type: SchemaType.STRING, description: "The name of the prestacion or text found" },
          preferente: {
            type: SchemaType.OBJECT,
            properties: {
              porcentaje: { type: SchemaType.NUMBER, nullable: true },
              tope: { type: SchemaType.STRING, nullable: true },
              clinicas: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true },
              tope_anual: { type: SchemaType.STRING, nullable: true }
            }
          },
          libre_eleccion: {
            type: SchemaType.OBJECT,
            properties: {
              porcentaje: { type: SchemaType.NUMBER, nullable: true },
              tope: { type: SchemaType.STRING, nullable: true },
              tope_anual: { type: SchemaType.STRING, nullable: true }
            }
          }
        },
        required: ['tipo', 'item']
      }
    }
  },
  required: ['coberturas']
} as any;

export const PROMPT_HOSP_P1 = `
  You are running the HOSPITALARIO phase. Every item you output is hospitalario by definition.
  ** PHASE: HOSPITALARY 1 (BASIC CARE & SURGERY) **
  Segment: Día Cama, UTI, Pabellón.
  Items: 1 - 24.
  ${CHECKLIST_HOSP.substring(CHECKLIST_HOSP.indexOf("**SECCIÓN 1"), CHECKLIST_HOSP.indexOf("**SECCIÓN 4"))}
  
  ⚠️ NO CROSS-SCOPE: Do not mention ambulatorio. Do not output items that clearly belong to other sections outside the hospitalario portion.
`;

export const PROMPT_HOSP_P2 = `
  You are running the HOSPITALARIO phase. Every item you output is hospitalario by definition.
  ** PHASE: HOSPITALARY 2 (PROFESSIONAL & SUPPLIES & SUPPORT) **
  Segment: Honorarios, Medicamentos, Insumos, Anestesia, Exámenes, Imagenología.
  Items: 25 - End of Section.
  ${CHECKLIST_HOSP.substring(CHECKLIST_HOSP.indexOf("**SECCIÓN 4"))}

  ⚠️ PHYSICAL PRESENCE RULE: 
  - If "Exámenes de Laboratorio" or "Imagenología" appear visually under the "HOSPITALARIO" section in the document, **EXTRACT THEM HERE**.
  - Do NOT skip them thinking they are "ambulatory". If they are in the hospitalary table, they belong here.
  - ** OUTPUT EVERY SINGLE LINE ** you see in this section.

  ⚠️ NO CROSS-SCOPE: Do not mention ambulatorio.
`;

export const PROMPT_AMB_P1 = `
  You are running the AMBULATORIO phase. Every item you output is ambulatorio by definition.
  ** PHASE: AMBULATORY 1 (CONSULTATIONS & LAB) **
  Segment: Consultas y Laboratorio.
  Items: 1 - 18.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 1"), CHECKLIST_AMB.indexOf("**SECCIÓN 3"))}

  ⚠️ NO CROSS-SCOPE: Do not mention hospitalario.
`;

export const PROMPT_AMB_P2 = `
  You are running the AMBULATORIO phase. Every item you output is ambulatorio by definition.
  ** PHASE: AMBULATORY 2 (IMAGING) **
  Segment: Imagenología.
  Items: 19 - 34.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 3"), CHECKLIST_AMB.indexOf("**SECCIÓN 4"))}

  ⚠️ NO CROSS-SCOPE: Do not mention hospitalario.
`;

export const PROMPT_AMB_P3 = `
  You are running the AMBULATORIO phase. Every item you output is ambulatorio by definition.
  ** PHASE: AMBULATORY 3 (PROCEDURES & THERAPIES) **
  Segment: Procedimientos y Terapias.
  Items: 35 - 54.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 4"), CHECKLIST_AMB.indexOf("**SECCIÓN 5"))}

  ⚠️ NO CROSS-SCOPE: Do not mention hospitalario.
`;

export const PROMPT_AMB_P4 = `
  You are running the AMBULATORIO phase. Every item you output is ambulatorio by definition.
  ** PHASE: AMBULATORY 4 (URGENCY & SPECIALTIES) **
  Segment: Urgencias, Salud Mental, Dental, Óptica.
  Items: 55 - 70.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 5"))}

  ⚠️ NO CROSS-SCOPE: Do not mention hospitalario.
`;

export const PROMPT_ANEXOS_P1 = `
  ** MANDATO: ESCÁNER DE ANEXOS(PARTE 1) v11.2 **

    ROL: Transcriptor legal de anexos.
      OBJETIVO: Capturar la PRIMERA MITAD de los anexos y secciones post - cobertura.
  
  ⚠️ INSTRUCCIONES:
1. Identifica el inicio de los Anexos(Anexo 1, Apéndice A, etc.).
  2. Transcribe íntegramente las primeras 5 - 10 reglas / cláusulas encontradas.
  3. Usa el prefijo "ANEXO" en 'CÓDIGO/SECCIÓN'.
  4. NO resumas.Copia PÁRRAFO POR PÁRRAFO.

  FORMATO: JSON Strict(Schema Reglas Universal).
`;

export const PROMPT_ANEXOS_P2 = `
    ** MANDATO: ESCÁNER DE ANEXOS(PARTE 2) v11.2 **

      ROL: Transcriptor legal de anexos.
        OBJETIVO: Capturar la SEGUNDA MITAD de los anexos hasta el FINAL del documento.
  
  ⚠️ INSTRUCCIONES:
1. Busca desde la mitad de los anexos hasta la ÚLTIMA PÁGINA.
  2. Transcribe íntegramente todas las cláusulas restantes hasta el fin del PDF.
  3. Usa el prefijo "ANEXO" en 'CÓDIGO/SECCIÓN'.
  4. MÁXIMA PRIORIDAD: Llegar hasta el final absoluto del documento.

  FORMATO: JSON Strict(Schema Reglas Universal).
`;

export const PROMPT_EXTRAS = `
    ** MANDATO FORENSE v10.8: PASE 4 - PRESTACIONES VALORIZADAS(ANTI - INVENCIÓN) **
  
  ⚠️ ALERTA DE SEGURIDAD(CRÍTICO):
  Prohibido resumir.Copia TEXTUALMENTE las condiciones.
  
  ⚠️ REGLA ANTI - INVENCIÓN:
- SOLO extrae lo que veas explícitamente como una tabla o lista de "Prestaciones Valorizadas" adicional a la general.
  - Si no existe tal sección, DEVUELVE UN ARRAY VACÍO.No inventes datos.
  
  ⚠️ REGLA DE EXCLUSIÓN(ESTRICTO):
  NO EXTRAIGAS NADA QUE YA ESTÉ EN LA GRILLA GENERAL DE LAS PÁGINAS 1 Y 2.
  - No extraigas "Día Cama", "Pabellón", "Honorarios", "Medicamentos", "Insumos" o "Anestesia" generales.
  - SÓLO extrae ítems que aparezcan en la sección 'SELECCIÓN DE PRESTACIONES VALORIZADAS'(Generalmente Pág 7).

  OBJETIVO: Capturar la "Selección de Prestaciones Valorizadas" que SOBREESCRIBE la bonificación general.

    INSTRUCCIONES:
1. ** REGLA DE SUPREMACÍA **: Busca cirugías específicas(Apendicectomía, Cesárea, Parto, etc.).
      - Captura el CÓDIGO FONASA y el Valor en Pesos('Copago').
      - Márcalos como 'SUPREMO'.
  2. ** TOPES ESPECÍFICOS **: Busca topes en Pesos para Medicamentos / Insumos específicos de estas cirugías.

  FORMATO: JSON Strict(Schema Coberturas Estructural).
`;

export const SCHEMA_REGLAS = {
  description: "Esquema Universal de Reglas de Auditoría v8.4",
  type: SchemaType.OBJECT,
  properties: {
    reglas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'PÁGINA ORIGEN': { type: SchemaType.STRING },
          'CÓDIGO/SECCIÓN': { type: SchemaType.STRING },
          'CÓDIGO_DISPARADOR_FONASA': {
            type: SchemaType.STRING,
            description: "Lista de códigos que activan esta regla (ej: 1802053, 403, 405)"
          },
          'SUBCATEGORÍA': { type: SchemaType.STRING },
          'VALOR EXTRACTO LITERAL DETALLADO': {
            type: SchemaType.STRING,
            description: "Copia fiel del párrafo completo. OBLIGATORIO > 50 caracteres."
          },
          'LOGICA_DE_CALCULO': {
            type: SchemaType.STRING,
            description: "Explicación técnica: ¿Es un tope por evento, por día, o porcentaje fijo?"
          }
        },
        required: ['PÁGINA ORIGEN', 'CÓDIGO/SECCIÓN', 'VALOR EXTRACTO LITERAL DETALLADO'],
      }
    },
    metrics: {
      type: SchemaType.OBJECT,
      properties: {
        tokensInput: { type: SchemaType.NUMBER },
        tokensOutput: { type: SchemaType.NUMBER },
        cost: { type: SchemaType.NUMBER }
      }
    }
  }
};


export const SCHEMA_RAW_CELLS = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      tabla_id: { type: SchemaType.STRING },
      fila_index: { type: SchemaType.NUMBER },
      col_index: { type: SchemaType.NUMBER },
      texto: { type: SchemaType.STRING },
    },
    required: ['tabla_id', 'fila_index', 'col_index', 'texto']
  }
};

export const SCHEMA_COBERTURAS = {
  type: SchemaType.OBJECT,
  properties: {
    coberturas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'categoria': { type: SchemaType.STRING },
          'item': { type: SchemaType.STRING },
          'nota_restriccion': { type: SchemaType.STRING, nullable: true },

          // NUEVA ESTRUCTURA PROFUNDA (v14.0)
          'modalidades': {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                'tipo': {
                  type: SchemaType.STRING,
                  enum: ["PREFERENTE", "LIBRE_ELECCION", "BONIFICACION"]
                },
                'porcentaje': { type: SchemaType.NUMBER, nullable: true },
                'tope': { type: SchemaType.STRING, nullable: true },
                'unidadTope': {
                  type: SchemaType.STRING,
                  enum: ["UF", "AC2", "VAM", "PESOS", "SIN_TOPE", "DESCONOCIDO"]
                },
                'tipoTope': {
                  type: SchemaType.STRING,
                  enum: ["POR_EVENTO", "ANUAL", "ILIMITADO", "DIARIO"]
                },
                // V2 SCHEMA (Strict Join)
                'tope_nested': {
                  type: SchemaType.OBJECT,
                  properties: {
                    'unidad': { type: SchemaType.STRING },
                    'valor': { type: SchemaType.NUMBER }
                  },
                  nullable: true
                },
                'copago': { type: SchemaType.STRING, nullable: true },
                // --- EXPLORATION DOCTRINE EVIDENCE ---
                'evidencia_literal': { type: SchemaType.STRING, description: "Literal text from cell/row" },
                'incertidumbre': { type: SchemaType.STRING, description: "Reason for uncertainty if any (e.g. 'valor legible pero unidad ambigua')" },
                'fuente_geometria': { type: SchemaType.STRING, description: "If provided via Cartesian flow, the cell ID" },
                'origen_extraccion': {
                  type: SchemaType.STRING,
                  enum: ["VISUAL_MODULAR", "OCR_DETERMINISTICO", "TEXTO_FALLBACK", "IMAGEN_FALLBACK"],
                  description: "Forensic source hierarchy"
                }
              },
              required: ['tipo', 'unidadTope', 'tipoTope']
            }
          },

          'CÓDIGO_DISPARADOR_FONASA': { type: SchemaType.STRING, description: "Códigos FONASA asociados (ej: 0305xxx)" },
          'NIVEL_PRIORIDAD': {
            type: SchemaType.STRING,
            enum: ["GENERAL", "SUPREMO"],
            description: "'GENERAL' para tablas pág 1, 'SUPREMO' para prestaciones valorizadas pág 7."
          }
        },
        required: ['categoria', 'item', 'modalidades']
      }
    },
    diseno_ux: {
      type: SchemaType.OBJECT,
      properties: {
        nombre_isapre: { type: SchemaType.STRING },
        titulo_plan: { type: SchemaType.STRING },
        subtitulo_plan: { type: SchemaType.STRING },
        layout: { type: SchemaType.STRING },
        funcionalidad: { type: SchemaType.STRING },
        salida_json: { type: SchemaType.STRING },
      },
      required: ['nombre_isapre', 'titulo_plan', 'layout', 'funcionalidad', 'salida_json'],
    }
  },
  required: ['coberturas', 'diseno_ux']
} as any;

export const SCHEMA_PROYECCION_JSON = {
  type: SchemaType.OBJECT,

  properties: {
    plan_info: {
      type: SchemaType.OBJECT,
      properties: {
        isapre: { type: SchemaType.STRING },
        nombre_plan: { type: SchemaType.STRING },
        codigo_plan: { type: SchemaType.STRING },
        tipo_plan: { type: SchemaType.STRING }
      },
      required: ['isapre', 'nombre_plan']
    },
    coberturas_nacionales: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          seccion: { type: SchemaType.STRING },
          ambito: {
            type: SchemaType.STRING,
            enum: ["HOSPITALARIO", "AMBULATORIO"],
            description: "Determine if this item is Inpatient (HOSPITALARIO) or Outpatient (AMBULATORIO)"
          },
          item: { type: SchemaType.STRING },
          preferente: {
            type: SchemaType.OBJECT,
            properties: {
              porcentaje: { type: SchemaType.NUMBER, nullable: true },
              tope: { type: SchemaType.STRING, nullable: true },
              clinicas: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
            }
          },
          libre_eleccion: {
            type: SchemaType.OBJECT,
            properties: {
              porcentaje: { type: SchemaType.NUMBER, nullable: true },
              tope: { type: SchemaType.STRING, nullable: true }
            }
          },
          tope_anual_uf: { type: SchemaType.STRING, nullable: true }
        },
        required: ['seccion', 'ambito', 'item']
      }
    },
    coberturas_internacionales: {
      type: SchemaType.OBJECT,
      properties: {
        existe: { type: SchemaType.BOOLEAN },
        descripcion: { type: SchemaType.STRING, nullable: true },
        porcentaje: { type: SchemaType.NUMBER, nullable: true },
        tope: { type: SchemaType.STRING, nullable: true }
      },
      required: ['existe']
    },
    notas_explicativas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          numero: { type: SchemaType.STRING },
          texto: { type: SchemaType.STRING }
        },
        required: ['numero', 'texto']
      }
    }
  },
  required: ['plan_info', 'coberturas_nacionales', 'coberturas_internacionales']
} as any;


export const PROMPT_PROYECCION_JSON = `
  ACT AS A HIGH - FIDELITY MEDICAL CONTRACT ANALYST(JSON MAPPING MODE).

  GOAL:
  Extract a structured JSON representation of the provided health contract.
  
  {{FEW_SHOT_EXAMPLES}}

  CRITICAL INSTRUCTIONS:
1. ** COLUMN ALIGNMENT(CRITICAL) **:
- Most Isapre contracts have 5 - 7 columns.
     - Column 1: Prestación / Item.
     - Column 2: % Bonificación.
     - Column 3 & 4: National Topes(usually 1.2x Arancel or UF values like 4.5 UF).
     - Column 5 & 6: International Coverages(USA / Mundo).
     - ** NEVER ** move a value from the National columns(Topes) to the International columns.
     - If a value like "300 UF" or "100 UF" is in the middle of the table, it is a NATIONAL TOPE.
  2. ** TOPES EXTRACTION **:
- Capture even complex strings like "1.2 veces AC2 + 0.5 UF".
     - If there are multiple topes for one item(e.g., Daily and Yearly), combine them in the 'tope' string or choose the most restrictive.
     - Use "SIN TOPE" if explicit.Use null only if absolutely blank.
  3. ** INTERNATIONAL COVERAGE **:
- Separate it completely.If there is no explicit International column data, 'existe' must be false.
  4. ** FIDELITY & DOUBLE VERIFICATION(CRITICAL) **:
     - ** STEP 1: EXTRACTION **: Extract the data as seen.
     - ** STEP 2: VERIFICATION **: Double check the extracted 'tope' against the source image.Ensure it matches exactly.
     - ** STEP 3: OUTPUT **: If verified, provide the output.
     - Do not summarize.Transcribe every digit and symbol.

   5. ** EXCLUSIONS & READING COMPREHENSION (STRICT) **:
     - ** LOOK AT THE CELLS, NOT JUST THE LABELS **.
     - Even if the label says "(Oferta Preferente)", if the specific cell for a provider (e.g., Clínica Alemana, Las Condes) says "Sin Cobertura", "Excluido", "-", "No Bonifica", or is blank where others have numbers, IT IS EXCLUDED.
     - ** SPECIFIC CHECK **: For "Clínica Alemana", "Clínica Las Condes", "Clínica Nieves" (and similar premium providers), CHECK EXPLICITLY if they have a % or if they are excluded in the table. 
     - IF EXCLUDED: Set percentage to 0 or null, and explicitly note "EXCLUIDO" in the tope or description if possible. DO NOT default to 100%.


   6. ** VISUAL SECTION & HIERARCHY DETECTION (UPPERCASE/BOLD RULES) **:
     - ** SECTION HEADERS ("CATEGORIA") **: Look for lines that are fully UPPERCASE or BOLD. These define the "seccion" or "categoria".
     - Examples: "PRESTACIONES HOSPITALARIAS", "PRESTACIONES RESTRINGIDAS", "ANEXO DE COBERTURA".
     - ** SUB-ITEMS **: Indented lines or normal case text below a header belong to that section.
     - ** ALWAYS ** use the exact UPPERCASE text as the 'seccion' or 'categoria' field in the JSON. Do not normalize or lower-case it. This determines the visual grouping in the UI.

    7. ** AMBITO DETECTION (HOSPITALARIO vs AMBULATORIO) **:
      - For EACH item, determine if it belongs to the HOSPITALARIO or AMBULATORIO scope.
      - ** HOSPITALARIO **: Inpatient services.
      - ** AMBULATORIO **: Outpatient services.
      - ** UNDETERMINED **: If the document is purely a list of prices or codes without a header context, use "UNDETERMINED".
      
    8. ** ANTI-FILLER MANDATE **:
      - NEVER use placeholder text like "Standard conditions apply".
      - If data is missing, use null or leave empty.

  OUTPUT FORMAT: JSON Strict according to the provided schema.
`;




// Configuration constants
export const CONTRACT_OCR_MAX_PAGES = 100; // Increased to ensure we reach the absolute end
// NOTE: User explicitly requested 8192 tokens per phase. We use a larger buffer for the engine.
export const CONTRACT_MAX_OUTPUT_TOKENS = 32000; // Doubled to allow massive verbatim transcription
export const CONTRACT_TEMPERATURE = GENERATION_CONFIG.temperature;
export const CONTRACT_TOP_P = GENERATION_CONFIG.topP;
export const CONTRACT_TOP_K = GENERATION_CONFIG.topK;


export const CONTRACT_FAST_MODEL = AI_MODELS.primary; // Primary: Gemini 3 Flash (Speed/Reasoning)
export const CONTRACT_REASONING_MODEL = AI_MODELS.fallback; // Secondary: Gemini 2.5 Flash (Reliability)
export const CONTRACT_FALLBACK_MODEL = AI_MODELS.reasoner; // Last Resort: Gemini 3 Pro (High Intellect but expensive)

export const CONTRACT_DEFAULT_RETRIES = 3;
