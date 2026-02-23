import { ContractAnalysisResult } from './contractTypes.js';
import { applySynonyms } from './contractLearning.service.js';

export interface CanonicalMetadata {
    origen: string;
    fuente: string;
    vigencia: string;
    tipo_contrato: "ISAPRE" | "FONASA" | "COMPLEMENTARIO" | "DENTAL" | "DESCONOCIDO";
    codigo_arancel?: string;
}

export interface CanonicalCobertura {
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    descripcion_textual: string;
    porcentaje: number | null;
    red_especifica: string;
    tipo_modalidad: "preferente" | "libre_eleccion" | "restringida" | "ampliada" | "desconocido";
    fuente_textual: string;
}

export interface CanonicalTope {
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    unidad: "UF" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDO" | "SIN_TOPE" | null;
    valor: number | string | null;
    aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido";
    tipo_modalidad?: "preferente" | "libre_eleccion" | "desconocido";
    fuente_textual: string;
    tope_existe?: boolean;
    razon?: string;
}

export interface CanonicalDeducible {
    unidad: "UF" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDO";
    valor: number | null;
    aplicacion: "anual" | "evento" | "desconocido";
    fuente_textual: string;
}

export interface CanonicalCopago {
    descripcion: string;
    valor: number;
    unidad: "UF" | "VAM" | "AC2" | "PESOS";
    fuente_textual: string;
}

export interface CanonicalExclusion {
    descripcion: string;
    fuente_textual: string;
}

export interface CanonicalRegla {
    condicion: string;
    efecto: string;
    fuente_textual: string;
}

export interface CanonicalContract {
    metadata: CanonicalMetadata;
    coberturas: CanonicalCobertura[];
    topes: CanonicalTope[];
    deducibles: CanonicalDeducible[];
    copagos: CanonicalCopago[];
    exclusiones: CanonicalExclusion[];
    reglas_aplicacion: CanonicalRegla[];
    observaciones: string[];
    items_no_clasificados: string[];
}

/**
 * Normalizes text for robust comparison (strips accents, non-alpha, lowercase)
 */
function normalizeText(text: string): string {
    return (text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9]/g, "");    // Remove non-alphanumeric
}

/**
 * Transforms a high-fidelity ContractAnalysisResult into the Canonical JSON format
 * defined in the 'canonizar-contrato-salud' skill.
 */
