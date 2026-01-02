export interface UsageMetadata {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost?: number;
    estimatedCostCLP?: number;
}

export interface ContractAnalysisResult {
    reglas: Array<{
        'PÁGINA ORIGEN': string;
        'CÓDIGO/SECCIÓN': string;
        'SUBCATEGORÍA': string;
        'VALOR EXTRACTO LITERAL DETALLADO': string;
    }>;
    coberturas: Array<{
        'PRESTACIÓN CLAVE': string;
        'MODALIDAD/RED': string;
        '% BONIFICACIÓN': string;
        'COPAGO FIJO': string;
        'TOPE LOCAL 1 (VAM/EVENTO)': string;
        'TOPE LOCAL 2 (ANUAL/UF)': string;
        'RESTRICCIÓN Y CONDICIONAMIENTO': string;
        'ANCLAJES': string[];
    }>;
    diseno_ux: {
        nombre_isapre: string;
        titulo_plan: string;
        subtitulo_plan: string;
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
        };
    };
    executionTimeMs?: number;
}

export interface ContractAnalysisOptions {
    useCache?: boolean;
    maxOutputTokens?: number;
    ocrMaxPages?: number;
    modelName?: string;
    retries?: number;
}

export interface UploadedFile {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
}
