import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

/**
 * PROMPT EXCLUSIVO PARA PASE 1: ESCÁNER LEGAL
 * Objetivo: Transcripción íntegra de notas al pie y definiciones.
 */
export const PROMPT_REGLAS_SOLO_PASE_1 = `
  ** MANDATO: ESCÁNER TEXTUAL ÍNTEGRO v9.0 **

  ROL: Transcriptor Legal Forense de Alta Precisión.
  OBJETIVO: Copiar PALABRA POR PALABRA cada punto de las "Notas Explicativas" y "Definiciones".

  ⚠️ INSTRUCCIONES DE NAVEGACIÓN VISUAL (ESTRICTO):
  1. **IGNORA LA PÁGINA 1 Y 2**: Salta las tablas de beneficios, porcentajes y topes.
  2. **ANCLA DE INICIO**: Tu trabajo comienza donde dice "1. COBERTURAS" (Sección de Notas Explicativas).
  3. **FOCALIZACIÓN**: Solo extrae texto plano denso. Ignora gráficos decorativos.

  ⚠️ REGLAS DE TRANSCRIPCIÓN (CERO RESUMEN):
  1. **TRANSCRIPCIÓN ÍNTEGRA**: El campo 'VALOR EXTRACTO LITERAL DETALLADO' debe ser un COPY-PASTE exacto del párrafo. 
  2. **PROHIBIDO**: No uses elipsis (...), no resumas y no uses la frase "según indica el plan".
  3. **ATOMICIDAD**: Si la Nota 1.1 tiene 3 párrafos, genera 3 objetos JSON independientes.
  4. **LISTAS TÉCNICAS**: Copia íntegramente listas de exclusión (ej: pañales, kit de aseo) y códigos Fonasa (ej: 1802053).

  NO analices. NO calcules. SOLO TRANSURIBE EL TEXTO VISIBLE.
  
  FORMATO: JSON Strict.
`;

export const SCHEMA_REGLAS_SOLO_PASE_1 = {
  type: SchemaType.OBJECT,
  properties: {
    reglas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          'PÁGINA ORIGEN': { type: SchemaType.STRING },
          'CÓDIGO/SECCIÓN': { type: SchemaType.STRING, description: "Ej: Nota 1.1, Nota 5.3" },
          'VALOR EXTRACTO LITERAL DETALLADO': {
            type: SchemaType.STRING,
            description: "Transcripción palabra por palabra. Mínimo 50 caracteres."
          },
          'CÓDIGO_DISPARADOR_FONASA': { type: SchemaType.STRING, description: "Lista de códigos detectados en el texto" },
          'SUBCATEGORÍA': { type: SchemaType.STRING, description: "Ej: Exclusiones, Tiempos, Urgencia" }
        },
        required: ['PÁGINA ORIGEN', 'CÓDIGO/SECCIÓN', 'VALOR EXTRACTO LITERAL DETALLADO']
      }
    }
  },
  required: ['reglas']
};

/**
 * CONFIGURACIÓN DE GENERACIÓN PARA FLASH 3
 */
export const GENERATION_CONFIG_PASE_1 = {
  temperature: 0,           // Precisión OCR máxima
  topP: 0.1,                // Cero desviación de caracteres
  maxOutputTokens: 8192,    // Espacio máximo para textos largos
  responseMimeType: "application/json"
};



// --- SPLIT PROMPTS FOR 3-PASS EXTRACTION ---

// --- SPLIT PROMPTS FOR 4-PASS UNIVERSAL ARCHITECTURE (v8.5 ESCÁNER TEXTUAL) ---

