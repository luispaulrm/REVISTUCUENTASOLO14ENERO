import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

// ========================================
// FASE 0: CLASIFICADOR (v10.0 - Universal Architecture)
// ========================================
export { PROMPT_CLASSIFIER, SCHEMA_CLASSIFIER } from './contractConstants_classifier.js';

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
  **SECCIÓN 1: DÍA CAMA (14 filas obligatorias)**
  1. Día Cama - Clínica Alemana (Oferta Preferente)
  2. Día Cama - Clínica Universidad de los Andes (Oferta Preferente)
  3. Día Cama - Clínica San Carlos de Apoquindo (Oferta Preferente)
  4. Día Cama - Clínica Santa María (Oferta Preferente)
  5. Día Cama - Hospital Clínico UC (Oferta Preferente)
  6. Día Cama - Clínica Las Condes (Oferta Preferente)
  7. Día Cama - Clínica Indisa (Oferta Preferente)
  8. Día Cama (Libre Elección)
  
  **SECCIÓN 2: DÍA CAMA UTI/UCI (8 filas obligatorias)**
  9. Día Cama UTI/UCI - Clínica Alemana (Oferta Preferente)
  10. Día Cama UTI/UCI - Clínica Universidad de los Andes (Oferta Preferente)
  11. Día Cama UTI/UCI - Clínica San Carlos de Apoquindo (Oferta Preferente)
  12. Día Cama UTI/UCI - Clínica Santa María (Oferta Preferente)
  13. Día Cama UTI/UCI - Hospital Clínico UC (Oferta Preferente)
  14. Día Cama UTI/UCI - Clínica Las Condes (Oferta Preferente)
  15. Día Cama UTI/UCI - Clínica Indisa (Oferta Preferente)
  16. Día Cama UTI/UCI (Libre Elección)
  
  **SECCIÓN 3: DERECHO PABELLÓN (8 filas obligatorias)**
  17. Derecho Pabellón - Clínica Alemana (Oferta Preferente)
  18. Derecho Pabellón - Clínica Universidad de los Andes (Oferta Preferente)
  19. Derecho Pabellón - Clínica San Carlos de Apoquindo (Oferta Preferente)
  20. Derecho Pabellón - Clínica Santa María (Oferta Preferente)
  21. Derecho Pabellón - Hospital Clínico UC (Oferta Preferente)
  22. Derecho Pabellón - Clínica Las Condes (Oferta Preferente)
  23. Derecho Pabellón - Clínica Indisa (Oferta Preferente)
  24. Derecho Pabellón (Libre Elección)
  
  **SECCIÓN 4: HONORARIOS MÉDICOS QUIRÚRGICOS (8 filas obligatorias)**
  25. Honorarios Médicos Quirúrgicos - Clínica Alemana (Oferta Preferente)
  26. Honorarios Médicos Quirúrgicos - Clínica Universidad de los Andes (Oferta Preferente)
  27. Honorarios Médicos Quirúrgicos - Clínica San Carlos de Apoquindo (Oferta Preferente)
  28. Honorarios Médicos Quirúrgicos - Clínica Santa María (Oferta Preferente)
  29. Honorarios Médicos Quirúrgicos - Hospital Clínico UC (Oferta Preferente)
  30. Honorarios Médicos Quirúrgicos - Clínica Las Condes (Oferta Preferente)
  31. Honorarios Médicos Quirúrgicos - Clínica Indisa (Oferta Preferente)
  32. Honorarios Médicos Quirúrgicos (Libre Elección)
  
  **SECCIÓN 5: MEDICAMENTOS (8 filas obligatorias)**
  33. Medicamentos - Clínica Alemana (Oferta Preferente)
  34. Medicamentos - Clínica Universidad de los Andes (Oferta Preferente)
  35. Medicamentos - Clínica San Carlos de Apoquindo (Oferta Preferente)
  36. Medicamentos - Clínica Santa María (Oferta Preferente)
  37. Medicamentos - Hospital Clínico UC (Oferta Preferente)
  38. Medicamentos - Clínica Las Condes (Oferta Preferente)
  39. Medicamentos - Clínica Indisa (Oferta Preferente)
  40. Medicamentos (Libre Elección)
  
  **SECCIÓN 6: MATERIALES E INSUMOS (8 filas obligatorias)**
  41. Materiales e Insumos Clínicos - Clínica Alemana (Oferta Preferente)
  42. Materiales e Insumos Clínicos - Clínica Universidad de los Andes (Oferta Preferente)
  43. Materiales e Insumos Clínicos - Clínica San Carlos de Apoquindo (Oferta Preferente)
  44. Materiales e Insumos Clínicos - Clínica Santa María (Oferta Preferente)
  45. Materiales e Insumos Clínicos - Hospital Clínico UC (Oferta Preferente)
  46. Materiales e Insumos Clínicos - Clínica Las Condes (Oferta Preferente)
  47. Materiales e Insumos Clínicos - Clínica Indisa (Oferta Preferente)
  48. Materiales e Insumos Clínicos (Libre Elección)
  
  **SECCIÓN 7: ANESTESIA (8 filas obligatorias)**
  49. Anestesia - Clínica Alemana (Oferta Preferente)
  50. Anestesia - Clínica Universidad de los Andes (Oferta Preferente)
  51. Anestesia - Clínica San Carlos de Apoquindo (Oferta Preferente)
  52. Anestesia - Clínica Santa María (Oferta Preferente)
  53. Anestesia - Hospital Clínico UC (Oferta Preferente)
  54. Anestesia - Clínica Las Condes (Oferta Preferente)
  55. Anestesia - Clínica Indisa (Oferta Preferente)
  56. Anestesia (Libre Elección)
