
import fs from 'fs';
import path from 'path';

// Input/Output paths
const INPUT_PATH = path.join(process.cwd(), 'extraction_result.json');
const OUTPUT_PATH = path.join(process.cwd(), 'segmentation_result.json');

// Helper Interfaces for Phase B
interface InternalRule {
    regla_id: string;
    porcentaje: number | null;
    tope: string | "SIN_TOPE" | null;
    prestadores: string[];
    // submodalidad / condicion fields
    modalidad_institucional?: string;
    condicion?: string;
}

// Interface Definitions
interface BlockInput {
    metadata: { valid: boolean };
    lineas: any[];
}

interface Block {
    bloque_id: string;
    pagina_inicio: number;
    linea_inicio: number;
    columna_inicio: number;
    modalidad: "preferente" | "libre_eleccion" | "institucional";
    tipo_bloque: "porcentaje" | "clausula_juridica" | "bloque_compuesto" | "exclusion_modalidad"; // FIX 5
    porcentaje: number | null;
    excluye?: string; // FIX 5
    tope: {
        existe: boolean | null;
        unidad: string | null;
        valor: number | null;
        razon: string | null;
    };
    texto_fuente: string;
    // Phase B fields
    texto_expandido?: string;
    reglas?: InternalRule[];
}

interface Assignment {
    pagina: number;
    indice_linea: number;
    prestacion_textual: string;
    modalidad: "preferente" | "libre_eleccion" | "institucional";
    bloque_id: string;
}

interface SegOutput {
    metadata: { origen: string; fuente: string };
    bloques: Block[];
    asignaciones: Assignment[];
}

// Regex Patterns
const REGEX_PERCENTAGE = /(\d{1,3})\s*%/;
const REGEX_PERCENTAGE_SIN_TOPE = /(\d{1,3})\s*%\s*Sin\s*Tope/i; // FIX 1
const REGEX_CLAUSE = /(solo|exclusivo)\s+cobertura\s+libre\s+elecci[oó]n/i;
const REGEX_TOPE_VALOR = /(\d{1,3}(?:[.,]\d+)?)\s*(UF|veces AC2)/i;

