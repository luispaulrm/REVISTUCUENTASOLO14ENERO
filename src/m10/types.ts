// ---------- Common ----------
export type MoneyCLP = number;

export type EvidenceRef =
    | { kind: "jsonpath"; source: "BILL" | "PAM" | "CONTRACT"; path: string; note?: string }
    | { kind: "docref"; source: "BILL" | "PAM" | "CONTRACT"; page?: number; anchorText?: string; note?: string };

export interface CanonicalBillItem {
    id: string;                 // estable (hash o id de origen)
    section?: string;           // Farmacia / Pabellón / Hospitalización / Exámenes / Honorarios etc.
    description: string;
    qty?: number;
    unitPrice?: MoneyCLP;
    total: MoneyCLP;
    codeInternal?: string;      // código prestador si existe
    categoryHint?: string;      // opcional (si ya tienes taxonomía Phase1)
}

export interface CanonicalBill {
    clinicName?: string;
    patientName?: string;
    invoiceNumber?: string;
    date?: string; // ISO
    items: CanonicalBillItem[];
    totals?: { total?: MoneyCLP };
}

export interface CanonicalPamLine {
    id: string;                 // estable (folio+index)
    folioPAM?: string;
    prestador?: string;
    codigoGC: string;
    descripcion: string;
    cantidad?: number;
    valorTotal: MoneyCLP;
    bonificacion: MoneyCLP;
    copago: MoneyCLP;
    // Raw additional fields if useful
    raw?: any;
}

export interface CanonicalPAM {
    folios: Array<{
        folioPAM: string;
        prestadorPrincipal?: string;
        items: CanonicalPamLine[];
    }>;
    global?: { totalCopago?: MoneyCLP; totalBonif?: MoneyCLP; totalValor?: MoneyCLP };
}

export type ContractDomain =
    | "HOSPITALIZACION"
    | "PABELLON"
    | "HONORARIOS"
    | "MATERIALES_CLINICOS"
    | "MEDICAMENTOS_HOSP"
    | "EXAMENES"
    | "OTROS";

export interface CanonicalContractRule {
    id: string;
    domain: ContractDomain;
    modalidad?: "PREFERENTE" | "LIBRE_ELECCION" | "AMBAS";
    coberturaPct?: number | null; // null si no expresa
    tope?: { kind: "UF" | "VAM" | "AC2" | "SIN_TOPE_EXPRESO" | "VARIABLE"; value?: number | null; currency?: string; };
    exclusion?: boolean;
    textLiteral: string;          // literal del contrato
    refs: EvidenceRef[];
}

export interface CanonicalContract {
    planName?: string;
    rules: CanonicalContractRule[];
    metadata?: Record<string, any>;
}

export interface SkillInput {
    bill: CanonicalBill;
    pam: CanonicalPAM;
    contract: CanonicalContract;
    // opcionales
    config?: {
        agrupadoresSospechosos?: string[]; // default: ["3101002","3201001","3101001","3201002"]
        opacidadThresholdIOP?: number;     // default 60
        allowMontoSubsetMatch?: boolean;   // default true (pero siempre con evidencia + familia)
    };
}

// 2) OUTPUT SCHEMA (TypeScript)
export type TraceStatus = "OK" | "PARTIAL" | "FAIL";
export type VerifState = "VERIFICABLE" | "NO_VERIFICABLE_POR_OPACIDAD" | "NO_VERIFICABLE_POR_CONTRATO";

export type FindingLevel = "CORRECTO" | "DISCUSION_TECNICA" | "FRAGMENTACION_ESTRUCTURAL";

export type Motor = "M1" | "M2" | "M3" | "M4" | "NA";

export interface TraceAttempt {
    step:
    | "CODE_MATCH"
    | "GLOSA_FAMILIA_MATCH"
    | "MONTO_1A1_MATCH"
    | "MONTO_SUBSET_MATCH"
    | "CONTRACT_ANCHOR_CHECK";
    status: TraceStatus;
    details: string;
    refsBill?: EvidenceRef[];
    refsPam?: EvidenceRef[];
    refsContract?: EvidenceRef[];
}

export interface PamAuditRow {
    pamLineId: string;
    codigoGC: string;
    descripcion: string;
    montoCopago: MoneyCLP;
    bonificacion: MoneyCLP;
    valorTotal: MoneyCLP;
    trace: {
        status: TraceStatus;
        attempts: TraceAttempt[];
        matchedBillItemIds: string[];
        matchedBillMonto?: MoneyCLP;
    };
    contractCheck: {
        state: VerifState;
        rulesUsed: string[]; // contract rule ids
        notes: string;
    };
    fragmentacion: {
        level: FindingLevel;
        motor: Motor;
        rationale: string;
        economicImpact: MoneyCLP; // típico = copago asociado
    };
    opacidad: {
        applies: boolean;
        iopScore: number; // 0-100
        agotamiento: boolean; // true si completó attempts y falló
        requiredDisclosures?: string[];
    };
    evidence: EvidenceRef[];
}

export interface SkillOutput {
    summary: {
        totalCopagoPAM?: MoneyCLP;
        totalCopagoAnalizado: MoneyCLP;
        totalImpactoFragmentacion: MoneyCLP;
        opacidadGlobal: { applies: boolean; iopScore: number };
        patternSystemic: boolean;
    };
    eventModel: {
        actoPrincipal?: string;
        paquetesDetectados: string[]; // "DIA_CAMA", "PABELLON", "PROCEDIMIENTO", etc.
        notes: string;
    };
    matrix: Array<{
        itemLabel: string;
        classification: FindingLevel;
        motor: Motor;
        fundamento: string;
        impacto: MoneyCLP;
        refs: EvidenceRef[];
    }>;
    pamRows: PamAuditRow[];
    reportText: string;   // informe forense
    complaintText: string; // texto estándar listo para reclamo/reposición
    debug: {
        stopConditionTriggered?: string;
        configUsed: Required<SkillInput["config"]>;
    };
}
