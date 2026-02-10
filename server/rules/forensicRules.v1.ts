import { TaxonomyResult } from '../types/taxonomy.types.js';

// --- INTERFACES ---

export interface AuditContext {
    existe_dia_cama: boolean;
    existe_pabellon: boolean;
    // Future expansion: existe_uci, existe_uti, etc.
}

export type FindingSeverity = "INFO" | "WARN" | "HIGH";

export interface ForensicFinding {
    code: string;           // E.g. "INHERENTE_HOTELERA"
    itemId: string;
    message: string;
    evidence: {
        grupo: string;
        sub_familia: string;
        atributos_relevantes: string[];
    };
    severity: FindingSeverity;
    ruleId: string;
}

export interface ForensicRule {
    id: string;
    description: string;
    when: (item: TaxonomyResult, ctx: AuditContext) => boolean;
    then: (item: TaxonomyResult, ctx: AuditContext) => ForensicFinding;
}

// --- RULES IMPLEMENTATION (V1) ---

const Rule_InherenteHotelera: ForensicRule = {
    id: "R-HOT-01",
    description: "Detecta ítems inherentes al día cama cuando existe cargo de hotelería.",
    when: (item, ctx) => {
        return (
            ctx.existe_dia_cama &&
            !!item.atributos.potencial_inherente_dia_cama &&
            item.grupo !== 'HOTELERA' // No flag the bed day itself
        );
    },
    then: (item, ctx) => ({
        code: "DUPLICIDAD_HOTELERA",
        itemId: item.id,
        ruleId: "R-HOT-01",
        severity: "HIGH",
        message: `Ítem "${item.item_original}" clasificado como inherente al Día Cama (Hotelera) ya cobrado.`,
        evidence: {
            grupo: item.grupo,
            sub_familia: item.sub_familia,
            atributos_relevantes: ['potencial_inherente_dia_cama']
        }
    })
};

const Rule_InherentePabellon: ForensicRule = {
    id: "R-PAB-01",
    description: "Detecta ítems inherentes al derecho de pabellón.",
    when: (item, ctx) => {
        return (
            ctx.existe_pabellon &&
            !!item.atributos.potencial_inherente_pabellon &&
            item.grupo !== 'PABELLON'
        );
    },
    then: (item, ctx) => ({
        code: "DUPLICIDAD_PABELLON",
        itemId: item.id,
        ruleId: "R-PAB-01",
        severity: "HIGH",
        message: `Ítem "${item.item_original}" incluido en Derecho de Pabellón.`,
        evidence: {
            grupo: item.grupo,
            sub_familia: item.sub_familia,
            atributos_relevantes: ['potencial_inherente_pabellon']
        }
    })
};

const Rule_NoClinico: ForensicRule = {
    id: "R-ADM-01",
    description: "Detecta cargos administrativos o no clínicos.",
    when: (item, ctx) => {
        return !!item.atributos.potencial_no_clinico;
    },
    then: (item, ctx) => ({
        code: "CARGO_NO_CLINICO",
        itemId: item.id,
        ruleId: "R-ADM-01",
        severity: "WARN",
        message: `Ítem "${item.item_original}" clasificado como administrativo/no clínico.`,
        evidence: {
            grupo: item.grupo,
            sub_familia: item.sub_familia,
            atributos_relevantes: ['potencial_no_clinico']
        }
    })
};

export const FORENSIC_RULES_V1: ForensicRule[] = [
    Rule_InherenteHotelera,
    Rule_InherentePabellon,
    Rule_NoClinico
];
