export const BILL_PROMPT = `
ACTÚA COMO UN AUDITOR FORENSE DE CUENTAS CLÍNICAS CHILENAS.

CONTEXTO DE "CAJA NEGRA":
Las clínicas en Chile usan formatos confusos para ocultar el costo real. 
A menudo presentan una columna "Valor" (Neto) y mucho después una columna "Valor ISA" (Bruto con IVA).

REGLA DE ORO DE TRAZABILIDAD:
- NUMERA LOS ÍTEMS: Cada ítem debe tener un campo 'index' comenzando desde 1 para toda la cuenta. Esto permite al usuario verificar si se saltó algún ítem.
- NO AGRUPES SECCIONES. Si la clínica lista "Materiales Clínicos 1", "Materiales Clínicos 2" y "Farmacia" por separado con sus propios subtotales, DEBES extraerlos como secciones independientes en el JSON. La trazabilidad debe ser exacta al documento.
- unitPrice: Debe ser el valor de la columna 'Precio' (VALOR NETO UNITARIO).
- total: Debe ser el valor de la columna 'Valor Isa' (VALOR TOTAL CON IMPUESTOS Y RECARGOS).
- RECUERDA: La diferencia entre Cantidad * Precio y Valor Isa corresponde a IVA, Impuestos Específicos o Recargos Legales vigentes en Chile. Esto es correcto y esperado.

INSTRUCCIONES DE EXTRACCIÓN EXHAUSTIVA:
1. Identifica las cabeceras de sección y sus subtotales declarados. Úsalos exactamente como aparecen.
2. EXTRAE CADA LÍNEA DEL DESGLOSE SIN EXCEPCIÓN.
3. ESTÁ PROHIBIDO RESUMIR, AGRUPAR O SIMPLIFICAR DATOS. Si el documento tiene 500 filas, el JSON debe tener 500 ítems.
4. No omitas información por ser repetitiva o de bajo valor (ej: "Suministro", "Gasa").
5. Convierte puntos de miles (.) a nada y comas decimales (,) a puntos para el JSON.
6. Si un ítem tiene valor 0, extráelo también.

INSTRUCCIONES DE FORMATO SALIDA (JERÁRQUICO):
1. Al principio, extrae estos metadatos si están visibles (si no, usa "N/A"):
   CLINIC: [Nombre de la Clínica/Institución]
   PATIENT: [Nombre del Paciente]
   INVOICE: [Número de Cuenta/Folio/Factura]
   DATE: [Fecha de la Cuenta]
   GRAND_TOTAL: [Valor Total Final de la Cuenta]
2. NO repitas el nombre de la sección en cada línea. Úsalo como CABECERA.
3. Estructura:
  CLINIC: ...
  PATIENT: ...
  INVOICE: ...
  DATE: ...
  GRAND_TOTAL: ...
  SECTION: [Nombre Exacto Sección]
  [Index]|[Código]|[Descripción]|[Cant]|[PrecioUnit]|[Total]
  SECTION: [Siguiente Sección...]
  ...
`;
