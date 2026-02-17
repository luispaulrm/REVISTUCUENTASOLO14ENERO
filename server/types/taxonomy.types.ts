export type GrupoCanonico = "HOTELERA" | "PABELLON" | "INSUMOS" | "HONORARIOS";

export type SubFamilia =
    | "FARMACOS"
    | "MATERIALES"
    | "LABORATORIO"
    | "IMAGENOLOGIA"
    | "ADMINISTRATIVO"
    | "N_A";

export interface AtributosPhase1 {
    // Señales descriptivas (NO juicio financiero)
    es_cargo_fijo?: boolean;               // por día/evento
    es_recuperable?: boolean;              // se lleva / se consume totalmente
    requiere_respaldo_medico?: boolean;    // receta / protocolo / orden

    // Señales “eligibles” (potenciales gatillos de Phase 2)
    potencial_inherente_dia_cama?: boolean;
    potencial_inherente_pabellon?: boolean;
    potencial_no_clinico?: boolean;
    potencial_parte_de_paquete?: boolean;
}

export interface RawCuentaItem {
    id: string;
    text: string;         // literal
    sourceRef?: string;   // p.ej. page/line/anchor
    originalSection?: string;
}

export interface TaxonomyResult {
    id: string;
    item_original: string;
    // Alias for compatibility with new service code using 'text'
    text?: string;
    grupo: GrupoCanonico;
    sub_familia: SubFamilia;
    atributos: AtributosPhase1 & { section?: string }; // Added section for Phase 1.5 context
    confidence: number;        // 0..1
    rationale_short: string;   // 1 línea, para debugging humano
    sourceRef?: string;
    etiologia?: EtiologiaResult;
}

// Result Wrapper for API
export interface TaxonomyResponse {
    results: TaxonomyResult[];
    skeleton?: TaxonomySkeleton;
}

// Visual Tree Structure
export interface TaxonomySkeleton {
    name: string;
    total_count: number;
    children?: TaxonomySkeleton[];
}

// --- PHASE 1.5: ETIOLOGY & FORENSIC CONTEXT ---

export type EtiologiaTipo =
    | "M1_FRAUDE_TECNICO"          // Tipo A: No existe en arancel o es acto no autónomo
    | "M2_UNBUNDLING_CLINICO"        // Tipo B: Insumo clínico que debiera estar absorbido
    | "M3_ABSORCION_NORMATIVA"       // Tipo C: Ítem de confort/hotelería (naturaleza administrativa)
    | "CORRECTO";                   // Bonificable

export type AbsorcionClinica =
    | "PABELLON"
    | "DIA_CAMA"
    | "EVENTO_UNICO"
    | "ATENCION_HOSPITALARIA"
    | "NO_APLICA" // Para Tipo C (no se absorbe, se expulsa)
    | null;

export type MotivoRechazoPrevisible =
    | "CODIGO_NO_RECONOCIDO"
    | "ACTO_INCLUIDO_EN_PAQUETE"
    | "ITEM_MAL_IMPUTADO"
    | "SIN_CAUSAL_PREVISIBLE";

export type ImpactoPrevisional =
    | "REBOTE_ISAPRE_PREVISIBLE"
    | "NO_BONIFICABLE_POR_NORMA"
    | "BONIFICABLE";

export interface EtiologiaResult {
    tipo: EtiologiaTipo;
    absorcion_clinica: AbsorcionClinica;
    codigo_fonasa_valido: boolean;
    motivo_rechazo_previsible: MotivoRechazoPrevisible;
    impacto_previsional: ImpactoPrevisional;
    // recomendado para auditoría defendible
    rationale_short?: string;
    confidence?: number; // 0..1
    evidence?: {
        anchors?: string[]; // ej: ["EXISTE_PABELLON", "EXISTE_DIA_CAMA"]
        rules?: string[];   // ej: ["RULE_ABSORCION_ANESTESIA_PABELLON"]
        matches?: string[]; // ej: ["regex:/(instalaci[oó]n).*(v[ií]a venosa)/i"]
    };
}

export interface TaxonomyContextAnchors {
    hasPabellon: boolean;
    hasDayBed: boolean;
    hasUrgencia: boolean;
    // opcional si lo tienes: evidencia de “evento único” (PAD / paquete / etc.)
    hasEventoUnicoHint?: boolean;
    // raw: nombres de secciones detectadas, para explicar decisiones
    sectionNames?: string[];
}

// Update TaxonomyResult to include Etiology
export interface TaxonomyResult {
    id: string;
    item_original: string; // Keep legacy name for now or refactor to 'text' if needed, sticking to existing type
    text?: string; // Adding optional text align with user code
    grupo: GrupoCanonico;
    sub_familia: SubFamilia;
    atributos: AtributosPhase1 & { section?: string }; // Modified to include section context
    confidence: number;        // 0..1
    rationale_short: string;   // 1 línea, para debugging humano
    sourceRef?: string;
    etiologia?: EtiologiaResult;
}
