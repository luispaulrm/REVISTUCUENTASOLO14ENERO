import { ContractFingerprint } from './contractFingerprint.js';

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

export interface ContractAnalysisResult {
    rawMarkdown?: string; // New field for Dual Verification
    fingerprint?: ContractFingerprint; // Phase 0 - Universal Architecture
    reglas: Array<{
        'PÁGINA ORIGEN'?: string;
        'CÓDIGO/SECCIÓN'?: string;
        'SUBCATEGORÍA'?: string;
        'VALOR EXTRACTO LITERAL DETALLADO'?: string;
        'pagina'?: string; // Legacy compat
        'seccion'?: string; // Legacy compat
        'categoria'?: string; // Legacy compat
        'texto'?: string; // Legacy compat
        'categoria_canonica'?: string;
    }>;
    coberturas: Array<{
        'categoria': string;
        'item': string;
        'modalidades': Array<{
            'tipo': "PREFERENTE" | "LIBRE_ELECCION" | "BONIFICACION";
            'porcentaje': number | null;
            'tope': number | null;
            'unidadTope': "UF" | "AC2" | "VAM" | "PESOS" | "SIN_TOPE" | "DESCONOCIDO";
            'tipoTope': "POR_EVENTO" | "ANUAL" | "ILIMITADO" | "DIARIO";
            'copago'?: string;
        }>;
        'nota_restriccion'?: string;
        'categoria_canonica'?: string;
        // Legacy flat fields are REMOVED to force structural adoption
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
            phases?: Array<{
                phase: string;
                totalTokens: number;
                promptTokens: number;
                candidatesTokens: number;
                estimatedCostCLP: number;
            }>;
        };
        extractionBreakdown?: {
            totalReglas: number;
            totalCoberturas: number;
            totalItems: number;
        };
    };
}
