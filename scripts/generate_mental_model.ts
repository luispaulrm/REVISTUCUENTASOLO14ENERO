import * as fs from 'fs';
import * as path from 'path';

interface CanonicalContract {
    contrato: {
        metadata: {
            fuente: string;
            fecha_procesamiento: string;
            [key: string]: any;
        };
        tabla_prestaciones: {
            lineas: any[];
            oferta_preferente_paths?: any[];
            [key: string]: any;
        };
    };
}

interface NodeData {
    titulo: string;
    cobertura?: string;
    detalle?: string;
    children?: NodeData[];
}

interface MentalModel {
    metadata: {
        source_contract: string;
        generated_at: string;
    };
    root: NodeData;
}

const STRICT_LITERAL_MODE = false; // Layer 2: Hard-lock to literals only if needed

function formatNumber(num: any): string {
    if (num === undefined || num === null) return "";
    return String(num).replace('.', ',');
}

function formatTope(tope: any): { text: string; alert?: string } {
    if (!tope) return { text: "" };

    // Layer 1: Literal Priority Logic
    if (tope.literal) {
        return { text: tope.literal };
    }

    if (STRICT_LITERAL_MODE) {
        return { text: "NO_LITERAL_DISPONIBLE", alert: "Falta literal contractual en modo estricto" };
    }

    // Layer 3: Normalization Risk Highlighting
    const alert = "Normalización técnica (reconstrucción)";

    let parts: string[] = [];
    if (tope.factor !== undefined && tope.factor !== null) {
        // Factors in these contracts consistently use 1 decimal (e.g., 4,0 or 1,2)
        const factorStr = Number(tope.factor).toFixed(1).replace('.', ',');
        parts.push(`${factorStr} veces`);
    }

    if (tope.tipo) parts.push(tope.tipo);
    if (tope.valor !== undefined && tope.valor !== null) {
        parts.push(formatNumber(tope.valor));
    }
    if (tope.unidad) parts.push(tope.unidad);

    const resultText = parts.join(" ");

    return {
        text: resultText,
        // Only alert if we actually had to reconstruct something (factor or valor)
        alert: (resultText.trim() !== "" && resultText !== tope.tipo) ? alert : undefined
    };
}

function generateMentalModel() {
    const inputPath = path.resolve(process.cwd(), 'canonical_contract.json');
    const outputPath = path.resolve(process.cwd(), 'mental_model.json');

    if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const rawData = fs.readFileSync(inputPath, 'utf-8');
    const canonical: CanonicalContract = JSON.parse(rawData);

    const metadata = canonical.contrato.metadata;
    const lineas = canonical.contrato.tabla_prestaciones.lineas;
    const prefPaths = canonical.contrato.tabla_prestaciones.oferta_preferente_paths || [];

    const mentalModel: MentalModel = {
        metadata: {
            source_contract: metadata.fuente || "Contrato Desconocido",
            generated_at: metadata.fecha_procesamiento || new Date().toISOString()
        },
        root: {
            titulo: "Contrato de Salud – Prestaciones y Coberturas",
            children: []
        }
    };

    lineas.filter(l => l.tipo === "prestacion").forEach(l => {
        let titulo = l.nombre;
        let detallePrefix = "";

        // ROF Refinement: Identify descriptors (like "0,8 veces AC2")
        // Pattern: Starts with number and comma/dot, or contains "veces ac"
        const isDescriptor = /^\d+[,.]\d+ vezes/i.test(titulo) || /^\d+[,.]\d+ veces/i.test(titulo) || titulo.toLowerCase().includes("veces ac");
        if (isDescriptor) {
            titulo = `[Nota] ${titulo}`;
            detallePrefix = "[Descriptor Contractual] ";
        }

        const node: NodeData = {
            titulo: titulo,
            children: []
        };

        // 1. Oferta Preferente
        if (l.preferente && l.preferente.aplica === true) {
            const prefNode: NodeData = {
                titulo: "Oferta Preferente",
                children: []
            };

            const paths = l.preferente.paths || [];
            if (paths.length === 0) {
                prefNode.cobertura = "Aplica (Sin detalles)";
            } else {
                paths.forEach((pId: string) => {
                    const pathData = prefPaths.find(p => p.path_id === pId);
                    if (pathData) {
                        const topeResult = formatTope(pathData.tope);
                        const alertText = topeResult.alert ? `[Alerta ROF: ${topeResult.alert}] ` : "";

                        const pathNode: NodeData = {
                            titulo: `Path: ${pId}`,
                            cobertura: `${pathData.porcentaje}% | Tope: ${topeResult.text}`,
                            detalle: `${alertText}${detallePrefix}Prestadores: ${pathData.prestadores?.join(", ") || "No especificado"}. Condiciones: ${pathData.condiciones?.join(", ") || "Ninguna"}. Fuente: p.${pathData.fuente?.pagina || "?"} f.${pathData.fuente?.linea_inicio || "?"}`
                        };
                        prefNode.children?.push(pathNode);
                    }
                });

                if (prefNode.children?.length === 1) {
                    const single = prefNode.children[0];
                    prefNode.cobertura = single.cobertura;
                    prefNode.detalle = single.detalle;
                    prefNode.children = [];
                } else {
                    prefNode.cobertura = "Múltiples opciones (expandir)";
                }
            }
            node.children?.push(prefNode);
        }

        // 2. Libre Elección
        if (l.libre_eleccion && l.libre_eleccion.aplica === true) {
            const le = l.libre_eleccion;
            const topeResult = formatTope(le.tope);
            const alertText = topeResult.alert ? `[Alerta ROF: ${topeResult.alert}] ` : "";

            const leNode: NodeData = {
                titulo: "Libre Elección",
                cobertura: `${le.porcentaje}% | ${topeResult.text}`.trim(),
                detalle: `${alertText}${detallePrefix}${le.heredado ? "Porcentaje heredado del contrato. " : ""}Fuente: p.${l.fuente_visual?.pagina || "?"} f.${l.fuente_visual?.fila || "?"}`
            };
            node.children?.push(leNode);
        }

        // 3. Tope Anual / NFE
        if (l.nfe && l.nfe.aplica === true) {
            const nfe = l.nfe;
            const nfeNode: NodeData = {
                titulo: "Tope Anual / NFE",
                cobertura: (nfe.valor !== undefined && nfe.unidad) ? `${formatNumber(nfe.valor)} ${nfe.unidad}` : "Sin tope expreso",
                detalle: `${detallePrefix}Razón: ${nfe.razon || "No especificada"}. Fuente: p.${l.fuente_visual?.pagina || "?"} f.${l.fuente_visual?.fila || "?"}`
            };
            node.children?.push(nfeNode);
        }

        mentalModel.root.children?.push(node);
    });

    fs.writeFileSync(outputPath, JSON.stringify(mentalModel, null, 2));
    console.log(`Mental model generated at: ${outputPath}`);
}

generateMentalModel();
