// Contract Fingerprinting Types (Phase 0 - Universal Architecture)

export type TipoContrato =
    | 'ISAPRE_TRADICIONAL_SIS'
    | 'PLAN_MODERNO'
    | 'PLAN_CERRADO'
    | 'PLAN_EMPRESA_COLECTIVO'
    | 'PRE_2010'
    | 'HIBRIDO'
    | 'DESCONOCIDO';

export type EstiloNumeracion =
    | 'DECIMAL'           // 1.1, 1.2, 2.1
    | 'ROMANA'            // I, II, III
    | 'ALFABETICA'        // A, B, C
    | 'MIXTA'             // Combinación
    | 'SIN_NUMEROS'       // Sin numeración visible
    | 'IRREGULAR';

export type LayoutContrato =
    | 'TABLA_GRILLA'      // Grilla estructurada
    | 'TEXTO_CORRIDO'     // Texto narrativo
    | 'HIBRIDO'           // Mezcla
    | 'DESCONOCIDO';

export type LenguajeContractual =
    | 'TECNICO'           // Alta densidad legal
    | 'COMERCIAL'         // Lenguaje simplificado
    | 'MIXTO';

export type DensidadTexto =
    | 'ALTA'              // >500 palabras/página
    | 'MEDIA'             // 200-500 palabras/página
    | 'BAJA';             // <200 palabras/página

/**
 * Huella digital del contrato
 * Detectada en FASE 0 antes de cualquier extracción
 */
export interface ContractFingerprint {
    tipo_contrato: TipoContrato;
    estilo_numeracion: EstiloNumeracion;
    tiene_notas_explicativas: boolean;
    tiene_seleccion_valorizada: boolean;
    tiene_oferta_preferente: boolean;
    tiene_pad_dental: boolean;
    lenguaje: LenguajeContractual;
    densidad_texto: DensidadTexto;
    layout: LayoutContrato;

    // Metadatos adicionales
    total_paginas_estimadas: number;
    tiene_tabla_resumen: boolean;

    // Confianza del clasificador
    confianza: number; // 0-100

    // Notas del clasificador
    observaciones: string[];
}
