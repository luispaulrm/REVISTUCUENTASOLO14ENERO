import { ContractFingerprint } from './contractFingerprint.js';


export interface RawCell {
    tabla_id: string;
    fila_index: number;
    col_index: number;
    texto: string;
}

export interface UploadedFile {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
}

export interface ContractAnalysisOptions {
    maxOutputTokens?: number;
}

export interface UsageMetadata {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost?: number;
    estimatedCostCLP?: number;
}

// User-defined Deterministic Flat Coverage
export interface ContractCoverage {
    prestacion: string;           // "MATERIALES CLINICOS"
    ambito: "HOSPITALARIO" | "AMBULATORIO";
    modalidad: "PREFERENTE" | "LIBRE_ELECCION";
    porcentaje: number | null;    // 80, 90, null
    tope: number | null;          // 20, 4.0, null
    unidad: "UF" | "AC2" | "SIN_TOPE";
    tipoTope: "POR_EVENTO" | "ANUAL" | "ILIMITADO";
    fuente: "TABLA_CONTRATO";
}

// ============================================================================
// DOCTRINA INDUSTRIAL: DIVISIÓN EXPLORATION vs LEGAL
// ============================================================================

/**
 * 🧪 EXPLORATION JSON
 * "Mapa exploratorio del documento. No tiene fuerza legal."
 * Función: Descubrir, enumerar, mapear, medir incertidumbre.
 * NUNCA usar para efectos legales directos sin pasar por el compilador.
 */
export interface ExplorationTopeCompound {
    alcance: 'NACIONAL' | 'INTERNACIONAL' | 'TRANSITORIO' | 'REGIONAL';
    regla?: 'SIN_TOPE' | 'CON_TOPE' | 'ARANCEL' | 'REEMBOLSO';
    tope?: number | null;
    unidad?: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'UNKNOWN';
    excepciones?: string[];
    descripcion?: string;
}

export interface ExplorationModality {
    tipo: 'PREFERENTE' | 'LIBRE_ELECCION';
    porcentaje: number | string; // e.g., 100 or "80%"
    tope: string | number | null;
    unidadTope: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'UNKNOWN';
    tipoTope: 'POR_EVENTO' | 'ANUAL' | 'ILIMITADO' | 'DESCONOCIDO';
    copago: string | number | null;
    evidencia_literal: string;
    origen_extraccion?: string;

    // Enrichment fields (v1.6.0+)
    interpretacion_sugerida?: string;
    tope_normalizado?: number | null;
    unidad_normalizada?: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'UNKNOWN';
    tope_raw?: string | null;
    tope_compuesto?: ExplorationTopeCompound[];
}

// 🧪 EXPLORATION ITEM 
export interface ExplorationItem {
    'categoria': string;
    'item': string;
    'ambito'?: "HOSPITALARIO" | "AMBULATORIO" | "ONCOLOGIA" | "OTRO" | "UNDETERMINED";
    'modalidades': Array<ExplorationModality>;
    'nota_restriccion'?: string | null;
    'categoria_canonica'?: string;
}

/**
 * 🧪 EXPLORATION JSON
 */
export interface ExplorationJSON {
    fileHash?: string;
    metadata?: {
        tipo_contrato?: string;
        fuente?: string;
        vigencia?: string;
        [key: string]: any;
    };
    cached?: boolean;
    rawMarkdown?: string;
    fingerprint?: ContractFingerprint;
    reglas: Array<any>;

    // THE DOCTRINAL SPLIT (v1.6.0)
    coberturas_evidencia: Array<ExplorationItem>;    // 100% Literal/Evidence
    coberturas_enriquecidas: Array<ExplorationItem>; // Normalized/Inferred/Resolved

    // Compatibility field (points to enriquecidas for UI)
    coberturas: Array<ExplorationItem>;

    glosario_unidades?: Array<{
        sigla: string;
        descripcion_contrato: string;
        valor_referencia?: number;
        fuente_textual: string;
    }>;

    diseno_ux: {
        nombre_isapre: string;
        titulo_plan: string;
        subtitulo_plan?: string;
        layout: string;
        funcionalidad: string;
        salida_json: string;
    };
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
    metrics?: {
        executionTimeMs: number;
        tokenUsage: {
            input: number;
            output: number;
            total: number;
            costClp: number;
            totalPages?: number;
            phaseSuccess?: Record<string, boolean>;
            phases?: Array<any>;
        };
        extractionBreakdown?: {
            totalReglas: number;
            totalCoberturas: number;
            totalItems: number;
        };
    };
}

/**
 * ⚖️ LEGAL AUDIT PACKAGE (Alias for external usage)
 */
export type ContractAnalysisResult = ExplorationJSON;
