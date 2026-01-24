
import { PAMItem, PamDocument } from '../../pamService';
import { ContractRegla } from '../../types';

export interface UnidadReferencia {
    tipo: "UF" | "VA" | "UV" | "BAM" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDA";
    valor_pesos_estimado?: number;
    evidencia: string[];
    confianza: "ALTA" | "MEDIA" | "BAJA";
    factor_origen?: number;
    cobertura_aplicada?: number;
    fecha_referencia?: Date;
    valor_uf_fecha?: number;
}

export interface TopeValidationResult {
    tope_aplica: boolean;
    tope_cumplido: boolean;
    monto_tope_estimado?: number;
    rationale: string;
    metodo_validacion: "FACTOR_ESTANDAR" | "MONTO_EXACTO" | "SIN_TOPE";
}

// Global Surgical Factors (Referential catalog from Fonasa Arancel MLE)
// If the contract doesn't specify a factor, we use these standard ones.
const SURGICAL_FACTORS: Record<string, number> = {
    '1802081': 6.0, // Colecistectomía
    '1801001': 3.0, // Apendicectomía
    '1801002': 4.0, // Gastrectomía
    '1802011': 4.0, // Hernia Inguinal
    '1902001': 1.0, // Pabellón (Ref)
    '1101009': 1.0, // Día Cama Integral (Ref)
    '2801001': 1.0, // Intervenciones Menores
};

function parseMonto(val: string | number | undefined): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = val.replace(/\./g, '').replace(',', '.');
    return parseFloat(clean) || 0;
}

/**
 * Searches for the coverage percentage in the contract for Surgery/Honoraries.
 */
/**
 * Searches for the coverage percentage in the contract for Surgery/Honoraries.
 */
function findCoverageFactor(contrato: any): number {
    if (!contrato || !contrato.coberturas) return 0.70; // Fallback only if contract is empty

    // Hierarchy of search: Honorarios -> Cirugía -> Hospitalario
    const targets = ['HONORARIOS', 'CIRUGIA', 'QUIRURGICO', 'HOSPITALARIO'];

    for (const target of targets) {
        const found = contrato.coberturas.find((c: any) =>
            (c.item || c.categoria || "").toUpperCase().includes(target)
        );

        if (found && found.modalidades) {
            // Prioritize Libre Elección for factor usage (standard audit context)
            const modality = found.modalidades.find((m: any) => m.tipo === 'LIBRE_ELECCION') ||
                found.modalidades.find((m: any) => m.tipo === 'PREFERENTE');

            if (modality && (modality.porcentaje !== null || modality.cobertura)) { // Support both number and legacy string if needed
                if (typeof modality.porcentaje === 'number') {
                    return modality.porcentaje > 1 ? modality.porcentaje / 100 : modality.porcentaje;
                }
                const val = parseMonto(modality.cobertura || modality.copago || "0"); // Fallback
                return val > 1 ? val / 100 : val;
            }
        }
        // Legacy fallback (flat structure check just in case)
        if (found && found.valor) {
            const val = parseMonto(found.valor);
            if (val > 1) return val / 100;
            if (val > 0) return val;
        }
    }

    return 0.70; // Default safety fallback
}

import { getUfForDate } from './ufService.js';

/**
 * Infers the internal contractual unit value (VA, AC2, BAM, VAM) from the PAM and Contract.
 * Deduce NOTHING via hardcode; everything is triangulated.
 */
export async function inferUnidadReferencia(
    contrato: { coberturas?: any[], reglas?: ContractRegla[], diseno_ux?: any } | any,
    pam: PamDocument | any,
    isapreName?: string,
    eventDate: Date = new Date()
): Promise<UnidadReferencia> {

    const evidencia: string[] = [];
    const coverage = findCoverageFactor(contrato);
    const normalizedIsapre = (isapreName || contrato?.diseno_ux?.nombre_isapre || "").toUpperCase();

    // Fetch real UF for the date
    const valorUf = await getUfForDate(eventDate);
    evidencia.push(`UF_DETERMINISTA: Valor UF al ${eventDate.toLocaleDateString()} es $${valorUf.toLocaleString('es-CL')}.`);

    // Map unit type based on Isapre
    let unitType: UnidadReferencia["tipo"] = "VA";
    if (normalizedIsapre.includes("MASVIDA")) unitType = "VAM";
    else if (normalizedIsapre.includes("COLMENA")) unitType = "VAM";
    else if (normalizedIsapre.includes("CONSALUD")) unitType = "AC2";
    else if (normalizedIsapre.includes("BANMEDICA") || normalizedIsapre.includes("VIDA TRES") || normalizedIsapre.includes("CRUZ BLANCA")) unitType = "VA";

    // Reverse Engineering from PAM
    const items = pam.folios?.flatMap((f: any) => f.desglosePorPrestador?.flatMap((d: any) => d.items)) || [];

    // Candidates: Items with surgical codes, bonification and copay
    const candidates = items.filter((item: PAMItem) =>
        item.codigoGC && SURGICAL_FACTORS[item.codigoGC] &&
        parseMonto(item.bonificacion) > 0
    );

    if (candidates.length > 0) {
        // Use the most significant candidate (highest factor usually most stable)
        const primaryCandidate = candidates.sort((a, b) =>
            (SURGICAL_FACTORS[b.codigoGC!] || 0) - (SURGICAL_FACTORS[a.codigoGC!] || 0)
        )[0];

        const factor = SURGICAL_FACTORS[primaryCandidate.codigoGC!];
        const bonif = parseMonto(primaryCandidate.bonificacion);

        // Math: UnitValue = Bonif / (Factor * Coverage)
        const impliedUnitValue = bonif / (factor * coverage);

        evidencia.push(`DEDUCCIÓN DINÁMICA: Tipo ${unitType} inferido para Isapre ${normalizedIsapre || "Desconocida"}.`);
        evidencia.push(`FUERZA DETERMINISTA: Valor Unidad inferido desde ${primaryCandidate.codigoGC} (${primaryCandidate.descripcion}).`);
        evidencia.push(`MATEMÁTICA: Bonif $${bonif} / (Factor ${factor} * Cobertura ${Math.round(coverage * 100)}%) = $${Math.round(impliedUnitValue)}.`);
        evidencia.push(`ORIGEN: Cobertura extraída del contrato (${Math.round(coverage * 100)}%).`);

        return {
            tipo: unitType,
            valor_pesos_estimado: Math.round(impliedUnitValue),
            confianza: "ALTA",
            evidencia: evidencia,
            factor_origen: factor,
            cobertura_aplicada: coverage,
            fecha_referencia: eventDate,
            valor_uf_fecha: valorUf
        };
    }

    return {
        tipo: normalizedIsapre ? unitType : "DESCONOCIDA",
        evidencia: ["No se encontraron ítems ancla suficientes para deducir el Valor Unidad."],
        confianza: "BAJA",
        fecha_referencia: eventDate,
        valor_uf_fecha: valorUf
    };
}

