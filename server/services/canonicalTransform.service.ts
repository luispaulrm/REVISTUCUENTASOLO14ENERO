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
    unidad: "UF" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDO";
    valor: number | null;
    aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido";
    tipo_modalidad?: "preferente" | "libre_eleccion" | "desconocido";
    fuente_textual: string;
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

    // REDUNDANT SAFETY: Even with ?., we ensure diseno_ux exists as an object
    const diseno = result.diseno_ux || ({} as any);
    const finger = result.fingerprint || ({} as any);
    const meta = (result as any).metadata || {};

    const tcRaw = (String(finger.tipo_contrato || diseno.nombre_isapre || meta.source_document || "")).toUpperCase();

    if (tcRaw.includes("ISAPRE")) tipo_contrato = "ISAPRE";
    else if (tcRaw.includes("FONASA")) tipo_contrato = "FONASA";
    else if (tcRaw.includes("COMPLEMENTARIO")) tipo_contrato = "COMPLEMENTARIO";
    else if (tcRaw.includes("DENTAL")) tipo_contrato = "DENTAL";

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
        if (normalizedCategory.includes("hosp") || normalizedItem.toLowerCase().includes("hosp")) ambito = "hospitalario";
        else if (normalizedCategory.includes("amb") || normalizedItem.toLowerCase().includes("amb")) ambito = "ambulatorio";
        else if (normalizedCategory.includes("restringida") || normalizedCategory.includes("libre") || normalizedCategory.includes("extra")) ambito = "mixto";

        cob.modalidades.forEach(mod => {
            // Attempt to infer Red Specificity
            let red_especifica = "Todas";
            if (mod.tipo === "PREFERENTE") {
                const clinicsMatch = diseno.subtitulo_plan?.match(/Clínica\s+(\w+)/i);
                red_especifica = clinicsMatch ? clinicsMatch[0] : "Red Preferente";
            } else if (mod.tipo === "LIBRE_ELECCION") {
                red_especifica = "Libre Elección";
            }

            // Map Modality Type
            let tipo_modalidad: "preferente" | "libre_eleccion" | "restringida" | "ampliada" | "desconocido" = "desconocido";
            if (mod.tipo === "LIBRE_ELECCION") tipo_modalidad = "libre_eleccion";
            else if (mod.tipo === "PREFERENTE") tipo_modalidad = "preferente";
            else if (categoria.includes("restringida")) tipo_modalidad = "restringida";
            else if (mod.tipo === "BONIFICACION" || categoria.includes("ampliaci")) tipo_modalidad = "ampliada";

            // Add Cobertura
            canonical.coberturas.push({
                ambito,
                descripcion_textual: `${itemName}`,
                porcentaje: mod.porcentaje,
                red_especifica,
                tipo_modalidad,
                fuente_textual: `${pagePrefix} Sección ${cob.categoria}: ${itemName}`
            });

            // Add Tope if exists
            if (mod.tope !== null) {
                // UNIT NORMALIZATION (v1.8) - AC2 Preserved
                let unidad: "UF" | "VAM" | "AC2" | "PESOS" | "DESCONOCIDO" = "DESCONOCIDO";
                const uRaw = (mod.unidadTope || "").toUpperCase();
                if (uRaw === "UF") unidad = "UF";
                else if (uRaw === "AC2") unidad = "AC2";
                else if (["VAM", "V20", "V10", "VA", "VECES ARANCEL"].includes(uRaw)) unidad = "VAM";
                else if (uRaw === "PESOS" || uRaw === "$") unidad = "PESOS";

                let aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido" = "desconocido";
                if (mod.tipoTope === "ANUAL") aplicacion = "anual";
                else if (mod.tipoTope === "POR_EVENTO") aplicacion = "por_evento";

                // V2 Support: Check nested tope first, then legacy number, or extract if object
                let val: number | null = mod.tope_nested?.valor ?? null;

                if (val === null) {
                    if (typeof mod.tope === 'number') {
                        val = mod.tope;
                    } else if (typeof mod.tope === 'object' && mod.tope !== null) {
                        // Handle case where LLM puts object in 'tope' instead of 'tope_nested'
                        val = (mod.tope as any).valor ?? null;
                    }
                }

                const unit = mod.tope_nested?.unidad ?? (typeof mod.tope === 'object' ? (mod.tope as any)?.unidad : mod.unidadTope) ?? "";

                canonical.topes.push({
                    ambito,
                    unidad,
                    valor: val,
                    aplicacion,
                    tipo_modalidad: mod.tipo === "LIBRE_ELECCION" ? "libre_eleccion" : (mod.tipo === "PREFERENTE" ? "preferente" : "desconocido"),
                    fuente_textual: `${pagePrefix} Tope para ${itemName} (${mod.tipo}): ${val} ${unit || "SIN_UNIDAD"}`
                });
            }

            // Add Copago if exists
            if (mod.copago) {
                const valMatch = mod.copago.match(/(\d+[,.]?\d*)/);
                const unitMatch = mod.copago.match(/(UF|VAM|AC2|V20|PESOS|\$)/i);

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

    return canonical;
}
