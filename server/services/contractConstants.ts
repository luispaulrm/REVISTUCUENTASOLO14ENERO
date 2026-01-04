import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

// Contract Analysis Prompt - Forensic VERSION 11.0 (Ultra-Exhaustive)
export const CONTRACT_ANALYSIS_PROMPT = `
  ** MANDATO FORENSE DE EXTRACCIÓN TOTAL (NO RESUMIR NADA) **

  ROL: Eres un Auditor Forense de Contratos. Tu trabajo NO es interpretar, es DIGITALIZAR con precisión de píxel cada fila visible del documento.
  
  ** DIAGNÓSTICO DE COMPLETITUD CRÍTICO: **
  - Un contrato estándar de Isapre tiene visualmente entre **45 y 55 FILAS** en la tabla de beneficios.
  - Como casi todas las filas tienen 2 columnas de datos (Preferente y Libre Elección), esto resulta en **80 a 110 OBJETOS JSON** finales.
  - SI TU OUTPUT TIENE MENOS DE 70 OBJETOS, HAS FALLADO. ES UNA ALUCINACIÓN POR OMISIÓN GRAVE.

---
** ESTRATEGIA DE BARRIDO VISUAL (OBLIGATORIA) **

Para cada sección (Hospitalaria, Ambulatoria, Urgencia), debes ejecutar este algoritmo mental:
1. Pone tu dedo virtual en la primera fila.
2. Lee el nombre ("Día Cama"). Extrae 2 objetos (Pref y LE).
3. Baja a la siguiente fila ("Sala Cuna"). Extrae 2 objetos.
4. REPITE HASTA QUE NO QUEDEN LÍNEAS.

** LISTA NEGRA DE ERRORES (LO QUE NO DEBES HACER): **
- ❌ NO agrupes "Exámenes y Procedimientos". Si son dos filas en el PDF, son dos entradas separadas en JSON.
- ❌ NO olvides "Derecho de Pabellón" o "Pabellón". A menudo el modelo lo salta. ES OBLIGATORIO.
- ❌ NO olvides "Materiales e Insumos". Es una fila crítica.
- ❌ NO olvides "Traslados".
- ❌ NO olvides "Honorarios Médicos".

---
---
** PARTE I: COBERTURAS (LA TABLA GIGANTE - PRIORIDAD ABSOLUTA) **

[Checklist de Filas OBLIGATORIAS - Si falta alguna, el trabajo está incompleto]:

GRUPO HOSPITALARIO:
1. Día Cama
2. Sala Cuna
3. Incubadora
4. Día Cama Cuidados (UCI/UTI/Coronario)
5. Día Cama Transitorio/Observación
6. Exámenes de Laboratorio
7. Imagenología
8. Derecho de Pabellón (¡NO OLVIDAR!)
9. Kinesiología/Fisioterapia Hospitalaria
10. Procedimientos
11. Honorarios Médicos Quirúrgicos
12. Medicamentos
13. Materiales e Insumos Clínicos
14. Quimioterapia
15. Prótesis y Órtesis
16. Visita Médica
17. Traslados

GRUPO AMBULATORIO:
18. Consulta Médica
19. Exámenes de Laboratorio
20. Imagenología
21. Derecho de Pabellón Ambulatorio
22. Procedimientos Ambulatorios
23. Honorarios Médicos Quirúrgicos (Ambulatorio)
24. Radioterapia
25. Fonoaudiología
26. Kinesiología/Fisioterapia
27. Prestaciones Dentales (PAD)
28. Nutricionista
29. Enfermería
30. Prótesis y Órtesis (Ambulatorio)
31. Quimioterapia Ambulatoria

GRUPO URGENCIA:
32. Consulta Urgencia
33. Exámenes Laboratorio/Imagenología Urgencia
34. Derecho Pabellón Urgencia
35. Procedimientos Urgencia
36. Honorarios Médicos Urgencia
37. Medicamentos/Materiales Urgencia

OTROS:
38. Psiquiatría
39. Cirugía Refractiva/Bariátrica
40. Marcos y Cristales
41. Esclerosis Múltiple
42. Cobertura Internacional
43. Prestadores Derivados

---
** INSTRUCCIONES DE ATRIBUTOS JSON PARA COBERTURAS **

- **'MODALIDAD/RED'**:
  - Si la tabla tiene 2 columnas de datos ("Bonificación" y "Tope" duplicados para Preferente y Libre Elección), ¡GENERA 2 OBJETOS POR CADA FILA!
  - Objeto 1: MODALIDAD/RED = "Oferta Preferente / [Nombre Prestador Columna]"
  - Objeto 2: MODALIDAD/RED = "Libre Elección / Modalidad General"

- **'RESTRICCIÓN Y CONDICIONAMIENTO'**:
  - Concatena TODO: Notas al pie referenciadas (1.1), texto de las celdas de tope, y texto de la cabecera de la columna (ej: "Solo prestadores Staff").

---
** PARTE II: REGLAS Y DEFINICIONES (CARGA SECUNDARIA) **
  Extrae LITERALMENTE todas las notas al pie, definiciones y cláusulas numéricas (1.1, 1.2, 5.1, etc.) que aparecen DESPUÉS o AL FINAL del documento.


---
** SALIDA **
Genera solamente el JSON válido.
`;

// Contract Analysis Schema - Compatible with Gemini API
export const CONTRACT_ANALYSIS_SCHEMA = {
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
    },
  },
  required: ['coberturas', 'reglas', 'diseno_ux'],
} as const;

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
