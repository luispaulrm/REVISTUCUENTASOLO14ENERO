
import fs from 'fs';
import path from 'path';

// INPUTS
const SEGMENTATION_PATH = path.join(process.cwd(), 'segmentation_result.json');
const EXTRACTION_PATH = path.join(process.cwd(), 'extraction_result.json');
const OUTPUT_PATH = path.join(process.cwd(), 'expansion_result.json');

// --- KNOWN LISTS ---
const KNOWN_PRESTADORES = [
    "Hospital Clínico",
    "Clínica Santa María",
    "Clínica Indisa",
    "Clínica Dávila",
    "Clínica Avansalud",
    "Clínica Bicentenario",
    "Clínicas Tabancura",
    "Red de Salud UC Christus",
    "Clínica Vespucio",
    "Integramédica"
];

const SECTION_HEADERS = [
    "TOPES DE BONIFICACION",
    "VALORIZACION TOPES",
    "PRESTACIONES DENTALES",
    "NOTAS EXPLICATIVAS",
    "AMBULATORIAS",
    "\\(\\+\\)", // escaped regex for (*)
    "\\(\\*\\)",
    "URGENCIA" // Often a section break
];

// --- INTERFACES ---
interface InternalRule {
    porcentaje: number | null;
    tope: string | "SIN_TOPE" | null;
    prestadores: string[];
    modalidad_institucional?: string;
    condicion?: string;
    codigo_modalidad?: string;
}

interface Block {
    bloque_id: string;
    pagina_inicio: number;
    linea_inicio: number;
    columna_inicio: number;
    modalidad: "preferente" | "libre_eleccion" | "institucional";
    tipo_bloque: string;
    porcentaje: number | null;
    tope: any;
    texto_fuente: string;

    // Output Fields
    reglas?: InternalRule[];
    estado_semantico?: "LIMPIO" | "PARCIAL" | "CONTAMINADO" | "INVALIDO";
    confianza?: number;
    rol?: "OPERATIVO" | "REFERENCIAL";
    excludeFromCanonizador?: boolean;
    razon?: string;

    // Internal use
    _texto_expandido_raw?: string;
}

interface ExpandedOutput {
    metadata: any;
    bloques: Block[];
    asignaciones: any[];
}

// --- MODULES ---

// 🔹 Módulo 1 — HeaderAnchorResolver
function isHeaderAnchor(block: Block): boolean {
    const txt = block.texto_fuente.toUpperCase();
    return (
        txt.includes("SIN TOPE") ||
        txt.includes("CON TOPE") ||
        txt.includes("EN:") ||
        (!!block.porcentaje && txt.includes("%"))
    );
}

// 🔹 Módulo 2 — VerticalExpansionScanner (Strict V2)
function collectExpansionText(block: Block, allLines: any[]): string {
    let textParts: string[] = [];

    let startIndex = allLines.findIndex((l: any) => l.pagina === block.pagina_inicio && l.indice_linea === block.linea_inicio);
    if (startIndex === -1) return "";

    for (let i = startIndex + 1; i < allLines.length; i++) {
        const line = allLines[i];
        const lineText = line.texto_plano.toUpperCase();

        // 🔹 Corrección 2 (Refined): Cierre por encabezado de sección
        if (SECTION_HEADERS.some(h => new RegExp(h, "i").test(lineText))) break;

        // Standard stops
        if (lineText.match(/(\d+%)\s+SIN\s+TOPE/i)) break;
        if (lineText.match(/(\d+%)\s+CON\s+TOPE/i)) break;
        if (lineText.includes("SOLO COBERTURA LIBRE ELECCIÓN")) break;
        if (line.tipo === 'cabecera_tabla' || line.tipo === 'titulo') break;

        // 🔹 Corrección 1 (Implicit): Hard column check -> WIDENED to Modality Zone
        // Matches logic in Segmenter Phase B
        const splitColumnIndex = 50; // Hardcoded approximation or derive? 50 is safe for this contract.

        const validCells = line.celdas?.filter((c: any) => {
            if (block.modalidad === 'preferente') {
                // Include Col 2, 3, 4. Exclude Col 1 unless strictly provider?
                // Let's rely on standard zone < 50.
                return c.indice_columna < splitColumnIndex;
            } else {
                return c.indice_columna >= splitColumnIndex;
            }
        });

        if (validCells && validCells.length > 0) {
            for (const cell of validCells) {
                // 🔹 Corrección 4: Noise Filter
                if (block.modalidad === 'preferente' && cell.texto.match(/UF|veces AC2|Copago Fijo/i)) {
                    continue;
                }

                // Filter Col 1 to avoid adding prestation names to provider list?
                // Unlike segmenter, Expander is focused on providers.
                // If Col 1 has "DERECHO DE PABELLON", we don't want it.
                // If Col 1 has "Hospital...", we do.
                if (cell.indice_columna === 1) {
                    if (!cell.texto.match(/Hospital|Clínica|Centro|Red|Médico/i)) continue;
                }

                textParts.push(cell.texto);
            }
        }
    }
    return textParts.join(" ");
}

