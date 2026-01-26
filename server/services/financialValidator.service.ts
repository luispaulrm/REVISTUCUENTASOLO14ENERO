
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
    '1103057': 5.0, // Rizotomía (Estimado referencial para anclaje)
    '1102025': 2.0, // Bloqueo facetario
    '1103048': 3.0  // Infiltración
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
/**
 * Resolves the modality (PREFERENTE vs LIBRE_ELECCION) based on clinic name and contract.
 */
export function resolveModalityByPrestador(contrato: any, prestador: string): 'PREFERENTE' | 'LIBRE_ELECCION' {
    if (!prestador || !contrato || !contrato.coberturas) return 'LIBRE_ELECCION';

    const p = prestador.toUpperCase();
    console.log(`[DEBUG_NET] Resolving Network for: "${p}"`);

    // Check all coverage items and their red_especifica
    for (const c of contrato.coberturas) {
        if (c.tipo_modalidad === 'preferente' && c.red_especifica) {
            const red = String(c.red_especifica).toUpperCase();

            // Debug potential matches
            const clinics = red.split(/[,;|]/).map(s => s.trim());
            for (const clinic of clinics) {
                if (clinic.length > 3) {
                    if (p.includes(clinic)) {
                        console.log(`[DEBUG_NET] MATCH FOUND: Provider "${p}" includes "${clinic}" (from: ${red})`);
                        return 'PREFERENTE';
                    }
                    if (clinic.includes(p)) {
                        console.log(`[DEBUG_NET] MATCH FOUND: Clinic "${clinic}" includes "${p}"`);
                        return 'PREFERENTE';
                    }
                }
            }
        }
    }

    console.log(`[DEBUG_NET] No match found. Defaulting to LIBRE_ELECCION.`);
    return 'LIBRE_ELECCION';
}

