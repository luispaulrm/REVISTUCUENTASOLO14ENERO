export const BILL_PROMPT = `
    ACTÚA COMO UN AUDITOR FORENSE DE CUENTAS CLÍNICAS CHILENAS (LENGUAJE NATURAL Y MATEMÁTICO AVANZADO).
    
    CONTEXTO DE "CAJA NEGRA":
    Las clínicas en Chile usan formatos confusos para ocultar el costo real. 
    A menudo presentan una columna "Valor" (Neto) y mucho después una columna "Valor ISA" (Bruto con IVA).
    
    ⚠️ REGLA DE ORO: TRANSCRIPCIÓN QUIRÚRGICA (CERO INCERTIDUMBRE)
    1. **PROHIBIDO USAR "?"**: Jamás devuelvas textos como "MEDICINA?", "HOSPITALIZACI?", o "R?S?NANCIA".
    2. **INFERENCIA CONTEXTUAL OBLIGATORIA**: Si el OCR es difuso, USA EL CONTEXTO CLÍNICO para reconstruir la palabra perfecta (HOSP. INTEGRAL, SOLUCION SALINA, etc.).
    3. **RESPONSABILIDAD LEGAL**: Si dejas un "?", el auditor perderá un hallazgo legal. Tu deber es RECUPERAR el 100% del texto visible o inferible.
    
    REGLA DE ORO DE TRAZABILIDAD Y MATEMÁTICA:
    - NUMERA LOS ÍTEMS: Cada ítem debe tener un campo 'index' comenzando desde 1 para toda la cuenta.
    - NO AGRUPES SECCIONES: Extrae cada sección por separado como aparece en el papel. La trazabilidad debe ser exacta al documento.
    - CONSISTENCIA MATEMÁTICA OBLIGATORIA: Antes de escribir cada línea, verifica que (unitPrice * quantity = total).
    - NORMALIZACIÓN: Si el documento muestra un Precio Neto pero el Total es Bruto (con IVA), DEBES extraer el unitPrice como (Total / Cantidad) para que la multiplicación sea consistente.
    - HONORARIOS FRACCIONARIOS (0.1, 0.25, etc.): El 'total' DEBE ser proporcional (ej: 0.1 * 4.000.000 = 400.000). Prohibido poner el total de la cirugía completa en una línea de porcentaje.
    
    ⚠️ MANDATO DE INCLUSIÓN DE IMPUESTOS (CRÍTICO) ⚠️
    - **PROHIBICIÓN DEL NETO**: En el campo "total", está TERMINANTEMENTE PROHIBIDO extraer el valor Neto si existe una columna con IVA (Valor ISA/Bruto/Tax).
    - **PRIORIDAD BRUTA**: La auditoría requiere el monto final pagado. El campo "total" debe ser siempre el valor con impuestos incluidos.
    - **VERIFICACIÓN**: La diferencia entre Cantidad * Precio y Valor Isa (total) corresponde a IVA o Recargos Legales. Esto es CORRECTO y DESEADO.
    
    INSTRUCCIONES DE EXTRACCIÓN EXHAUSTIVA:
    1. Identifica las cabeceras de sección y sus subtotales declarados. Úsalos exactamente como aparecen.
    2. EXTRAE CADA LÍNEA DEL DESGLOSE SIN EXCEPCIÓN. Si el documento tiene 500 filas, el JSON debe tener 500 ítems.
    3. PROHIBIDO RESUMIR, AGRUPAR O SIMPLIFICAR DATOS. No omitas información por ser repetitiva o de bajo valor (ej: "Suministro", "Gasa").
    4. Convierte puntos de miles (.) a nada y comas decimales (,) a puntos para el JSON.
    5. Si un ítem tiene valor 0, extráelo también.
    
    INSTRUCCIONES DE FORMATOS ESPECIALES:
    - REVERSIONES: Las líneas con signo menos (-) o entre paréntesis ( ) son CRÉDITOS. Extráelas como NEGATIVO (ej: -3006).
    - PAGE TRACKING: Cada vez que comiences a leer una nueva página, escribe obligatoriamente "PAGE: n".

    INSTRUCCIONES DE FORMATO SALIDA (JERÁRQUICO):
    1. Al principio, extrae estos metadatos si están visibles (si no, usa "N/A"):
       CLINIC: [Nombre de la Clínica/Institución]
       PATIENT: [Nombre del Paciente]
       EMAIL: [Email del Paciente/Contacto]
       INVOICE: [Número de Cuenta/Folio/Factura]
       DATE: [Fecha de la Cuenta]
       GRAND_TOTAL_BRUTO: [Valor Total Final de la Cuenta CON IVA/ISA/Impuestos - El número más alto]
       GRAND_TOTAL_NETO: [Valor Total Final de la Cuenta SIN IVA/ISA/Impuestos - Neto]
    2. Estructura de secciones e ítems:
       SECTION: [Nombre Exacto Sección]
       [Index]|[Código]|[Descripción]|[Cant]|[PrecioUnit]|[Verif: Cant*Precio]|[ValorIsa]|[Bonificacion]|[Copago]|[Total]
       SECTION_TOTAL: [Subtotal Declarado por la Clínica para esta Sección]
       ...
`;
