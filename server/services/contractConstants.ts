import { SchemaType } from "@google/generative-ai";

// Contract Analysis Prompt - Forensic VERSION 10.0 (Json Deterministic)
export const CONTRACT_ANALYSIS_PROMPT = `
  ** Mandato Forense de Análisis de Contrato de Salud Isapre - Versión Final (JSON STRICT MODE) **

    Usted es un motor de extracción de datos forense. Su ÚNICA función es convertir el contrato PDF a un objeto JSON válido.
    
    CRITERIO FUNDAMENTAL: "SI EXISTE EN EL PDF, DEBE EXISTIR EN EL JSON".
    NO AGRUPE. NO RESUMA. NO OMITE NADA.

---
** PARTE I: EXTRACCIÓN DE REGLAS (Array "reglas") **

  1. ** Literalidad Absoluta **: El campo "VALOR EXTRACTO LITERAL DETALLADO" debe contener el texto EXACTO del PDF.
  2. ** Exhaustividad **: Extraiga TODAS las notas explicativas (1.1, 1.2, etc.), definiciones (Sección 2) y cláusulas administrativas (Secciones 3, 4, 5).

---
** PARTE II: ANÁLISIS DE COBERTURA (Array "coberturas") **

** IMPERATIVO DE COMPLETITUD:**
  He detectado que esta tabla contiene entre 70 y 85 filas de beneficios.
  TU DEBER JSON ES EXTRAERLAS TODAS.
  Si tu JSON tiene menos de 60 ítems, es una ALUCINACIÓN POR OMISIÓN y será rechazado.

  [LISTA DE CONTROL DE EXTRACCIÓN - NO ES OPCIONAL]:
  
  GRUPO A: HOSPITALARIO (Extraer CADA fila por separado)
  - Días Cama (Todas las variantes: Solo, UCI, UTI, Coronario, Transitorio).
  - Sala Cuna, Incubadora.
  - Exámenes laboratorios e Imagenología (Hospitalario).
  - Pabellones y Procedimientos.
  - Honorarios Médicos (Verificar notas staff vs libre elección).
  - Medicamentos y materiales (Separar si están en filas distintas).
  - Quimioterapia y Drogas antineoplásicas.
  - Prótesis y Órtesis (Incluyendo osteosíntesis).
  - Visitas médicas.
  - Traslados.

  GRUPO B: AMBULATORIO
  - Consultas médicas (Todas las especialidades listadas).
  - Exámenes y procedimientos ambulatorios.
  - Pabellón ambulatorio (Cirugía mayor y menor).
  - Radioterapia, Quimioterapia ambulatoria.
  - Fonoaudiología, Kinesiología, Terapia Ocupacional.
  - PAD Dental y otras prestaciones dentales.
  - Nutricionistas, Enfermería.
  - Prótesis ambulatorias (Audífonos, lentes, etc).

  GRUPO C: URGENCIA (Desglose TOTAL)
  - NO agrupes la urgencia. Extrae: Consulta, Exámenes, Procedimientos, Pabellón, Honorarios, Medicamentos. Cada uno es una fila JSON.

  GRUPO D: RESTRINGIDAS Y OTROS
  - Psiquiatría (Hospitalaria y Ambulatoria).
  - Cirugía Refractiva, Bariátrica, Metabólica.
  - Marcos y Cristales, Esclerosis Múltiple.
  - Cobertura Internacional.

  GRUPO E: DERIVADOS
  - Prestadores derivados (Hospitalario y Ambulatorio).

---
** ALGORITMO DE POBLADO DE DATOS (JSON) **

  Para CADA objeto en el array "coberturas":

1. ** 'PRESTACIÓN CLAVE' **: El nombre exacto que aparece en la fila.
2. ** 'MODALIDAD/RED' **:
- Si la tabla tiene columnas diferenciadas, genera DOS OBJETOS: uno con "Preferente/Nacional" y otro con "Internacional" (si aplica).
   - O uno para "Preferente" y otro para "Libre Elección" si están separados.
3. ** 'TOPE LOCAL 1' y 'TOPE LOCAL 2' **: Extráelos de sus columnas respectivas. Si la celda está vacía pero hay un encabezado de grupo (Malla) que dice "100% Sin Tope", HEREDA ese valor.
4. ** 'RESTRICCIÓN Y CONDICIONAMIENTO' (CRÍTICO) **:
- Este campo debe ser TEXTO LARGO.
   - Concatena: [Texto de Notas al pie (*)] + [Condiciones de Malla / Recuadro] + [Restricciones de la celda].
   - ** EJEMPLO:** "Tope aplica por beneficiario. | (**) Nota 1.2: Solo prestadores staff. | Malla: 100% Sin Tope en Clínica Alemana."
  - NUNCA pongas "Ver nota". COPIA LA NOTA.
5. ** 'ANCLAJES' **: Array de strings con las páginas de origen de la prestación, notas y malla.

---
** PARTE III: METADATA (Objeto "diseno_ux") **
  Llene con los datos del encabezado del documento: Nombre Isapre, Plan y Subtítulo.

---
** INSTRUCCIÓN FINAL **
  Genera ÚNICAMENTE el JSON. Sin bloques de código markdown, sin texto introductorio.
El JSON debe ser válido y contener TODAS las ~80 prestaciones detectadas.
`;

// Contract Analysis Schema - Compatible with Gemini API
export const CONTRACT_ANALYSIS_SCHEMA = {
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
    },
    coberturas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'PRESTACIÓN CLAVE': { type: SchemaType.STRING, description: "Nombre exacto de la prestación" },
          'MODALIDAD/RED': { type: SchemaType.STRING, description: "Nacional / Internacional" },
          '% BONIFICACIÓN': { type: SchemaType.STRING, description: "Porcentaje (100%, 80%)" },
          'COPAGO FIJO': { type: SchemaType.STRING, description: "Monto o '-'" },
          'TOPE LOCAL 1 (VAM/EVENTO)': { type: SchemaType.STRING, description: "Tope evento/VAM" },
          'TOPE LOCAL 2 (ANUAL/UF)': { type: SchemaType.STRING, description: "Tope anual/UF" },
          'RESTRICCIÓN Y CONDICIONAMIENTO': { type: SchemaType.STRING, description: "Notas, mallas y condiciones completas" },
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
    },
  },
  required: ['reglas', 'coberturas', 'diseno_ux'],
} as const;

// Configuration constants
export const CONTRACT_OCR_MAX_PAGES = 50;
export const CONTRACT_MAX_OUTPUT_TOKENS = 80000;
export const CONTRACT_FAST_MODEL = 'gemini-1.5-flash';
export const CONTRACT_REASONING_MODEL = 'gemini-1.5-pro';
export const CONTRACT_FALLBACK_MODEL = 'gemini-1.5-pro-002';
export const CONTRACT_DEFAULT_RETRIES = 3;
