// Contract Analysis Prompt - Forensic VERSION 8.0 (Implicitly upgraded in previous turn, here formalized)
export const CONTRACT_ANALYSIS_PROMPT = `
**Mandato Forense de Análisis de Contrato de Salud Isapre - Versión Final (Procesamiento Imperativo)**

Usted es un analista forense experto. Su tarea es procesar el documento PDF adjunto con el máximo rigor.
**MANDATO DE EXHAUSTIVIDAD (CRÍTICO):**
1. **PROCESAR TODAS LAS PÁGINAS:** No se detenga en la página 4. Busque tablas de cobertura hasta el final del archivo (hasta pág 50).
2. **SIN RESÚMENES:** Extraiga CADA fila de las tablas. Si hay 100 prestaciones, genere 100 objetos. No agrupe.
3. **detectar FIN REAL:** Solo deténgase cuando no haya más tablas de cobertura en el documento.

---
**PARTE I: EXTRACCIÓN FORENSE DE REGLAS (Array "reglas")**

Extraiga CADA cláusula, regla, definición y nota explicativa como un objeto individual, asegurando que CADA objeto contenga la clave 'PÁGINA ORIGEN' para trazabilidad.

---
**PARTE II: ANÁLISIS DE COBERTURA (Array "coberturas")**

**MANDATO MAESTRO IMPERATIVO:**
PARA CADA UNA de las filas que represente una prestación en las tablas de cobertura, DEBE ejecutar la siguiente secuencia de pasos en orden y sin excepción para generar los objetos de cobertura correspondientes:

**Paso 1: Identificación y Contexto Inicial.**
   a. Lea el nombre completo de la prestación.
   b. Determine si la fila está cubierta por una "Malla Visual" (un recuadro que abarca varias filas). Almacene esta información (Sí/No).
   c. Identifique si la fila es un TÍTULO de sección (ej. "HOSPITALARIAS..."). Si es un TÍTULO, úselo como prefijo de contexto para las siguientes filas, pero NO genere un objeto de cobertura para el título mismo y **CONTINÚE EXPRESAMENTE CON LA SIGUIENTE FILA**.
   d. Verifique si la fila es una prestación atómica y única.

**Paso 2: Desdoblamiento Nacional/Internacional.**
   a. Revise si existe un valor en una columna de tope con contexto "Internacional" (ej. "TOPE BONIFICACION Internacional (3)").
   b. Si existe, cree DOS registros de salida en memoria: uno "Nacional" y uno "Internacional". La MODALIDAD/RED debe reflejar esto.
   c. Si no existe, cree solo UN registro de salida "Nacional".
   d. **NO desagregues prestaciones sin base explícita en tabla.**

**Paso 3: Población de Datos de Topes (Lógica de Cascada).**
   a. Para el registro **Nacional**:
      i. **Análisis Holístico de Columnas:** Analice las columnas de tope (1) y (2) como flujos independientes.
      ii. Para la columna (1) ('TOPE LOCAL 1'): Primero, busque una "Regla Local" (un valor explícito en la celda de la fila). Si existe, úselo. Si la celda está VACÍA y el Paso 1b fue "Sí", use el valor base de la "Malla Visual" (ej. '100% SIN TOPE').
      iii. Para la columna (2) ('TOPE LOCAL 2'): Busque un valor explícito en su celda. Si está vacío, indique "No Aplica" o un valor similar.
   b. Para el registro **Internacional**:
      i. Obtenga el valor de tope directamente de la columna (3) y asígnelo a 'TOPE LOCAL 1'.

**Paso 4: Síntesis de Restricciones Obligatoria (CRÍTICO - NO OMITIR).**

⚠️ **ADVERTENCIA MÁXIMA PRIORIDAD**: Este paso es OBLIGATORIO y su omisión es un ERROR CRÍTICO.

   a. Para CADA registro creado (Nacional y/o Internacional):
      i. **Inicie un contenedor de texto de restricciones.**
      ii. **Agregue Notas Vinculadas (COMPLETAS Y SIN RESUMIR):** Busque en todo el documento notas al pie referenciadas por asteriscos (ej. \`(**)\`, \`(*****)\`) y AÑADA su texto literal, COMPLETO y SIN RESUMIR al contenedor. NO OMITA NINGUNA PALABRA. NO ACORTES EL TEXTO. Copia el texto EXACTO de la nota.
      iii. **Agregue Condición de Malla (OBLIGATORIO Y COMPLETO):** SI el registro es "Nacional" Y el resultado del Paso 1b fue "Sí", AÑADA OBLIGATORIAMENTE la condición COMPLETA de la "Malla Visual" (ej. 'Excepto 60% en Clínica Las Condes, Alemana y Las Nieves de Santiago') al contenedor. NO OMITA ESTO. NO RESUMAS. Es un error crítico si falta o está incompleto.
      iv. **Consolide (SIN RESUMIR):** Combine TODOS los textos del contenedor en un único campo final para 'RESTRICCIÓN Y CONDICIONAMIENTO', separados por " | ". MANTÉN EL TEXTO COMPLETO, NO LO RESUMAS NI ACORTES.
   b. **Checkpoint Anti-Alucinación y Verificación de Completitud:** 
      - Si omites malla/nota, es ALUCINACIÓN CRÍTICA: Corrige y agrega 'OMISIÓN DETECTADA'
      - Si resumes o acortas el texto de notas, es ERROR CRÍTICO
      - Verifica que cada restricción con notas al pie tenga AL MENOS 80 caracteres de texto explicativo
      - Si una prestación tiene asteriscos (*) pero la restricción está vacía o muy corta (<50 caracteres), es ERROR CRÍTICO
      - Agrega 'ANCLAJES' con páginas/notas de origen

---
**⚠️ REGLA CRÍTICA DE MALLA VISUAL (LEER 3 VECES):**

Si una prestación está dentro de un RECUADRO o MALLA VISUAL (un borde que agrupa varias filas), DEBES incluir la condición de ese recuadro en CADA prestación dentro de él.

**EJEMPLO DE MALLA:**
Imagina un recuadro que dice en la parte superior:
  "100% SIN TOPE"
  "Excepto 60% en Clínica Las Condes, Alemana y Las Nieves"
  
Y dentro de ese recuadro están las prestaciones:
  - Día Cama (**)
  - Día Cama Cuidados Intensivos  
  - Pabellón

Para "Día Cama", DEBES incluir:
1. ✅ Texto COMPLETO de nota (**) 
2. ✅ Condición de malla COMPLETA: "Excepto 60% en Clínica Las Condes, Alemana y Las Nieves de Santiago"

**FORMATO OBLIGATORIO**:
"[Texto completo nota (**)] | [Texto completo nota (*****)] | Excepto 60% en Clínica Las Condes, Alemana y Las Nieves de Santiago."

**SI OMITES LA CONDICIÓN DE MALLA, ES ERROR CRÍTICO INACEPTABLE.**

---
**EJEMPLO DE APLICACIÓN CRÍTICA (Paso 4):**

Imagine que la prestación es "Día Cama" y está dentro de una Malla Visual que dice "Excepto 60% en Clínica Las Condes...". Además, "Día Cama" tiene notas al pie (**) y (*****).

*   **Texto de Nota (**):* "La Cobertura Sin Tope para Día Cama se otorgará solamente hasta el Día Cama Estándar..."
*   **Texto de Nota (*****):* "El listado de los prestadores... está disponible..."
*   **Texto de Malla Visual:** "Excepto 60% en Clínica Las Condes, Alemana y Las Nieves de Santiago."

**Salida CORRECTA para 'RESTRICCIÓN Y CONDICIONAMIENTO':**
"La Cobertura Sin Tope para Día Cama se otorgará solamente hasta el Día Cama Estándar del establecimiento... | El listado de los prestadores... está disponible... | Excepto 60% en Clínica Las Condes, Alemana y Las Nieves de Santiago."

**Salida INCORRECTA (OMISIÓN CRÍTICA):**
"La Cobertura Sin Tope para Día Cama se otorgará solamente hasta el Día Cama Estándar del establecimiento... | El listado de los prestadores... está disponible..."
(Aquí falta la condición de la Malla Visual. Esto es inaceptable).

---
**VERIFICACIÓN FINAL ANTES DE GENERAR JSON:**

Antes de producir el JSON final, ejecuta esta lista de verificación para CADA cobertura:
1. ✅ Si la prestación tiene asteriscos (*) en el documento, verifica que 'RESTRICCIÓN Y CONDICIONAMIENTO' contenga el texto COMPLETO de cada nota
2. ✅ Si la prestación está dentro de una Malla Visual, verifica que la condición de malla esté incluida COMPLETA
3. ✅ Si hay notas al pie, la restricción debe tener AL MENOS 100 caracteres (texto real, no solo "Ver condiciones")
4. ✅ NO uses frases genéricas como "Ver condiciones" o "Consultar restricciones" - INCLUYE EL TEXTO COMPLETO
5. ✅ Si una restricción tiene menos de 50 caracteres y hay asteriscos, es un ERROR CRÍTICO que debes corregir

---
**PARTE III: ESPECIFICACIÓN DE INTERFAZ (Objeto "diseno_ux")**

Complete los siguientes campos:
*   'nombre_isapre': Identifique el NOMBRE DE LA ISAPRE (ej: "Colmena", "Banmédica", "Cruz Blanca"). Es fundamental.
*   'titulo_plan': Identifique el TÍTULO PRINCIPAL del plan de salud (ej: "Plan de Salud Libre Elección", "Plan Complementario Colmena Golden Plus").
*   'subtitulo_plan': Identifique el SUBTÍTULO o código del plan (ej: "Código: 104-GOLD-23"). Si no existe, use un string vacío "".
*   'layout': "forensic_report_v2"
*   'funcionalidad': "pdf_isapre_analyzer_imperative"
*   'salida_json': "strict_schema_v3_final"

**SALIDA JSON VÁLIDA (OBLIGATORIA):**
- Responde SOLO con JSON válido (sin \`\`\` ni Markdown).
- Escapa cualquier comilla doble dentro de textos usando \\\\\".
- No uses comas finales (trailing commas) en objetos/arrays.
- No incluyas caracteres antes o después del JSON.
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
                    'MODALIDAD/RED': { type: "string", description: "Modalidad (Nacional/Internacional)" },
                    '% BONIFICACIÓN': { type: "string", description: "Porcentaje de bonificación (ej: 100%, 80%)" },
                    'COPAGO FIJO': { type: "string", description: "Copago fijo si existe (ej: $5000), sino '-'" },
                    'TOPE LOCAL 1 (VAM/EVENTO)': { type: "string", description: "Tope por evento o VAM" },
                    'TOPE LOCAL 2 (ANUAL/UF)': { type: "string", description: "Tope anual o en UF" },
                    'RESTRICCIÓN Y CONDICIONAMIENTO': { type: "string", description: "Restricciones, notas y excepciones de malla" },
                    'ANCLAJES': { type: "array", items: { type: "string", description: 'Páginas/notas referenciadas.' } }
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
