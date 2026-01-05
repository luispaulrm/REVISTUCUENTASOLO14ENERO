import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

/**
 * PROMPT EXCLUSIVO PARA PASE 1: ESCÁNER LEGAL
 * Objetivo: Transcripción íntegra de notas al pie y definiciones.
 */
export const PROMPT_REGLAS_SOLO_PASE_1 = `
  ** MANDATO: ESCÁNER TEXTUAL ÍNTEGRO v9.0 **

  ROL: Transcriptor Legal Forense de Alta Precisión.
  OBJETIVO: Copiar PALABRA POR PALABRA cada punto de las "Notas Explicativas" y "Definiciones".

  ⚠️ INSTRUCCIONES DE NAVEGACIÓN VISUAL (ESTRICTO):
  1. **IGNORA LA PÁGINA 1 Y 2**: Salta las tablas de beneficios, porcentajes y topes.
  2. **ANCLA DE INICIO**: Tu trabajo comienza donde dice "1. COBERTURAS" (Sección de Notas Explicativas).
  3. **FOCALIZACIÓN**: Solo extrae texto plano denso. Ignora gráficos decorativos.

  ⚠️ REGLAS DE TRANSCRIPCIÓN (CERO RESUMEN):
  1. **TRANSCRIPCIÓN ÍNTEGRA**: El campo 'VALOR EXTRACTO LITERAL DETALLADO' debe ser un COPY-PASTE exacto del párrafo. 
  2. **PROHIBIDO**: No uses elipsis (...), no resumas y no uses la frase "según indica el plan".
  3. **ATOMICIDAD**: Si la Nota 1.1 tiene 3 párrafos, genera 3 objetos JSON independientes.
  4. **LISTAS TÉCNICAS**: Copia íntegramente listas de exclusión (ej: pañales, kit de aseo) y códigos Fonasa (ej: 1802053).

  NO analices. NO calcules. SOLO TRANSURIBE EL TEXTO VISIBLE.
  
  FORMATO: JSON Strict.
`;

export const SCHEMA_REGLAS_SOLO_PASE_1 = {
  type: SchemaType.OBJECT,
  properties: {
    reglas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'PÁGINA ORIGEN': { type: SchemaType.STRING },
          'CÓDIGO/SECCIÓN': { type: SchemaType.STRING, description: "Ej: Nota 1.1, Nota 5.3" },
          'VALOR EXTRACTO LITERAL DETALLADO': {
            type: SchemaType.STRING,
            description: "Transcripción palabra por palabra. Mínimo 50 caracteres."
          },
          'CÓDIGO_DISPARADOR_FONASA': { type: SchemaType.STRING, description: "Lista de códigos detectados en el texto" },
          'SUBCATEGORÍA': { type: SchemaType.STRING, description: "Ej: Exclusiones, Tiempos, Urgencia" }
        },
        required: ['PÁGINA ORIGEN', 'CÓDIGO/SECCIÓN', 'VALOR EXTRACTO LITERAL DETALLADO']
      }
    }
  },
  required: ['reglas']
};

/**
 * CONFIGURACIÓN DE GENERACIÓN PARA FLASH 3
 */
export const GENERATION_CONFIG_PASE_1 = {
  temperature: 0,           // Precisión OCR máxima
  topP: 0.1,                // Cero desviación de caracteres
  maxOutputTokens: 8192,    // Espacio máximo para textos largos
  responseMimeType: "application/json"
};



// --- SPLIT PROMPTS FOR 3-PASS EXTRACTION ---

// --- SPLIT PROMPTS FOR 4-PASS UNIVERSAL ARCHITECTURE (v8.5 ESCÁNER TEXTUAL) ---

