
import { PAMItem, PamDocument } from '../../src/pamService';
import { ContractRegla } from '../../src/types';

export type UnidadEstado =
    | "VERIFICABLE"
    | "NO_VERIFICABLE_POR_OPACIDAD"
    | "NO_VERIFICABLE_POR_CONTRATO";

export interface UnidadReferencia {
    tipo: "UF" | "VA" | "UV" | "BAM" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDA" | null;
    valor_pesos_estimado?: number;
    evidencia: string[];
    confianza: "ALTA" | "MEDIA" | "BAJA";
    factor_origen?: number;
    cobertura_aplicada?: number;
    fecha_referencia?: Date;
    estado: UnidadEstado;
    vam_confidence_score: number;
    anchors: Array<{
        source: "CONTRATO" | "PAM";
        detalle: string;      // ej: "Tope 2.5 AC2 en prestación X"
        evidencia: string;    // trace/debug
        impliedValue?: number;
        unitType?: string;
    }>;
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

    // Strip currency symbols and whitespaces
    const sanitized = val.toString().replace(/[\$\s]/g, '');

    // 1. Handle Chilean format with comma as decimal (e.g. "1.234,56")
    if (sanitized.includes(',')) {
        const clean = sanitized.replace(/\./g, '').replace(',', '.');
        return parseFloat(clean) || 0;
    }

    // 2. Handle strings with dots only
    const dots = (sanitized.match(/\./g) || []).length;
    if (dots > 1) {
        // Multiple dots -> Thousand separators (e.g. "1.267.808")
        return parseFloat(sanitized.replace(/\./g, '')) || 0;
    }

    if (dots === 1) {
        const parts = sanitized.split('.');
        // Common heuristic: 3 digits after dot -> Thousand separator (e.g. "267.808")
        if (parts[1].length === 3) {
            return parseFloat(sanitized.replace(/\./g, '')) || 0;
        } else {
            // Otherwise treat as decimal (e.g. "3.5", "1.0", "1.25")
            return parseFloat(sanitized) || 0;
        }
    }

    return parseFloat(sanitized) || 0;
}

/**
 * Expert Refinement V6.2: Deterministic Contradiction Detection
 */
