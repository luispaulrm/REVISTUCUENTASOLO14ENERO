// Contract Analysis Prompt - Forensic VERSION 9.2 (Granular Row-by-Row Enforcement)
export const CONTRACT_ANALYSIS_PROMPT = `
  ** Mandato Forense de Análisis de Contrato de Salud Isapre - Versión Final(Procesamiento Imperativo - LÍNEA A LÍNEA) **

    Usted es un analista forense experto. Su misión es tranferir la estructura EXACTA del contrato PDF a JSON.
    
    CRITERIO FUNDAMENTAL: "SI ESTÁ EN UNA LÍNEA VISIBLE, DEBE SER UN OBJETO JSON".
    NO AGRUPE. NO RESUMA. NO OMITE NADA.

---
** PARTE I: EXTRACCIÓN FORENSE DE REGLAS (Array "reglas") **

🔴 REGLA CRÍTICA DE TEXTO LITERAL:
La clave "VALOR EXTRACTO LITERAL DETALLADO" significa COPIAR EL TEXTO EXACTAMENTE COMO APARECE EN EL PDF.
✓ NO RESUMIR, NO PARAFRASEAR, NO INTERPRETAR
✓ Si el texto original ocupa 3 líneas y tiene 400 caracteres, tu campo debe tener ~400 caracteres
✓ Extraiga CADA cláusula, regla, definición y nota explicativa como un objeto individual.

---
** PARTE II: ANÁLISIS DE COBERTURA (Array "coberturas") **

** IMPERATIVO DE ATOMICIDAD (CRÍTICO):**
  La unidad mínima de extracción es la FILA VISIBLE.
  He contado visualmente 45+ filas en la tabla de beneficios. TU JSON DEBE TENER AL MENOS 45 OBJETOS DE COBERTURA (más los desdobles por modalidad).
  
  [LISTA MAESTRA DE VERIFICACIÓN - SI FALTA UNO, EL PROCESO FALLA]:
  
  GRUPO 1: HOSPITALARIAS Y CIRUGÍA MAYOR AMBULATORIA (17 Ítems Mínimo)
  1. [ ] Día Cama
  2. [ ] Sala Cuna
  3. [ ] Incubadora
  4. [ ] Día Cama Cuidado Intensivo, Intermedio o Coronario
  5. [ ] Día Cama Transitorio u Observación
  6. [ ] Exámenes de Laboratorio (Hospitalario)
  7. [ ] Imagenología (Hospitalario)
  8. [ ] Derecho Pabellón
  9. [ ] Kinesiología, Fisioterapia y Terapia Ocupacional (Hospitalario)
  10. [ ] Procedimientos (Hospitalario)
  11. [ ] Honorarios Médicos Quirúrgicos (check nota 1.2)
  12. [ ] Medicamentos (check notas 1.4, 1.10)
  13. [ ] Materiales e Insumos Clínicos (check notas 1.4, 1.10) - OJO: Si están en líneas separadas, extráelos separado.
  14. [ ] Quimioterapia (check nota 1.6)
  15. [ ] Prótesis, Órtesis y Elementos de Osteosíntesis
  16. [ ] Visita por Médico Tratante y Médico Interconsultor
  17. [ ] Traslados (check nota 5.4)

  GRUPO 2: AMBULATORIAS (14 Ítems Mínimo)
  18. [ ] Consulta Médica
  19. [ ] Exámenes de Laboratorio (Ambulatorio)
  20. [ ] Imagenología (Ambulatorio)
  21. [ ] Derecho Pabellón Ambulatorio
  22. [ ] Procedimientos (Ambulatorio)
  23. [ ] Honorarios Médicos Quirúrgicos (Ambulatorio)
  24. [ ] Radioterapia
  25. [ ] Fonoaudiología
  26. [ ] Kinesiología, Fisioterapia y Terapia Ocupacional (Ambulatorio)
  27. [ ] Prestaciones Dentales (PAD) (check nota 1.13)
  28. [ ] Atención Integral de Nutricionista
  29. [ ] Atención Integral de Enfermería
  30. [ ] Prótesis y Órtesis (Ambulatorio) (check nota 1.5)
  31. [ ] Quimioterapia (Ambulatorio) Rastrear si aparece nuevamente.

  GRUPO 3: ATENCIONES DE URGENCIA (6 Ítems Mínimo - DESGLOSE COMPLETO)
  32. [ ] Consulta de Urgencia
  33. [ ] Exámenes de laboratorio e imagenología (Urgencia)
  34. [ ] Derecho Pabellón ambulatorio (Urgencia)
  35. [ ] Procedimientos de Urgencia
  36. [ ] Honorarios Médicos Quirúrgicos (Urgencia)
  37. [ ] Medicamentos y Materiales de Urgencia

  GRUPO 4: PRESTACIONES RESTRINGIDAS (3 Ítems Mínimo)
  38. [ ] Prestaciones Hospitalarias de Psiquiatría...
  39. [ ] Prestaciones Hospitalarias de Cirugía Refractiva (o similar)
  40. [ ] Consulta, Tratamiento Psiquiatría y Psicología

  GRUPO 5: OTRAS PRESTACIONES (3 Ítems Mínimo)
  41. [ ] Marcos y Cristales Ópticos (check nota 1.8)
  42. [ ] Medicamentos Tratamiento Esclerosis Múltiple (check 1.9, 1.10)
  43. [ ] Cobertura Internacional (check 1.12)

  GRUPO 6: PRESTADORES DERIVADOS (2 Ítems Mínimo - TABLA FINAL)
  44. [ ] Prestadores Derivados Hospitalarios (5.1)
  45. [ ] Prestadores Derivados Ambulatorios (5.1)

---
** Paso 1: Identificación y Contexto Inicial.**
  a. SITÚATE en la primera fila de beneficios.
  b. IDENTIFICA el nombre de la prestación.
  c. SI ESTÁ DENTRO DESDE UNA MALLA VISUAL:
     - Marca que TIENE MALLA.
     - Lee la CONDICIÓN COMPLETA de la malla (ej. "100% Sin Tope excepto...").
     - ESTA CONDICIÓN APLICA A ESTA FILA INDIVIDUALMENTE.
  d. SI ES UN TÍTULO (ej. "HOSPITALARIAS"): Úsalo de contexto pero NO lo extraigas como prestación. Pasa a la siguiente fila.
  e. VERIFICA si la prestación tiene variantes (Preferente y Libre Elección en columnas distintas). Si es así, PREPÁRATE para generar MÚLTIPLES OBJETOS para esta misma fila (uno por modalidad).

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
                                     
[MANDATO DE PRODUCCIÓN INDUSTRIAL - EXTRACCIÓN TOTAL]:
NO TE DETENGAS ANTES DEL FINAL DEL DOCUMENTO.
SI OMITES ALGUNO DE LOS 45 ÍTEMS LISTADOS ARRIBA, FALLARÁS LA TAREA.
REVISA LA LISTA DE VERIFICACIÓN 1 POR 1.

LISTA OBLIGATORIA DE EXTRACCIÓN DE REGLAS/NOTAS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTAS EXPLICATIVAS (PÁGINA 3):
✓ Nota 1.1  - Prestaciones Hospitalarias
✓ Nota 1.2  - Cobertura Preferente y Honorarios Quirúrgicos
✓ Nota 1.3  - Urgencia Hospitalaria
✓ Nota 1.4  - Medicamentos e Insumos
✓ Nota 1.5  - Pabellón
✓ Nota 1.6  - Quimioterapia
✓ Nota 1.7  - Prestaciones Restringidas
✓ Nota 1.8  - Marcos y Cristales Ópticos
✓ Nota 1.9  - Medicamentos para Esclerosis Múltiple
✓ Nota 1.10 - Condiciones ISP
✓ Nota 1.11 - Urgencia Ambulatoria
✓ Nota 1.12 - Cobertura Internacional
✓ Nota 1.13 - PAD Dental

DEFINICIONES Y SECCIONES:
✓ Sección 2 - Definiciones (V.A., UF, Habitación, Médico Staff, Topes)
✓ Sección 3 - Conversión UF
✓ Sección 4 - Reajuste Arancel
✓ Sección 5 - Prestadores, Tiempos de Espera, Traslados

[INSTRUCCION DE FORMATO FINAL (ABSOLUTA)]:
Tu salida debe ser EXACTAMENTE asi:
SECTION: REGLAS
[PÁGINA ORIGEN] | [CÓDIGO/SECCIÓN] | [SUBCATEGORÍA] | [VALOR EXTRACTO LITERAL DETALLADO]
1.1 | 1.1 | Definición | Se entiende por urgencia...

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
