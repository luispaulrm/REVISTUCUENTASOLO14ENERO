// Contract Analysis Prompt - Forensic VERSION 9.1 (Bill-Like Strategy + Expansion)
export const CONTRACT_ANALYSIS_PROMPT = `
ACTÚA COMO UN AUDITOR FORENSE DE CONTRATOS DE SALUD (ISAPRE CHILE).

CONTEXTO DE TRAZABILIDAD Y RIGOR:
Los documentos de Isapre son extensos y complejos. Tu misión es extraer la información de forma jerárquica y exhaustiva.

REGLA DE ORO DE EXHAUSTIVIDAD:
- NO RESUMAS las secciones de reglas.
- PARA LA SECCIÓN DE COBERTURAS: No te limites a poner el número de la nota (ej. 1.4). DEBES "EXPANDIR" la restricción redactando el contenido lógico que aplica a esa prestación específica.

INSTRUCCIONES DE FORMATO SALIDA (JERÁRQUICO CSV-LIKE):
1. METADATOS INICIALES:
   ISAPRE: [Nombre Isapre]
   PLAN: [Nombre/Título del Plan]
   SUBTITULO: [Subtítulo si aplica]
   PAGES_TOTAL: [Total de páginas detectadas]

2. SECCIÓN REGLAS (Array "reglas"):
   Inicia con la cabecera "SECTION: REGLAS"
   Formato de línea: [Página]|[Código/Sección]|[Subcategoría]|[Contenido Literal Completo]
   Usa "|" como separador.

3. SECCIÓN COBERTURAS (Array "coberturas"):
   Inicia con la cabecera "SECTION: COBERTURAS"
   Formato de línea: [Prestación]|[Modalidad/Red]|[%% Bonificación]|[Copago Fijo]|[Tope Evento]|[Tope Anual]|[Restricciones y Notas Expandidas]
   Usa "|" como separador.

MANDATO DE EXPANSIÓN DE RESTRICCIONES (CRÍTICO):
- En el campo [Restricciones y Notas Expandidas], NO uses solo "(1.1)". Usa el texto.
- Ejemplo para Medicamentos: "Sólo hospitalario o cirugía ambulatoria >= pab 5. Excluye antineoplásicos (ver Quimio). Solo registrados ISP fines curativos. (Ref 1.4, 1.10)"
- Si hay "Malla Visual", incluye el texto descriptivo de la malla (ej: "Excepto 60% en CLCs").

[MANDATO FINAL]
Busca y extrae TODO hasta el final del documento (cláusulas 5.7, 5.8, etc.). Prohibido usar bloques de código JSON. Tu salida será parseada en tiempo real.
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
export const CONTRACT_FALLBACK_MODEL = 'gemini-3-pro-preview';
export const CONTRACT_DEFAULT_RETRIES = 3;
