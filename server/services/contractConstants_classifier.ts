import { SchemaType } from "@google/generative-ai";
import { AI_MODELS, GENERATION_CONFIG } from "../config/ai.config.js";

/**
 * ========================================
 * FASE 0: CLASIFICADOR DE CONTRATOS (v8.0 - Universal Architecture)
 * ========================================
 * Objetivo: Detectar estructura y tipo de contrato ANTES de extraer reglas.
 * Salida: ContractFingerprint (huella digital del contrato)
 */
export const PROMPT_CLASSIFIER = `
** CLASIFICADOR DE CONTRATOS ISAPRE v8.0 **

ROL: Clasificador de documentos contractuales de salud.

OBJETIVO: Analizar SOLO la estructura del documento. NO extraigas reglas aún.

INSTRUCCIONES:
1. Revisa las primeras 5-7 páginas del documento
2. Identifica el tipo de contrato basándote en:
   - Estilo de presentación (tabla vs texto)
   - Presencia de secciones específicas
   - Lenguaje utilizado
3. Detecta elementos clave SIN extraer contenido

DEVUELVE SOLO:

**tipo_contrato**: 
- ISAPRE_TRADICIONAL_SIS: Contrato con grilla estándar SIS, numeración 1.X
- PLAN_MODERNO: Diseño comercial, sin numeración estricta
- PLAN_CERRADO: Plan empresa/institución específica
- PRE_2010: Contrato antiguo con formato pre-reforma
- HIBRIDO: Mezcla de estilos
- BILL_OR_PAM: El documento es una Boleta, Factura, PAM o Presupuesto de Salud, pero NO un contrato.
- DESCONOCIDO: No clasificable

**estilo_numeracion**: 
- DECIMAL: 1.1, 1.2, 2.1
- ROMANA: I, II, III
- ALFABETICA: A, B, C
- MIXTA: Combinación
- SIN_NUMEROS: Sin numeración visible
- IRREGULAR: Numeración inconsistente

**layout**:
- TABLA_GRILLA: Tabla estructurada con columnas
- TEXTO_CORRIDO: Texto narrativo/legal
- HIBRIDO: Mezcla
- DESCONOCIDO: No clasificable

**lenguaje**:
- TECNICO: Alta densidad legal, términos jurídicos
- COMERCIAL: Lenguaje simplificado, comercial
- MIXTO: Combinación
- NO_CONTRACTUAL: Lenguaje de cobranza, detalle de prestaciones médicas (facturación)

**densidad_texto**:
- ALTA: >500 palabras por página
- MEDIA: 200-500 palabras por página
- BAJA: <200 palabras por página

**DETECCIÓN DE SECCIONES** (true/false):
- tiene_notas_explicativas: ¿Hay notas al pie con referencias (1.1, Nota A, etc.)?
- tiene_seleccion_valorizada: ¿Hay sección "Selección Valorizada" o "Prestaciones Valorizadas"?
- tiene_oferta_preferente: ¿Hay "Oferta Preferente" o lista de prestadores?
- tiene_pad_dental: ¿Hay "PAD Dental" o coberturas dentales específicas?
- tiene_tabla_resumen: ¿Hay tabla resumen en primeras páginas?

**ESTIMACIONES**:
- total_paginas_estimadas: Número aproximado de páginas del contrato
- confianza: 0-100 (tu confianza en esta clasificación)

**observaciones**: Array de strings con notas relevantes
Ejemplo: ["Numeración irregular entre páginas", "Tabla resumen en página 1"]

NO EXTRAIGAS REGLAS. SOLO CLASIFICA.
⚠️ CRÍTICO: Si detectas que es una BOLETA o PAM, clasifica como 'BILL_OR_PAM' inmediatamente.
`;

export const SCHEMA_CLASSIFIER = {
    type: SchemaType.OBJECT,
    properties: {
        tipo_contrato: {
            type: SchemaType.STRING,
            enum: ['ISAPRE_TRADICIONAL_SIS', 'PLAN_MODERNO', 'PLAN_CERRADO', 'PRE_2010', 'HIBRIDO', 'BILL_OR_PAM', 'DESCONOCIDO']
        },
        estilo_numeracion: {
            type: SchemaType.STRING,
            enum: ['DECIMAL', 'ROMANA', 'ALFABETICA', 'MIXTA', 'SIN_NUMEROS', 'IRREGULAR']
        },
        layout: {
            type: SchemaType.STRING,
            enum: ['TABLA_GRILLA', 'TEXTO_CORRIDO', 'HIBRIDO', 'DESCONOCIDO']
        },
        lenguaje: {
            type: SchemaType.STRING,
            enum: ['TECNICO', 'COMERCIAL', 'MIXTO', 'NO_CONTRACTUAL']
        },
        densidad_texto: {
            type: SchemaType.STRING,
            enum: ['ALTA', 'MEDIA', 'BAJA']
        },
        tiene_notas_explicativas: { type: SchemaType.BOOLEAN },
        tiene_seleccion_valorizada: { type: SchemaType.BOOLEAN },
        tiene_oferta_preferente: { type: SchemaType.BOOLEAN },
        tiene_pad_dental: { type: SchemaType.BOOLEAN },
        tiene_tabla_resumen: { type: SchemaType.BOOLEAN },
        total_paginas_estimadas: { type: SchemaType.NUMBER },
        confianza: {
            type: SchemaType.NUMBER,
            description: "Confianza del clasificador (0-100)"
        },
        observaciones: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING }
        }
    },
    required: [
        'tipo_contrato',
        'estilo_numeracion',
        'layout',
        'lenguaje',
        'densidad_texto',
        'tiene_notas_explicativas',
        'tiene_seleccion_valorizada',
        'tiene_oferta_preferente',
        'tiene_pad_dental',
        'tiene_tabla_resumen',
        'total_paginas_estimadas',
        'confianza',
        'observaciones'
    ]
};

/**
 * ========================================
 * EXISTING PROMPTS (PRESERVED)
 * ========================================
 */
