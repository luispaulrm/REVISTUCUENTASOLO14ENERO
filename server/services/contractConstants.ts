import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";



// --- SPLIT PROMPTS FOR 3-PASS EXTRACTION ---

// --- SPLIT PROMPTS FOR 4-PASS UNIVERSAL ARCHITECTURE (v8.0) ---

export const PROMPT_REGLAS = `
  ** MANDATO UNIVERSAL v8.0: PASE 1 - REGLAS Y DEFINICIONES **
  
  ROL: Auditor Forense de Seguros (Nivel Experto).
  OBJETIVO: Extraer Notas Legales, Definiciones de Tiempo y Exclusiones.
  
  ⚠️ INSTRUCCIONES MAESTRAS PASE 1:
  1. **ATOMICIDAD**: Si la Nota 1.1 tiene 3 párrafos, crea 3 reglas separadas. ¡PROHIBIDO RESUMIR!
  2. **VARIABLES DE TIEMPO**: Busca definiciones de "Día Cama" (ej: >4 horas vs >6 horas).
  3. **VARIABLES DE EXCLUSIÓN**: Transcribe listas de exclusiones de insumos (ej: pañales, kit de aseo).
  4. **FIDELIDAD**: El campo 'VALOR EXTRACTO LITERAL DETALLADO' debe ser >50 caracteres.
  5. **IGNORAR**: Tabla de Factores.
  
  FORMATO: JSON Strict (Schema Reglas Universal).
`;

export const PROMPT_COBERTURAS_HOSP = `
  ** MANDATO UNIVERSAL v8.0: PASE 2 - HOSPITALARIO (HOSP) **
  
  OBJETIVO: Mapear Día Cama, Pabellón, Insumos y Medicamentos.
  
  ⚠️ INSTRUCCIONES MAESTRAS PASE 2:
  1. **DESGLOSE DE REDES**: Crea una regla JSON para CADA prestador de la Red Preferente mencionado.
  2. **CONDICIONES**: Captura "Solo en habitación compartida" o "Topes de veces al año".
  3. **IGNORAR**: Tabla de Factores.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_COBERTURAS_AMB = `
  ** MANDATO UNIVERSAL v8.0: PASE 3 - AMBULATORIO Y URGENCIA (AMB) **
  
  OBJETIVO: Consultas, Exámenes y Urgencias.
  
  ⚠️ INSTRUCCIONES MAESTRAS PASE 3:
  1. **URGENCIA COMPLEJA vs SIMPLE**: Busca los códigos que definen la complejidad (ej: subgrupos 04, 05).
  2. **COPAGOS FIJOS**: Captura valores en UF o Pesos para consultas de urgencia.
  3. **IGNORAR**: Tabla de Factores.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_EXTRAS = `
  ** MANDATO UNIVERSAL v8.0: PASE 4 - PRESTACIONES VALORIZADAS (EXTRAS) **
  
  OBJETIVO: Tablas de Cirugías Específicas (Partos, PAD) y Tiempos.
  
  ⚠️ INSTRUCCIONES MAESTRAS PASE 4:
  1. **TABLAS VALORIZADAS**: Mapea cirugías con copago fijo (ej: Parto, Apendicectomía - Pág 7 Consalud).
  2. **TIEMPOS DE ESPERA**: Si no salió en Reglas, extráelo aquí.
  3. **DERIVADOS**: Prestadores derivados y cobertura internacional.
  
  FORMATO: JSON Strict.
`;

export const SCHEMA_REGLAS = {
  description: "Esquema Universal de Reglas de Auditoría v8.1",
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
          'PRESTACIÓN CLAVE': { type: SchemaType.STRING, description: "Nombre exacto de la prestación" },
          'MODALIDAD/RED': { type: SchemaType.STRING, description: "Nacional / Internacional / Preferente / Libre Elección" },
          '% BONIFICACIÓN': { type: SchemaType.STRING, description: "Porcentaje (ej: 100%, 80%)" },
          'COPAGO FIJO': { type: SchemaType.STRING, description: "Monto fijo o '-'" },
          'TOPE LOCAL 1 (VAM/EVENTO)': { type: SchemaType.STRING, description: "Tope por evento o VAM" },
          'TOPE LOCAL 2 (ANUAL/UF)': { type: SchemaType.STRING, description: "Tope anual en UF" },
          'RESTRICCIÓN Y CONDICIONAMIENTO': { type: SchemaType.STRING, description: "Todas las notas, condiciones de malla y restricciones específicas" },
          'ANCLAJES': { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          'CÓDIGO_DISPARADOR_FONASA': { type: SchemaType.STRING, description: "Códigos FONASA asociados (ej: 0305xxx)" },
          'LOGICA_DE_CALCULO': { type: SchemaType.STRING, description: "Ej: % de cobertura sobre el arancel" }
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
