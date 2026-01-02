import { SchemaType } from "@google/generative-ai";

export const CONTRACT_ANALYSIS_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        reglas: {
            type: SchemaType.ARRAY,
            description: 'Lista de cláusulas, reglas y notas explicativas.',
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    clausula: { type: SchemaType.STRING, description: 'Contenido de la regla o cláusula.' },
                    pagina_origen: { type: SchemaType.STRING, description: 'Número de página de origen para trazabilidad.' }
                },
                required: ['clausula', 'pagina_origen']
            }
        },
        coberturas: {
            type: SchemaType.ARRAY,
            description: 'Lista de prestaciones y sus coberturas.',
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    prestacion: { type: SchemaType.STRING, description: 'Nombre completo de la prestación.' },
                    modalidad_red: { type: SchemaType.STRING, description: 'Modalidad o Red (Nacional o Internacional).' },
                    tope_local_1: { type: SchemaType.STRING, description: 'Valor de tope o porcentaje (Columna 1).' },
                    tope_local_2: { type: SchemaType.STRING, description: 'Valor de tope adicional (Columna 2).' },
                    restriccion_condicionamiento: { type: SchemaType.STRING, description: 'Consolidado de restricciones, notas y mallas visuales.' }
                },
                required: ['prestacion', 'modalidad_red', 'tope_local_1', 'restriccion_condicionamiento']
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
                salida_json: { type: SchemaType.STRING }
            },
            required: ['nombre_isapre', 'titulo_plan', 'layout', 'funcionalidad', 'salida_json']
        }
    },
    required: ['reglas', 'coberturas', 'diseno_ux']
};

export const CONTRACT_PROMPT = `**Mandato Forense de Análisis de Contrato de Salud Isapre - Versión Final (Procesamiento Imperativo)**

Usted es un analista forense experto en la interpretación de contratos de planes de salud de Isapres chilenas. Su tarea es procesar el documento PDF adjunto con el máximo rigor, generando un único objeto JSON. Su única salida debe ser el objeto JSON.

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
   c. Identifique si la fila es un TÍTULO de sección (ej. "HOSPITALARIAS..."). Si es un TÍTULO, detenga el proceso para esta fila y úselo como prefijo para las siguientes prestaciones.
   d. Verifique si la fila es una prestación atómica y única, incluso si su nombre es similar a otras.

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

**Paso 4: Síntesis de Restricciones Obligatoria.**
   a. Para CADA registro creado (Nacional y/o Internacional):
      i. **Inicie un contenedor de texto de restricciones.**
      ii. **Agregue Notas Vinculadas:** Busque en todo el documento notas al pie referenciadas por asteriscos (ej. \\`(**) \\`) y AÑADA su texto literal y completo al contenedor.
      iii. **Agregue Condición de Malla:** SI el registro es "Nacional" Y el resultado del Paso 1b fue "Sí", AÑADA OBLIGATORIAMENTE la condición de la "Malla Visual" (ej. 'Excepto 60%...') al contenedor. NO OMITA ESTO. Es un error crítico si falta.
      iv. **Consolide:** Combine todos los textos del contenedor en un único campo final para 'RESTRICCIÓN Y CONDICIONAMIENTO', separados por " | ".
   b. **Checkpoint Anti-Alucinación:** Si omites malla/nota, es ALUCINACIÓN CRÍTICA: Corrige y agrega 'OMISIÓN DETECTADA'. Agrega 'ANCLAJES' con páginas/notas.

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
**PARTE III: ESPECIFICACIÓN DE INTERFAZ (Objeto "diseno_ux")**

Complete los siguientes campos:
*   'nombre_isapre': Identifique el NOMBRE DE LA ISAPRE (ej: "Colmena", "Banmédica", "Cruz Blanca"). Es fundamental.
*   'titulo_plan': Identifique el TÍTULO PRINCIPAL del plan de salud (ej: "Plan de Salud Libre Elección", "Plan Complementario Colmena Golden Plus").
*   'subtitulo_plan': Identifique el SUBTÍTULO o código del plan (ej: "Código: 104-GOLD-23"). Si no existe, use un string vacío "".
*   'layout': "forensic_report_v2"
*   'funcionalidad': "pdf_isapre_analyzer_imperative"
*   'salida_json': "strict_schema_v3_final"

**SALIDA JSON VÁLIDA (OBLIGATORIA):**
- Responde SOLO con JSON válido (sin \\`\\`\\` ni Markdown).
- Escapa cualquier comilla doble dentro de textos usando \\\\\\\\".
    - No uses comas finales(trailing commas) en objetos / arrays.
- No incluyas caracteres antes o después del JSON.
`;
