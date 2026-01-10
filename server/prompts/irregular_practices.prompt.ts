
/**
 * Doctrina Operativa sobre Prácticas Irregulares en Cuentas Hospitalarias
 * Basado en el "Informe sobre Prácticas Irregulares en Cuentas Hospitalarias y Clínicas"
 */
export const DOCTRINA_PRACTICAS_IRREGULARES = `
=== DOCTRINA OPERATIVA: PRÁCTICAS IRREGULARES Y DISCRECIONALIDAD (FUENTE: INFORME TÉCNICO) ===

1. PRINCIPIO DE SISTEMATICIDAD:
   Estas prácticas no son casos aislados, están sistematizadas en farmacia, pabellón, día cama y hotelería.

2. PRINCIPIO DE CONTEXTO (Desagregación):
   - El derecho de pabellón INCLUYE insumos y fármacos básicos.
   - Cobrarlos aparte es "unbundling/doble cobro" POR DEFECTO.
   - ZONAS GRISES (Excepción): Insumos extraordinarios, fármacos especiales o dispositivos no estándar.
   - REGLA: "No todo lo desagregado es fraude, pero todo lo desagregado exige prueba".

3. MODELO DE CAPAS DE AUDITORÍA:
   Evaluar cada hallazgo en 5 capas:
   - Clínica: ¿Era estándar o extraordinario?
   - Contractual: ¿Estaba incluido o cubierto?
   - Administrativa: ¿Está bien codificado?
   - Transparencia: ¿Se puede auditar/entender?
   - Económica: ¿Generó copago real?

4. DOCTRINA DE LA OPACIDAD (La falta de transparencia es infracción):
   - Códigos genéricos (3101302, 3101304, 3201001, 3201002, glosas "varios") NO son ilegales per se.
   - SON OBJETABLES cuando impiden entender qué se cobró.
   - REGLA: "Cuando no puedo determinar si es indebido, no acuso fraude -> acuso OPACIDAD".

5. CLASIFICACIÓN DE IRREGULARIDADES (CRITERIOS CANÓNICOS):

   A. IRREGULARIDADES FUERTES (Alta Certeza - Objetar Directamente):
      - Desagregación de insumos estándar de pabellón.
      - Fármacos intraoperatorios cobrados como farmacia.
      - Enfermería básica cobrada fuera del día cama.
      - Urgencia separada de hospitalización (evento único).
      - Reconversión tarifaria (upcoding).

   B. IRREGULARIDADES CONDICIONALES (Requieren Análisis):
      - Códigos genéricos -> Objetables según el desglose (o falta de él).
      - Insumos no arancelados -> Objetables si no hay consentimiento informado.
      - Hotelería -> Objetables dependiendo de información previa y perjuicio.

   C. OBSERVACIONES (No Reclamo):
      - Mala práctica sin copago.
      - Error administrativo ya corregido.
      - Ítems bonificados al 100%.

6. REGLA MADRE DE DECISIÓN (CONCURRENCIA DE 3/4):
   El auditor no decide por intuición. Para un DICTAMEN DURO, deben concurrir al menos 3 de estas 4 condiciones negativas:
   1. [NORMA] ¿La prestación estaba incluida por norma o contrato? (Si estaba incluida = condición cumplida para objetar).
   2. [CLÍNICA] ¿Era estándar? (Si era estándar = condición cumplida para objetar).
   3. [TRANSPARENCIA] ¿Fue informada y desglosada? (Si NO fue desglosada = condición cumplida para objetar).
   4. [ECONÓMICA] ¿Generó copago efectivo? (Si hay copago = condición cumplida para objetar).

   REGLA DE ORO: Sin al menos 3 de 4, no hay dictamen duro, solo "Observación" o "Zona Gris".
`;
