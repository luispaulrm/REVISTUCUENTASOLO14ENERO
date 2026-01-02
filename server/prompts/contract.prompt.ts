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
                    'VALOR EXTRACTO LITERAL DETALLADO': { type: SchemaType.STRING }
                },
                required: ['PÁGINA ORIGEN', 'CÓDIGO/SECCIÓN', 'SUBCATEGORÍA', 'VALOR EXTRACTO LITERAL DETALLADO']
            }
        },
        coberturas: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    'PRESTACIÓN CLAVE': { type: SchemaType.STRING },
                    'MODALIDAD/RED': { type: SchemaType.STRING },
                    '% BONIFICACIÓN': { type: SchemaType.STRING },
                    'COPAGO FIJO': { type: SchemaType.STRING },
                    'TOPE LOCAL 1 (VAM/EVENTO)': { type: SchemaType.STRING },
                    'TOPE LOCAL 2 (ANUAL/UF)': { type: SchemaType.STRING },
                    'RESTRICCIÓN Y CONDICIONAMIENTO': { type: SchemaType.STRING },
                    'ANCLAJES': {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING }
                    }
                },
                required: ['PRESTACIÓN CLAVE', 'MODALIDAD/RED', '% BONIFICACIÓN', 'COPAGO FIJO', 'TOPE LOCAL 1 (VAM/EVENTO)', 'RESTRICCIÓN Y CONDICIONAMIENTO']
            }
        },
        diseno_ux: {
            type: SchemaType.OBJECT,
            properties: {
                nombre_isapre: { type: SchemaType.STRING },
                titulo_plan: { type: SchemaType.STRING },
                subtitulo_plan: { type: SchemaType.STRING }
            },
            required: ['nombre_isapre', 'titulo_plan']
        }
    }
};

export const CONTRACT_PROMPT = `**MANDATO TURBO-EXTRACTOR FORENSE (PROTOCOLO v8.0 - ALGORITMO INTEGRAL)**

Usted es un transcriptor de ALTA PRECISIÓN especializado en auditoría forense de contratos de salud.
NO USE JSON. Use el siguiente formato de texto plano con delimitadores "|" para máxima velocidad.

---
**ALGORITMO FORENSE DE 4 PASOS (OBLIGATORIO POR FILA):**

1. **DETECCIÓN DE MALLAS VISUALES:** Identifique recuadros o bordes que agrupan varias filas (ej: un bloque que diga "100% Sin Tope"). Esta es la "regla base" de la sección.
2. **DESDOBLAMIENTO GEOGRÁFICO:** Si el contrato tiene columnas para "Nacional" e "Internacional", usted DEBE generar DOS filas COBER| independientes para la misma prestación, una para cada modalidad.
3. **CASCADA DE HEREDACIÓN DE TOPES:** Busque el valor en la celda específica. Si está vacía, "herede" automáticamente el valor de la Malla Visual detectada en el Paso 1. NO deje campos de tope en "---" si existe una regla de malla superior.
4. **SINTETIZACIÓN IMPERATIVA DE RESTRICCIONES:** 
   - **Resolución de Asteriscos (*):** Si ve (*), (**), etc., busque el texto REAL al pie de página y PÉGUELO ÍNTEGRO.
   - **Inyección de Malla:** Si la prestación tiene condiciones de bloque (ej: "Excepto 60% en Clínica X"), INYECTE ese texto en el campo de restricciones de CADA fila.
   - **Bono Internacional:** Para filas internacionales, incluya siempre la regla de "Reembolso / 90 días" si aplica.

---
**CHECKPOINTS ANTI-RESUMEN (SEGURIDAD):**
- Prohibido usar: "Ver notas", "Consultar condiciones", "Misma regla", "Ídem".
- Densidad de Información: Si una restricción es muy corta, re-examine el documento para buscar el texto completo. El objetivo es que la columna sea AUTÓNOMA.
- Trazabilidad: En el bloque RULE, informe siempre el número de página exacto.

---
**ESTRUCTURA DE SALIDA:**
METADATA|ISAPRE:[Nombre]|PLAN:[Titulo]|SUB:[Codigo/Subtitulo]
RULE|[Pagina]|[Seccion]|[Categoria]|[Texto literal íntegro]
COBER|[Prestacion]|[Modalidad]|[Percent]|[Copago]|[Tope1]|[Tope2]|[Restriccion_Resuelta]|[Anclajes]
`;
