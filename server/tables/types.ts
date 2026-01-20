// tables/types.ts
export type TableCell = string | number | null;

export type Table = {
    id: string;
    title: string;
    description?: string;
    columns: { key: string; label: string; align?: "left" | "right" | "center" }[];
    rows: Record<string, TableCell>[];
    footnote?: string;
};

export type MoneyCLP = number;

export type AuditCategoriaFinal = "A" | "B" | "Z" | "N/A";

export type AuditHallazgo = {
    codigos?: string;
    titulo?: string;
    glosa?: string;
    categoria?: string;
    tipo_monto?: string;
    montoObjetado?: MoneyCLP;
    recomendacion_accion?: string;
    nivel_confianza?: string;
    estado_juridico?: string;
    categoria_final?: AuditCategoriaFinal;
    isSubsumed?: boolean;
    anclajeJson?: string;
    hallazgo?: string;
};

export type AuditJSON = {
    decisionGlobal?: { estado?: string; fundamento?: string };
    resumenFinanciero?: {
        totalCopagoInformado?: MoneyCLP;
        totalCopagoObjetado?: MoneyCLP;
        cobros_improcedentes_exigibles?: MoneyCLP;
        copagos_bajo_controversia?: MoneyCLP;
        ahorro_confirmado?: MoneyCLP;
        monto_indeterminado?: MoneyCLP;
        monto_no_observado?: MoneyCLP; // New field for Cat OK
        totalCopagoReal?: MoneyCLP;
        estado_copago?: string;
    };
    hallazgos?: AuditHallazgo[];
    bitacoraAnalisis?: any[];
    antecedentes?: any;
};

export type PamItem = {
    descripcion: string;
    codigo?: string;
    copago?: MoneyCLP;
    bonificacion?: MoneyCLP;
    total?: MoneyCLP;
    grupo?: string; // si tu extractor ya lo trae (ideal)
};

export type PamJSON = {
    items?: PamItem[];
    totalCopago?: MoneyCLP;
};

export type CuentaItem = {
    seccion?: string;        // "3101 MATERIALES", "8964 ALIMENTACION"
    codigo?: string;
    descripcion: string;
    cantidad?: number;
    precioUnitario?: MoneyCLP;
    total?: MoneyCLP;
};

export type CuentaJSON = {
    items?: CuentaItem[];
};