`;

const CHECKLIST_AMB = `
  **SECCIÓN 1: CONSULTAS (4 filas)**
  1. Consulta Médica General (Oferta Preferente)
  2. Consulta Médica General (Libre Elección)
  3. Consulta Pediatría (Oferta Preferente)
  4. Consulta Pediatría (Libre Elección)
  
  **SECCIÓN 2: LABORATORIO (14 filas)**
  5. Exámenes de Laboratorio (Oferta Preferente)
  6. Exámenes de Laboratorio (Libre Elección)
  7. Hemograma (Oferta Preferente)
  8. Hemograma (Libre Elección)
  9. Perfil Bioquímico (Oferta Preferente)
  10. Perfil Bioquímico (Libre Elección)
  11. Orina Completa (Oferta Preferente)
  12. Orina Completa (Libre Elección)
  13. Cultivos (Oferta Preferente)
  14. Cultivos (Libre Elección)
  15. Glucosa en Sangre (Oferta Preferente)
  16. Glucosa en Sangre (Libre Elección)
  17. Perfil Lipídico (Oferta Preferente)
  18. Perfil Lipídico (Libre Elección)
  
  **SECCIÓN 3: IMAGENOLOGÍA (16 filas)**
  19. Imagenología (Oferta Preferente)
  20. Imagenología (Libre Elección)
  21. Rayos X (Oferta Preferente)
  22. Rayos X (Libre Elección)
  23. Ecotomografía (Oferta Preferente)
  24. Ecotomografía (Libre Elección)
  25. TAC/Scanner (Oferta Preferente)
  26. TAC/Scanner (Libre Elección)
  27. Resonancia Magnética (Oferta Preferente)
  28. Resonancia Magnética (Libre Elección)
  29. Mamografía (Oferta Preferente)
  30. Mamografía (Libre Elección)
  31. Densitometría Ósea (Oferta Preferente)
  32. Densitometría Ósea (Libre Elección)
  33. Ecografía Doppler (Oferta Preferente)
  34. Ecografía Doppler (Libre Elección)
  
  **SECCIÓN 4: PROCEDIMIENTOS (12 filas)**
  35. Procedimientos Diagnósticos (Oferta Preferente)
  36. Procedimientos Diagnósticos (Libre Elección)
  37. Procedimientos Terapéuticos (Oferta Preferente)
  38. Procedimientos Terapéuticos (Libre Elección)
  39. Endoscopía Digestiva (Oferta Preferente)
  40. Endoscopía Digestiva (Libre Elección)
  41. Colonoscopía (Oferta Preferente)
  42. Colonoscopía (Libre Elección)
  43. Biopsia (Oferta Preferente)
  44. Biopsia (Libre Elección)
  45. Electrocardiograma (Oferta Preferente)
  46. Electrocardiograma (Libre Elección)
  
  **SECCIÓN 5: TERAPIAS (8 filas)**
  47. Kinesiología (Oferta Preferente)
  48. Kinesiología (Libre Elección)
  49. Fonoaudiología (Oferta Preferente)
  50. Fonoaudiología (Libre Elección)
  51. Terapia Ocupacional (Oferta Preferente)
  52. Terapia Ocupacional (Libre Elección)
  53. Nutricionista (Oferta Preferente)
  54. Nutricionista (Libre Elección)
  
  **SECCIÓN 6: URGENCIAS (4 filas)**
  55. Urgencia Simple Adulto (Oferta Preferente)
  56. Urgencia Simple Adulto (Libre Elección)
  57. Urgencia Compleja Adulto (Oferta Preferente)
  58. Urgencia Compleja Adulto (Libre Elección)
  
  **SECCIÓN 7: SALUD MENTAL (4 filas)**
  59. Consulta Psiquiatría (Oferta Preferente)
  60. Consulta Psiquiatría (Libre Elección)
  61. Consulta Psicología (Oferta Preferente)
  62. Consulta Psicología (Libre Elección)
  
  **SECCIÓN 8: DENTAL (4 filas)**
  63. PAD Dental (Oferta Preferente)
  64. PAD Dental (Libre Elección)
  65. Tratamiento Dental General (Oferta Preferente)
  66. Tratamiento Dental General (Libre Elección)
  
  **SECCIÓN 9: ÓPTICA Y PRÓTESIS (4 filas)**
  67. Lentes Ópticos (Libre Elección)
  68. Lentes de Contacto (Libre Elección)
  69. Audífonos (Libre Elección)
  70. Prótesis y Órtesis (Libre Elección)