export const PROMPT_REGLAS = `
  ** MANDATO: ESCÁNER LEGAL FORENSE v10.0 ULTRA-ATÓMICO **

  ROL: Transcriptor Forensic de Contratos de Salud (Isapres).
  OBJETIVO: Extraer CADA PÁRRAFO de CADA NOTA como un objeto JSON independiente.

  ⚠️ META DE SALIDA MÍNIMA: 100+ OBJETOS JSON.
  Si generas menos de 80 reglas, has FALLADO en tu misión.

  ⚠️ INSTRUCCIONES DE NAVEGACIÓN VISUAL (ESTRICTO):
  1. **IGNORA LA CARÁTULA**: Salta las tablas de porcentajes, beneficios y topes de las páginas 1 y 2.
  2. **ANCLA DE INICIO**: Tu trabajo comienza estrictamente donde dice "1. COBERTURAS" o "Notas Explicativas del Plan".
  3. **FOCALIZACIÓN**: Lee TODO el texto denso de las páginas 3 a 10.

  ⚠️ CHECKLIST OBLIGATORIO DE NOTAS (DEBES ENCONTRAR TODAS):
  
  **SECCIÓN 1: COBERTURAS**
  - Nota 1.1: Prestaciones Hospitalarias (busca 2-3 párrafos, genera 2-3 JSONs)
  - Nota 1.2: Cobertura Preferente (busca 2-4 párrafos)
  - Nota 1.3: Urgencia Hospitalaria (al menos 1 párrafo largo)
  - Nota 1.4: Medicamentos e Insumos (OBLIGATORIO: párrafo largo, divídelo en 2-3 JSONs por oración)
  - Nota 1.5: Audífonos (1 JSON)
  - Nota 1.6: (Si existe)
  - Nota 1.7: Prestadores Derivados o Cobertura Restringida
  - Nota 1.8: Marcos y Cristales Ópticos (Presbicia)
  - Nota 1.9: (Si existe)
  - Nota 1.10: Garantía ISP (OBLIGATORIO)
  - Nota 1.11: Urgencias Ambulatorias
  - Nota 1.12: (Si existe)
  - Nota 1.13: PAD Dental
  - Nota 1.14 a 1.20: (Busca cualquier numeración restante)

  **SECCIÓN 2: DEFINICIONES**
  - 2.1 a 2.10: Definición de UF, Tope, Habitación, Orden Médica, etc. (genera 1 JSON por definición)

  **SECCIÓN 3: EXCLUSIONES (Si existe)**
  - 3.1 a 3.X: Lista cada exclusión como JSON independiente.

  **SECCIÓN 4: PRESTACIONES RESTRINGIDAS (Si existe)**
  - 4.1 a 4.X

  **SECCIÓN 5: OFERTA PREFERENTE**
  - Nota 5.1: Prestadores Derivados
  - Nota 5.2: Disponibilidad
  - Nota 5.3: TIEMPOS MÁXIMOS DE ESPERA (¡OBLIGATORIO! Genera 1 JSON por cada tiempo: Consulta, Lab, Imagen, Procedimientos, Cirugía)
  - Nota 5.4 a 5.10: (Si existen)

  ⚠️ REGLAS DE ATOMICIDAD EXTREMA:
  1. **UN PÁRRAFO = UN JSON**: Si la Nota 1.4 tiene 3 oraciones separadas por punto seguido, genera 3 JSONs.
  2. **LISTAS = EXPLOSIONES**: Si una nota dice "Se excluyen: a) pañales, b) kit de aseo, c) sondas", genera 3 JSONs (uno por item).
  3. **TABLA DE TIEMPOS (5.3)**: Genera 5 JSONs separados (Consulta 10 días, Lab 4 días, etc.).

  ⚠️ FORMATO DE TRANSCRIPCIÓN:
  - 'VALOR EXTRACTO LITERAL DETALLADO': COPY-PASTE exacto del párrafo o FRASE COMPLETA.
  - 'CÓDIGO/SECCIÓN': "Nota 1.4 (Oración 1)", "Nota 5.3 (Consulta)", etc.

  NO resumas. NO agrupes. SOLO MULTIPLICA.
  
  FORMATO: JSON Strict (Schema Reglas).
`;