/**
 * Validates if a specific honorary item complies with the calculated unit value cap.
 */
export function validateTopeHonorarios(
    item: { codigoGC: string; bonificacion: string | number; copago: string | number; descripcion?: string },
    unidadRef: UnidadReferencia,
    contrato?: any
): TopeValidationResult & { regla_aplicada?: any } {

    if (unidadRef.confianza === "BAJA" || !unidadRef.valor_pesos_estimado || !unidadRef.cobertura_aplicada) {
        return {
            tope_aplica: false,
            tope_cumplido: false,
            rationale: "Unidad de referencia no deducible para este caso.",
            metodo_validacion: "SIN_TOPE"
        };
    }

    // 1. Try Specific Contract Rule Lookup
    let factor = SURGICAL_FACTORS[item.codigoGC];
    let reglaAplicada: any = null;

    if (contrato && contrato.coberturas) {
        // Find rule specifically matching code or description
        const specificRule = contrato.coberturas.find((c: any) =>
            (c.item && c.item.includes(item.codigoGC)) ||
            (c.item && item.descripcion && c.item.toUpperCase().includes(item.descripcion.toUpperCase().substring(0, 15)))
        );

        if (specificRule && specificRule.modalidades) {
            reglaAplicada = specificRule;
            // Parse custom factor from modalities (LIBRE_ELECCION prefered)
            const modality = specificRule.modalidades.find((m: any) => m.tipo === 'LIBRE_ELECCION') ||
                specificRule.modalidades.find((m: any) => m.tipo === 'PREFERENTE');

            if (modality && modality.tope) {
                // FORCE: Always format tope_aplicado so AuditEngine can display it
                factor = modality.tope;
                const unit = modality.unidadTope || "AC2";

                // Construct the string expected by parseCeilingFactor in AuditEngine
                // e.g., "1.2 veces AC2" or just "1.2 AC2"
                reglaAplicada = {
                    ...specificRule,
                    tope_aplicado: `${factor} veces ${unit}`, // Format explicit for regex
                    _internal_factor: factor,
                    _internal_unit: unit
                };
            } else if (modality && modality.copago) {
                // Fallback to legacy string parsing if 'tope' was not numeric but put in a string field (unlikely with new schema but safe)
                // ... logic logic ... but let's trust the number first.
            }
        }
    }

    if (!factor) {
        return {
            tope_aplica: false,
            tope_cumplido: false,
            rationale: `Código ${item.codigoGC} no tiene factor asignado para validación automática.`,
            metodo_validacion: "SIN_TOPE"
        };
    }

    // Tope = V.A * Factor * Cobertura
    const montoTopeTeorico = unidadRef.valor_pesos_estimado * factor * unidadRef.cobertura_aplicada;
    const bonif = parseMonto(item.bonificacion);

    // Tolerance of $2.500 for rounding differences in V.A calculation
    if (Math.abs(bonif - montoTopeTeorico) < 2500) {
        return {
            tope_aplica: true,
            tope_cumplido: true,
            monto_tope_estimado: montoTopeTeorico,
            rationale: `CUMPLE: Bonificación ($${bonif}) coincide con el V.A deducido de $${unidadRef.valor_pesos_estimado} (Factor ${factor} @ ${Math.round(unidadRef.cobertura_aplicada * 100)}%).`,
            metodo_validacion: "FACTOR_ESTANDAR",
            regla_aplicada: reglaAplicada
        };
    } else if (bonif > montoTopeTeorico + 2500) {
        return {
            tope_aplica: true,
            tope_cumplido: true,
            rationale: "CUMPLE (EXCEDE): Bonificación superior al tope (posible beneficio adicional).",
            metodo_validacion: "FACTOR_ESTANDAR",
            regla_aplicada: reglaAplicada
        };
    } else {
        return {
            tope_aplica: true,
            tope_cumplido: false,
            rationale: `DISCREPANCIA: Bonif $${bonif} es inferior al tope calculado de $${Math.round(montoTopeTeorico)} para factor ${factor}.`,
            metodo_validacion: "FACTOR_ESTANDAR",
            regla_aplicada: reglaAplicada
        };
    }
}
