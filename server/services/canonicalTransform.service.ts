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
    // 0. Metadata Normalization
    let tipo_contrato: "ISAPRE" | "FONASA" | "COMPLEMENTARIO" | "DENTAL" | "DESCONOCIDO" = "DESCONOCIDO";
    const tcRaw = (result.fingerprint?.tipo_contrato || result.diseno_ux.nombre_isapre || "").toUpperCase();
    if (tcRaw.includes("ISAPRE")) tipo_contrato = "ISAPRE";
    else if (tcRaw.includes("FONASA")) tipo_contrato = "FONASA";
    else if (tcRaw.includes("COMPLEMENTARIO")) tipo_contrato = "COMPLEMENTARIO";
    else if (tcRaw.includes("DENTAL")) tipo_contrato = "DENTAL";

    const canonical: CanonicalContract = {
        metadata: {
            origen: "contrato_pdf",
            fuente: `${result.diseno_ux.nombre_isapre} - ${result.diseno_ux.titulo_plan}`,
            vigencia: "No especificada",
            tipo_contrato,
            codigo_arancel: result.diseno_ux.subtitulo_plan?.match(/(AC2|V20|V10)/i)?.[0] || undefined
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
    result.coberturas.forEach((cob, cobIdx) => {
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
                const clinicsMatch = result.diseno_ux.subtitulo_plan?.match(/Clínica\s+(\w+)/i);
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

                canonical.topes.push({
                    ambito,
                    unidad,
                    valor: mod.tope,
                    aplicacion,
                    tipo_modalidad: mod.tipo === "LIBRE_ELECCION" ? "libre_eleccion" : (mod.tipo === "PREFERENTE" ? "preferente" : "desconocido"),
                    fuente_textual: `${pagePrefix} Tope para ${itemName} (${mod.tipo}): ${mod.tope} ${mod.unidadTope}`
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

    // 2. Process Reglas (Exclusions, Deducibles, etc.)
    result.reglas.forEach(reg => {
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
    if (result.diseno_ux.funcionalidad) {
        canonical.observaciones.push(`Funcionalidad: ${result.diseno_ux.funcionalidad}`);
    }

    return canonical;
}
