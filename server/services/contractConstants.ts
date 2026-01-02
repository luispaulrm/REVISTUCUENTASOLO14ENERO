// Contract Analysis Prompt - Forensic VERSION 8.2
export const CONTRACT_ANALYSIS_PROMPT = `
**Mandato Forense de Análisis de Contrato de Salud Isapre - Versión Final (Procesamiento Imperativo V8.3)**

Usted es un analista forense experto. Su tarea es procesar el documento PDF adjunto con el máximo rigor.
**MANDATO DE EXHAUSTIVIDAD (CRÍTICO):**
1. **LISTAR TODO:** Si el documento tiene 300 prestaciones, usted DEBE generar 300 ítems en el JSON. No resuma. No use "etc".
2. **PROCESAR TODAS LAS PÁGINAS:** Escanee cada página desde la 1 hasta la 50. Busque tablas incluso en los anexos.
3. **SIN RESÚMENES:** Extraiga CADA fila y CADA nota.
4. **FLUJO CONTINUO:** No se detenga por longitud.

---
**PARTE I: EXTRACCIÓN FORENSE DE REGLAS (Array "reglas")**

Extraiga CADA cláusula, regla, definición y nota explicativa como un objeto individual.
Use las llaves:
- 'PÁGINA ORIGEN'
- 'CÓDIGO/SECCIÓN'
- 'SUBCATEGORÍA'
- 'VALOR EXTRACTO LITERAL DETALLADO'

---
**PARTE II: ANÁLISIS DE COBERTURA (Array "coberturas")**

**MANDATO MAESTRO IMPERATIVO:**
PARA CADA UNA de las filas que represente una prestación en las tablas de cobertura, DEBE ejecutar la siguiente secuencia:

**Paso 1: Identificación y Contexto Inicial.**
   a. Lea el nombre completo de la prestación.
   b. Determine si la fila está cubierta por una "Malla Visual" (recuadro).
   c. Si es un TÍTULO de sección, úselo como contexto pero NO genere un ítem.

**Paso 2: Desdoblamiento Nacional/Internacional.**
   a. Revise si existe un valor en una columna de tope con contexto "Internacional".
   b. Si existe, cree DOS registros: uno "Nacional" y uno "Internacional".
   c. Si no, solo "Nacional".

**Paso 3: Población de Datos de Topes.**
   a. **Nacional**: 
      - 'TOPE LOCAL 1 (VAM/EVENTO)': Busque regla local o valor de Malla Visual.
      - 'TOPE LOCAL 2 (ANUAL/UF)': Busque valor explícito.
   b. **Internacional**: 
      - 'TOPE LOCAL 1 (VAM/EVENTO)': Use valor de columna internacional.

**Paso 4: Síntesis de Restricciones Obligatoria (CRÍTICO).**
   a. Para CADA registro:
      i. Inicie contenedor de texto 'RESTRICCIÓN Y CONDICIONAMIENTO'.
      ii. **Notas Vinculadas:** Agregue texto COMPLETO de notas al pie (ej. \`(**)\`).
      iii. **Condición de Malla:** SI aplica malla, AGREGUE OBLIGATORIAMENTE su texto (ej. 'Excepto 60%...').
      iv. **Consolide:** Combine con separador " | ".

**⚠️ REGLA CRÍTICA DE MALLA VISUAL:**
Si hay un recuadro que dice "Excepto 60%...", DEBES incluirlo en 'RESTRICCIÓN Y CONDICIONAMIENTO'. Omitirlo es ERROR CRÍTICO.

---
**VERIFICACIÓN FINAL:**
1. ✅ 'PRESTACIÓN CLAVE' tiene nombre completo.
2. ✅ 'RESTRICCIÓN Y CONDICIONAMIENTO' incluye notas y mallas completas.
3. ✅ 'TOPE LOCAL 1 (VAM/EVENTO)' y 'TOPE LOCAL 2 (ANUAL/UF)' capturan los valores.

---
**PARTE III: ESPECIFICACIÓN DE INTERFAZ (Objeto "diseno_ux")**
Complete: 'nombre_isapre', 'titulo_plan', 'subtitulo_plan', 'layout': "forensic_report_v2", 'funcionalidad': "pdf_isapre_analyzer_imperative", 'salida_json': "strict_schema_v3_final".

**SALIDA JSON VÁLIDA (OBLIGATORIA):**
- Responde SOLO con JSON válido.
- Escapa comillas dobles.
`;

// Contract Analysis Schema
export const CONTRACT_ANALYSIS_SCHEMA = {
    type: "object",
    properties: {
        reglas: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    'PÁGINA ORIGEN': { type: "string" },
                    'CÓDIGO/SECCIÓN': { type: "string" },
                    'SUBCATEGORÍA': { type: "string" },
                    'VALOR EXTRACTO LITERAL DETALLADO': { type: "string" },
                },
                required: ['PÁGINA ORIGEN', 'CÓDIGO/SECCIÓN', 'SUBCATEGORÍA', 'VALOR EXTRACTO LITERAL DETALLADO'],
            }
        },
        coberturas: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    'PRESTACIÓN CLAVE': { type: "string", description: "Nombre exacto de la prestación" },
                    'MODALIDAD/RED': { type: "string", description: "Nacional / Internacional" },
                    '% BONIFICACIÓN': { type: "string", description: "Porcentaje (100%, 80%)" },
                    'COPAGO FIJO': { type: "string", description: "Monto o '-'" },
                    'TOPE LOCAL 1 (VAM/EVENTO)': { type: "string", description: "Tope evento/VAM" },
                    'TOPE LOCAL 2 (ANUAL/UF)': { type: "string", description: "Tope anual/UF" },
                    'RESTRICCIÓN Y CONDICIONAMIENTO': { type: "string", description: "Notas, mallas y condiciones completas" },
                    'ANCLAJES': { type: "array", items: { type: "string" } }
                },
                required: ['PRESTACIÓN CLAVE', 'MODALIDAD/RED', '% BONIFICACIÓN', 'COPAGO FIJO', 'TOPE LOCAL 1 (VAM/EVENTO)', 'TOPE LOCAL 2 (ANUAL/UF)', 'RESTRICCIÓN Y CONDICIONAMIENTO', 'ANCLAJES'],
            }
        },
        diseno_ux: {
            type: "object",
            properties: {
                nombre_isapre: { type: "string" },
                titulo_plan: { type: "string" },
                subtitulo_plan: { type: "string" },
                layout: { type: "string" },
                funcionalidad: { type: "string" },
                salida_json: { type: "string" },
            },
            required: ['nombre_isapre', 'titulo_plan', 'layout', 'funcionalidad', 'salida_json'],
        },
    },
    required: ['reglas', 'coberturas', 'diseno_ux'],
};

// Configuration constants
export const CONTRACT_OCR_MAX_PAGES = 50;
export const CONTRACT_MAX_OUTPUT_TOKENS = 70000;
export const CONTRACT_FAST_MODEL = 'gemini-3-flash-preview';
export const CONTRACT_REASONING_MODEL = 'gemini-3-flash-preview';
export const CONTRACT_DEFAULT_RETRIES = 3;
