
/**
 * Doctrina Operativa sobre Prácticas Irregulares en Cuentas Hospitalarias
 * Basado en el "Informe sobre Prácticas Irregulares en Cuentas Hospitalarias y Clínicas"
 */
export const DOCTRINA_PRACTICAS_IRREGULARES = `
=== DOCTRINA OPERATIVA: PRÁCTICAS IRREGULARES Y DISCRECIONALIDAD (FUENTE: INFORME TÉCNICO) ===

9. 1. PRINCIPIO DE NEUTRALIDAD ECONÓMICA:
   - El monto del copago, por sí solo, NO constituye indicio de irregularidad, abuso ni infracción.
   - La auditoría evalúa cumplimiento normativo y contractual, no la conveniencia económica del resultado.
   - REGLA: "Resultado caro ≠ resultado irregular".

10. 2. PRINCIPIO DE SISTEMATICIDAD:
   Estas prácticas no son casos aislados, están sistematizadas en farmacia, pabellón, día cama y hotelería.

11. 3. PRINCIPIO DE CONTEXTO (Desagregación):
   - El derecho de pabellón INCLUYE insumos y fármacos básicos.
   - Cobrarlos aparte es "unbundling/doble cobro" POR DEFECTO.
   - ZONAS GRISES (Excepción): Insumos extraordinarios, fármacos especiales o dispositivos no estándar.
   - REGLA: "No todo lo desagregado es fraude, pero todo lo desagregado exige prueba".

12. 4. DOCTRINA DE LA OPACIDAD (Uso restringido):
   - La opacidad es una infracción de TRANSPARENCIA, no un juicio de JUSTICIA del precio.
   - NO existe opacidad cuando:
     a) La regla contractual existe (tope, factor o límite).
     b) El resultado es matemáticamente reconstruible desde el PAM.
     c) La convergencia aritmética confirma el modelo aplicado.
   - REGLA: "Si se puede reconstruir, no es opaco, aunque sea complejo".

13. 5. CLASIFICACIÓN DE IRREGULARIDADES (CRITERIOS CANÓNICOS):

   A. IRREGULARIDADES FUERTES (Alta Certeza - Objetar Directamente):
      - Desagregación de insumos estándar de pabellón.
      - Fármacos intraoperatorios cobrados como farmacia.
      - Enfermería básica cobrada fuera del día cama.

   B. IRREGULARIDADES CONDICIONALES (Requieren Análisis):
      - Códigos genéricos -> Objetables según el desglose (o falta de él).
      - Insumos no arancelados -> Objetables si no hay consentimiento informado.
      - Hotelería -> Objetables dependiendo de información previa y perjuicio.

   C. OBSERVACIONES (No Reclamo):
      - Mala práctica sin copago.
      - Error administrativo ya corregido.
      - Ítems bonificados al 100%.

   D. HECHOS CONTRACTUALES NEUTROS (No objetables):
      - Aplicación de modalidad Libre Elección.
      - Aplicación de topes contractuales explícitos (AC2, VAM, VA, etc.).
      - Saturación de tope con copago elevado resultante.
      - Diferencias entre cobertura porcentual teórica y cobertura efectiva post-tope.
      - REGLA: "El auditor registra, pero no objeta".

   E. PRINCIPIO DE CONVERGENCIA ARANCELARIA:
      - Cuando una unidad privada (AC2, VAM, VA) es deducida por despeje matemático desde una prestación ancla y validada por convergencia en >=2 líneas adicionales, dicha unidad se considera:
        -> VERIFICADA
        -> AUDITABLE
        -> NO OPACA
      - Cualquier objeción posterior debe refutar la matemática, no el resultado.

6. REGLA MADRE DE DECISIÓN (CONCURRENCIA DE 3/4):
   El auditor no decide por intuición. Para un DICTAMEN DURO, deben concurrir al menos 3 de estas 4 condiciones negativas:
   1. [NORMA] ¿La prestación estaba incluida por norma o contrato? (Si estaba incluida = condición cumplida para objetar).
   2. [CLÍNICA] ¿Era estándar? (Si era estándar = condición cumplida para objetar).
   3. [TRANSPARENCIA] ¿Fue informada y desglosada? (Si NO fue desglosada = condición cumplida para objetar).
   4. [ECONÓMICA] ¿Generó copago efectivo? (Si hay copago = condición cumplida para objetar).

   ACLARACIÓN OPERATIVA [NORMA]:
   La condición [NORMA] solo se considera "cumplida para objetar" cuando:
   - Existe inclusión expresa SIN tope, o
   - Se cobra fuera de toda cobertura conocida.
   La existencia de un TOPE contractual explícito invalida automáticamente la condición [NORMA].

   **REGLA DE BLOQUEO DE LIBRE ELECCIÓN**: Si el evento es en Modalidad Libre Elección y el copago se explica por la aplicación del factor contractual (ej: 1.2 AC2), la condición 1 (NORMA) NO se cumple. Sin 3 de 4, NO hay dictamen de irregularidad.

   PRINCIPIO DE CARGA ARGUMENTAL:
   Quien invoque irregularidad debe demostrar:
   - Qué regla se incumple.
   - En qué punto exacto falla la matemática o la norma.
   La mera sorpresa por el resultado económico no constituye argumento válido.

   REGLA DE ORO: Sin al menos 3 de 4, no hay dictamen duro, solo "Observación" o "Zona Gris".
`;