export function transformToCanonical(result: ContractAnalysisResult): CanonicalContract {
    console.log('[CANONICAL] transformToCanonical execution triggered. Result status:', !!result, 'DisenoUX:', !!result?.diseno_ux);

    // Defensive check for result
    if (!result) {
        throw new Error('transformToCanonical received null/undefined result');
    }

    // 0. Metadata Normalization
    let tipo_contrato: "ISAPRE" | "FONASA" | "COMPLEMENTARIO" | "DENTAL" | "DESCONOCIDO" = "DESCONOCIDO";

    const diseno = result.diseno_ux || ({} as any);
    const finger = result.fingerprint || ({} as any);
    const meta = (result as any).metadata || {};

    const tcRaw = normalizeText(finger.tipo_contrato || diseno.nombre_isapre || meta.source_document || "");
    const isapreNames = ["banmedica", "colmena", "consalud", "cruzblanca", "vidatres", "esencial", "nueva masvida"];

    if (tcRaw.includes("isapre") || isapreNames.some(name => tcRaw.includes(name))) tipo_contrato = "ISAPRE";
    else if (tcRaw.includes("fonasa")) tipo_contrato = "FONASA";
    else if (tcRaw.includes("complementario")) tipo_contrato = "COMPLEMENTARIO";
    else if (tcRaw.includes("dental")) tipo_contrato = "DENTAL";

    const canonical: CanonicalContract = {
        metadata: {
            origen: "contrato_pdf",
            fuente: diseno.nombre_isapre && diseno.nombre_isapre !== "Unknown"
                ? `${diseno.nombre_isapre} - ${diseno.titulo_plan || "PLAN"}`
                : (meta.source_document || result.fingerprint?.tipo_contrato || "CONTRATO RESCATADO"),
            vigencia: meta.timestamp || "Vigencia no especificada",
            tipo_contrato,
            codigo_arancel: diseno.subtitulo_plan?.match(/(AC2|V20|V10)/i)?.[0] || undefined
        },
        coberturas: [],
        topes: [],
        deducibles: [],
        copagos: [],
        exclusiones: [],
        reglas_aplicacion: [],
        observaciones: [],
        items_no_clasificados: []
    };

    // --- V3.5 BRIDGE (Rule-Based Hierarchy) ---
    if (result.v3) {
        console.log('[CANONICAL] V3.5 Bridge activated');

        result.v3.coverageBlocks.forEach(block => {
            block.benefitRules.forEach(rule => {
                const itemName = rule.prestacionLabel;
                const pagePrefix = `[p.V3]`;

                // Determine ambito from block title or prestacion
                let ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido" = "desconocido";
                const lowBlock = block.blockTitle.toLowerCase();
                if (lowBlock.includes("hosp") || lowBlock.includes("quiru")) ambito = "hospitalario";
                else if (lowBlock.includes("amb") || lowBlock.includes("cons")) ambito = "ambulatorio";

                const processV3Modality = (mod: any, type: "preferente" | "libre_eleccion") => {
                    if (!mod) return;

                    // Add Cobertura
                    canonical.coberturas.push({
                        ambito,
                        descripcion_textual: itemName,
                        porcentaje: mod.bonificacionPct,
                        red_especifica: type === "preferente" ? "Red Preferente" : "Libre Elección",
                        tipo_modalidad: type,
                        fuente_textual: `${pagePrefix} Block ${block.blockTitle}: ${itemName}`
                    });

                    // Add Topes
                    const mapTope = (v3Tope: any, aplicacion: "por_evento" | "anual") => {
                        if (!v3Tope || v3Tope.tipo === 'NO_ENCONTRADO') return;

                        const isSinTope = v3Tope.tipo === 'SIN_TOPE_EXPLICITO';
                        let unidad: "UF" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDO" | "SIN_TOPE" = "DESCONOCIDO";
                        if (v3Tope.unidad === 'UF') unidad = "UF";
                        else if (v3Tope.unidad === 'VA') unidad = "VAM";
                        else if (v3Tope.unidad === 'CLP') unidad = "PESOS";

                        canonical.topes.push({
                            ambito,
                            unidad: isSinTope ? "SIN_TOPE" : unidad,
                            valor: isSinTope ? "SIN TOPE" : v3Tope.valor,
                            aplicacion,
                            tipo_modalidad: type,
                            fuente_textual: `${pagePrefix} ${itemName} (${type}): ${v3Tope.raw || (isSinTope ? "SIN TOPE" : "")}`,
                            tope_existe: !isSinTope,
                            razon: isSinTope ? "SIN_TOPE_EXPRESO_EN_CONTRATO" : undefined
                        } as any);
                    };

                    mapTope(mod.topePrestacion, "por_evento");

                    if (mod.topeAnualBeneficiario) {
                        mapTope(mod.topeAnualBeneficiario, "anual");
                    } else if (type === "preferente" && mod.topePrestacion?.tipo === 'SIN_TOPE_EXPLICITO') {
                        mapTope({ tipo: "SIN_TOPE_EXPLICITO", raw: "Heuristica Preferente" }, "anual");
                    } else if (type === "libre_eleccion" || type === "preferente") {
                        mapTope({ tipo: "SIN_TOPE_EXPLICITO", raw: "Heuristica Fallback" }, "anual");
                    }
                };

                processV3Modality(rule.modalidadPreferente, "preferente");
                processV3Modality(rule.modalidadLibreEleccion, "libre_eleccion");
            });
        });

        // Map V3 Network Rules as General Rules
        result.v3.networkRules.forEach(net => {
            canonical.reglas_aplicacion.push({
                condicion: `Regla de Red: ${net.redesPrestador.join(", ")}`,
                efecto: `${net.bonificacionPct}% cobertura - ${net.notesRaw || "Sin notas"}`,
                fuente_textual: `[V3] Base legal de red: ${net.networkRuleId}`
            });
        });

        if (canonical.coberturas.length > 0) return canonical; // V3 is sufficient
    }

    // 1. Process Coberturas & Topes
    (result.coberturas || []).forEach((cob, cobIdx) => {
        const itemName = cob.item || "Prestación desconocida";
        const categoria = cob.categoria?.toLowerCase() || "";

        // Page inference (coberturas usually on p1-p2)
        const pagePrefix = `[p.${cobIdx < 20 ? 1 : 2}]`;

        // Use Semantic Dictionary for normalization (v1.8)
        const normalizedItem = applySynonyms(itemName);
        const normalizedCategory = applySynonyms(cob.categoria || "");

        let ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido" = "desconocido";
        const lowerItem = itemName.toLowerCase();
        const normItem = normalizeText(itemName);
        const normCat = normalizeText(cob.categoria || "");

        if (normCat.includes("hosp") || normItem.includes("hosp") || normItem.includes("diacama") || normItem.includes("pabellon") || normItem.includes("quirurgico") || normItem.includes("intensivo")) {
            ambito = "hospitalario";
        } else if (normCat.includes("amb") || normItem.includes("amb") || normItem.includes("consulta") || normItem.includes("examen") || normItem.includes("laboratorio") || normItem.includes("imagen")) {
            ambito = "ambulatorio";
        } else if (normCat.includes("restringida") || normCat.includes("libre") || normCat.includes("extra")) {
            ambito = "mixto";
        }

        cob.modalidades.forEach(mod => {
            // Attempt to infer Red Specificity (v2.1)
            let red_especifica = mod.tipo === "PREFERENTE" ? "Red Preferente" : "Libre Elección";
            if (mod.tipo === "PREFERENTE") {
                if (mod.clinicas && mod.clinicas.length > 0) {
                    red_especifica = mod.clinicas.join(", ");
                } else {
                    const clinicsMatch = diseno.subtitulo_plan?.match(/Clínica\s+[\w\s]+/i);
                    if (clinicsMatch) red_especifica = clinicsMatch[0];
                }
            }

            // Map Modality Type
            let tipo_modalidad: "preferente" | "libre_eleccion" | "restringida" | "ampliada" | "desconocido" = "desconocido";
            if (mod.tipo === "LIBRE_ELECCION") tipo_modalidad = "libre_eleccion";
            else if (mod.tipo === "PREFERENTE") tipo_modalidad = "preferente";
            else if (categoria.includes("restringida")) tipo_modalidad = "restringida";
            else if (mod.tipo === "BONIFICACION" || categoria.includes("ampliaci")) tipo_modalidad = "ampliada";

            // Add Cobertura
            const percentageVal = typeof mod.porcentaje === 'string'
                ? parseFloat(mod.porcentaje.replace("%", "").replace(",", "."))
                : mod.porcentaje;

            canonical.coberturas.push({
                ambito,
                descripcion_textual: `${itemName}`,
                porcentaje: isNaN(percentageVal as number) ? null : percentageVal,
                red_especifica,
                tipo_modalidad,
                fuente_textual: `${pagePrefix} Sección ${cob.categoria}: ${itemName}`
            });

            // Add Topes (Geometric Multi-Type Support v2.5)
            const processTope = (rawVal: any, forceAplicacion?: "anual" | "por_evento") => {
                const uTopeRaw = (mod.unidad_normalizada || mod.unidadTope || "").toUpperCase();

                // Value-specific detection (v2.6)
                const valStr = (String(rawVal || "")).toUpperCase();
                const isSinTopeValue = valStr.includes("SIN TOPE") || valStr.includes("ILIMITADO") || valStr.includes("SIN_TOPE");

                // Fallback to unit/evidence ONLY if value is missing or value itself says Sin Tope
                const isSinTopeItem = isSinTopeValue || (
                    (rawVal === null || rawVal === undefined) &&
                    (uTopeRaw.includes("SIN_TOPE") || uTopeRaw.includes("ILIMITADO") || (mod.evidencia_literal || "").toUpperCase().match(/\bSIN TOPE\b/))
                );

                if (rawVal !== null && rawVal !== undefined || isSinTopeItem) {
                    // Bug 1 Fix: Deterministic unit inference from raw string / evidence
                    let unidad: "UF" | "VAM" | "AC2" | "PESOS" | null = null;
                    const combinedSource = `${uTopeRaw} ${valStr} ${(mod.evidencia_literal || "").toUpperCase()}`;

                    if (combinedSource.includes("UF") || combinedSource.includes("U.F.")) unidad = "UF";
                    else if (combinedSource.includes("AC2")) unidad = "AC2";
                    else if (["VAM", "V20", "V10", "VA", "VECES ARANCEL", "V.A"].some(u => combinedSource.includes(u))) unidad = "VAM";
                    else if (combinedSource.includes("PESOS") || combinedSource.includes("$") || combinedSource.includes("CLP")) unidad = "PESOS";

                    let val: number | null = null;
                    if (typeof rawVal === 'number') val = rawVal;
                    else if (typeof rawVal === 'string') {
                        const match = rawVal.match(/(\d+[,.]?\d*)/);
                        if (match) val = parseFloat(match[1].replace(",", "."));
                    } else if (rawVal && typeof rawVal === 'object') {
                        val = (rawVal as any).valor ?? null;
                    }

                    // Priority for normalized engine numeric values if checking the main tope
                    if (!forceAplicacion && val === null && !isSinTopeItem) {
                        val = (mod as any).tope_normalizado ?? mod.tope_nested?.valor ?? null;
                    }

                    // Bug 2 Fix: Rely on explicit forceAplicacion for anual/por_evento
                    let aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido" = forceAplicacion || "desconocido";
                    if (!forceAplicacion) {
                        if (mod.tipoTope === "ANUAL" || (mod.tipoTope as string) === "ANUAL") aplicacion = "anual";
                        else if (mod.tipoTope === "POR_EVENTO" || (mod.tipoTope as string) === "POR_EVENTO" || mod.tipoTope === "ILIMITADO" || mod.tipoTope === "DIARIO") aplicacion = "por_evento";
                    }

                    // Bug 3 Fix: Semantic TopeValue implementation
                    let tipo: "NUMERICO" | "SIN_TOPE_EXPLICITO" | "NO_ENCONTRADO" = "NO_ENCONTRADO";
                    let razon: string | undefined = undefined;
                    let tope_existe: boolean | null = null;

                    if (isSinTopeItem) {
                        tipo = "SIN_TOPE_EXPLICITO";
                        val = "SIN TOPE" as any;
                        unidad = "SIN_TOPE" as any;
                        tope_existe = false;
                        razon = "SIN_TOPE_EXPRESO_EN_CONTRATO";
                    } else if (val !== null) {
                        tipo = "NUMERICO";
                        tope_existe = true;
                    } else {
                        tipo = "NO_ENCONTRADO";
                        val = null;
                        unidad = null;
                        tope_existe = false;
                        razon = "CELDA_VACIA_OCR";
                    }

                    const topeEntry: any = {
                        ambito,
                        tipo,
                        unidad,
                        valor: val,
                        aplicacion,
                        tope_existe,
                        tipo_modalidad: mod.tipo === "LIBRE_ELECCION" ? "libre_eleccion" : (mod.tipo === "PREFERENTE" ? "preferente" : "desconocido"),
                        fuente_textual: `${pagePrefix} Tope para ${itemName} (${mod.tipo}): ${isSinTopeItem ? "SIN TOPE" : (val !== null ? val + " " + (unidad || "") : "No encontrado")}`
                    };

                    if (razon) topeEntry.razon = razon;

                    canonical.topes.push(topeEntry);
                }
            };

            // 1. Process regular tope (usually per event/proc)
            processTope(mod.tope, "por_evento");

            // 2. Process annual tope (if extracted by geometric prompt)
            if ((mod as any).tope_anual) {
                processTope((mod as any).tope_anual, "anual");
            } else if (mod.tipo === "PREFERENTE" && String(mod.tope || "").toUpperCase().includes("SIN TOPE")) {
                // Heuristic requested by user: In Oferta Preferente, "Sin Tope" acts as both per-event and annual.
                processTope("SIN TOPE", "anual");
            } else if (mod.tipo === "LIBRE_ELECCION" || mod.tipo === "PREFERENTE") {
                // Fallback heuristic: If annual tope is completely missing, default to "Sin Tope" annual 
                // because merged "Sin Tope" cells are often missed by the LLM.
                processTope("SIN TOPE", "anual");
            }


            // Add Copago if exists
            if (mod.copago) {
                const copagoStr = String(mod.copago);
                const valMatch = copagoStr.match(/(\d+[,.]?\d*)/);
                const unitMatch = copagoStr.match(/(UF|VAM|AC2|V20|PESOS|\$)/i);

                if (valMatch) {
                    let unidad: "UF" | "VAM" | "AC2" | "PESOS" = "PESOS";
                    if (unitMatch) {
                        const u = unitMatch[0].toUpperCase();
                        if (u === "UF") unidad = "UF";
                        else if (u === "AC2") unidad = "AC2";
                        else if (["VAM", "V20"].includes(u)) unidad = "VAM";
                        else if (u === "PESOS" || u === "$") unidad = "PESOS";
                    }

                    canonical.copagos.push({
                        descripcion: `${itemName} (${mod.tipo})`,
                        valor: parseFloat(valMatch[1].replace(",", ".")),
                        unidad: unidad,
                        fuente_textual: `${pagePrefix} Copago detectado para ${itemName}: ${mod.copago}`
                    });
                }
            }
        });

        if (cob.nota_restriccion) {
            canonical.observaciones.push(`${pagePrefix} ${itemName}: ${cob.nota_restriccion}`);
        }
    });

    // 1.5. Industrial Mapping (v1.5.0 Audit Package Bridge)
    // If we have no coberturas but we do have assignments (Industrial Rescue)
    if (canonical.coberturas.length === 0 && (result as any).assignments) {
        const assignments = (result as any).assignments as any[];
        assignments.forEach(asg => {
            const rowLabel = asg.row_id?.replace('R_', '').replace(/_/g, ' ') || "Prestación";

            // Extract from atoms (Industrial Format)
            const atom = (asg.atoms && asg.atoms.length > 0) ? asg.atoms[0] : {};
            const val = atom.value || asg.pointer?.raw_text || "";
            const unit = atom.unit || "";

            let tipo_modalidad: "preferente" | "libre_eleccion" | "desconocido" = "desconocido";
            if (asg.column_id?.includes("PREF")) tipo_modalidad = "preferente";
            else if (asg.column_id?.includes("LE_") || asg.column_id?.includes("LIBRE")) tipo_modalidad = "libre_eleccion";

            // Add Cobertura
            canonical.coberturas.push({
                ambito: "mixto",
                descripcion_textual: rowLabel,
                porcentaje: unit === '%' ? parseFloat(val.replace(',', '.')) : null,
                red_especifica: tipo_modalidad === "preferente" ? "Red Plan" : "Libre Elección",
                tipo_modalidad,
                fuente_textual: `[Rescate 1.5.0] Asignación: ${rowLabel}`
            });

            // Add Tope
            if (unit !== '%' && val) {
                let canonicalUnit: "UF" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDO" = "DESCONOCIDO";
                const uMatch = unit.toUpperCase();
                if (uMatch.includes("UF")) canonicalUnit = "UF";
                else if (uMatch.includes("AC2")) canonicalUnit = "AC2";
                else if (uMatch.includes("VAM")) canonicalUnit = "VAM";
                else if (uMatch.includes("$") || uMatch.includes("PESO")) canonicalUnit = "PESOS";

                canonical.topes.push({
                    ambito: "mixto",
                    unidad: canonicalUnit,
                    valor: parseFloat(val.replace(',', '.')) || null,
                    aplicacion: "desconocido",
                    tipo_modalidad,
                    fuente_textual: `[Rescate 1.5.0] Tope para ${rowLabel}: ${val} ${unit}`
                });
            }
        });
    }

    // 1.6. Row Metadata (Industrial Fallback for Visibility)
    if (canonical.coberturas.length === 0 && (result as any).spatial_map?.rows) {
        const rows = (result as any).spatial_map.rows as any[];
        rows.forEach(r => {
            if (r.raw_text && r.raw_text.length > 3) {
                canonical.items_no_clasificados.push(r.raw_text);
            }
        });
    }

    // 2. Process Reglas (Exclusions, Deducibles, etc.)
    (result.reglas || []).forEach(reg => {
        const category = (reg.SUBCATEGORÍA || "").toUpperCase();
        const text = reg['VALOR EXTRACTO LITERAL DETALLADO'] || "";
        const section = reg['CÓDIGO/SECCIÓN'] || "";
        const page = reg['PÁGINA ORIGEN'] || "X";
        const pagePrefix = `[p.${page}]`;

        if (category.includes("EXCLUSIÓN")) {
            canonical.exclusiones.push({
                descripcion: text.substring(0, 200),
                fuente_textual: `${pagePrefix} Sección ${section}: ${text}`
            });
        } else if (category.includes("DEDUCIBLE")) {
            const ufMatch = text.match(/(\d+[,.]?\d*)\s*UF/i);
            const valor = ufMatch ? parseFloat(ufMatch[1].replace(",", ".")) : null;

            canonical.deducibles.push({
                unidad: ufMatch ? "UF" : "DESCONOCIDO",
                valor: valor,
                aplicacion: text.toLowerCase().includes("anual") ? "anual" : "desconocido",
                fuente_textual: `${pagePrefix} ${text}`
            });
        } else {
            // General rules & Tope Scope (v1.7)
            let condicion = `Sección ${section}`;
            if (text.toLowerCase().includes("beneficiario") || text.toLowerCase().includes("familiar")) {
                condicion = `Alcance Tope: ${section}`;
            }

            canonical.reglas_aplicacion.push({
                condicion,
                efecto: text.substring(0, 300) + (text.length > 300 ? "..." : ""),
                fuente_textual: `${pagePrefix} ${text}`
            });
        }
    });

    // 3. Observations from design metadata
    if (diseno.funcionalidad) {
        canonical.observaciones.push(`Funcionalidad: ${diseno.funcionalidad}`);
    }

    // ============================================================================
    // BUG FIX PASS: GLOBAL TOPE NORMALIZER (Deterministic Enforcement)
    // Ensures no 'DESCONOCIDO' units survive, enforces TopeValue semantics.
    // ============================================================================
    canonical.topes.forEach((t: any) => {
        const text = (t.fuente_textual || t.raw || "").toUpperCase();

        // Bug 3: Semantic mapping for "Sin Tope"
        if (t.razon === "SIN_TOPE_EXPRESO_EN_CONTRATO" || text.includes("SIN TOPE") || text.includes("ILIMITADO")) {
            t.tipo = "SIN_TOPE_EXPLICITO";
            t.valor = null;
            t.unidad = null;
            t.tope_existe = false;
            t.razon = "SIN_TOPE_EXPRESO_EN_CONTRATO";
        }
        // Numeric Topes
        else if (t.valor !== null && t.valor !== undefined) {
            t.tipo = "NUMERICO";
            t.tope_existe = true;

            // Bug 1: Infer unit explicitly from source text
            if (!t.unidad || t.unidad === "DESCONOCIDO") {
                if (text.includes("UF") || text.includes("U.F.")) t.unidad = "UF";
                else if (text.includes("AC2")) t.unidad = "AC2";
                else if (text.match(/\b(VAM|V20|V10|VA|V.A|VECES ARANCEL)\b/)) t.unidad = "VAM";
                else if (text.includes("PESOS") || text.includes("$") || text.includes("CLP") || text.includes("CL$")) t.unidad = "PESOS";
                else t.unidad = null; // Clean fallback instead of DESCONOCIDO
            }
        }
        // Missing Topes
        else {
            t.tipo = "NO_ENCONTRADO";
            t.valor = null;
            t.unidad = null;
            t.tope_existe = false;
            if (!t.razon) t.razon = "CELDA_VACIA_OCR";
        }
    });

    return canonical;
}
