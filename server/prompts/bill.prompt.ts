export const BILL_PROMPT = `
    ACTÚA COMO AUDITOR FORENSE (LENGUAJE NATURAL Y MATEMÁTICO).
    
    META: EXTRAER EL 100% DE LOS ÍTEMS VISIBLES EN LA CUENTA CLÍNICA.
    
    ⚠️ REGLAS CRÍTICAS (NO ROMPER):
    1. EXTRACCIÓN TOTAL: Si hay 500 filas, dame 500 ítems. NO RESUMAS.
    2. SIN INCERTIDUMBRE: Prohibido usar "?". Si el OCR falla, INFIERE por contexto (ej: "SOLUCION SALINA").
    3. MATEMÁTICA: (PrecioUnit * Cantidad) DEBE ser igual a Total. Si Total es Bruto, recalcula Unitario.
    4. IMPUESTOS: El "Total" SIEMPRE debe ser el valor FINAL (con IVA/ISA). NUNCA el Neto.
    5. NO FUSIONAR DUPLICADOS: Si un ítem (ej: "CEFTRIAXONA") aparece 2 veces con el mismo precio, DAME 2 OBJETOS. Mantén la integridad 100%.
    6. REVERSIONES: Usa signo negativo (-) para créditos.
    7. PAGE TRACKING: El campo "page" indica en qué página aparece cada ítem.
    
    RESPONDE ÚNICAMENTE CON JSON PURO. SIN MARKDOWN. SIN BACKTICKS.
`;

/**
 * JSON Schema for Gemini Structured Output.
 * This forces the model to return a well-formed JSON object,
 * eliminating the need for CSV parsing and magnitude heuristics.
 */
export const BILL_JSON_SCHEMA = {
    type: "OBJECT",
    properties: {
        clinicName: { type: "STRING", description: "Nombre de la clínica u hospital" },
        patientName: { type: "STRING", description: "Nombre del paciente" },
        invoiceNumber: { type: "STRING", description: "Número de folio o boleta" },
        date: { type: "STRING", description: "Fecha de la cuenta" },
        grandTotalBruto: { type: "NUMBER", description: "Gran Total BRUTO final de la cuenta (entero, sin decimales)" },
        sections: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    category: { type: "STRING", description: "Nombre de la sección (ej: PABELLON, FARMACIA, INSUMOS)" },
                    sectionTotal: { type: "NUMBER", description: "Subtotal declarado de esta sección (entero)" },
                    items: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                code: { type: "STRING", description: "Código del ítem (ej: 1103057, 22040113). Vacío si no tiene." },
                                description: { type: "STRING", description: "Descripción completa del ítem" },
                                quantity: { type: "NUMBER", description: "Cantidad (ej: 1, 2, 0.08)" },
                                unitPrice: { type: "NUMBER", description: "Precio unitario (entero CLP, sin decimales)" },
                                total: { type: "NUMBER", description: "Total del ítem con impuestos (entero CLP). Negativo si es reversión." },
                                page: { type: "NUMBER", description: "Número de página donde aparece este ítem" }
                            },
                            required: ["description", "quantity", "unitPrice", "total"]
                        }
                    }
                },
                required: ["category", "items"]
            }
        }
    },
    required: ["sections", "grandTotalBruto"]
};
