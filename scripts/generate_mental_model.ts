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

const STRICT_LITERAL_MODE = false;

function formatNumber(num: any): string {
    if (num === undefined || num === null) return "";
    return String(num).replace('.', ',');
}

function formatTope(tope: any, isUrgencia: boolean = false): { text: string; alert?: string } {
    if (!tope) return { text: "" };

    const label = isUrgencia ? "Copago Fijo:" : "Tope:";

    if (tope.literal) {
        return { text: tope.literal };
    }

    if (STRICT_LITERAL_MODE) {
        return { text: "NO_LITERAL_DISPONIBLE", alert: "Falta literal contractual en modo estricto" };
    }

    const alert = "Normalización técnica (reconstrucción)";

    let parts: string[] = [];
    if (isUrgencia) parts.push(label);

    if (tope.factor !== undefined && tope.factor !== null) {
        const factorStr = Number(tope.factor).toFixed(1).replace('.', ',');
        parts.push(`${factorStr} veces`);
    }

    if (tope.tipo && !isUrgencia) parts.push(tope.tipo);

    if (tope.valor !== undefined && tope.valor !== null) {
        parts.push(formatNumber(tope.valor));
    }

    if (tope.unidad) parts.push(tope.unidad);
    if (isUrgencia && tope.tipo === "UF" && !tope.unidad) parts.push("UF");

    const resultText = parts.join(" ");

    return {
        text: resultText,
        alert: (resultText.trim() !== "" && resultText !== tope.tipo) ? alert : undefined
    };
}

function processNode(l: any, prefPaths: any[], isUrgencia: boolean = false): NodeData {
    let titulo = l.nombre || "";
    let detallePrefix = "";

    const isDescriptor = /^\d+[,.]\d+ vezes/i.test(titulo) || /^\d+[,.]\d+ veces/i.test(titulo) || titulo.toLowerCase().includes("veces ac");
    if (isDescriptor) {
        titulo = `[Nota] ${titulo}`;
        detallePrefix = "[Descriptor Contractual] ";
    }

    const node: NodeData = {
        titulo: titulo,
        children: []
    };

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
                    const topeResult = formatTope(pathData.tope, isUrgencia);
                    const alertText = topeResult.alert ? `[Alerta ROF: ${topeResult.alert}] ` : "";

                    const pathNode: NodeData = {
                        titulo: `Path: ${pId}`,
                        cobertura: `${pathData.porcentaje}% | ${topeResult.text}`,
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

    if (l.libre_eleccion && l.libre_eleccion.aplica === true) {
        const le = l.libre_eleccion;
        const topeResult = formatTope(le.tope, isUrgencia);
        const alertText = topeResult.alert ? `[Alerta ROF: ${topeResult.alert}] ` : "";

        const leNode: NodeData = {
            titulo: "Libre Elección",
            cobertura: `${le.porcentaje}% | ${topeResult.text}`.trim(),
            detalle: `${alertText}${detallePrefix}${le.heredado ? "Porcentaje heredado del contrato. " : ""}Fuente: p.${l.fuente_visual?.pagina || "?"} f.${l.fuente_visual?.fila || "?"}`
        };
        node.children?.push(leNode);
    }

    if (l.nfe && l.nfe.aplica === true) {
        const nfe = l.nfe;
        const labels = isUrgencia ? "Copago Fijo (Compleja):" : "Tope Anual / NFE";
        const nfeNode: NodeData = {
            titulo: labels,
            cobertura: (nfe.valor !== undefined && nfe.unidad) ? `${formatNumber(nfe.valor)} ${nfe.unidad}` : "Sin tope expreso",
            detalle: `${detallePrefix}Razón: ${nfe.razon || "No especificada"}. Fuente: p.${l.fuente_visual?.pagina || "?"} f.${l.fuente_visual?.fila || "?"}`
        };
        node.children?.push(nfeNode);
    }

    return node;
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

    const hospitalario: NodeData = { titulo: "HOSPITALARIO Y CIRUGÍA MAYOR AMBULATORIA", children: [] };
    const ambulatorio: NodeData = { titulo: "PRESTACIONES AMBULATORIAS", children: [] };
    const restringidas: NodeData = { titulo: "PRESTACIONES RESTRINGIDAS", children: [] };
    const otras: NodeData = { titulo: "OTRAS COBERTURAS", children: [] };
    const urgencia: NodeData = { titulo: "Universo ATENCIÓN DE URGENCIA", children: [] };

    let currentUniverse: NodeData = hospitalario;

    lineas.forEach(l => {
        const nombre = (l.nombre || "").toUpperCase();
        const textoEnca = (l.texto || "").toUpperCase();

        // 1. Check for Universe Transitions (via header or specific section-starting name)
        if (nombre.includes("AMBULATORIAS") || textoEnca.includes("AMBULATORIAS")) {
            currentUniverse = ambulatorio;
        } else if (nombre.includes("RESTRINGIDAS") || textoEnca.includes("RESTRINGIDAS")) {
            currentUniverse = restringidas;
        } else if (nombre.includes("OTRAS COBERTURAS") || textoEnca.includes("OTRAS COBERTURAS")) {
            currentUniverse = otras;
        }

        if (l.tipo === "prestacion") {
            const isUrg = nombre.includes("URGENCIA");

            if (isUrg) {
                // Specialized Urgencia grouping
                if (nombre === "URGENCIA ADULTO") {
                    const node = processNode(l, prefPaths, true);
                    node.titulo = "Urgencia Adulto";
                    if (node.children) {
                        node.children.forEach(c => {
                            if (c.titulo === "Libre Elección") c.titulo = "Copago Fijo (Urgencia Normal)";
                            if (c.titulo === "Copago Fijo (Compleja):") c.titulo = "Copago Fijo (Urgencia Compleja)";
                        });
                    }
                    urgencia.children?.push(node);
                } else if (nombre === "URGENCIA PEDIÁTRICA") {
                    const node = processNode(l, prefPaths, true);
                    node.titulo = "Urgencia Pediátrica";
                    if (node.children) {
                        node.children.forEach(c => {
                            if (c.titulo === "Libre Elección") c.titulo = "Copago Fijo (Normal / Compleja)";
                            if (c.titulo === "Copago Fijo (Compleja):") c.titulo = "Copago Fijo (Urgencia Compleja Referencia)";
                        });
                    }
                    urgencia.children?.push(node);
                } else if (nombre === "ATENCIÓN DE URGENCIA") {
                    const node = processNode(l, prefPaths);
                    node.titulo = "Cláusulas y Prestadores de Urgencia";
                    urgencia.children?.push(node);
                } else if (nombre !== "OTRAS COBERTURAS") { // Safety: don't double count OTRAS if handled below
                    urgencia.children?.push(processNode(l, prefPaths, true));
                }
            } else {
                // Add to current identified universe
                currentUniverse.children?.push(processNode(l, prefPaths));
            }
        }
    });

    // Final Assembly (Filtering empty universes)
    if (hospitalario.children!.length > 0) mentalModel.root.children?.push(hospitalario);
    if (ambulatorio.children!.length > 0) mentalModel.root.children?.push(ambulatorio);
    if (restringidas.children!.length > 0) mentalModel.root.children?.push(restringidas);
    if (otras.children!.length > 0) mentalModel.root.children?.push(otras);
    if (urgencia.children!.length > 0) mentalModel.root.children?.push(urgencia);

    fs.writeFileSync(outputPath, JSON.stringify(mentalModel, null, 2));
    console.log(`Mental model generated at: ${outputPath}`);
}

generateMentalModel();