`;

// --- PHASE 3: MODULAR MICRO-PROMPTS (v10.0) ---

const SHARED_MANDATE = `
  ** MANDATO FORENSE v12.0: LECTURA GEOMÉTRICA DE TABLAS (ANTI-HERENCIA VERTICAL) **
  OBJETIVO: Extraer datos de tablas respetando la posición exacta de cada celda.
  
  ⚠️ FASE 1: IDENTIFICACIÓN DE COLUMNAS
  Antes de extraer datos, identifica la estructura de columnas:
  1. **Columna 1:** Nombre de la prestación (izquierda extrema).
  2. **Columna 2 (OFERTA PREFERENTE):** 
     - Sub-columna 2A: "% Bonificación"
     - Sub-columna 2B: "Tope máx. año contrato por beneficiario"
  3. **Columna 3 (LIBRE ELECCIÓN):**
     - Sub-columna 3A: "% Bonificación"
     - Sub-columna 3B: "Tope máx. año contrato por beneficiario"
  
  ⚠️ FASE 2: EXTRACCIÓN FILA POR FILA (REGLA ANTI-HERENCIA)
  Para CADA fila de prestación:
  1. Lee el NOMBRE de la prestación (columna 1).
  2. Lee la BONIFICACIÓN PREFERENTE (columna 2A, directamente bajo ese encabezado).
  3. Lee el TOPE PREFERENTE (columna 2B, directamente bajo ese encabezado).
     - **CRÍTICO:** Si la celda está VACÍA, tiene "—" o "---", reporta "-" literalmente.
     - **PROHIBIDO:** NO copies el valor de la fila superior (ej: si "Día Cama" tiene "Sin Tope", NO lo uses para "Medicamentos").
  4. Lee la BONIFICACIÓN LIBRE ELECCIÓN (columna 3A).
  5. Lee el TOPE LIBRE ELECCIÓN (columna 3B).
  
  ⚠️ REGLA DE ORO DE EXTRACCIÓN (ANTI-HERENCIA VERTICAL):
  - **CADA CELDA ES INDEPENDIENTE:** No heredes valores de celdas superiores ni inferiores.
  - **LEE SOLO LO QUE ESTÁ EN LA CELDA:** Si una celda de "Medicamentos" está vacía, reporta "-", incluso si la celda de "Día Cama" (arriba) tiene "Sin Tope".
  - **VALIDACIÓN VISUAL:** Imagina que estás apuntando con un puntero láser a la celda específica. ¿Qué texto ves en ESA celda exacta? Ese es el valor.
  
  ⚠️ CASOS ESPECIALES:
  - Si ves "100% Sin Tope" en una celda combinada (merged cell), ese valor aplica SOLO a las prestaciones listadas en esa celda.
  - Si "Medicamentos" o "Insumos" tienen celda vacía en Preferente, significa que NO tienen cobertura preferente (reporta "-").
  - "Sin Tope" solo debe reportarse si está ESCRITO EXPLÍCITAMENTE en la celda de esa prestación.
  
  ⚠️ PROTOCOLO DE CONFLICTO: 
  Si ves "100% SIN TOPE" en la primera columna y "300 UF" en la tercera:
  -> COBERTURA REAL = "100% SIN TOPE".
  -> NOTA RESTRICCIÓN = "Tope Internacional: 300 UF".
  Si ves "---" o vacío en la primera columna:
  -> COBERTURA REAL = "-".
  Si ves "Sin Tope" en la fila de arriba pero la celda actual está vacía:
  -> COBERTURA REAL = "-" (NO HEREDAR).
