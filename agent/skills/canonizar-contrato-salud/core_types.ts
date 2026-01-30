
// ----------------------
// 1) Core semantic types
// ----------------------

export type BlockEffect = "LIMITANTE" | "NEUTRO" | "EXPANSIVO";

export type BlockScope =
    | "PREFERENTE_RED"
    | "PREFERENTE_MODAL"
    | "PORCENTAJE"
    | "TOPE_EVENTO"
    | "TOPE_ANUAL_NFE"
    | "FINANCIAL_DOMAIN"; // útil para CAMBIO_DOMINIO

export type LatentReason =
    | "HERENCIA_CORTADA"
    | "LIMITANTE_TOPE"
    | "CAMBIO_DOMINIO"
    | "OTRA";

export type Modalidad = "preferente" | "libre_eleccion";

export interface Block {
    id: string;              // p.ej. "L2_53_C7" o similar
    text: string;            // texto crudo
    col: number;             // columna (1..n)
    rowId: string;           // id prestación / fila detectada
    segmentId: string;       // sub-tramo horizontal (delta) dentro de la fila
    effect: BlockEffect;
    scope: BlockScope;
}

export interface Restriction {
    scope: BlockScope;
    kind: "TOPE_UF" | "TOPE_AC2" | "SIN_TOPE" | "PORCENTAJE" | "OTRA";
    value?: number;          // UF o factor AC2 o porcentaje
    raw: string;
    byBlock: string;
}

export interface OptionNode {
    id: string;              // OptionID estable (NO usar modalidad como key)
    modalidad: Modalidad;
    scopes: Set<BlockScope>;
    porcentaje?: number;     // 80 / 90
    prestadores: string[];   // clínicas/red
    tope_evento?: { tipo: "UF" | "AC2" | "SIN_TOPE"; valor?: number };
    tope_anual?: { tipo: "UF" | "AC2" | "SIN_TOPE"; valor?: number }; // NFE
    meta?: Record<string, any>;
}

export interface OptionGraph {
    rowId: string;
    options: Map<string, OptionNode>; // id -> node
    edges: Array<{ from: string; to: string; type: "COMPATIBLE" | "CONFLICT" }>;
}

export interface LatentOption {
    id: string;
    reason: LatentReason;
    scope: BlockScope;
    byBlock: string;
}

export interface LineState {
    opciones_activas: Set<string>;        // OptionIDs
    opciones_latentes: LatentOption[];    // con razón
    restricciones: Restriction[];
    historial_bloques: string[];
    dominio: "CLINICO" | "FINANCIERO";    // cambio de dominio
    herencia_cortada: boolean;            // línea verde / solo LE
}

// Utilidad para comparar scope
export function intersectsScope(blockScope: BlockScope, optionScopes: Set<BlockScope>) {
    return optionScopes.has(blockScope);
}

// Added Missing Exports
export type SemanticOperator =
    | { type: "HERENCIA_CORTADA"; byBlock: string }
    | { type: "CAMBIO_DOMINIO_FINANCIERO"; byBlock: string }
    | { type: "TOPE_EVENTO"; restr: Restriction }
    | { type: "TOPE_ANUAL_NFE"; restr: Restriction }
    | { type: "PORCENTAJE"; restr: Restriction };

export interface HistorialFinancieroEntry {
    tipo: "exclusion_modal" | "regimen" | "tope_evento" | "tope_anual";
    valor?: any;
    unidad?: string;
    porcentaje?: number;
    descripcion?: string;
    fuente?: string;
}