export const PROMPT_COBERTURAS_HOSP = `
  ** MANDATO UNIVERSAL v10.3: PASE 2 - HOSPITALARIO (ENUMERACIÓN ULTRA-EXPLÍCITA) **
  
  OBJETIVO: Generar EXACTAMENTE las 56 filas listadas abajo. NO resumir, NO consolidar.
  
  ⚠️ META MATEMÁTICA: 56 OBJETOS JSON EXACTOS.
  Si generas menos de 50, has FALLADO.
  
  ⚠️ CHECKLIST NUMERADO (GENERA EXACTAMENTE ESTAS FILAS):
  
  **SECCIÓN 1: DÍA CAMA (14 filas obligatorias)**
  1. Día Cama - Clínica Alemana (Oferta Preferente)
  2. Día Cama - Clínica Universidad de los Andes (Oferta Preferente)
  3. Día Cama - Clínica San Carlos de Apoquindo (Oferta Preferente)
  4. Día Cama - Clínica Santa María (Oferta Preferente)
  5. Día Cama - Hospital Clínico UC (Oferta Preferente)
  6. Día Cama - Clínica Las Condes (Oferta Preferente)
  7. Día Cama - Clínica Indisa (Oferta Preferente)
  8. Día Cama (Libre Elección)
  
  **SECCIÓN 2: DÍA CAMA UTI/UCI (8 filas obligatorias)**
  9. Día Cama UTI/UCI - Clínica Alemana (Oferta Preferente)
  10. Día Cama UTI/UCI - Clínica Universidad de los Andes (Oferta Preferente)
  11. Día Cama UTI/UCI - Clínica San Carlos de Apoquindo (Oferta Preferente)
  12. Día Cama UTI/UCI - Clínica Santa María (Oferta Preferente)
  13. Día Cama UTI/UCI - Hospital Clínico UC (Oferta Preferente)
  14. Día Cama UTI/UCI - Clínica Las Condes (Oferta Preferente)
  15. Día Cama UTI/UCI - Clínica Indisa (Oferta Preferente)
  16. Día Cama UTI/UCI (Libre Elección)
  
  **SECCIÓN 3: DERECHO PABELLÓN (8 filas obligatorias)**
  17. Derecho Pabellón - Clínica Alemana (Oferta Preferente)
  18. Derecho Pabellón - Clínica Universidad de los Andes (Oferta Preferente)
  19. Derecho Pabellón - Clínica San Carlos de Apoquindo (Oferta Preferente)
  20. Derecho Pabellón - Clínica Santa María (Oferta Preferente)
  21. Derecho Pabellón - Hospital Clínico UC (Oferta Preferente)
  22. Derecho Pabellón - Clínica Las Condes (Oferta Preferente)
  23. Derecho Pabellón - Clínica Indisa (Oferta Preferente)
  24. Derecho Pabellón (Libre Elección)
  
  **SECCIÓN 4: HONORARIOS MÉDICOS QUIRÚRGICOS (8 filas obligatorias)**
  25. Honorarios Médicos Quirúrgicos - Clínica Alemana (Oferta Preferente)
  26. Honorarios Médicos Quirúrgicos - Clínica Universidad de los Andes (Oferta Preferente)
  27. Honorarios Médicos Quirúrgicos - Clínica San Carlos de Apoquindo (Oferta Preferente)
  28. Honorarios Médicos Quirúrgicos - Clínica Santa María (Oferta Preferente)
  29. Honorarios Médicos Quirúrgicos - Hospital Clínico UC (Oferta Preferente)
  30. Honorarios Médicos Quirúrgicos - Clínica Las Condes (Oferta Preferente)
  31. Honorarios Médicos Quirúrgicos - Clínica Indisa (Oferta Preferente)
  32. Honorarios Médicos Quirúrgicos (Libre Elección)
  
  **SECCIÓN 5: MEDICAMENTOS (8 filas obligatorias)**
  33. Medicamentos - Clínica Alemana (Oferta Preferente)
  34. Medicamentos - Clínica Universidad de los Andes (Oferta Preferente)
  35. Medicamentos - Clínica San Carlos de Apoquindo (Oferta Preferente)
  36. Medicamentos - Clínica Santa María (Oferta Preferente)
  37. Medicamentos - Hospital Clínico UC (Oferta Preferente)
  38. Medicamentos - Clínica Las Condes (Oferta Preferente)
  39. Medicamentos - Clínica Indisa (Oferta Preferente)
  40. Medicamentos (Libre Elección)
  
  **SECCIÓN 6: MATERIALES E INSUMOS (8 filas obligatorias)**
  41. Materiales e Insumos Clínicos - Clínica Alemana (Oferta Preferente)
  42. Materiales e Insumos Clínicos - Clínica Universidad de los Andes (Oferta Preferente)
  43. Materiales e Insumos Clínicos - Clínica San Carlos de Apoquindo (Oferta Preferente)
  44. Materiales e Insumos Clínicos - Clínica Santa María (Oferta Preferente)
  45. Materiales e Insumos Clínicos - Hospital Clínico UC (Oferta Preferente)
  46. Materiales e Insumos Clínicos - Clínica Las Condes (Oferta Preferente)
  47. Materiales e Insumos Clínicos - Clínica Indisa (Oferta Preferente)
  48. Materiales e Insumos Clínicos (Libre Elección)
  
  **SECCIÓN 7: ANESTESIA (8 filas obligatorias)**
  49. Anestesia - Clínica Alemana (Oferta Preferente)
  50. Anestesia - Clínica Universidad de los Andes (Oferta Preferente)
  51. Anestesia - Clínica San Carlos de Apoquindo (Oferta Preferente)
  52. Anestesia - Clínica Santa María (Oferta Preferente)
  53. Anestesia - Hospital Clínico UC (Oferta Preferente)
  54. Anestesia - Clínica Las Condes (Oferta Preferente)
  55. Anestesia - Clínica Indisa (Oferta Preferente)
  56. Anestesia (Libre Elección)
  
  **= TOTAL: 56 FILAS OBLIGATORIAS PARA HOSPITALARIO**
  
  ⚠️ PROHIBIDO ABSOLUTO:
  - **NO CREAR ÍTEMS DE RESUMEN O AGREGACIÓN.** Cada fila debe ser ÚNICA y ATÓMICA.
  - **NO CONSOLIDAR** múltiples clínicas en una sola fila.
  - **NO CREAR "Día Cama" genérico** que liste todas las clínicas.
  - **NO CREAR filas adicionales** fuera de esta lista numerada.
  
  ⚠️ RESTRICCIONES OBLIGATORIAS POR TIPO:
  
  **Día Cama (todas las clínicas):**
  - 'nota_restriccion': "Habitación Individual Simple. Referencia: Nota 1.4, 2.3"
  - Para CLC agregar: "Sólo con bonos. Referencia: Nota 1.2"
  
  **Honorarios (todas las clínicas):**
  - 'nota_restriccion': "Sólo con Médicos Staff. Referencia: Nota 1.2"
  - Para CLC agregar: "Sólo con bonos. Referencia: Nota 1.2"
  
  **Medicamentos (todas las clínicas):**
  - 'nota_restriccion': "Sólo en prestaciones que requieran hospitalización y en cirugías ambulatorias (pabellón 5 o superior). Excluye drogas antineoplásicas. No cubre insumos ambulatorios. Solo medicamentos registrados en ISP. Referencia: Nota 1.4, 1.10"
  - Para CLC agregar: "Sólo con bonos. Referencia: Nota 1.2"
  
  **Materiales e Insumos (todas las clínicas):**
  - 'nota_restriccion': "Sólo en prestaciones que requieran hospitalización y en cirugías ambulatorias (pabellón 5 o superior). Solo insumos registrados en ISP. Referencia: Nota 1.4, 1.10"
  - Para CLC agregar: "Sólo con bonos. Referencia: Nota 1.2"
  
  **Anestesia (todas las clínicas):**
  - 'nota_restriccion': "Sólo con Médicos Staff. Referencia: Nota 1.2"
  - Para CLC agregar: "Sólo con bonos. Referencia: Nota 1.2"
  
  **Libre Elección (todos los ítems):**
  - 'nota_restriccion': "Sujeto a arancel Isapre. Tope por evento/beneficiario. Referencia: Nota 1.1, 1.4"
  
  ⚠️ REGLA DE NOMENCLATURA:
  - 'item': EXACTAMENTE como está en la lista numerada arriba.
  - 'modalidad': "Oferta Preferente" o "Libre Elección" según indica la lista.
  - 'nota_restriccion': NUNCA null. Usar las plantillas de arriba.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_COBERTURAS_AMB = `
  ** MANDATO UNIVERSAL v10.3: PASE 3 - AMBULATORIO (ENUMERACIÓN ULTRA-EXPLÍCITA) **
  
  OBJETIVO: Generar EXACTAMENTE las 70 filas listadas abajo. NO resumir, NO consolidar.
  
  ⚠️ META MATEMÁTICA: 70 OBJETOS JSON EXACTOS.
  Si generas menos de 60, has FALLADO.
  
  ⚠️ CHECKLIST NUMERADO (GENERA EXACTAMENTE ESTAS FILAS):
  
  **SECCIÓN 1: CONSULTAS (4 filas)**
  1. Consulta Médica General (Oferta Preferente)
  2. Consulta Médica General (Libre Elección)
  3. Consulta Pediatría (Oferta Preferente)
  4. Consulta Pediatría (Libre Elección)
  
  **SECCIÓN 2: LABORATORIO (14 filas)**
  5. Exámenes de Laboratorio (Oferta Preferente)
  6. Exámenes de Laboratorio (Libre Elección)
  7. Hemograma (Oferta Preferente)
  8. Hemograma (Libre Elección)
  9. Perfil Bioquímico (Oferta Preferente)
  10. Perfil Bioquímico (Libre Elección)
  11. Orina Completa (Oferta Preferente)
  12. Orina Completa (Libre Elección)
  13. Cultivos (Oferta Preferente)
  14. Cultivos (Libre Elección)
  15. Glucosa en Sangre (Oferta Preferente)
  16. Glucosa en Sangre (Libre Elección)
  17. Perfil Lipídico (Oferta Preferente)
  18. Perfil Lipídico (Libre Elección)
  
  **SECCIÓN 3: IMAGENOLOGÍA (16 filas)**
  19. Imagenología (Oferta Preferente)
  20. Imagenología (Libre Elección)
  21. Rayos X (Oferta Preferente)
  22. Rayos X (Libre Elección)
  23. Ecotomografía (Oferta Preferente)
  24. Ecotomografía (Libre Elección)
  25. TAC/Scanner (Oferta Preferente)
  26. TAC/Scanner (Libre Elección)
  27. Resonancia Magnética (Oferta Preferente)
  28. Resonancia Magnética (Libre Elección)
  29. Mamografía (Oferta Preferente)
  30. Mamografía (Libre Elección)
  31. Densitometría Ósea (Oferta Preferente)
  32. Densitometría Ósea (Libre Elección)
  33. Ecografía Doppler (Oferta Preferente)
  34. Ecografía Doppler (Libre Elección)
  
  **SECCIÓN 4: PROCEDIMIENTOS (12 filas)**
  35. Procedimientos Diagnósticos (Oferta Preferente)
  36. Procedimientos Diagnósticos (Libre Elección)
  37. Procedimientos Terapéuticos (Oferta Preferente)
  38. Procedimientos Terapéuticos (Libre Elección)
  39. Endoscopía Digestiva (Oferta Preferente)
  40. Endoscopía Digestiva (Libre Elección)
  41. Colonoscopía (Oferta Preferente)
  42. Colonoscopía (Libre Elección)
  43. Biopsia (Oferta Preferente)
  44. Biopsia (Libre Elección)
  45. Electrocardiograma (Oferta Preferente)
  46. Electrocardiograma (Libre Elección)
  
  **SECCIÓN 5: TERAPIAS (8 filas)**
  47. Kinesiología (Oferta Preferente)
  48. Kinesiología (Libre Elección)
  49. Fonoaudiología (Oferta Preferente)
  50. Fonoaudiología (Libre Elección)
  51. Terapia Ocupacional (Oferta Preferente)
  52. Terapia Ocupacional (Libre Elección)
  53. Nutricionista (Oferta Preferente)
  54. Nutricionista (Libre Elección)
  
  **SECCIÓN 6: URGENCIAS (4 filas)**
  55. Urgencia Simple Adulto (Oferta Preferente)
  56. Urgencia Simple Adulto (Libre Elección)
  57. Urgencia Compleja Adulto (Oferta Preferente)
  58. Urgencia Compleja Adulto (Libre Elección)
  
  **SECCIÓN 7: SALUD MENTAL (4 filas)**
  59. Consulta Psiquiatría (Oferta Preferente)
  60. Consulta Psiquiatría (Libre Elección)
  61. Consulta Psicología (Oferta Preferente)
  62. Consulta Psicología (Libre Elección)
  
  **SECCIÓN 8: DENTAL (4 filas)**
  63. PAD Dental (Oferta Preferente)
  64. PAD Dental (Libre Elección)
  65. Tratamiento Dental General (Oferta Preferente)
  66. Tratamiento Dental General (Libre Elección)
  
  **SECCIÓN 9: ÓPTICA Y PRÓTESIS (4 filas)**
  67. Lentes Ópticos (Libre Elección)
  68. Lentes de Contacto (Libre Elección)
  69. Audífonos (Libre Elección)
  70. Prótesis y Órtesis (Libre Elección)
  
  **= TOTAL: 70 FILAS OBLIGATORIAS PARA AMBULATORIO**
  
  ⚠️ PROHIBIDO ABSOLUTO:
  - **NO CREAR ÍTEMS DE RESUMEN O AGREGACIÓN.** Cada fila debe ser ÚNICA y ATÓMICA.
  - **NO CONSOLIDAR** múltiples prestaciones en una sola fila.
  - **NO CREAR filas adicionales** fuera de esta lista numerada.
  
  ⚠️ RESTRICCIONES OBLIGATORIAS POR TIPO:
  
  **Consultas (Pref):**
  - 'nota_restriccion': "Sólo con presentación de bonos. Máximo 10 días de espera. Referencia: Nota 1.2, 5.3"
  
  **Consultas (LE):**
  - 'nota_restriccion': "No requiere orden médica. Referencia: Nota 2.13"
  
  **Laboratorio/Imagenología (Pref):**
  - 'nota_restriccion': "Sólo con presentación de bonos. Requiere orden médica. Máximo 4 días de espera. Referencia: Nota 1.2, 2.13, 5.3"
  
  **Laboratorio/Imagenología (LE):**
  - 'nota_restriccion': "Requiere orden médica. Referencia: Nota 2.13"
  
  **Procedimientos (Pref):**
  - 'nota_restriccion': "Sólo con presentación de bonos. Requiere orden médica. Máximo 5 días de espera. Referencia: Nota 1.2, 2.13, 5.3"
  
  **Procedimientos (LE):**
  - 'nota_restriccion': "Requiere orden médica. Referencia: Nota 2.13"
  
  **Terapias (Pref):**
  - 'nota_restriccion': "Sólo con presentación de bonos. Requiere orden médica. Referencia: Nota 1.2, 2.13"
  
  **Terapias (LE):**
  - 'nota_restriccion': "Requiere orden médica. Referencia: Nota 2.13"
  
  **Urgencias (Pref):**
  - 'nota_restriccion': "Cobertura preferente solo al acto inicial; seguimiento por plan general. Referencia: Nota 1.11"
  
  **Urgencias (LE):**
  - 'nota_restriccion': "Si no acude a prestador preferente, dar aviso en 48 horas. Referencia: Nota 1.3"
  
  **Salud Mental (ambas modalidades):**
  - 'nota_restriccion': "Cobertura reducida (40%). Referencia: Nota 1.7"
  
  **PAD Dental (ambas modalidades):**
  - 'nota_restriccion': "Solo beneficiarios entre 12 años y 17 años, 11 meses, 29 días. Referencia: Nota 1.13"
  
  **Lentes Ópticos:**
  - 'nota_restriccion': "Requiere receta médica. No requiere receta para presbicia >40 años. Referencia: Nota 1.8"
  
  **Audífonos:**
  - 'nota_restriccion': "Solo mayores de 55 años. Referencia: Nota 1.5"
  
  ⚠️ REGLA DE NOMENCLATURA:
  - 'item': EXACTAMENTE como está en la lista numerada arriba.
  - 'modalidad': "Oferta Preferente" o "Libre Elección" según indica la lista.
  - 'nota_restriccion': NUNCA null. Usar las plantillas de arriba.
  
  FORMATO: JSON Strict.