`;

export const PROMPT_HOSP_P1 = `
  ${SHARED_MANDATE}
  **SEGMENTO ASIGNADO: DÍA CAMA, UTI Y PABELLÓN**
  
  Extrae exactamente las filas 1 a 24 del checklist Hospitalario:
  1-8: Día Cama (7 clínicas + LE)
  9-16: UTI/UCI (7 clínicas + LE)
  17-24: Pabellón (7 clínicas + LE)
  
  ⚠️ RESTRICCIÓN: Solo procesa estos 24 ítems.
  ${CHECKLIST_HOSP.substring(CHECKLIST_HOSP.indexOf("**SECCIÓN 1"), CHECKLIST_HOSP.indexOf("**SECCIÓN 4"))}
`;

export const PROMPT_HOSP_P2 = `
  ${SHARED_MANDATE}
  **SEGMENTO ASIGNADO: HONORARIOS, MEDICAMENTOS, INSUMOS Y ANESTESIA**
  
  Extrae exactamente las filas 25 a 56 del checklist Hospitalario:
  25-32: Honorarios Médicos Quirúrgicos
  33-40: Medicamentos
  41-48: Materiales e Insumos
  49-56: Anestesia
  
  ⚠️ RESTRICCIÓN: Solo procesa estos 32 ítems.
  ${CHECKLIST_HOSP.substring(CHECKLIST_HOSP.indexOf("**SECCIÓN 4"))}
`;

export const PROMPT_AMB_P1 = `
  ${SHARED_MANDATE}
  **SEGMENTO ASIGNADO: CONSULTAS Y LABORATORIO**
  
  Extrae exactamente las filas 1 a 18 del checklist Ambulatorio:
  1-4: Consultas
  5-18: Laboratorio (Hemograma, Perfil, etc.)
  
  ⚠️ RESTRICCIÓN: Solo procesa estos 18 ítems.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 1"), CHECKLIST_AMB.indexOf("**SECCIÓN 3"))}