function findCoverageFactor(contrato: any, prestador?: string): number {
    if (!contrato || !contrato.coberturas) return 0.70;

    const modalityType = prestador ? resolveModalityByPrestador(contrato, prestador) : 'LIBRE_ELECCION';

    // Hierarchy of search: Honorarios -> Cirugía -> Hospitalario
    const targets = ['HONORARIOS', 'CIRUGIA', 'QUIRURGICO', 'HOSPITALARIO'];

    for (const target of targets) {
        const found = contrato.coberturas.find((c: any) =>
            (c.item || "").toUpperCase().includes(target) ||
            (c.categoria || "").toUpperCase().includes(target) ||
            (c.categoria_canonica || "").toUpperCase().includes(target)
        );

        if (found && found.modalidades) {
            // High Fidelity path
            const modality = found.modalidades.find((m: any) => m.tipo === modalityType) ||
                found.modalidades.find((m: any) => m.tipo === 'LIBRE_ELECCION') ||
                found.modalidades.find((m: any) => m.tipo === 'PREFERENTE');

            if (modality && (modality.porcentaje !== null || modality.cobertura)) {
                if (typeof modality.porcentaje === 'number') {
                    return modality.porcentaje > 1 ? modality.porcentaje / 100 : modality.porcentaje;
                }
                const val = parseMonto(modality.cobertura || modality.copago || "0");
                return val > 1 ? val / 100 : val;
            }
        }

        // Canonical Skill path (Flattened fields) - Filter by modality if possible
        const matchingModality = contrato.coberturas.filter((c: any) => {
            const itemMatch = (c.item || "").toUpperCase().includes(target) ||
                (c.categoria || "").toUpperCase().includes(target) ||
                (c.categoria_canonica || "").toUpperCase().includes(target) ||
                (c.descripcion_textual || "").toUpperCase().includes(target);

            return itemMatch && (!c.tipo_modalidad || c.tipo_modalidad === modalityType.toLowerCase());
        });

        const chosen = matchingModality.length > 0 ? matchingModality[0] : found;

        if (chosen && (chosen.porcentaje !== undefined)) {
            const perc = typeof chosen.porcentaje === 'number' ? chosen.porcentaje : parseMonto(chosen.porcentaje || "0");
            if (perc > 0) return perc > 1 ? perc / 100 : perc;
        }
    }

    return 0.70;
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
    const coverage = findCoverageFactor(contrato, pam?.prestadorPrincipal || (pam?.folios && pam.folios[0]?.prestadorPrincipal));
    const normalizedIsapre = (isapreName || contrato?.diseno_ux?.nombre_isapre || "").toUpperCase();

    // Fetch real UF for the date
    let valorUf = 38000; // Default fallback
    try {
        valorUf = await getUfForDate(eventDate);
    } catch (e) {
        console.log("[UFService] Fallback to default UF 38000 due to error");
    }
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
    contrato?: any,
    context?: { prestador?: string } // Added context
): TopeValidationResult & { regla_aplicada?: any } {

    const modalityType = context?.prestador ? resolveModalityByPrestador(contrato, context.prestador) : 'LIBRE_ELECCION';

    // 1. Try Specific Contract Rule Lookup FIRST (Logic Layer)
    let factor = SURGICAL_FACTORS[item.codigoGC];
    let reglaAplicada: any = null;

    if (contrato && contrato.coberturas) {
        // Find rule specifically matching code or description (Support Canonical V2 fields)
        // AND matching modality logic
        const matchingRules = contrato.coberturas.filter((c: any) => {
            const triggerCodes = String(c.CODIGO_DISPARADOR_FONASA || "").split(',').map(s => s.trim()).filter(s => s.length > 0);
            const matchesTrigger = (c.item && typeof c.item === 'string' && c.item.includes(item.codigoGC)) ||
                (triggerCodes.some(tc => item.codigoGC.startsWith(tc))) ||
                (c.item && typeof c.item === 'string' && item.descripcion && c.item.toUpperCase().includes(item.descripcion.toUpperCase().substring(0, 15)));

            return matchesTrigger;
        });

        // Prioritize rule matching the resolved modality
        let specificRule = matchingRules.find((c: any) => c.tipo_modalidad === modalityType.toLowerCase());

        // Fallback to any matching rule if strict modality match fails
        if (!specificRule && matchingRules.length > 0) {
            specificRule = matchingRules[0];
        }

        if (specificRule) {
            reglaAplicada = specificRule;
            if (specificRule.modalidades) {
                // High Fidelity path (Nested)
                const modality = specificRule.modalidades.find((m: any) => m.tipo === 'LIBRE_ELECCION') ||
                    specificRule.modalidades.find((m: any) => m.tipo === 'PREFERENTE');

                if (modality && modality.tope) {
                    factor = modality.tope;
                    // Dynamic Unit: Prefer specific unit from rule, else inferred unit type, else generic fallback
                    const unit = modality.unidadTope || unidadRef.tipo || "FACTOR_ARANCEL";

                    reglaAplicada = {
                        ...specificRule,
                        tope_aplicado: `${factor} veces ${unit}`,
                        _internal_factor: factor,
                        _internal_unit: unit
                    };
                }
            } else if (specificRule.porcentaje !== undefined) {
                // Canonical Skill path (Flat)
                // Try to find matching tope in topes array if not in this object
                const associatedTope = contrato.topes?.find((t: any) => {
                    const topTriggers = String(t.CODIGO_DISPARADOR_FONASA || "").split(',').map(s => s.trim()).filter(s => s.length > 0);
                    const ruleTriggers = String(specificRule.CODIGO_DISPARADOR_FONASA || "").split(',').map(s => s.trim()).filter(s => s.length > 0);

                    const triggerMatch = topTriggers.some(tt => ruleTriggers.includes(tt));
                    const modalityMatch = !t.tipo_modalidad || t.tipo_modalidad === modalityType.toLowerCase();

                    return (triggerMatch && modalityMatch) ||
                        (t.fuente_textual && specificRule.fuente_textual && t.fuente_textual.includes(specificRule.fuente_textual)) ||
                        (t.descripcion_textual && specificRule.descripcion_textual && t.descripcion_textual.includes(specificRule.descripcion_textual));
                });

                if (associatedTope && associatedTope.valor !== null) {
                    factor = associatedTope.valor;
                    const unit = associatedTope.unidad || unidadRef.tipo || "FACTOR_ARANCEL";
                    reglaAplicada = {
                        ...specificRule,
                        tope_aplicado: `${factor} veces ${unit}`,
                        _internal_factor: factor,
                        _internal_unit: unit
                    };
                }
            }
        } else if (contrato.topes && Array.isArray(contrato.topes)) {
            // Semantic Canonical path (Separate topes array - Legacy/Direct match)
            const associatedTope = contrato.topes.find((t: any) =>
                (t.descripcion_textual && typeof t.descripcion_textual === 'string' && t.descripcion_textual.includes(item.codigoGC)) ||
                (t.fuente_textual && typeof t.fuente_textual === 'string' && t.fuente_textual.includes(item.codigoGC))
            );

            if (associatedTope && associatedTope.valor !== null) {
                factor = associatedTope.valor;
                const unit = associatedTope.unidad || "AC2";

                reglaAplicada = {
                    item: associatedTope.descripcion_textual,
                    tope_aplicado: `${factor} veces ${unit}`,
                    _internal_factor: factor,
                    _internal_unit: unit,
                    fuente: associatedTope.fuente_textual
                };
            }
        }
    }

    // 2. If we found a rule but have NO Unit Value confidence (Financial Layer failure)
    // We still return true for "tope_aplica" (we know there IS a ceiling) but false for "tope_cumplido" (uncertain).
    // This allows the UI to show the ceiling even if we can't calculate exact math.
    if ((unidadRef.confianza === "BAJA" || !unidadRef.valor_pesos_estimado || !unidadRef.cobertura_aplicada) && !factor) {
        return {
            tope_aplica: false,
            tope_cumplido: false,
            rationale: "Unidad de referencia no deducible para este caso.",
            metodo_validacion: "SIN_TOPE"
        };
    }

    // Low confidence but we HAVE a factor/rule? 
    // We can at least report the rule.
    if ((unidadRef.confianza === "BAJA" || !unidadRef.valor_pesos_estimado) && factor) {
        return {
            tope_aplica: true,
            tope_cumplido: false, // Cannot verify
            rationale: `DETECTADO: Regla contractual hallada (${reglaAplicada?.tope_aplicado || factor}), pero valor moneda (AC2/UF) no determinado o confianza baja.`,
            metodo_validacion: "SIN_TOPE",
            regla_aplicada: reglaAplicada
        };
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
    const montoTopeTeorico = unidadRef.valor_pesos_estimado! * factor * unidadRef.cobertura_aplicada!;
    const bonif = parseMonto(item.bonificacion);

    // Tolerance of $2.500 for rounding differences in V.A calculation
    if (Math.abs(bonif - montoTopeTeorico) < 2500) {
        return {
            tope_aplica: true,
            tope_cumplido: true,
            monto_tope_estimado: montoTopeTeorico,
            rationale: `CUMPLE: Bonificación ($${bonif}) coincide con el V.A deducido de $${unidadRef.valor_pesos_estimado} (Factor ${factor} @ ${Math.round(unidadRef.cobertura_aplicada! * 100)}%).`,
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
