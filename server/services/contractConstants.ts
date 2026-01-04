import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

// Contract Analysis Prompt - Forensic VERSION 11.0 (Ultra-Exhaustive)
// --- SPLIT PROMPTS FOR 2-PASS EXTRACTION ---

export const PROMPT_REGLAS = `
  ** MANDATO FORENSE: PARTE 1 - REGLAS Y DEFINICIONES **
  
  ROL: Auditor Forense.
  OBJETIVO: Extraer LITERALMENTE todas las notas al pie, definiciones y cláusulas numéricas (1.1, 1.2, 5.1, etc.) del documento.
  NO EXTRAIGAS LA TABLA DE COBERTURAS EN ESTE PASO.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_COBERTURAS = `
  ** MANDATO FORENSE: PARTE 2 - COBERTURAS (TABLA DE BENEFICIOS) **
  
  ROL: Auditor Forense.
  OBJETIVO: Digitalizar la TABLA DE BENEFICIOS (Hospitalario, Ambulatorio, Urgencia).
  
  CRITERIO DE COMPLETITUD:
  - Debes extraer ~45 filas visuales.
  - Como hay 2 columnas (Preferente / Libre Elección), esto generará ~90 objetos.
  - BARRIDO VISUAL: Hospitalario -> Ambulatorio -> Urgencia -> Otros.
  
  INSTRUCCIONES CLAVE:
  - 'MODALIDAD/RED': Genera 2 objetos por fila si hay 2 columnas de datos.
  - 'RESTRICCIÓN': Concatena notas al pie, topes y cabeceras.
  
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