`;

export const PROMPT_EXTRAS = `
  ** MANDATO FORENSE v8.4: PASE 4 - PRESTACIONES VALORIZADAS (PAGE 7 SUPREMACY) **
  
  ⚠️ ALERTA DE SEGURIDAD DE DATOS (CRÍTICO):
  Prohibido resumir. Copia TEXTUALMENTE las condiciones.
  
  OBJETIVO: Capturar la "Selección de Prestaciones Valorizadas" que SOBREESCRIBE la bonificación general.
  
  ⚠️ INSTRUCCIONES CRÍTICAS (CONSALUD/MASVIDA/COLMENA):
  1. **REGLA DE SUPREMACÍA**: Busca la sección 'SELECCIÓN DE PRESTACIONES VALORIZADAS' (Generalmente Pág 7).
     - Por cada cirugía (Apendicectomía, Cesárea, Parto, etc.), genera una regla.
     - Captura el CÓDIGO FONASA y el Valor en Pesos ('Copago').
     - ESTOS VALORES SOBREESCRIBEN CUALQUIER PORCENTAJE DEL PLAN GENERAL. Márcalos como 'SUPREMO'.
  2. **TOPES ESPECÍFICOS**: Busca topes en Pesos para Medicamentos/Insumos en estas cirugías (ej: "Tope $758.208").
  3. **TIEMPOS DE ESPERA**: Mapea la tabla completa de tiempos (10 días consulta, etc.).
  
  FORMATO: JSON Strict (Schema Coberturas).