// 🔹 Módulo 3 — SemanticSplitter & Normalizer (V2)
function processExpandedText(rawText: string, modality: string): { prestadores: string[], condiciones: string[], modCode: string } {
    const prestadores: string[] = [];
    const condiciones: string[] = [];
    let modCode = "";

    // Preliminary Clean
    let clean = rawText;
    // 🔹 Corrección 4: Exclusión automática de ruido
    if (modality === 'preferente') {
        clean = clean.replace(/\d+([.,]\d+)?\s*(veces\s*)?AC2/gi, " ");
        clean = clean.replace(/\d+([.,]\d+)?\s*UF/gi, " ");
    }

    // Extract Providers
    // Extract Providers - FIXED REGEX for Accents
    const providerRegex = /(?:Hospital|Clínica|Centro Médico|Integramédica|Red de Salud)[a-zA-Z\u00C0-\u00FF\s\.]*/gi;
    const items = clean.match(providerRegex);

    if (items) {
        items.forEach(p => {
            let sub = p.replace(/[,:;.]+$/, '').trim();

            sub.split(/,| y | e /).forEach(token => {
                token = token.trim();

                // 🔹 Corrección 3: Limpieza dura de prestadores
                if (token.length < 10) return; // Discard short
                if (!token.match(/Cl[ií]nica|Hospital|Red|Integram|Centro/i)) return; // Valid keywords

                // Normalize
                token = token.replace(/Clinica/i, "Clínica").replace(/Maria/i, "María");

                // Optional White-list check? User said "Opcional (recomendado)".
                // We will use it to boost confidence, but maybe not strictly discard if regex passed?
                // "if (!KNOWN... state = PARCIAL)". Logic happens in status calc.

                if (!prestadores.includes(token)) prestadores.push(token);
            });
        });
    }

    if (rawText.includes("(A.1)")) { modCode = "A.1"; }
    else if (rawText.includes("(A.2)")) { modCode = "A.2"; }

    if (rawText.match(/Habitación Individual/i)) condiciones.push("Habitación Individual");
    if (rawText.match(/Modalidad Institucional/i)) condiciones.push("Modalidad Institucional");

    return { prestadores, condiciones, modCode };
}

