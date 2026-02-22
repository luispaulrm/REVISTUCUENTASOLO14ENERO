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
    maxPages?: number;
    log?: (msg: string) => void;
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

export interface ExplorationTopeCompound {
    alcance: 'NACIONAL' | 'INTERNACIONAL' | 'TRANSITORIO' | 'REGIONAL';
    regla?: 'SIN_TOPE' | 'CON_TOPE' | 'ARANCEL' | 'REEMBOLSO';
    tope?: number | null;
    unidad?: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'UNKNOWN';
    tipoTope?: 'TOPE_EVENTO' | 'TOPE_ANUAL' | 'ILIMITADO' | 'DESCONOCIDO';
    excepciones?: Array<{
        prestador: string;
        porcentaje: number;
        efecto: 'CAMBIO_DOMINIO' | 'LIMITANTE' | 'INFORMATIVO';
    }>;
    descripcion?: string;
}


export interface ExplorationModality {
    tipo: 'PREFERENTE' | 'LIBRE_ELECCION';
    porcentaje: number | string; // e.g., 100 or "80%"
    tope: string | number | null;
    unidadTope: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'UNKNOWN';
    tipoTope: 'POR_EVENTO' | 'ANUAL' | 'ILIMITADO' | 'MIXTO_EVENTO_Y_ANUAL' | 'DESCONOCIDO' | 'DIARIO';
    copago: string | number | null;
    evidencia_literal: string;
    origen_extraccion?: string;

    // Enrichment fields (v1.7.0+)
    interpretacion_sugerida?: string;
    tope_normalizado?: number | null;
    unidad_normalizada?: 'UF' | 'AC2' | 'VAM' | 'PESOS' | 'SIN_TOPE' | 'MIXTO' | 'COMPUESTO' | 'UNKNOWN';
    tope_raw?: string | null;
    tope_compuesto?: ExplorationTopeCompound[];
    reglas_por_nivel?: Array<{ nivel: 'I' | 'II' | 'III'; porcentaje: number }>;
    subdominio?: 'DENTAL_PAD' | 'MEDICAMENTOS' | 'GLOBAL' | 'UNDETERMINED';
    contexto_clinico?: 'QUIRURGICO_HOSPITALARIO' | 'QUIRURGICO_AMBULATORIO' | 'CONSULTA' | 'DIAGNOSTICO' | 'TERAPIA' | 'INSUMOS' | 'GLOBAL';
    flag_inconsistencia_porcentaje?: boolean;
    source_occurrence_id?: string;
    clinicas?: string[];
    tope_anual?: string | null;

    // V2 SCHEMA (Strict Join)
    tope_nested?: {
        unidad: string;
        valor: number;
    } | null;
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

// ============================================================================
// V3.5 ARCHITECTURE: RULE-BASED EXTRACTION & SEMANTIC GRID
// ============================================================================

export type UnidadRef = 'UF' | 'VA' | 'CLP' | 'OTRA';

export type TopeTipo =
    | 'NUMERICO'
    | 'SIN_TOPE_EXPLICITO'
    | 'NO_ENCONTRADO';

export type TopeRazon =
    | 'SIN_TOPE_EXPRESO_EN_CONTRATO'
    | 'SIN_TOPE_INFERIDO_POR_DISENO'
    | 'CELDA_VACIA_OCR'
    | 'COLUMNA_NO_EXISTE';

export interface TopeValue {
    tipo: TopeTipo;
    valor: number | null;        // null SOLO si tipo != NUMERICO
    unidad: UnidadRef | null;     // null SOLO si no aplica
    raw: string | null;           // texto crudo de la celda
    razon?: TopeRazon;            // obligatorio si tipo != NUMERICO
    confidence?: number;          // opcional
}

export interface V3BenefitRule {
    ruleId: string;
    blockId: string;
    prestacionLabel: string;
    modalidadPreferente?: {
        bonificacionPct: number | null;
        topePrestacion: TopeValue;
        topeAnualBeneficiario?: TopeValue | null;
    } | null;
    modalidadLibreEleccion?: {
        bonificacionPct: number | null;
        topePrestacion: TopeValue;
        topeAnualBeneficiario?: TopeValue | null;
    } | null;
    networkRuleIds?: string[];
    evidence: {
        source?: string;
        anchors: string[];
    };
}

export interface V3NetworkRule {
    networkRuleId: string;
    blockId?: string | null; // scope block si inequívoco
    bonificacionPct: number;
    topePrestacion: TopeValue; // típicamente SIN_TOPE_EXPLICITO
    redesPrestador: string[];
    notesRaw?: string | null;
    evidence: {
        source?: string;
        anchors: string[];
    };
}

export interface ContractV3Output {
    docMeta: {
        planType: string | null;
        hasPreferredProviderMode: boolean;
        funNumber: string | null;
        rawTitle: string | null;
    };
    coverageBlocks: Array<{
        blockId: string;
        blockTitle: string;
        benefitRules: V3BenefitRule[];
    }>;
    networkRules: V3NetworkRule[];
    issues: Array<{
        code: string;
        message: string;
        path?: string;
    }>;
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

    // V3 Evolution
    v3?: ContractV3Output;
}

/**
 * ⚖️ LEGAL AUDIT PACKAGE (Alias for external usage)
 */
export type ContractAnalysisResult = ExplorationJSON;

// ============================================================================
// GRID ALGORITHM V3.5: SEMANTIC GRID
// ============================================================================

export interface Token {
    text: string;
    page: number;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

export interface GridColumn {
    colId: string;
    x0: number;
    x1: number;
    headerHint?: string | null; // "PRESTACIONES", "BONIF_%_PREF", etc.
}

export interface GridRow {
    rowId: string;
    page: number;
    y0: number;
    y1: number;
    cells: Record<string, { raw: string; tokenIds?: string[] }>;
}

export interface RuleBox {
    boxId: string;
    page: number;
    y0: number;
    y1: number;
    raw: string;
    anchors: string[];
}

export interface TableModel {
    docId: string;
    columns: GridColumn[];
    rows: GridRow[];
    ruleBoxes: RuleBox[];
    blockHints: Array<{ blockTitle: string; y0: number; y1: number; page: number }>;
    issues: Array<{ code: string; message: string; page?: number }>;
}