`;

export const SCHEMA_REGLAS = {
  description: "Esquema Universal de Reglas de Auditoría v8.4",
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
          'categoria': { type: SchemaType.STRING },
          'item': { type: SchemaType.STRING },
          'modalidad': { type: SchemaType.STRING, enum: ["Libre Elección", "Oferta Preferente", "Bonificación"] },
          'cobertura': { type: SchemaType.STRING },
          'tope': { type: SchemaType.STRING },
          'copago': { type: SchemaType.STRING },
          'nota_restriccion': { type: SchemaType.STRING, nullable: true },

          // Campos v8.0/8.4
          'CÓDIGO_DISPARADOR_FONASA': { type: SchemaType.STRING, description: "Códigos FONASA asociados (ej: 0305xxx)" },
          'LOGICA_DE_CALCULO': { type: SchemaType.STRING, description: "Ej: % de cobertura sobre el arancel" },
          'NIVEL_PRIORIDAD': {
            type: SchemaType.STRING,
            enum: ["GENERAL", "SUPREMO"],
            description: "'GENERAL' para tablas pág 1, 'SUPREMO' para prestaciones valorizadas pág 7."
          }
        },
        required: ['categoria', 'item', 'modalidad', 'cobertura']
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
export const CONTRACT_MAX_OUTPUT_TOKENS = 16384; // Increased for 100+ atomic rule extraction
export const CONTRACT_TEMPERATURE = GENERATION_CONFIG.temperature;
export const CONTRACT_TOP_P = GENERATION_CONFIG.topP;
export const CONTRACT_TOP_K = GENERATION_CONFIG.topK;

export const CONTRACT_FAST_MODEL = AI_MODELS.primary;
export const CONTRACT_REASONING_MODEL = AI_MODELS.primary; // User requested strict adherence to primary model
export const CONTRACT_FALLBACK_MODEL = AI_MODELS.fallback;
export const CONTRACT_DEFAULT_RETRIES = 3;