async function runExpander() {
    if (!fs.existsSync(SEGMENTATION_PATH) || !fs.existsSync(EXTRACTION_PATH)) {
        console.error("Missing input files");
        process.exit(1);
    }

    const segData = JSON.parse(fs.readFileSync(SEGMENTATION_PATH, 'utf-8'));
    const extractData = JSON.parse(fs.readFileSync(EXTRACTION_PATH, 'utf-8'));

    const output: ExpandedOutput = { ...segData };

    for (const block of output.bloques) {
        // Init Defaults
        block.rol = "OPERATIVO";
        block.excludeFromCanonizador = false;

        // 🔹 Corrección 5: LE = REFERENCIAL
        if (block.modalidad === 'libre_eleccion') {
            block.rol = "REFERENCIAL";
            block.excludeFromCanonizador = true;
            block.estado_semantico = "LIMPIO";
            block.confianza = 1.0;
            continue;
        }

        if (block.tipo_bloque === 'exclusion_modalidad') {
            block.estado_semantico = "LIMPIO";
            block.confianza = 1.0;
            continue;
        }

        if (isHeaderAnchor(block)) {
            const expandedStr = collectExpansionText(block, extractData.lineas);
            block._texto_expandido_raw = expandedStr;

            const fullText = block.texto_fuente + " " + expandedStr;
            const { prestadores, condiciones, modCode } = processExpandedText(fullText, block.modalidad);

            // 🔹 Corrección 1: Estado INVALIDO (Regex Relaxed: "Sin Tope" followed by colon or "en")
            if (block.texto_fuente.match(/Sin Tope(:|\s+en)/i) && prestadores.length === 0) {
                block.estado_semantico = "INVALIDO";
                block.confianza = 0.2;
                block.razon = "BLOQUE_REQUIERE_PRESTADOR_EXPLICITO";
                block.excludeFromCanonizador = true;

                // FIX 3 & 5: If assignments exist, DO NOT EXCLUDE. Flag as HIGH RISK only.
                // We need to count assignments. We have access to 'output.asignaciones' or 'segData.asignaciones'.
                // We are modifying 'output' object which starts with segData copy.
                const assignmentCount = output.asignaciones.filter(a => a.bloque_id === block.bloque_id).length;

                if (assignmentCount > 0) {
                    block.excludeFromCanonizador = false;
                    block.razon = "RIESGO_JURIDICO_ALTO"; // Auditor sees: High Risk but exists.
                    block.estado_semantico = "INVALIDO"; // Keep Invalid semantic but actionable? 
                    // Or maybe "PARCIAL"? No, "INVALIDO" is honest. But "exclusion = false" is key.
                }

                block.reglas = [{
                    porcentaje: block.porcentaje,
                    tope: "SIN_TOPE",
                    prestadores: [] // Canonizer will see empty array -> "NO_ESPECIFICADOS"
                }];
                continue;
            }

            const rule: InternalRule = {
                porcentaje: block.porcentaje,
                tope: block.tope.existe === false ? "SIN_TOPE" : block.tope.valor ? `${block.tope.valor}` : null,
                prestadores: prestadores,
                modalidad_institucional: condiciones.find(c => c.includes("Institucional")),
                codigo_modalidad: modCode || undefined,
                condicion: [...new Set(condiciones)].join(", ") || undefined
            };

            block.reglas = [rule];

            // 🔹 Corrección 6: Estado Semántico V2 (Production Logic)
            // Rule A: Contamination Check
            const isContaminated = (expandedStr + " " + block.texto_fuente).match(/IMAGENOLOG[IÍ]A|PROCEDIMIENTOS|EXÁMENES|RADIOTERAPIA|INTEGRAL/i);

            // Rule C: Trailing Cutoff Check
            const hasTrailingCutoff = expandedStr.trim().match(/(Cl[ií]nica|Hospital|Centro|Red)\s*[,; \.]*$/i);

            // Rule B: Provider Count Check
            if (prestadores.length >= 2 && !isContaminated && !hasTrailingCutoff) {
                block.estado_semantico = "LIMPIO";
                block.confianza = 0.95;
            } else {
                // Forces PARCIAL
                block.estado_semantico = "PARCIAL";
                // Adjust confidence based on case
                if (isContaminated || hasTrailingCutoff) {
                    block.confianza = hasTrailingCutoff ? 0.65 : 0.6;
                } else if (prestadores.length === 1) {
                    block.confianza = 0.7; // Single provider implies partial
                } else {
                    // 0 providers, likely generic or issue
                    // If it was "Sin Tope" logic above caught it.
                    // Here maybe "90%" generic.
                    if (block.tope.existe === false) {
                        block.confianza = 0.5;
                    } else {
                        block.estado_semantico = "LIMPIO"; // Generic % with cap is usually standard
                        block.confianza = 0.9;
                    }
                }
            }

        } else {
            // Simple blocks
            block.estado_semantico = "LIMPIO";
            block.confianza = 0.9;
            if (!block.reglas) {
                block.reglas = [{
                    porcentaje: block.porcentaje,
                    tope: block.tope.existe ? `${block.tope.valor}` : "SIN_TOPE",
                    prestadores: []
                }];
            }
        }

        // Final Canonical Eligibility Check
        if (block.estado_semantico !== "LIMPIO" || block.modalidad !== "preferente") {
            // Implicitly not fully eligible, but exclude flag handles hard exclusions
        }
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
    console.log("Expansion Complete (Production V1)");
}

runExpander().catch(e => console.error(e));