function detectAnchorContradictions(anchors: UnidadReferencia["anchors"]): { contradictory: boolean; reason?: string } {
    if (anchors.length < 2) return { contradictory: false };

    // 1. Group by unitType to check for Intra-Unit consistency
    const types = Array.from(new Set(anchors.map(a => a.unitType).filter(t => !!t)));

    for (const type of types) {
        const typeAnchors = anchors.filter(a => a.unitType === type && a.impliedValue !== undefined);
        if (typeAnchors.length >= 2) {
            const values = typeAnchors.map(a => a.impliedValue!);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            for (const val of values) {
                // Tolerance 5% (Expert Standard)
                if (Math.abs(val - avg) / avg > 0.05) {
                    return {
                        contradictory: true,
                        reason: `Inconsistencia en ${type}: $${val.toLocaleString('es-CL')} se desvía >5% del promedio ($${Math.round(avg).toLocaleString('es-CL')})`
                    };
                }
            }
        }
    }

    // 2. Unit Type Clash (e.g. Contract says AC2, PAM shows VAM values)
    // This happens if more than one type is present with High Confidence anchors
    const activeTypes = Array.from(new Set(anchors.filter(a => a.impliedValue && a.impliedValue > 0).map(a => a.unitType)));
    if (activeTypes.length > 1) {
        return {
            contradictory: true,
            reason: `Conflicto estructural de unidades: Detectados múltiples tipos (${activeTypes.join(", ")}) sin precedencia clara.`
        };
    }

    // 3. Invalid Anchors (Missing unit)
    const invalid = anchors.find(a => a.source === "CONTRATO" && !a.unitType);
    if (invalid) {
        return {
            contradictory: true,
            reason: `Anchor inválido detectado: ${invalid.detalle} no especifica unidad (UF/VAM/AC2).`
        };
    }

    return { contradictory: false };
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



/**
 * Infers the internal contractual unit value (VA, AC2, BAM, VAM) from the PAM and Contract.
 * Deduce NOTHING via hardcode; everything is triangulated.
 */
export async function inferUnidadReferencia(
    contrato: { coberturas?: any[], reglas?: ContractRegla[], diseno_ux?: any, glosario_unidades?: any[] } | any,
    pam: PamDocument | any,
    isapreName?: string,
    eventDate: Date = new Date()
): Promise<UnidadReferencia> {

    const evidencia: string[] = [];
    const normalizedIsapre = (isapreName || contrato?.diseno_ux?.nombre_isapre || "").toUpperCase();
    const coverage = findCoverageFactor(contrato, pam?.prestadorPrincipal || (pam?.folios && pam.folios[0]?.prestadorPrincipal));
    const anchors: UnidadReferencia["anchors"] = [];

    // --- DETECCIÓN DE OPACIDAD (PAM SUCIO) ---
    const allFolios = pam?.folios || [];
    const allItems = allFolios.flatMap((f: any) => f.desglosePorPrestador?.flatMap((d: any) => d.items) || []);

    const aggregatedItems = allItems.filter((i: any) =>
        (!i.codigoGC && !i.codigo) ||
        /VARIOS|INSUMOS|MEDICAMENTOS|PAQUETE|AJUSTE/i.test(i.descripcion || "")
    );

    const totalItems = Math.max(1, allItems.length);
    const opacidadRatio = aggregatedItems.length / totalItems;
    const hasLargeOpaqueBlock = aggregatedItems.some((i: any) => parseMonto(i.valorTotal) > 200000);

    let estado: UnidadEstado = "VERIFICABLE";
    let vam_confidence_score = 0.5;

    // Expert Refinement V6.2: Precedencia Fija (Opacidad > Contrato)
    if (opacidadRatio > 0.35 || hasLargeOpaqueBlock) {
        estado = "NO_VERIFICABLE_POR_OPACIDAD";
        vam_confidence_score = Math.max(0.1, 0.5 - opacidadRatio);
        evidencia.push(`OPACIDAD DETECTADA: PAM altamente agregado (${(opacidadRatio * 100).toFixed(1)}%).`);
        if (hasLargeOpaqueBlock) evidencia.push("ALERTA: Se detectaron bloques opacos de alto valor (> $200k).");
    }

    // --- ANCHOR COLLECTION ---
    let unitType: UnidadReferencia["tipo"] = null;

    // 1. GLOSSARY ANCHORS
    if (contrato?.glosario_unidades && Array.isArray(contrato.glosario_unidades)) {
        contrato.glosario_unidades.forEach((u: any) => {
            if (["AC2", "VAM", "AC", "VA"].includes(u.sigla)) {
                const val = parseMonto(u.valor_referencia);
                anchors.push({
                    source: "CONTRATO",
                    detalle: `Glosario: ${u.sigla}`,
                    evidencia: `Valor ref: ${u.valor_referencia || 'N/A'}`,
                    impliedValue: val > 0 ? val : undefined,
                    unitType: u.sigla
                });
                if (!unitType) unitType = u.sigla as any;
            }
        });
    }

    // Isapre-based fallback for unitType if not found in glossary
    if (!unitType) {
        const isConsalud = normalizedIsapre.includes("CONSALUD");
        const isColmena = normalizedIsapre.includes("COLMENA");
        const isMasvida = normalizedIsapre.includes("MASVIDA");
        const isBanmedica = normalizedIsapre.includes("BANMEDICA") || normalizedIsapre.includes("VIDA TRES") || normalizedIsapre.includes("CRUZ BLANCA");

        if (isMasvida || isColmena) {
            unitType = "VAM";
            evidencia.push(`Inferencia ISAPRE: ${normalizedIsapre} -> Tipo Unidad: VAM`);
        } else if (isConsalud) {
            unitType = "AC2";
            evidencia.push(`Inferencia ISAPRE: ${normalizedIsapre} -> Tipo Unidad: AC2`);
        } else if (isBanmedica) {
            unitType = "VA";
            evidencia.push(`Inferencia ISAPRE: ${normalizedIsapre} -> Tipo Unidad: VA`);
        } else {
            evidencia.push(`Inferencia ISAPRE: No se reconoció ${normalizedIsapre}. Usando default: ${unitType}`);
        }
    }

    // 2. PAM ANCHORS (Forensic Triangulation)
    const VALID_ANCHOR_CODES = ['1103057', '1802081', '1801001'];
    const candidates = allItems.filter((item: any) =>
        item.codigoGC && VALID_ANCHOR_CODES.includes(item.codigoGC) &&
        parseMonto(item.bonificacion) > 0
    );

    candidates.forEach(c => {
        const factor = SURGICAL_FACTORS[c.codigoGC!];
        const bonif = parseMonto(c.bonificacion);
        const implied = Math.round(bonif / factor);

        // Map code to expected unit type for clash detection
        let cType = unitType;
        if (c.codigoGC === '1103057') cType = 'AC2';

        evidencia.push(`Anclaje PAM: Código ${c.codigoGC} -> Valor Implicado: $${implied} (${cType})`);

        anchors.push({
            source: "PAM",
            detalle: `Anclaje PAM ${c.codigoGC}`,
            evidencia: `Bonif: $${bonif} / Factor: ${factor}`,
            impliedValue: implied,
            unitType: cType as string
        });
    });

    // 3. DETECT CONTRADICTIONS (V6.2 Polish)
    const contradiction = detectAnchorContradictions(anchors);
    if (contradiction.contradictory) {
        if (estado === "VERIFICABLE") { // Precedence: Opacity > Contrato
            estado = "NO_VERIFICABLE_POR_CONTRATO";
            vam_confidence_score = 0.2;
            evidencia.push(`CONTRADICCIÓN DETERMINÍSTICA: ${contradiction.reason}`);
        }
    }

    // --- FINAL DECISION ---
    const pamAnchors = anchors.filter(a => a.source === "PAM");
    const contractAnchors = anchors.filter(a => a.source === "CONTRATO" && a.impliedValue);

    let finalValue = 0;
    let confidence: "ALTA" | "MEDIA" | "BAJA" = "BAJA";

    if (contractAnchors.length > 0 && !contradiction.contradictory) {
        finalValue = contractAnchors[0].impliedValue!;
        confidence = "ALTA";
        unitType = contractAnchors[0].unitType as any;
    } else if (pamAnchors.length > 0 && !contradiction.contradictory) {
        const values = pamAnchors.map(a => a.impliedValue!).filter(v => !!v);
        finalValue = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        const independentCount = new Set(pamAnchors.map(a => a.detalle)).size;
        confidence = independentCount >= 2 ? "ALTA" : "MEDIA";
        if (estado === "VERIFICABLE") {
            vam_confidence_score = independentCount >= 2 ? 1.0 : 0.75;
        }
    } else {
        // Fallback
        if (unitType === "AC2") {
            finalValue = 223500; // 2024-2025 Ref
            evidencia.push("FALLBACK: Usando valor referencial AC2 2024 ($223.500)");
        } else if (unitType === "VAM") {
            finalValue = 42500; // 2024-2025 Ref
            evidencia.push("FALLBACK: Usando valor referencial VAM 2024 ($42.500)");
        } else {
            finalValue = 40500; // VA Fallback
            evidencia.push("FALLBACK: Usando valor referencial VA 2024 ($40.500)");
        }
        confidence = "BAJA";
        if (estado === "VERIFICABLE") {
            estado = "NO_VERIFICABLE_POR_CONTRATO";
            vam_confidence_score = 0.3;
        }
    }

    return {
        tipo: unitType,
        valor_pesos_estimado: finalValue,
        confianza: confidence,
        evidencia,
        factor_origen: 1.0,
        fecha_referencia: eventDate,
        cobertura_aplicada: coverage,
        estado,
        vam_confidence_score,
        anchors
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

    if (!unidadRef.cobertura_aplicada) {
        return {
            tope_aplica: true,
            tope_cumplido: false,
            rationale: "No se pudo validar: falta cobertura_aplicada en UnidadReferencia.",
            metodo_validacion: "SIN_TOPE"
        };
    }

    // Tope = V.A * Factor * Cobertura
    const montoTopeTeorico = unidadRef.valor_pesos_estimado! * factor * unidadRef.cobertura_aplicada!;
    const bonif = parseMonto(item.bonificacion);

    // Tolerance of +/- 1 peso (Forensic Standard)
    if (Math.abs(bonif - montoTopeTeorico) <= 1.5) {
        return {
            tope_aplica: true,
            tope_cumplido: true,
            monto_tope_estimado: montoTopeTeorico,
            rationale: `CUMPLE: Convergencia exacta (±1 peso). Bonificación ($${bonif}) calza con V.A deducido de $${unidadRef.valor_pesos_estimado}.`,
            metodo_validacion: "FACTOR_ESTANDAR",
            regla_aplicada: reglaAplicada
        };
    } else if (bonif > montoTopeTeorico + 1.5) {
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
