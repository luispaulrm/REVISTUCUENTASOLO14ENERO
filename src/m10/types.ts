// ---------- Common ----------
export type MoneyCLP = number;

export type EvidenceRef =
    | { kind: "jsonpath"; source: "BILL" | "PAM" | "CONTRACT"; path: string; note?: string }
    | { kind: "docref"; source: "BILL" | "PAM" | "CONTRACT"; page?: number; anchorText?: string; note?: string };

export interface CanonicalBillItem {
    id: string;
    section?: string;
    description: string;
    qty?: number;
    unitPrice?: MoneyCLP;
    total: MoneyCLP;
    codeInternal?: string;
}

export interface CanonicalBill {
    items: CanonicalBillItem[];
}

export interface CanonicalPamLine {
    id: string;
    folioPAM?: string;
    codigoGC: string;
    descripcion: string;
    cantidad?: number;
    valorTotal: MoneyCLP;
    bonificacion: MoneyCLP;
    copago: MoneyCLP;
    prestador?: string;
}

export interface CanonicalPAM {
    folios: Array<{
        folioPAM: string;
        prestador?: string;
        items: CanonicalPamLine[];
    }>;
    global?: { totalCopago?: MoneyCLP };
}

export type ContractDomain =
    | "HOSPITALIZACION" | "PABELLON" | "HONORARIOS" | "MATERIALES_CLINICOS"
    | "MEDICAMENTOS_HOSP" | "EXAMENES" | "OTROS" | "PROTESIS_ORTESIS"
    | "CONSULTA" | "KINESIOLOGIA" | "TRASLADOS";

export interface CanonicalContractRule {
    id: string;
    domain: ContractDomain;
    coberturaPct?: number | null;
    tope?: { kind: "UF" | "VAM" | "AC2" | "SIN_TOPE_EXPRESO" | "VARIABLE"; value?: number | null; currency?: string; };
    textLiteral: string;
}

export interface CanonicalContract {
    rules: CanonicalContractRule[];
}

export interface AuditMetadata {
    patientName?: string;
    clinicName?: string;
    isapre?: string;
    plan?: string;
    financialDate?: string;
}

export interface SkillInput {
    bill: CanonicalBill;
    pam: CanonicalPAM;
    contract: CanonicalContract;
    config?: {
        opacidadThresholdIOP?: number; // default 60
    };
    metadata?: AuditMetadata;
}

// 2) OUTPUT SCHEMA
export type TraceStatus = "OK" | "PARTIAL" | "FAIL";
export type VerifState = "VERIFICABLE" | "NO_VERIFICABLE_POR_CONTRATO" | "POTENCIAL_INFRACCION";

export type FindingLevel = "CORRECTO" | "DISCUSION_TECNICA" | "FRAGMENTACION_ESTRUCTURAL";

export type Motor = "M1" | "M2" | "M3" | "M4" | "NA";

export interface TraceAttempt {
    step: "CODE" | "GLOSA_FAMILIA" | "MONTO_1A1" | "MONTO_SUBSET" | "CONTRACT_ANCHOR";
    status: TraceStatus;
    details: string;
    refsBill?: EvidenceRef[];
}

export interface PamAuditRow {
    pamLineId: string;
    codigoGC: string;
    descripcion: string;
    montoCopago: MoneyCLP;
    bonificacion: MoneyCLP;
    trace: {
        status: TraceStatus;
        attempts: TraceAttempt[];
        matchedBillItemIds: string[];
    };
    contractCheck: {
        state: VerifState;
        rulesUsed: string[];
        notes: string;
    };
    fragmentacion: {
        level: FindingLevel;
        motor: Motor;
        rationale: string;
        economicImpact: MoneyCLP;
    };
    opacidad: {
        applies: boolean;
        iopScore: number;
        breakdown: { label: string; points: number }[];
        agotamiento: boolean;
    };
}

export interface SkillOutput {
    summary: {
        totalCopagoAnalizado: MoneyCLP;
        totalImpactoFragmentacion: MoneyCLP;
        opacidadGlobal: { applies: boolean; maxIOP: number };
        patternSystemic: {
            m1Count: number;
            m2Count: number;
            m3CopagoPct: number;
            isSystemic: boolean;
        };
    };
    eventModel: {
        actoPrincipal?: string;
        paquetesDetectados: string[];
        notes: string;
    };
    matrix: Array<{
        itemLabel: string;
        classification: FindingLevel;
        motor: Motor;
        fundamento: string;
        impacto: MoneyCLP;
        iop?: number;
    }>;
    pamRows: PamAuditRow[];
    reportText: string;
    complaintText: string;
    metadata?: AuditMetadata;
}
