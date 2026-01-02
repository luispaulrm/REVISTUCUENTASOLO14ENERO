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
Asegúrese de capturar ÍNTEGRAMENTE bloques de texto como:
- "NOTAS EXPLICATIVAS DEL PLAN DE SALUD"
- "(1) COBERTURAS" (y sus puntos internos 1.1, 1.2, etc.)
- "(2) DEFINICIONES"
- "(3) VALOR DE CONVERSIÓN DE LA UF"
- "(4) REAJUSTE DEL ARANCEL"
- Cláusulas finales numéricas: DEBE extraer TODO (5.7, 5.8, etc.) hasta el final del texto.
- OBLIGATORIO: Busque y extraiga "5.7" (Término/Modificación) y "5.8" (Reglas especiales sobre modificación). NO SE DETENGA ANTES.
- Cláusulas de "Segunda Opinión", "Divergencias", "Modificación de Contrato".
- TODAS las notas al pie numeradas o con asteriscos.

Use las llaves:
- 'PÁGINA ORIGEN'
- 'CÓDIGO/SECCIÓN'
- 'SUBCATEGORÍA'
- 'VALOR EXTRACTO LITERAL DETALLADO'

**PROHIBICIONES ABSOLUTAS DE RESUMEN (CRITICO):**
❌ PROHIBIDO usar elipsis ("..."), puntos suspensivos o resúmenes.
❌ PROHIBIDO truncar párrafos largos. Extraiga CADA PALABRA del texto original.
❌ Si una nota explicativa tiene 500 palabras, el campo 'VALOR EXTRACTO LITERAL DETALLADO' DEBE tener esas mismas 500 palabras.
✅ COPY-PASTE EXACTO E ÍNTEGRO de todo el contenido textual.

**RESTRICCIONES NEGATIVAS (IMPORTANTE):**
NO extraiga como "reglas" la información específica del caso actual.
❌ IGNORAR: Nombres de pacientes, médicos, instituciones o diagnósticos.
❌ IGNORAR: Totales monetarios de facturas, bonificaciones específicas del caso o copagos calculados.
❌ IGNORAR: Fechas, folios de bonos o números de factura.
✅ SÓLO EXTRAER: Condiciones generales del plan, topes teóricos (UF/Veces), exclusiones contractuales y notas al pie genéricas.


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
   b. Si existe, cree DOS registros: 
      - Uno con 'MODALIDAD/RED': "NACIONAL"
      - Uno con 'MODALIDAD/RED': "INTERNACIONAL"
   c. Si no, solo cree uno con 'MODALIDAD/RED': "NACIONAL" (o "LIBRE ELECCIÓN" si aplica).

**Paso 3: Población de Datos de Topes.**
   a. **Nacional**: 
      - 'TOPE LOCAL 1 (VAM/EVENTO)': Busque regla local o valor de Malla Visual.
      - 'TOPE LOCAL 2 (ANUAL/UF)': Busque valor explícito.
   b. **Internacional**: 
      - 'TOPE LOCAL 1 (VAM/EVENTO)': Use valor de columna internacional.

**Paso 4: Síntesis de Restricciones Obligatoria (CRÍTICO - NO RESUMIR).**
   a. Para CADA registro:
      i. Inicie contenedor de texto 'RESTRICCIÓN Y CONDICIONAMIENTO'.
      ii. **Notas Vinculadas:** Agregue texto IDÉNTICO y COMPLETO de notas al pie, asteriscos (*) o números (1).
      iii. **Condición de Malla:** SI aplica malla, COPY-PASTE OBLIGATORIO de TODO el texto (ej. 'Excepto 60%...').
      iv. **Texto Largo:** Si el texto es largo, COPIALO ÍNTEGRAMENTE. PROHIBIDO usar "..." o cortar oraciones.
      v. **Consolide:** Combine con separador " | ".

**PARTE IV: AUTO-AUDITORÍA DE CIERRE (MENTAL - CRÍTICO)**
Antes de cerrar el objeto JSON, revise visualmente la **ÚLTIMA PÁGINA** del documento PDF.
1. ¿Existen cláusulas numeradas al final (ej. 5.7, 5.8, 6.1, 7.X)?
2. ¿Existen firmas o notas finales?
Si la respuesta es SÍ, **DEBE** agregarlas al array "reglas".
**NO FINALICE** hasta haber extraído el último carácter legible del documento.

**⚠️ REGLA CRÍTICA DE CAPTURA DE TEXTO:**
Si la celda de observaciones/restricciones tiene texto, COPIALO VERBATIM. 
Prohibido usar resúmenes o "ver anexo" sin incluir el contenido, ni usar elipsis "...".
Si hay texto como "Excepto 60% SIN TOPE en Clínica Las Condes...", ESTE DEBE APARECER ENTERO.

---
**VERIFICACIÓN FINAL:**
1. ✅ 'PRESTACIÓN CLAVE' tiene nombre completo.
2. ✅ 'RESTRICCIÓN Y CONDICIONAMIENTO' incluye notas y mallas completas.
3. ✅ 'TOPE LOCAL 1 (VAM/EVENTO)' y 'TOPE LOCAL 2 (ANUAL/UF)' capturan los valores.
4. ✅ 'MODALIDAD/RED' distingue explícitamente "Nacional" o "Internacional".

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
