// ---------- Common ----------
export type MoneyCLP = number;


export type EvidenceRef =
    | { kind: "jsonpath"; source: "BILL" | "PAM" | "CONTRACT"; path: string; note?: string; itemID?: string }
    | { kind: "docref"; source: "BILL" | "PAM" | "CONTRACT"; page?: number; anchorText?: string; note?: string };

export interface CanonicalBillItem {
    id: string;
    section?: string;
    sectionPath?: string[]; // New: full path for provenance
    sectionKey?: string;    // New: unique key for provenance
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
    tope?: { kind: "UF" | "UTM" | "CLP" | "VAM" | "AC2" | "SIN_TOPE_EXPRESO" | "VARIABLE"; value?: number | null; currency?: string; };
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
    executionTimestamp?: string;
}

export interface SkillInput {
    bill: CanonicalBill;
    pam: CanonicalPAM;
    contract: CanonicalContract;
    config?: {
        opacidadThresholdIOP?: number; // default 60
        // M5: UF resolver output (pre-resolved by adapter before engine call)
        ufValueCLP?: number;          // e.g. 39750.94
        ufDateUsed?: string;          // ISO date: "2026-02-21"
        ufSource?: string;            // "mindicador.cl" | "BCCh" | "SII" | "fallback"
    };
    metadata?: AuditMetadata;
}

// 2) OUTPUT SCHEMA
export type TraceStatus = "OK" | "PARTIAL" | "FAIL" | "AMBIGUOUS";

// --- STRUCTURAL GLOSS TYPOLOGY (TGE) ---
export type TGEType = "TGE_A" | "TGE_B" | "TGE_C" | "TGE_D" | "TGE_E" | "NONE";

// M5: Full contract verification state machine
export type ContractCheckState =
    | "VERIFICABLE_OK"               // Rule found, bonif/copago within tolerance
    | "INFRA_BONIFICACION"           // Rule found, copago exceeds expected by > tolerance
    | "TOPE_EXCEDIDO"                // Tope value exists and amount exceeds it
    | "TOPE_NO_VERIFICABLE"          // Tope indicated but value is null/unparsed
    | "NO_VERIFICABLE_POR_CONTRATO"  // No rule found for this domain
    | "NO_VERIFICABLE_POR_MODALIDAD"; // Rules exist but can't determine preferente vs LE

// Legacy alias (some code still references this)
export type VerifState = ContractCheckState | "VERIFICABLE" | "POTENCIAL_INFRACCION";

export type FindingLevel = "CORRECTO" | "DISCUSION_TECNICA" | "FRAGMENTACION_ESTRUCTURAL" | "INFRA_BONIFICACION" | "NO_ARANCELABLE";

export type Motor = "M1" | "M2" | "M3" | "M4" | "M5" | "NA";

export interface SubtotalBlock {
    id: string;
    total: MoneyCLP;
    neto?: MoneyCLP;
    iva?: MoneyCLP;
    componentItemIds: string[];
    label?: string;
    isVirtual?: boolean;
}

export interface TraceAttempt {
    step: "CODE" | "GLOSA_FAMILIA" | "MONTO_1A1" | "MONTO_SUBSET" | "CONTRACT_ANCHOR" | "MONTO_SUBTOTAL" | "MONTO_CONTIGUO";
    status: TraceStatus;
    details: string;
    refsBill?: EvidenceRef[];
    candidates?: TraceCandidate[]; // New: store top candidates
    billItemIds?: string[];        // New: store IDs reached in this attempt
}

export interface TraceCandidate {
    items: CanonicalBillItem[];
    score: number;
    reason: string;
    isAmbiguous?: boolean;
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
        traceability?: { level: string; reason: string };
    };
    contractCheck: {
        state: ContractCheckState | VerifState;
        rulesUsed: string[];
        notes: string;
        ruleRef?: string;               // e.g. "Día Cama / preferente / 100%"
        ruleMatchedBy?: 'MODALIDAD' | 'FALLBACK' | 'NONE';
        expectedBonifPct?: number | null;
        expectedBonif?: number | null;
        expectedCopago?: number | null;
        deltaCopago?: number | null;     // positive = patient overcharged
        toleranceCLP?: number;
        topeState?: 'SIN_TOPE' | 'TOPE_OK' | 'TOPE_EXCEDIDO' | 'TOPE_NO_VERIFICABLE';
        topeCLP?: number | null;
    };
    fragmentacion: {
        level: FindingLevel;
        motor: Motor;
        rationale: string;
        economicImpact: MoneyCLP;
        tge?: TGEType;
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
            m5Count: number;
            m5ExcessCopago: MoneyCLP;
            m5OverchargePct: number;
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
