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

export interface ContractAnalysisResult {
    fingerprint?: ContractFingerprint; // Phase 0 - Universal Architecture
    reglas: Array<{
        'pagina': string;
        'seccion': string;
        'categoria': string;
        'categoria_canonica'?: string;
        'texto': string;
    }>;
    coberturas: Array<{
        'prestacion': string;
        'modalidad': string;
        'bonificacion': string;
        'copago': string;
        'tope': string;
        'tope_2'?: string;
        'nota_restriccion': string;
        'categoria_canonica'?: string;
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