`;

export const PROMPT_AMB_P2 = `
  ${SHARED_MANDATE}
  **SEGMENTO ASIGNADO: IMAGENOLOGÍA**
  
  Extrae exactamente las filas 19 a 34 del checklist Ambulatorio:
  Rayos X, Ecotomografía, TAC, Resonancia, Mamografía, Densitometría, Doppler.
  
  ⚠️ RESTRICCIÓN: Solo procesa estos 16 ítems.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 3"), CHECKLIST_AMB.indexOf("**SECCIÓN 4"))}
`;

export const PROMPT_AMB_P3 = `
  ${SHARED_MANDATE}
  **SEGMENTO ASIGNADO: PROCEDIMIENTOS Y TERAPIAS**
  
  Extrae exactamente las filas 35 a 54 del checklist Ambulatorio:
  Procedimientos Diagnósticos/Terapéuticos, Endoscopía, Colonoscopía, Biopsia, Electro, Kine, Fono, TO, Nutri.
  
  ⚠️ RESTRICCIÓN: Solo procesa estos 20 ítems.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 4"), CHECKLIST_AMB.indexOf("**SECCIÓN 6"))}
`;

export const PROMPT_AMB_P4 = `
  ${SHARED_MANDATE}
  **SEGMENTO ASIGNADO: URGENCIAS, SALUD MENTAL, DENTAL Y ÓPTICA**
  
  Extrae exactamente las filas 55 a 70 del checklist Ambulatorio:
  Urgencias, Psiquiatría, Psicología, PAD Dental, Lentes, Audífonos, Prótesis.
  
  ⚠️ RESTRICCIÓN: Solo procesa estos 16 ítems.
  ${CHECKLIST_AMB.substring(CHECKLIST_AMB.indexOf("**SECCIÓN 6"))}
`;

export const PROMPT_EXTRAS = `
  ** MANDATO FORENSE v10.8: PASE 4 - PRESTACIONES VALORIZADAS (ANTI-INVENCIÓN) **
  
  ⚠️ ALERTA DE SEGURIDAD (CRÍTICO):
  Prohibido resumir. Copia TEXTUALMENTE las condiciones.
  
  ⚠️ REGLA ANTI-INVENCIÓN:
  - SOLO extrae lo que veas explícitamente como una tabla o lista de "Prestaciones Valorizadas" adicional a la general.
  - Si no existe tal sección, DEVUELVE UN ARRAY VACÍO. No inventes datos.
  
  ⚠️ REGLA DE EXCLUSIÓN (ESTRICTO):
  NO EXTRAIGAS NADA QUE YA ESTÉ EN LA GRILLA GENERAL DE LAS PÁGINAS 1 Y 2.
  - No extraigas "Día Cama", "Pabellón", "Honorarios", "Medicamentos", "Insumos" o "Anestesia" generales.
  - SÓLO extrae ítems que aparezcan en la sección 'SELECCIÓN DE PRESTACIONES VALORIZADAS' (Generalmente Pág 7).
  
  OBJETIVO: Capturar la "Selección de Prestaciones Valorizadas" que SOBREESCRIBE la bonificación general.
  
  INSTRUCCIONES:
  1. **REGLA DE SUPREMACÍA**: Busca cirugías específicas (Apendicectomía, Cesárea, Parto, etc.).
      - Captura el CÓDIGO FONASA y el Valor en Pesos ('Copago').
      - Márcalos como 'SUPREMO'.
  2. **TOPES ESPECÍFICOS**: Busca topes en Pesos para Medicamentos/Insumos específicos de estas cirugías.
  
  FORMATO: JSON Strict (Schema Coberturas).