async function runSegmenter() {
    if (!fs.existsSync(INPUT_PATH)) {
        console.error("Input file not found");
        process.exit(1);
    }

    const rawInput = fs.readFileSync(INPUT_PATH, 'utf-8');
    const inputJson = JSON.parse(rawInput);

    // --- PHASE A: INITIAL SEGMENTATION ---
    const output: SegOutput = {
        metadata: {
            origen: "segmentador-bloques",
            fuente: inputJson.metadata?.fuente || "unknown"
        },
        bloques: [],
        asignaciones: []
    };

    let activeModalities: { [key: string]: Block | null } = {
        "preferente": null,
        "libre_eleccion": null
    };

    let splitColumnIndex = 50;
    let globalBlockCounter = 0;

    const allLines = inputJson.lineas;

    for (const linea of allLines) {
        // 1. Modality Detection and Split Column Refinement
        if (linea.tipo === 'cabecera_tabla') {
            const bonifIndices = linea.celdas
                .filter((c: any) => c.texto.toUpperCase().includes("BONIFICACIÓN") || c.texto.toUpperCase().includes("TOPE"))
                .map((c: any) => c.indice_columna);

            if (bonifIndices.length >= 2) {
                splitColumnIndex = (bonifIndices[0] + bonifIndices[bonifIndices.length - 1]) / 2;
            }
        }

        // 2. Process Cells
        if (linea.celdas && linea.celdas.length > 0) {
            let newBlockFound = false;

            for (const celda of linea.celdas) {
                const colIdx = celda.indice_columna;
                const cellText = celda.texto;

                const pctMatch = cellText.match(REGEX_PERCENTAGE);
                const clauseMatch = cellText.match(REGEX_CLAUSE);
                // FIX 1 Check included in pctMatch usually, but explicit check
                const sinTopeMatch = cellText.match(REGEX_PERCENTAGE_SIN_TOPE);

                if (pctMatch || clauseMatch) {
                    const modality = colIdx < splitColumnIndex ? "preferente" : "libre_eleccion";
                    const blockId = (modality === 'preferente' ? "PREF_" : "LE_") + `BLK_${++globalBlockCounter}`;

                    let tipo: any = pctMatch ? "porcentaje" : "clausula_juridica";
                    let excluye = undefined;

                    if (clauseMatch) {
                        tipo = "exclusion_modalidad";
                        excluye = "preferente";
                        // Explicit strict exclusion: Clear active block for this modality
                        activeModalities[modality] = null;

                        // Also clear if we hit a hard section header? 
                        // Handled separately below, but exclusion acts as a blocker.
                    }

                    const newBlock: Block = {
                        bloque_id: blockId,
                        pagina_inicio: linea.pagina,
                        linea_inicio: linea.indice_linea,
                        columna_inicio: colIdx,
                        modalidad: modality,
                        tipo_bloque: tipo,
                        porcentaje: pctMatch ? parseInt(pctMatch[1]) : null,
                        excluye: excluye,
                        tope: {
                            existe: cellText.toUpperCase().includes("SIN TOPE") ? false : null,
                            unidad: null,
                            valor: null,
                            razon: cellText.toUpperCase().includes("SIN TOPE") ? "SIN_TOPE_EXPRESO" : null
                        },
                        texto_fuente: cellText
                    };

                    if (!newBlock.tope.existe) {
                        const topeMatch = cellText.match(REGEX_TOPE_VALOR);
                        if (topeMatch) {
                            newBlock.tope.existe = true;
                            newBlock.tope.valor = parseFloat(topeMatch[1].replace(',', '.'));
                            newBlock.tope.unidad = topeMatch[2];
                        }
                    }

                    output.bloques.push(newBlock);

                    // Update Active Modality State
                    // If it's an exclusion, we already cleared it above, but we track the block itself.
                    // If it's a real block, set it as active.
                    if (tipo !== 'exclusion_modalidad') {
                        activeModalities[modality] = newBlock;
                    }
                    newBlockFound = true;
                }
            }

            // 3. Handle Section Headers (Stop Propagation)
            // If the line is a section header, it cuts off current active blocks.
            // Using a distinct list of major headers.
            const MAJOR_HEADERS = ["TOPES DE BONIFICACION", "VALORIZACION TOPES", "PRESTACIONES DENTALES", "NOTAS EXPLICATIVAS", "AMBULATORIAS"];
            if (linea.texto_plano && MAJOR_HEADERS.some(h => linea.texto_plano.toUpperCase().includes(h))) {
                activeModalities["preferente"] = null;
                activeModalities["libre_eleccion"] = null;
            }

            // 4. Assign Prestation (Vertical Propagation)
            // Only assign if we didn't just find a new block on this line that might be the prestation itself (rare case)
            // Actually, usually prestation is in col 1, block def in col 3.

            const descCell = linea.celdas.find((c: any) => c.indice_columna <= 2 && c.texto.length > 5);
            if (descCell) {
                const prestacion = descCell.texto;

                // Assign to Preferente if active
                if (activeModalities["preferente"]) {
                    output.asignaciones.push({
                        pagina: linea.pagina,
                        indice_linea: linea.indice_linea,
                        prestacion_textual: prestacion,
                        modalidad: "preferente",
                        bloque_id: activeModalities["preferente"]!.bloque_id
                    });
                }

                // Assign to Libre Elección if active
                if (activeModalities["libre_eleccion"]) {
                    output.asignaciones.push({
                        pagina: linea.pagina,
                        indice_linea: linea.indice_linea,
                        prestacion_textual: prestacion,
                        modalidad: "libre_eleccion",
                        bloque_id: activeModalities["libre_eleccion"]!.bloque_id
                    });
                }
            }
        }
    }

    // --- PHASE B: INTERNAL BLOCK DECOMPOSITION ---
    console.log("Starting Phase B: Decomposition...");

    for (const block of output.bloques) {
        // Skip exclusions from decomposition? Usually yes.
        if (block.tipo_bloque === "exclusion_modalidad") continue;

        // PASO 1: Marcar Candidatos
        const tf = block.texto_fuente;
        const hasMultiplePct = (tf.match(/%/g) || []).length > 1;
        const hasProviders = /Clínica|Hospital/i.test(tf);
        const hasConnectors = /\s+en:|\s+con\s+|\(A\.\d\)|Habitación/i.test(tf);

        // REGLA NUEVA: % Sin Tope: + texto posterior (implicit "Sin Tope" header logic for compound)
        let hasColonRule = false;
        if (tf.match(/\d+\s*%\s*Sin\s*Tope\s*:/i)) {
            let startIndex = allLines.findIndex((l: any) => l.pagina === block.pagina_inicio && l.indice_linea === block.linea_inicio);
            if (startIndex !== -1 && startIndex + 1 < allLines.length) {
                const nextLine = allLines[startIndex + 1];
                if (nextLine.tipo !== 'cabecera_tabla' && nextLine.texto_plano.length > 5) {
                    hasColonRule = true;
                }
            }
        }

        // FIX 1: Treat any "% Sin Tope" as potential start of a complex block if providers follow
        // User asked: "Si aparece un nuevo encabezado con patrón (\d+%)\s+Sin\s+Tope 👉 cerrar bloque anterior 👉 abrir bloque nuevo"
        // This is handled in Phase A. 
        // But for Phase B decomposition, we treat blocks as compound if they are likely to contain lists.
        // We will default to checking content.

        if (hasMultiplePct || hasProviders || hasConnectors || hasColonRule) {
            block.tipo_bloque = "bloque_compuesto";
            block.reglas = [];

            // PASO 3: Reconstruir texto extendido
            let expandedText = block.texto_fuente;

            let startIndex = allLines.findIndex((l: any) => l.pagina === block.pagina_inicio && l.indice_linea === block.linea_inicio);

            if (startIndex !== -1) {
                for (let i = startIndex + 1; i < allLines.length; i++) {
                    const nextLine = allLines[i];

                    if (nextLine.tipo === 'cabecera_tabla' || nextLine.tipo === 'titulo') break;

                    const text = nextLine.texto_plano;

                    // FIX 1 & 3: Strict Break on New Block Start
                    // If this line *contains* a new "% Sin Tope" pattern, we stop expansion.
                    if (text.match(REGEX_PERCENTAGE_SIN_TOPE) && nextLine.indice_linea !== block.linea_inicio) break;

                    // Check if Phase A created a new block here (Redundant but safe)
                    const blockStartsHere = output.bloques.some(b =>
                        b.pagina_inicio === nextLine.pagina &&
                        b.linea_inicio === nextLine.indice_linea &&
                        b.modalidad === block.modalidad
                    );
                    if (blockStartsHere) break;

                    if (text.match(/Solo cobertura libre elección/i)) break;

                    // FIX 4 & 5: Broaden Column Search for Content
                    // Instead of strict "block.columna_inicio", we look at the whole "modality zone".
                    // If Preferente, look at cols < splitColumnIndex (mostly 2, 3, 4).
                    // If LE, look at cols > splitColumnIndex.

                    const validCells = nextLine.celdas?.filter((c: any) => {
                        if (block.modalidad === 'preferente') {
                            return c.indice_columna < splitColumnIndex;
                        } else {
                            return c.indice_columna >= splitColumnIndex;
                        }
                    });

                    if (validCells && validCells.length > 0) {
                        for (const cell of validCells) {
                            // Noise Filter: Ignore typical LE noise if we are in Preferente
                            if (block.modalidad === 'preferente') {
                                if (cell.texto.match(/UF|veces AC2|Copago Fijo/i)) continue;
                            }

                            // Prevent mixing with Prestation names in Col 1 if they are clearly prestations?
                            // Usually Col 1 is Prestation. 
                            // But "Clínica Tabancura" might be in Col 2.
                            // We should avoid Col 1 unless it's clearly a provider list overflow.
                            // Risk: Adding "DERECHO DE PABELLON" to the block text?
                            // Check if cell text looks like a provider or part of the rule.
                            // Or relies on "expandedText" cleaning later?
                            // Better: Exclude Col 1 unless it contains provider keywords?

                            if (cell.indice_columna === 1) {
                                if (!cell.texto.match(/Hospital|Clínica|Centro|Red|Médico/i)) continue;
                            }

                            expandedText += " " + cell.texto;
                        }
                    }
                }
            }

            block.texto_expandido = expandedText;

            // PASO 4: Detectar reglas internas
            // We need to support "80% Sin Tope: Prov 1... 70% Sin Tope: Prov 2..."
            // The split regex needs to be careful not to consume the content.
            // Using lookahead or just matching headers and indices.

            const regexRuleStart = /(\d{1,3})\s*%\s*(?:Sin Tope)?/gi;

            let match;
            const matches = [];
            while ((match = regexRuleStart.exec(expandedText)) !== null) {
                matches.push({
                    index: match.index,
                    fullMatch: match[0],
                    pct: parseInt(match[1]),
                    hasSinTope: match[0].toUpperCase().includes("SIN TOPE")
                });
            }

            if (matches.length > 0) {
                for (let m = 0; m < matches.length; m++) {
                    const current = matches[m];
                    const next = matches[m + 1];
                    const ruleText = expandedText.slice(current.index, next ? next.index : undefined);

                    // PASO 4.2: Asociar prestadores
                    const providers: string[] = [];
                    // Update Provider Regex to be more inclusive of "Clínica X" in lists
                    // And handle newlines/commas

                    const providerRegex = /(?:Hospital|Clínica|Centro Médico|Integramédica|Red de Salud)[\w\s\.]+/gi;
                    const providerMatches = ruleText.match(providerRegex);
                    if (providerMatches) {
                        providerMatches.forEach(p => {
                            let clean = p.replace(/[,:;.]+$/, '').trim();
                            clean.split(/,| y /).forEach(sub => {
                                // Clean up "1.5 veces" artifacts if they slipped through
                                if (sub.match(/\d+.*veces/)) return;
                                if (sub.length > 3) providers.push(sub.trim());
                            });
                        });
                    }

                    // PASO 4.3: Submodalidad / Condicion
                    let condicion = "";
                    if (ruleText.includes("(A.1)")) condicion += "A.1 ";
                    if (ruleText.includes("(A.2)")) condicion += "A.2 ";
                    if (ruleText.match(/Habitación Individual/i)) condicion += "Habitación Individual";
                    if (ruleText.match(/Modalidad Institucional/i)) condicion += "Modalidad Institucional";

                    const ruleId = `${block.bloque_id}_R${m + 1}`;

                    block.reglas.push({
                        regla_id: ruleId,
                        porcentaje: current.pct,
                        tope: current.hasSinTope ? "SIN_TOPE" : null,
                        prestadores: [...new Set(providers)],
                        condicion: condicion.trim() || undefined
                    });
                }
            } else {
                // Fallback if no explicit percentage header found in text
                const providers: string[] = [];
                const providerRegex = /(?:Hospital|Clínica|Centro Médico|Integramédica|Red de Salud)[\w\s\.]+/gi;
                const providerMatches = expandedText.match(providerRegex);
                if (providerMatches) {
                    providerMatches.forEach(p => {
                        let clean = p.replace(/[,:;.]+$/, '').trim();
                        clean.split(/,| y /).forEach(sub => {
                            if (sub.length > 3) providers.push(sub.trim());
                        });
                    });
                }

                block.reglas.push({
                    regla_id: `${block.bloque_id}_R1`,
                    porcentaje: block.porcentaje,
                    tope: block.tope.existe === false ? "SIN_TOPE" : null,
                    prestadores: [...new Set(providers)]
                });
            }
        }
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
    console.log("Segmentation (Phase A + B + Fixes) complete.");
}

runSegmenter().catch(e => console.error(e));