export const PROMPT_REGLAS = `
  ** MANDATO: ESCÁNER LEGAL FORENSE v10.0 ULTRA-ATÓMICO **

  ROL: Transcriptor Forensic de Contratos de Salud (Isapres).
  OBJETIVO: Extraer CADA PÁRRAFO de CADA NOTA como un objeto JSON independiente.

  ⚠️ META DE SALIDA MÍNIMA: 100+ OBJETOS JSON.
  Si generas menos de 80 reglas, has FALLADO en tu misión.

  ⚠️ INSTRUCCIONES DE NAVEGACIÓN VISUAL (ESTRICTO):
  1. **IGNORA LA CARÁTULA**: Salta las tablas de porcentajes, beneficios y topes de las páginas 1 y 2.
  2. **ANCLA DE INICIO**: Tu trabajo comienza estrictamente donde dice "1. COBERTURAS" o "Notas Explicativas del Plan".
  3. **FOCALIZACIÓN**: Lee TODO el texto denso de las páginas 3 a 10.

  ⚠️ CHECKLIST OBLIGATORIO DE NOTAS (DEBES ENCONTRAR TODAS):
  
  **SECCIÓN 1: COBERTURAS**
  - Nota 1.1: Prestaciones Hospitalarias (busca 2-3 párrafos, genera 2-3 JSONs)
  - Nota 1.2: Cobertura Preferente (busca 2-4 párrafos)
  - Nota 1.3: Urgencia Hospitalaria (al menos 1 párrafo largo)
  - Nota 1.4: Medicamentos e Insumos (OBLIGATORIO: párrafo largo, divídelo en 2-3 JSONs por oración)
  - Nota 1.5: Audífonos (1 JSON)
  - Nota 1.6: (Si existe)
  - Nota 1.7: Prestadores Derivados o Cobertura Restringida
  - Nota 1.8: Marcos y Cristales Ópticos (Presbicia)
  - Nota 1.9: (Si existe)
  - Nota 1.10: Garantía ISP (OBLIGATORIO)
  - Nota 1.11: Urgencias Ambulatorias
  - Nota 1.12: (Si existe)
  - Nota 1.13: PAD Dental
  - Nota 1.14 a 1.20: (Busca cualquier numeración restante)

  **SECCIÓN 2: DEFINICIONES**
  - 2.1 a 2.10: Definición de UF, Tope, Habitación, Orden Médica, etc. (genera 1 JSON por definición)

  **SECCIÓN 3: EXCLUSIONES (Si existe)**
  - 3.1 a 3.X: Lista cada exclusión como JSON independiente.

  **SECCIÓN 4: PRESTACIONES RESTRINGIDAS (Si existe)**
  - 4.1 a 4.X

  **SECCIÓN 5: OFERTA PREFERENTE**
  - Nota 5.1: Prestadores Derivados
  - Nota 5.2: Disponibilidad
  - Nota 5.3: TIEMPOS MÁXIMOS DE ESPERA (¡OBLIGATORIO! Genera 1 JSON por cada tiempo: Consulta, Lab, Imagen, Procedimientos, Cirugía)
  - Nota 5.4 a 5.10: (Si existen)

  ⚠️ REGLAS DE ATOMICIDAD EXTREMA:
  1. **UN PÁRRAFO = UN JSON**: Si la Nota 1.4 tiene 3 oraciones separadas por punto seguido, genera 3 JSONs.
  2. **LISTAS = EXPLOSIONES**: Si una nota dice "Se excluyen: a) pañales, b) kit de aseo, c) sondas", genera 3 JSONs (uno por item).
  3. **TABLA DE TIEMPOS (5.3)**: Genera 5 JSONs separados (Consulta 10 días, Lab 4 días, etc.).

  ⚠️ FORMATO DE TRANSCRIPCIÓN:
  - 'VALOR EXTRACTO LITERAL DETALLADO': COPY-PASTE exacto del párrafo o FRASE COMPLETA.
  - 'CÓDIGO/SECCIÓN': "Nota 1.4 (Oración 1)", "Nota 5.3 (Consulta)", etc.

  NO resumas. NO agrupes. SOLO MULTIPLICA.
  
  FORMATO: JSON Strict (Schema Reglas).
`;

export const PROMPT_COBERTURAS_HOSP = `
  ** MANDATO UNIVERSAL v10.0: PASE 2 - HOSPITALARIO (EXPLOSIÓN ITEM x PRESTADOR) **
  
  OBJETIVO: Generar FILAS INDEPENDIENTES por cada combinación [ITEM x PRESTADOR x MODALIDAD].
  
  ⚠️ META MÍNIMA: 60+ OBJETOS JSON.
  Si generas menos de 50 coberturas hospitalarias, has FALLADO.
  
  ⚠️ LISTA DE CAZA OBLIGATORIA (MULTIPLICA CADA UNO):
  1. **Día Cama Básico**: Genera 1 fila por cada clínica (Alemana, U. Andes, San Carlos, Sta María, CLC, CL UC, Indisa).
  2. **Día Cama UTI/UCI**: Genera 1 fila por cada clínica.
  3. **Día Cama Intermedio**: Si existe, 1 fila por clínica.
  4. **Derecho Pabellón**: 1 fila por cada clínica.
  5. **Honorarios Médicos Quirúrgicos**: 1 fila por clínica.
  6. **Medicamentos**: 1 fila por clínica.
  7. **Materiales e Insumos**: 1 fila por clínica.
  8. **Gases Medicinales**: Si existe, 1 fila por clínica.
  9. **Anestesia**: 1 fila por clínica.
  
  ⚠️ MATRIZ DE MODALIDADES:
  - Por CADA item arriba, genera TAMBIÉN 1 fila para "Libre Elección" (con sus topes en UF/VA).
  
  ⚠️ REGLA DE NOMENCLATURA:
  - 'item': "Día Cama - Clínica Alemana", "Día Cama - Clínica Las Condes", etc.
  - 'modalidad': "Oferta Preferente" o "Libre Elección".
  
  FORMATO: JSON Strict.
`;

