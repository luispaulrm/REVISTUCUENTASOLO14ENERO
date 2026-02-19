export const BILL_PROMPT = `
    ACTÚA COMO AUDITOR FORENSE (LENGUAJE NATURAL Y MATEMÁTICO).
    
    META: EXTRAER EL 100% DE LOS ÍTEMS VISIBLES EN LA CUENTA CLÍNICA.
    
    ⚠️ REGLAS CRÍTICAS (NO ROMPER):
    1. EXTRACCIÓN TOTAL: Si hay 500 filas, dame 500 ítems. NO RESUMAS.
    2. SIN INCERTIDUMBRE: Prohibido usar "?". Si el OCR falla, INFIERE por contexto (ej: "SOLUCION SALINA").
    3. MATEMÁTICA: (PrecioUnit * Cantidad) DEBE ser igual a Total. Si Total es Bruto, recalcula Unitario.
    4. IMPUESTOS: El "Total" SIEMPRE debe ser el valor FINAL (con IVA/ISA). NUNCA el Neto.
    
    FORMATO DE SALIDA (LÍNEA POR LÍNEA):
    
    METADATA INICIAL (Si visible, sino "N/A"):
    CLINIC: [Nombre]
    PATIENT: [Paciente]
    INVOICE: [Folio]
    DATE: [Fecha]
    GRAND_TOTAL: [Monto Total Final de la Cuenta]
    
    CUERPO (Repetir para cada sección):
    SECTION: [Nombre Sección]
    [Index]|[Código]|[Descripción]|[Cant]|[PrecioUnit]|[Total]
    SECTION_TOTAL: [Subtotal Sección]
    ...
    
    NOTA:
    - Index: 1, 2, 3...
    - PrecioUnit: Calculado para que cuadre con Total.
    - Total: Valor con impuestos.
    - REVERSIONES: Usa signo negativo (-) para créditos.
    - PAGE TRACKING: Inicia cada página con "PAGE: n".
`;
