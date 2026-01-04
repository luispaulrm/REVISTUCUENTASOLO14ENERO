import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";



// --- SPLIT PROMPTS FOR 3-PASS EXTRACTION ---

export const PROMPT_REGLAS = `
  ** MANDATO FORENSE: PARTE 1 - REGLAS Y DEFINICIONES (MODO "UN-NESTING" + TEXTO INTEGRO) **
  
  ROL: Auditor Forense.
  OBJETIVO: Extraer LITERALMENTE todas las notas al pie, definiciones y cláusulas numéricas (1.1, 1.2, 5.1, etc.).
  
  ⚠️ MANDATO DE FIDELIDAD (IMPORTANTE):
  - "VALOR EXTRACTO LITERAL DETALLADO": DEBE SER UN VOLCADO DE TEXTO ÍNTEGRO. No permitas paráfrasis.
  - Ejemplo: Si la regla es Nota 1.3, empieza con "En caso de urgencia..." y termina con la última palabra del párrafo. ¡Copia y pega!
  
  CRITERIO DE EXPLOSIÓN:
  1. **DESANIDADO**: Si dice "Clínica A, B y C", genera 3 reglas separadas.
  2. **MAPEO DE NOTAS**: Cada sub-punto (1.1 a 1.13, 5.1 a 5.8) de las páginas 3 y 4 es una mina de oro. Extráelo como entidad separada.
  3. **PÁGINA 4**: No olvides las reglas finales: "Tiempos de Espera" (5.3) y "Traslados" (5.4).
  
  FORMATO: JSON Strict.
`;

export const PROMPT_COBERTURAS_HOSP = `
  ** MANDATO FORENSE: PARTE 2 - COBERTURAS HOSPITALARIAS (MODO DUAL + LETRA PEQUEÑA) **
  
  ROL: Auditor Forense.
  OBJETIVO: Digitalizar SOLO el GRUPO HOSPITALARIO.
  
  ALCANCE (Filas 1-17):
  1. Día Cama
  2. Sala Cuna
  3. Incubadora
  4. Día Cama Cuidados (UCI/UTI/Coronario)
  5. Día Cama Transitorio/Observación
  6. Exámenes de Laboratorio (Hosp)
  7. Imagenología (Hosp)
  8. Derecho de Pabellón
  9. Kinesiología/Fisioterapia Hospitalaria
  10. Procedimientos
  11. Honorarios Médicos Quirúrgicos
  12. Medicamentos
  13. Materiales e Insumos Clínicos
  14. Quimioterapia
  15. Prótesis y Órtesis
  16. Visita Médica
  17. Traslados
  
  INSTRUCCIONES CLAVE:
  - 🔴 **OBLIGATORIO**: Debes extraer SIEMPRE por separado "Oferta Preferente" y "Libre Elección".
  - **LETRA PEQUEÑA**: Copia textualmente las restricciones (ej: "Sólo con Médicos Staff", "Sujeto a Arancel V20").
  - **SEPARACIÓN**: Si dice "Clínica Las Condes bonificación 60%", extráelo como regla propia.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_COBERTURAS_AMB = `
  ** MANDATO FORENSE: PARTE 3 - AMBULATORIO, URGENCIA Y OTROS (MODO DUAL + LETRA PEQUEÑA) **
  
  ROL: Auditor Forense.
  OBJETIVO: Digitalizar las secciones AMBULATORIA, URGENCIA y OTROS.
  
  ALCANCE (Filas 18-43+):
  - GRUPO AMBULATORIO (Consulta Médica, Exámenes, Pabellón Amb, etc.)
  - GRUPO URGENCIA (Consulta, Exámenes, Pabellón Urg, etc.)
  - OTROS (Psiquiatría, Cirugía Refractiva, Marcos, Esclerosis, Internacional, Derivados)
  
  INSTRUCCIONES CLAVE:
  - 🔴 **OBLIGATORIO**: Debes extraer SIEMPRE por separado "Oferta Preferente" y "Libre Elección".
  - **FINAL DEL DOCUMENTO**: Asegúrate de llegar al final para capturar Prestadores Derivados.
  - **LETRA PEQUEÑA**: Copia textualmente todas las condiciones (ej: "Sin tope", "V.A.").
  
  FORMATO: JSON Strict.
`;

export const SCHEMA_REGLAS = {
  type: SchemaType.OBJECT,
  properties: {
    reglas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'PÁGINA ORIGEN': { type: SchemaType.STRING },
          'CÓDIGO/SECCIÓN': { type: SchemaType.STRING },
          'SUBCATEGORÍA': { type: SchemaType.STRING },
          'VALOR EXTRACTO LITERAL DETALLADO': { type: SchemaType.STRING },
        },
        required: ['PÁGINA ORIGEN', 'CÓDIGO/SECCIÓN', 'SUBCATEGORÍA', 'VALOR EXTRACTO LITERAL DETALLADO'],
      }
    }
  },
  required: ['reglas']
};

export const SCHEMA_COBERTURAS = {
  type: SchemaType.OBJECT,
  properties: {
    coberturas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'PRESTACIÓN CLAVE': { type: SchemaType.STRING, description: "Nombre exacto de la prestación" },
          'MODALIDAD/RED': { type: SchemaType.STRING, description: "Nacional / Internacional / Preferente / Libre Elección" },
          '% BONIFICACIÓN': { type: SchemaType.STRING, description: "Porcentaje (ej: 100%, 80%)" },
          'COPAGO FIJO': { type: SchemaType.STRING, description: "Monto fijo o '-'" },
          'TOPE LOCAL 1 (VAM/EVENTO)': { type: SchemaType.STRING, description: "Tope por evento o VAM" },
          'TOPE LOCAL 2 (ANUAL/UF)': { type: SchemaType.STRING, description: "Tope anual en UF" },
          'RESTRICCIÓN Y CONDICIONAMIENTO': { type: SchemaType.STRING, description: "Todas las notas, condiciones de malla y restricciones específicas" },
          'ANCLAJES': { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
        },
        required: ['PRESTACIÓN CLAVE', 'MODALIDAD/RED', '% BONIFICACIÓN', 'COPAGO FIJO', 'TOPE LOCAL 1 (VAM/EVENTO)', 'TOPE LOCAL 2 (ANUAL/UF)', 'RESTRICCIÓN Y CONDICIONAMIENTO', 'ANCLAJES'],
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
export const CONTRACT_MAX_OUTPUT_TOKENS = GENERATION_CONFIG.maxOutputTokens;
export const CONTRACT_TEMPERATURE = GENERATION_CONFIG.temperature;
export const CONTRACT_TOP_P = GENERATION_CONFIG.topP;
export const CONTRACT_TOP_K = GENERATION_CONFIG.topK;

export const CONTRACT_FAST_MODEL = AI_MODELS.primary;
export const CONTRACT_REASONING_MODEL = AI_MODELS.primary; // User requested strict adherence to primary model
export const CONTRACT_FALLBACK_MODEL = AI_MODELS.fallback;
export const CONTRACT_DEFAULT_RETRIES = 3;
