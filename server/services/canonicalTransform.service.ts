import { ContractAnalysisResult } from './contractTypes.js';

export interface CanonicalMetadata {
    origen: string;
    fuente: string;
    vigencia: string;
    tipo_contrato: string;
}

export interface CanonicalCobertura {
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    descripcion_textual: string;
    porcentaje: number | null;
    fuente_textual: string;
}

export interface CanonicalTope {
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    unidad: "UF" | "VAM" | "PESOS" | "DESCONOCIDO";
    valor: number | null;
    aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido";
    fuente_textual: string;
}

export interface CanonicalDeducible {
    unidad: "UF" | "VAM" | "PESOS" | "DESCONOCIDO";
    valor: number | null;
    aplicacion: "anual" | "evento" | "desconocido";
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
    copagos: any[]; // Specified as empty array in schema but can be extended
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
    const canonical: CanonicalContract = {
        metadata: {
            origen: "contrato_pdf",
            fuente: `${result.diseno_ux.nombre_isapre} - ${result.diseno_ux.titulo_plan}`,
            vigencia: "No especificada",
            tipo_contrato: result.fingerprint?.tipo_contrato || result.diseno_ux.nombre_isapre
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
    result.coberturas.forEach(cob => {
        const itemName = cob.item || "Prestación desconocida";
        const categoria = cob.categoria?.toLowerCase() || "";

        let ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido" = "desconocido";
        if (categoria.includes("hosp") || itemName.toLowerCase().includes("hosp")) ambito = "hospitalario";
        else if (categoria.includes("amb") || itemName.toLowerCase().includes("amb")) ambito = "ambulatorio";
        else if (categoria.includes("libre") || categoria.includes("general")) ambito = "mixto";

        cob.modalidades.forEach(mod => {
            // Add Cobertura
            canonical.coberturas.push({
                ambito,
                descripcion_textual: `${itemName} - Modalidad ${mod.tipo}`,
                porcentaje: mod.porcentaje,
                fuente_textual: `Extracción estructural - Sección ${cob.categoria}`
            });

            // Add Tope if exists
            if (mod.tope !== null) {
                let unidad: "UF" | "VAM" | "PESOS" | "DESCONOCIDO" = "DESCONOCIDO";
                if (mod.unidadTope === "UF") unidad = "UF";
                else if (mod.unidadTope === "VAM" || mod.unidadTope === "AC2") unidad = "VAM";
                else if (mod.unidadTope === "PESOS") unidad = "PESOS";

                let aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido" = "desconocido";
                if (mod.tipoTope === "ANUAL") aplicacion = "anual";
                else if (mod.tipoTope === "POR_EVENTO") aplicacion = "por_evento";

                canonical.topes.push({
                    ambito,
                    unidad,
                    valor: mod.tope,
                    aplicacion,
                    fuente_textual: `Tope detectado para ${itemName} (${mod.tipo}): ${mod.tope} ${mod.unidadTope}`
                });
            }
        });

        if (cob.nota_restriccion) {
            canonical.observaciones.push(`${itemName}: ${cob.nota_restriccion}`);
        }
    });

    // 2. Process Reglas (Exclusions, Deducibles, etc.)
    result.reglas.forEach(reg => {
        const category = (reg.SUBCATEGORÍA || "").toUpperCase();
        const text = reg['VALOR EXTRACTO LITERAL DETALLADO'] || "";
        const section = reg['CÓDIGO/SECCIÓN'] || "";

        if (category.includes("EXCLUSIÓN")) {
            canonical.exclusiones.push({
                descripcion: text.substring(0, 200), // Summary for canonical but original exists
                fuente_textual: `Sección ${section}: ${text}`
            });
        } else if (category.includes("DEDUCIBLE")) {
            // Simple parsing of deducible from text
            const ufMatch = text.match(/(\d+[,.]?\d*)\s*UF/i);
            const valor = ufMatch ? parseFloat(ufMatch[1].replace(",", ".")) : null;

            canonical.deducibles.push({
                unidad: ufMatch ? "UF" : "DESCONOCIDO",
                valor: valor,
                aplicacion: text.toLowerCase().includes("anual") ? "anual" : "desconocido",
                fuente_textual: text
            });
        } else {
            // General rules
            canonical.reglas_aplicacion.push({
                condicion: `Sección ${section}`,
                efecto: text.substring(0, 300) + (text.length > 300 ? "..." : ""),
                fuente_textual: text
            });
        }
    });

    // 3. Observations from design metadata
    if (result.diseno_ux.funcionalidad) {
        canonical.observaciones.push(`Funcionalidad: ${result.diseno_ux.funcionalidad}`);
    }

    return canonical;
}