export const PROMPT_COBERTURAS_AMB = `
  ** MANDATO UNIVERSAL v10.0: PASE 3 - AMBULATORIO (EXPLOSIÓN POR PRESTACIÓN) **
  
  OBJETIVO: Generar FILAS INDIVIDUALES por cada tipo de examen/procedimiento.
  
  ⚠️ META MÍNIMA: 80+ OBJETOS JSON.
  Si generas menos de 60 coberturas ambulatorias, has FALLADO.
  
  ⚠️ LISTA DE CAZA OBLIGATORIA (GENERA 1 JSON POR CADA UNO):
  
  **CONSULTAS (4 filas):**
  - Consulta Médica General (Pref + LE)
  - Consulta Pediatría (Pref + LE)
  
  **LABORATORIO (10+ filas):**
  - Exámenes de Laboratorio (Pref + LE)
  - Hemograma (Pref + LE)
  - Perfil Bioquímico (Pref + LE)
  - Orina Completa (Pref + LE)
  - Cultivos (Pref + LE)
  
  **IMAGENOLOGÍA (12+ filas):**
  - Imagenología Genérica (Pref + LE)
  - Rayos X (Pref + LE)
  - Ecotomografía (Pref + LE)
  - TAC/Scanner (Pref + LE)
  - Resonancia Magnética (Pref + LE)
  - Mamografía (Pref + LE)
  
  **PROCEDIMIENTOS (10+ filas):**
  - Procedimientos Diagnósticos (Pref + LE)
  - Procedimientos Terapéuticos (Pref + LE)
  - Endoscopía (Pref + LE)
  - Colonoscopía (Pref + LE)
  - Biopsia (Pref + LE)
  
  **TERAPIAS (8+ filas):**
  - Kinesiología (Pref + LE)
  - Fonoaudiología (Pref + LE)
  - Terapia Ocupacional (Pref + LE)
  - Nutrición (Pref + LE)
  
  **URGENCIAS (4+ filas):**
  - Urgencia Simple Adulto (Pref + LE)
  - Urgencia Compleja Adulto (Pref + LE)
  
  **SALUD MENTAL (4+ filas):**
  - Consulta Psiquiatría (Pref + LE)
  - Consulta Psicología (Pref + LE)
  
  **DENTAL (4+ filas):**
  - PAD Dental (Pref + LE)
  - Tratamiento Dental General (Pref + LE)
  
  **ÓPTICA (4+ filas):**
  - Lentes Ópticos (Pref + LE)
  - Lentes Contacto (Pref + LE)
  
  ⚠️ REGLAS:
  - Por CADA item, genera 2 filas: 1 para "Oferta Preferente" y 1 para "Libre Elección".
  - Si el contrato menciona un examen específico (ej: "Hemograma"), crea una fila para él.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_EXTRAS = `
  ** MANDATO FORENSE v8.4: PASE 4 - PRESTACIONES VALORIZADAS (PAGE 7 SUPREMACY) **
  
  ⚠️ ALERTA DE SEGURIDAD DE DATOS (CRÍTICO):
  Prohibido resumir. Copia TEXTUALMENTE las condiciones.
  
  OBJETIVO: Capturar la "Selección de Prestaciones Valorizadas" que SOBREESCRIBE la bonificación general.
  
  ⚠️ INSTRUCCIONES CRÍTICAS (CONSALUD/MASVIDA/COLMENA):
  1. **REGLA DE SUPREMACÍA**: Busca la sección 'SELECCIÓN DE PRESTACIONES VALORIZADAS' (Generalmente Pág 7).
     - Por cada cirugía (Apendicectomía, Cesárea, Parto, etc.), genera una regla.
     - Captura el CÓDIGO FONASA y el Valor en Pesos ('Copago').
     - ESTOS VALORES SOBREESCRIBEN CUALQUIER PORCENTAJE DEL PLAN GENERAL. Márcalos como 'SUPREMO'.
  2. **TOPES ESPECÍFICOS**: Busca topes en Pesos para Medicamentos/Insumos en estas cirugías (ej: "Tope $758.208").
  3. **TIEMPOS DE ESPERA**: Mapea la tabla completa de tiempos (10 días consulta, etc.).
  
  FORMATO: JSON Strict (Schema Coberturas).
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
export const CONTRACT_OCR_MAX_PAGES = 50;
// NOTE: User explicitly requested 8192 tokens. This is aggressive for large contracts but we comply.
export const CONTRACT_MAX_OUTPUT_TOKENS = 16384; // Increased for 100+ atomic rule extraction
export const CONTRACT_TEMPERATURE = GENERATION_CONFIG.temperature;
export const CONTRACT_TOP_P = GENERATION_CONFIG.topP;
export const CONTRACT_TOP_K = GENERATION_CONFIG.topK;

export const CONTRACT_FAST_MODEL = AI_MODELS.primary;
export const CONTRACT_REASONING_MODEL = AI_MODELS.primary; // User requested strict adherence to primary model
export const CONTRACT_FALLBACK_MODEL = AI_MODELS.fallback;
export const CONTRACT_DEFAULT_RETRIES = 3;
