
import { PAMItem, PAMDocument } from '../../pamService';
import { ContractRegla } from '../../types';

export interface UnidadReferencia {
    tipo: "UF" | "VA" | "UV" | "BAM" | "AC2" | "PESOS" | "DESCONOCIDA";
    valor_pesos_estimado?: number;
    evidencia: string[];
    confianza: "ALTA" | "MEDIA" | "BAJA";
    factor_origen?: number; // e.g. 6.0 for Colecistectomía
}

export interface TopeValidationResult {
    tope_aplica: boolean;
    tope_cumplido: boolean;
    monto_tope_estimado?: number;
    rationale: string;
    metodo_validacion: "FACTOR_ESTANDAR" | "MONTO_EXACTO" | "SIN_TOPE";
}

// Common surgical factors for reference (Catalog V1)
const SURGICAL_FACTORS: Record<string, number> = {
    '1802081': 6.0, // Colecistectomía
    '1801001': 3.0, // Apendicectomía
    '1101009': 1.0, // Día Cama Integral (Reference)
    // Add more as needed
};

function parseMonto(val: string | number | undefined): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    // Remove dots (thousands) but keep comma as decimal if present.
    // Standard Chilean format: 1.000,00 or 1.000
    // Approach: remove all dots, then replace comma with dot.
    const clean = val.replace(/\./g, '').replace(',', '.');
    return parseFloat(clean) || 0;
}

/**
 * Infers the internal contractual unit value (VA, AC2, BAM) from the PAM and Contract.
 * Strategy: Find an "Anchor Item" where bonification is clearly defined and consistent with a standard factor.
 */
export function inferUnidadReferencia(
    contrato: { reglas: ContractRegla[] } | any,
    pam: PAMDocument | any
): UnidadReferencia {

    const evidencia: string[] = [];

    // 1. Optional: Parse contract text if available (future improvement)

    // 2. Reverse Engineering from PAM
    const items = pam.folios?.flatMap((f: any) => f.desglosePorPrestador?.flatMap((d: any) => d.items)) || [];

    // Candidates: Surgical code exists in catalog, has bonification > 0, has copay > 0
    const candidates = items.filter((item: PAMItem) =>
        item.codigoGC && SURGICAL_FACTORS[item.codigoGC] &&
        parseMonto(item.bonificacion) > 0 &&
        parseMonto(item.copago) > 0
    );

    if (candidates.length > 0) {
        // Focus on the first robust candidate assuming 70% coverage standard
        const primaryCandidate = candidates[0];
        const factor = SURGICAL_FACTORS[primaryCandidate.codigoGC];

        const bonif = parseMonto(primaryCandidate.bonificacion);
        const impliedUnit70 = (bonif / 0.70) / factor;

        evidencia.push(`Inferido desde ítem ${primaryCandidate.codigoGC} (${primaryCandidate.descripcion}) con Factor ${factor}.`);
        evidencia.push(`Supuesto: Cobertura 0.70. Bonificación real: $${bonif} (Leída como ${primaryCandidate.bonificacion}).`);

        return {
            tipo: "VA", // Generic internal unit
            valor_pesos_estimado: Math.round(impliedUnit70),
            confianza: "ALTA",
            evidencia: evidencia,
            factor_origen: factor
        };
    }

    return {
        tipo: "DESCONOCIDA",
        evidencia: ["No se encontraron ítems ancla conocidos en el PAM."],
        confianza: "BAJA"
    };
}

/**
 * Validates if a specific honorary item complies with the calculated unit value cap.
 */
export function validateTopeHonorarios(
    item: { codigoGC: string; bonificacion: string | number; copago: string | number },
    unidadRef: UnidadReferencia
): TopeValidationResult {

    // Safety check
    if (unidadRef.confianza === "BAJA" || !unidadRef.valor_pesos_estimado) {
        return {
            tope_aplica: false,
            tope_cumplido: false,
            rationale: "Unidad de referencia desconocida o de baja confianza.",
            metodo_validacion: "SIN_TOPE"
        };
    }

    const factor = SURGICAL_FACTORS[item.codigoGC];
    if (!factor) {
        return {
            tope_aplica: false,
            tope_cumplido: false,
            rationale: `Código ${item.codigoGC} no tiene factor conocido en catálogo.`,
            metodo_validacion: "SIN_TOPE"
        };
    }

    const factorAplicado = factor;
    const montoTopeTeorico = unidadRef.valor_pesos_estimado * factorAplicado * 0.70;

    const bonif = parseMonto(item.bonificacion);
    // const diff = Math.abs(bonif - montoTopeTeorico); // unused var in strict TS?

    if (Math.abs(bonif - montoTopeTeorico) < 2000) {
        return {
            tope_aplica: true,
            tope_cumplido: true,
            monto_tope_estimado: montoTopeTeorico,
            rationale: `Bonificación ($${bonif}) coincide con tope calculado ($${Math.round(montoTopeTeorico)}) basado en Unidad $${unidadRef.valor_pesos_estimado}.`,
            metodo_validacion: "FACTOR_ESTANDAR"
        };
    } else if (bonif > montoTopeTeorico) {
        return {
            tope_aplica: true,
            tope_cumplido: true,
            rationale: "Bonificación superior al tope teórico (Cobertura mejorada o error a favor).",
            metodo_validacion: "FACTOR_ESTANDAR"
        };
    } else {
        const copago = parseMonto(item.copago);
        const totalPAM = bonif + copago;
        const theoreticalCoverage = totalPAM * 0.70;

        if (Math.abs(bonif - theoreticalCoverage) < 2000) {
            return {
                tope_aplica: true,
                tope_cumplido: true,
                rationale: "Cobertura proporcional (70%) aplicada sin llegar al tope (Monto bajo).",
                metodo_validacion: "FACTOR_ESTANDAR"
            };
        }

        return {
            tope_aplica: true,
            tope_cumplido: false,
            rationale: `Discrepancia: Bonificación ($${bonif}) no calza con tope ($${Math.round(montoTopeTeorico)}) ni con cobertura directa.`,
            metodo_validacion: "FACTOR_ESTANDAR"
        };
    }
}