`;

export const PROMPT_ANEXOS_P1 = `
  ** MANDATO: ESCÁNER DE ANEXOS (PARTE 1) v11.2 **
  
  ROL: Transcriptor legal de anexos.
  OBJETIVO: Capturar la PRIMERA MITAD de los anexos y secciones post-cobertura.
  
  ⚠️ INSTRUCCIONES:
  1. Identifica el inicio de los Anexos (Anexo 1, Apéndice A, etc.).
  2. Transcribe íntegramente las primeras 5-10 reglas/cláusulas encontradas.
  3. Usa el prefijo "ANEXO" en 'CÓDIGO/SECCIÓN'.
  4. NO resumas. Copia PÁRRAFO POR PÁRRAFO.
  
  FORMATO: JSON Strict (Schema Reglas Universal).
`;

export const PROMPT_ANEXOS_P2 = `
  ** MANDATO: ESCÁNER DE ANEXOS (PARTE 2) v11.2 **
  
  ROL: Transcriptor legal de anexos.
  OBJETIVO: Capturar la SEGUNDA MITAD de los anexos hasta el FINAL del documento.
  
  ⚠️ INSTRUCCIONES:
  1. Busca desde la mitad de los anexos hasta la ÚLTIMA PÁGINA.
  2. Transcribe íntegramente todas las cláusulas restantes hasta el fin del PDF.
  3. Usa el prefijo "ANEXO" en 'CÓDIGO/SECCIÓN'.
  4. MÁXIMA PRIORIDAD: Llegar hasta el final absoluto del documento.
  
  FORMATO: JSON Strict (Schema Reglas Universal).
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
          'CÓDIGO/SECCIÓN': { type: SchemaType.STRING }, // Mantener compatible
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
    // Metrics structure remains
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
          'modalidad': { type: SchemaType.STRING, enum: ["Libre Elección", "Oferta Preferente", "Bonificación"] },
          'cobertura': { type: SchemaType.STRING },
          'tope': { type: SchemaType.STRING },
          'copago': { type: SchemaType.STRING },
          'nota_restriccion': { type: SchemaType.STRING, nullable: true },

          // Campos v8.0/8.4
          'CÓDIGO_DISPARADOR_FONASA': { type: SchemaType.STRING, description: "Códigos FONASA asociados (ej: 0305xxx)" },
          'LOGICA_DE_CALCULO': { type: SchemaType.STRING, description: "Ej: % de cobertura sobre el arancel" },
          'NIVEL_PRIORIDAD': {
            type: SchemaType.STRING,
            enum: ["GENERAL", "SUPREMO"],
            description: "'GENERAL' para tablas pág 1, 'SUPREMO' para prestaciones valorizadas pág 7."
          }
        },
        required: ['categoria', 'item', 'modalidad', 'cobertura']
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
};


// Configuration constants
export const CONTRACT_OCR_MAX_PAGES = 100; // Increased to ensure we reach the absolute end
// NOTE: User explicitly requested 8192 tokens per phase. We use a larger buffer for the engine.
export const CONTRACT_MAX_OUTPUT_TOKENS = 32000; // Doubled to allow massive verbatim transcription
export const CONTRACT_TEMPERATURE = GENERATION_CONFIG.temperature;
export const CONTRACT_TOP_P = GENERATION_CONFIG.topP;
export const CONTRACT_TOP_K = GENERATION_CONFIG.topK;

export const CONTRACT_FAST_MODEL = AI_MODELS.reasoner; // Primary: Gemini 3 Pro (High Intellect)
export const CONTRACT_REASONING_MODEL = AI_MODELS.primary; // Secondary: Gemini 3 Flash (Speed/Reasoning)
export const CONTRACT_FALLBACK_MODEL = AI_MODELS.fallback; // Fallback: Gemini 2.5 Flash (Legacy Reliability)

export const CONTRACT_DEFAULT_RETRIES = 3;
