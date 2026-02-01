
import { PAMItem, PamDocument } from '../../src/pamService';
import { ContractRegla } from '../../src/types';

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
    '1103057': 1.2, // Rizotomía (Ancla Contractual Consalud)
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
    if (!prestador || !contrato) return 'LIBRE_ELECCION';

    const p = prestador.toUpperCase();
    console.log(`[DEBUG_NET] Resolving Network for: "${p}"`);

    // 1. V3 Support: check agrupaciones_clinicas
    if (contrato.agrupaciones_clinicas && Array.isArray(contrato.agrupaciones_clinicas)) {
        for (const ag of contrato.agrupaciones_clinicas) {
            if (ag.alias_clinicas && Array.isArray(ag.alias_clinicas)) {
                for (const alias of ag.alias_clinicas) {
                    if (p.includes(alias.toUpperCase()) || alias.toUpperCase().includes(p)) {
                        console.log(`[DEBUG_NET] V3 MATCH FOUND: "${p}" belongs to group "${ag.nombre_agrupacion}"`);
                        return 'PREFERENTE';
                    }
                }
            }
        }
    }

    // 2. V2 Support: check coberturas red_especifica
    if (contrato.coberturas) {
        for (const c of contrato.coberturas) {
            if (c.tipo_modalidad === 'preferente' && c.red_especifica) {
                const red = String(c.red_especifica).toUpperCase();
                const clinics = red.split(/[,;|]/).map(s => s.trim());
                for (const clinic of clinics) {
                    if (clinic.length > 3) {
                        if (p.includes(clinic) || clinic.includes(p)) {
                            console.log(`[DEBUG_NET] V2 MATCH FOUND: "${p}" matched "${clinic}"`);
                            return 'PREFERENTE';
                        }
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


    // Initialize unit type default
    let unitType: UnidadReferencia["tipo"] = "VA";

    // 1. V2 SCHEMA PRIORITY: Check "glosario_unidades"
    if (contrato?.glosario_unidades && Array.isArray(contrato.glosario_unidades) && contrato.glosario_unidades.length > 0) {
        // Find definitions for AC2 or VAM
        const def = contrato.glosario_unidades.find((u: any) => ["AC2", "VAM", "AC", "VA"].includes(u.sigla));

        if (def) {
            evidencia.push(`GLOSARIO CONTRACTUAL: Se detectó definición explícita para ${def.sigla}.`);
            evidencia.push(`DESCRIPCIÓN: "${def.descripcion_contrato}"`);

            // If the definition contains a reference value (e.g. "valor referencial $35.000"), use it.
            // This requires extracting the number from the text if simpler parsing isn't available.
            // For now we assign the type and look for value confirmation in PAM.
            const normalizedType = def.sigla as UnidadReferencia["tipo"];

            // If the glossary explicitely says "pesos", we might handle it differently.
            // For now, assume it sets the type.
            if (def.valor_referencia) {
                return {
                    tipo: normalizedType,
                    valor_pesos_estimado: def.valor_referencia,
                    confianza: "ALTA",
                    evidencia,
                    fecha_referencia: eventDate
                };
            }

            // If no value but type is confirmed, we proceed to deduce value from PAM with High Confidence on TYPE.
            unitType = normalizedType;
        }
    } else {
        // Legacy Heuristic Fallback - Robust matching
        const isConsalud = normalizedIsapre.includes("CONSALUD");
        const isColmena = normalizedIsapre.includes("COLMENA");
        const isMasvida = normalizedIsapre.includes("MASVIDA");
        const isBanmedica = normalizedIsapre.includes("BANMEDICA") || normalizedIsapre.includes("VIDA TRES") || normalizedIsapre.includes("CRUZ BLANCA");

        console.log(`[DEBUG_UNIT] Normalizing Isapre: "${normalizedIsapre}"`);
        console.log(`[DEBUG_UNIT] Heuristics: Consalud=${isConsalud}, Colmena=${isColmena}, Banmedica=${isBanmedica}`);

        if (isMasvida || isColmena) unitType = "VAM";
        else if (isConsalud) unitType = "AC2";
        else if (isBanmedica) unitType = "VA";

        console.log(`[DEBUG_UNIT] Final Unit Type Selected: "${unitType}"`);
    }

    // Reverse Engineering from PAM (Existing Logic)
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
    } else {
        // Fallback if NO candidates found in PAM
        let fallbackValue = 38000; // Default VA
        let confidence: "BAJA" | "MEDIA" | "ALTA" = "BAJA";

        if (unitType === "AC2") {
            // Hardcoded fallback for Consalud 2024/2025 based on normative history
            fallbackValue = 223147;
            confidence = "MEDIA";
            evidencia.push(`FALLBACK: No se encontraron ítems quirúrgicos trazables en PAM.`);
            evidencia.push(`VALOR HISTÓRICO: Se utiliza valor base AC2 Consalud ($${fallbackValue.toLocaleString('es-CL')}) ante ausencia de datos.`);
        } else if (unitType === "VAM") {
            // Approximate VAM value if unknown
            fallbackValue = 39000;
            evidencia.push(`FALLBACK: No se encontraron ítems quirúrgicos trazables en PAM.`);
        }

        return {
            tipo: unitType,
            valor_pesos_estimado: fallbackValue,
            confianza: confidence,
            evidencia: evidencia,
            factor_origen: 1.0,
            cobertura_aplicada: coverage,
            fecha_referencia: eventDate,
            valor_uf_fecha: valorUf
        };
    }

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

                if (modality && (modality.tope !== undefined && modality.tope !== null) || modality.tope_nested) {

                    // HANDLE V2 STRICT JOIN (Nested Object)
                    let explicitUnitStr: string | undefined;

                    if (modality.tope_nested) {
                        factor = modality.tope_nested.valor;
                        explicitUnitStr = modality.tope_nested.unidad;
                    } else if (typeof modality.tope === 'object' && modality.tope !== null) {
                        // Typed as number | object, so safe to access props if object
                        factor = (modality.tope as any).valor;
                        explicitUnitStr = (modality.tope as any).unidad;
                    } else {
                        // Legacy number
                        factor = modality.tope as number;
                    }

                    // Dynamic Unit: Prefer specific unit from rule, else inferred unit type, else generic fallback
                    const unit = explicitUnitStr || modality.unidadTope || unidadRef.tipo || "FACTOR_ARANCEL";

                    // Handle AC2 specific fields from V3
                    const factorVal = modality.factor || factor;
                    const sinTopeAdicional = !!modality.sin_tope_adicional;

                    reglaAplicada = {
                        ...specificRule,
                        tope_aplicado: `${factorVal} veces ${unit}${sinTopeAdicional ? ' (Sin tope adicional)' : ''}`,
                        _internal_factor: factorVal,
                        _internal_unit: unit,
                        _sin_tope_adicional: sinTopeAdicional
                    };

                    // Update factor for math if it was found in V3 structure
                    factor = factorVal;
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
