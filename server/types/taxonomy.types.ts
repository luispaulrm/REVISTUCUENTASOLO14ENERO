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
}

export interface TaxonomyResult {
    id: string;
    item_original: string;
    grupo: GrupoCanonico;
    sub_familia: SubFamilia;
    atributos: AtributosPhase1;
    confidence: number;        // 0..1
    rationale_short: string;   // 1 línea, para debugging humano
    sourceRef?: string;
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
