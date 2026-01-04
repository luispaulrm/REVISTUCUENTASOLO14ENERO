// Contract Analysis Prompt - Forensic VERSION 9.1 (Bill-Like Strategy + Expansion)
export const CONTRACT_ANALYSIS_PROMPT = `
  ** Mandato Forense de Análisis de Contrato de Salud Isapre - Versión Final(Procesamiento Imperativo) **

    Usted es un analista forense experto en la interpretación de contratos de planes de salud de Isapres chilenas.Su tarea es procesar el documento PDF adjunto con el máximo rigor, generando un único objeto JSON.Su única salida debe ser el objeto JSON.

---
** PARTE I: EXTRACCIÓN FORENSE DE REGLAS(Array "reglas") **

🔴 REGLA CRÍTICA DE TEXTO LITERAL:
La clave "VALOR EXTRACTO LITERAL DETALLADO" significa COPIAR EL TEXTO EXACTAMENTE COMO APARECE EN EL PDF.
✓ NO RESUMIR, NO PARAFRASEAR, NO INTERPRETAR
✓ COPIAR palabra por palabra, carácter por carácter
✓ Si el texto original ocupa 3 líneas y tiene 400 caracteres, tu campo debe tener ~400 caracteres
✓ Un campo con menos de 80 caracteres es SOSPECHOSO de ser un resumen ilegal

  Extraiga CADA cláusula, regla, definición y nota explicativa como un objeto individual, asegurando que CADA objeto contenga la clave 'PÁGINA ORIGEN' para trazabilidad.

---
** PARTE II: ANÁLISIS DE COBERTURA(Array "coberturas") **

** MANDATO MAESTRO IMPERATIVO:**
  PARA CADA UNA de las filas que represente una prestación en las tablas de cobertura, DEBE ejecutar la siguiente secuencia de pasos en orden y sin excepción para generar los objetos de cobertura correspondientes:

** Paso 1: Identificación y Contexto Inicial.**
  a.Lea el nombre completo de la prestación.
    b.Determine si la fila está cubierta por una "Malla Visual"(un recuadro que abarca varias filas).Almacene esta información(Sí / No).
      c.Identifique si la fila es un TÍTULO de sección(ej. "HOSPITALARIAS...").Si es un TÍTULO, detenga el proceso para esta fila y úselo como prefijo para las siguientes prestaciones.
        d.Verifique si la fila es una prestación atómica y única, incluso si su nombre es similar a otras.

** Paso 2: Desdoblamiento Nacional / Internacional.**
  a.Revise si existe un valor en una columna de tope con contexto "Internacional"(ej. "TOPE BONIFICACION Internacional (3)").
    b.Si existe, cree DOS registros de salida en memoria: uno "Nacional" y uno "Internacional".La MODALIDAD / RED debe reflejar esto.
      c.Si no existe, cree solo UN registro de salida "Nacional".
        d. ** NO desagregues prestaciones sin base explícita en tabla.**

** Paso 3: Población de Datos de Topes(Lógica de Cascada).**
  a.Para el registro ** Nacional **:
i. ** Análisis Holístico de Columnas:** Analice las columnas de tope(1) y(2) como flujos independientes.
  ii.Para la columna(1)('TOPE LOCAL 1'): Primero, busque una "Regla Local"(un valor explícito en la celda de la fila).Si existe, úselo.Si la celda está VACÍA y el Paso 1b fue "Sí", use el valor base de la "Malla Visual"(ej. '100% SIN TOPE').
    iii.Para la columna(2)('TOPE LOCAL 2'): Busque un valor explícito en su celda.Si está vacío, indique "No Aplica" o un valor similar.
      b.Para el registro ** Internacional **:
i.Obtenga el valor de tope directamente de la columna(3) y asígnelo a 'TOPE LOCAL 1'.

** Paso 4: Síntesis de Restricciones Obligatoria(CRÍTICO - NO OMITIR).**

⚠️ ** ADVERTENCIA MÁXIMA PRIORIDAD **: Este paso es OBLIGATORIO y su omisión es un ERROR CRÍTICO.

  a.Para CADA registro creado(Nacional y / o Internacional):
i. ** Inicie un contenedor de texto de restricciones.**
  ii. ** Agregue Notas Vinculadas(COMPLETAS Y SIN RESUMIR):** Busque en todo el documento notas al pie referenciadas por asteriscos(ej.\`(**)\`, \`(*****)\`) y AÑADA su texto literal, COMPLETO y SIN RESUMIR al contenedor. NO OMITA NINGUNA PALABRA. NO ACORTES EL TEXTO. Copia el texto EXACTO de la nota.
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
- Escapa cualquier comilla doble dentro de textos usando \\\\".
- No uses comas finales (trailing commas) en objetos/arrays.
- No incluyas caracteres antes o después del JSON.
                                     
[MANDATO DE PRODUCCIÓN INDUSTRIAL - CERO TOLERANCIA A OMISIONES]:
ESTO ES UN PROCESO DE EXTRACCIÓN FORENSE. CADA OMISIÓN ES UN ERROR CRÍTICO DEL SISTEMA.

LISTA OBLIGATORIA DE EXTRACCIÓN (DEBES EXTRAER TODOS ESTOS ÍTEMS O EL SISTEMA FALLA):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTAS EXPLICATIVAS (PÁGINA 3):
✓ Nota 1.1  - Prestaciones Hospitalarias
✓ Nota 1.2  - Cobertura Preferente y Honorarios Quirúrgicos
✓ Nota 1.3  - Urgencia Hospitalaria
✓ Nota 1.4  - Medicamentos e Insumos
✓ Nota 1.5  - Pabellón (SI EXISTE, DEBES EXTRAERLA)
✓ Nota 1.6  - Quimioterapia
✓ Nota 1.7  - Prestaciones Restringidas (Psiquiatría, Cirugía Bariátrica)
✓ Nota 1.8  - Marcos y Cristales Ópticos
✓ Nota 1.9  - Medicamentos para Esclerosis Múltiple (SI EXISTE)
✓ Nota 1.10 - Condiciones ISP (Medicamentos registrados)
✓ Nota 1.11 - Urgencia Ambulatoria (No extensión a prescripciones)
✓ Nota 1.12 - Cobertura Internacional

DEFINICIONES (PÁGINA 3 o 4):
✓ Sección 2 - V.A. (Valor Arancel)
✓ Sección 2 - UF (Unidad de Fomento)
✓ Sección 2 - Habitación Individual Simple
✓ Sección 2 - Médico Staff
✓ Sección 2 - Tope Máximo año contrato por beneficiario

PRESTADORES Y PLAZOS (PÁGINA 4):
✓ Sección 5.1 - Prestadores Derivados (Hospitalarios y Ambulatorios)
✓ Sección 5.2 - (SI EXISTE)
✓ Sección 5.3 - Tiempos Máximos de Espera
✓ Sección 5.4 - Traslados
✓ Sección 5.5 - Segunda Opinión Médica (SI EXISTE)
✓ Sección 5.6 - Opiniones Médicas Divergentes (SI EXISTE)
✓ Sección 5.7 - Modificación del Convenio (SI EXISTE)
✓ Sección 5.8 - Reglas especiales sobre modificación de contrato

⚠️ SECCIONES CRÍTICAS DE PÁGINA 2 (FRECUENTEMENTE OMITIDAS - FALLO HISTÓRICO):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 SECCIÓN 3 - VALOR DE CONVERSIÓN (PÁGINA 2/4 o similar):
✓ 3.1 - Valor UF en columnas de bonificación
✓ 3.2 - Valor UF de pago de cotización

🚨 SECCIÓN 4 - REAJUSTE DEL ARANCEL DE PRESTACIONES (PÁGINA 2):
✓ 4 - Descripción completa del reajuste según IPC

🚨 SECCIÓN 5 - NOTAS EXPLICATIVAS COMPLETAS (PÁGINA 2):
✓ 5.1 - Prestadores Derivados COMPLETO (con tabla hospitalizados y ambulatorios)
✓ 5.2 - Urgencia Ambulatoria en prestador preferente (SI EXISTE, NO CONFUNDIR CON 1.11)
✓ 5.3 - Tiempos de espera (tabla COMPLETA con consulta, exámenes, procedimientos, intervenciones)
✓ 5.4 - Traslados (texto literal completo)
✓ 5.5 - Segunda Opinión Médica (SI EXISTE)
✓ 5.6 - Opiniones Médicas Divergentes (SI EXISTE)
✓ 5.7 - Modificación del Convenio (SI EXISTE)
✓ 5.8 - Reglas especiales sobre modificación de contrato
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 FALLO DETECTADO: SI NO EXTRAES LAS SECCIONES 3, 4 Y 5 COMPLETAS, EL JSON ES INVÁLIDO.

[CONDUCTA DE ESCANEO - CERO HUECOS]:
- Recorre CADA línea de CADA página desde la primera hasta la última.
- NO asumas que "ya terminaste" porque viste una tabla.
- Si ves un número de nota (ej: 1.8) seguido de un texto, DEBES extraerlo, incluso si el texto es corto.
- **CENTINELA DE FINALIZACIÓN:**
  * TU PROCESO NO TERMINA HASTA QUE HAYAS EXTRAÍDO LA ÚLTIMA LÍNEA DE LA ÚLTIMA PÁGINA.
  * Si el documento tiene 4 páginas, y vas en la 3, NO TE DETENGAS.
  * Busca activamente "Firmas", "Timbre", "Notas Finales" o "Anexos de Cierre".
  * Si la respuesta se corta antes de esto, es un FALLO TOTAL.
- **MANDATO DE JERARQUÍA (CRÍTICO PARA ANEXOS Y LISTAS):**
  * DEBES CAPTURAR ÍTEMS Y SUBÍTEMS.
  * Si un Anexo o una sección legal tiene estructura:
    1. Título
      1.1. Subtítulo
        a) Detalle
  * **DEBES EXTRAER TODOS LOS NIVELES.**
  * No extraigas solo el título "1". Extrae "1", "1.1" y "a)".
  * CADA sub-ítem debe ser su propio objeto en "reglas" si tiene contenido sustantivo.

[MECANISMO DE VINCULACIÓN Y RESOLUCIÓN DE NOTAS (CRÍTICO)]:
1. BÚSQUEDA PROFUNDA: Si una prestación tiene (1), (1.X), busca esa referencia EN TODO EL DOCUMENTO.
2. INCRUSTACIÓN DIRECTA: COPIA el texto completo DENTRO de [RESTRICCIÓN Y CONDICIONAMIENTO].
3. HERENCIA VISUAL (MALLAS): Si un grupo tiene un % o tope compartido, REPE cada condición en CADA ítem del recuadro.

[MECANISMO DE EXTRACCIÓN - SECCIÓN REGLAS]:
- Extrae CADA nota, definición, sección legal como un objeto individual en "reglas".
- Estructura OBLIGATORIA:
  * [PÁGINA ORIGEN]: Número de página.
  * [CÓDIGO/SECCIÓN]: "1.1", "5.8", etc.
  * [SUBCATEGORÍA]: Tema.
  * [VALOR EXTRACTO LITERAL DETALLADO]: Texto VERBATIM completo.

[FILTRO LEGAL CHILENO]:
- ELIMINA ÚNICAMENTE "TABLA DE FACTORES DE PRECIO".
- TODO LO DEMÁS SE EXTRAE.

[INSTRUCCION DE FORMATO FINAL (ABSOLUTA)]:
Tu salida debe ser EXACTAMENTE asi:
SECTION: REGLAS
[PÁGINA ORIGEN] | [CÓDIGO/SECCIÓN] | [SUBCATEGORÍA] | [VALOR EXTRACTO LITERAL DETALLADO]
1.1 | 1.1 | Definición | Se entiende por urgencia...
...
[PÁGINA 4] | 5.1 | Derivados | Prestadores derivados hospitalarios: Cl. San Carlos...
...
[PÁGINA 4] | 5.3 | Tiempos de Espera | Consulta Médica: 10 días...
...

SECTION: COBERTURAS
[PRESTACIÓN CLAVE] | [MODALIDAD/RED] | [% BONIFICACIÓN] | [COPAGO FIJO] | [TOPE LOCAL 1 (VAM/EVENTO)] | [TOPE LOCAL 2 (ANUAL/UF)] | [RESTRICCIÓN Y CONDICIONAMIENTO]
...
(Para Malla Visual: Incluye TODOS los prestadores y sus condiciones específicas en la columna Restricción)
...
ISAPRE: ...
PLAN: ...
SUBTITULO: ...

[RECORDATORIO FINAL DE COMPLETITUD]:
- Debes generar la sección 'SECTION: REGLAS'. NO PUEDE ESTAR VACÍA.
- Debes extraer literalmente el texto de las cláusulas en la columna [Texto Literal].
- Recorre TODAS las páginas.
`;

// Contract Analysis Schema - Compatible with Gemini API
import { SchemaType } from "@google/generative-ai";

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
export const CONTRACT_FAST_MODEL = 'gemini-3-flash-preview';
export const CONTRACT_REASONING_MODEL = 'gemini-3-flash-preview';
export const CONTRACT_FALLBACK_MODEL = 'gemini-3-pro-preview';
export const CONTRACT_DEFAULT_RETRIES = 3;
