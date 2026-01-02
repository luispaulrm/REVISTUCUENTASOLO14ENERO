export interface UsageMetadata {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost?: number;
    estimatedCostCLP?: number;
}

export interface ContractAnalysisResult {
    reglas: Array<{
        'pagina': string;
        'seccion': string;
        'categoria': string;
        'texto': string;
    }>;
    coberturas: Array<{
        'prestacion': string;
        'modalidad': string;
        'bonificacion': string;
        'copago': string;
        'tope_1': string;
        'tope_2': string;
        'restriccion': string;
        'anclajes': string[];
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
