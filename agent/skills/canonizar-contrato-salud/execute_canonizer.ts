import fs from 'fs';
import path from 'path';

// --- INPUT/OUTPUT PATHS ---
const EXTRACTION_PATH = path.join(process.cwd(), 'extraction_result.json');
const EXPANSION_PATH = path.join(process.cwd(), 'expansion_result.json');
const OUTPUT_PATH = path.join(process.cwd(), 'canonical_contract.json');

// --- INTERFACES ---
interface Assignment {
    pagina: number;
    indice_linea: number;
    prestacion_textual: string;
    modalidad: "preferente" | "libre_eleccion" | "institucional";
    bloque_id: string;
}

interface Block {
    bloque_id: string;
    pagina_inicio: number;
    linea_inicio: number;
    modalidad: "preferente" | "libre_eleccion";
    tipo_bloque: string;
    porcentaje: number | null;
    reglas?: Array<{
        porcentaje: number | null;
        tope: string | null;
        prestadores: string[];
        codigo_modalidad?: string;
        condicion?: string;
    }>;
    excluye?: string;
}

interface ExtractionLine {
    pagina: number;
    indice_linea: number;
    tipo: string;
    texto_plano?: string;
    celdas?: Array<{ texto: string; indice_columna: number }>;
}

interface ExpansionData {
    metadata: any;
    bloques: Block[];
    asignaciones: Assignment[];
}

interface Tope {
    tipo: "SIN_TOPE" | "UF" | "AC2" | "VECES_ARANCEL" | "VARIABLE" | "REGLA_FINANCIERA" | null;
    valor?: number | null;
    factor?: number;           // For AC2: the multiplier (0.8, 2.0, etc.)
    sigla?: string;
    origen?: string;
    sin_tope_adicional?: boolean;  // True when AC2 is the only limit (no UF cap)
}

interface Contexto {
    modalidad_base: "preferente" | "libre_eleccion";
    tiene_libre_eleccion: boolean;
    porcentaje_le: number | null;
    origen_porcentaje_le?: "explicit" | "implicit_global" | "inherited";
    heredada_desde?: string;
    texto_origen?: string;
    origen_herencia: "explicit" | "inherited";
}

interface PreferentePath {
    path_id: string;            // e.g. "PREF_A", "PREF_B", "PREF_C" o el mismo bloque_id
    modalidad_codigo?: string;  // A.1 / A.2
    porcentaje: number | null;
    tope: Tope;
    prestadores: string[];
    condiciones: string[];
    fuente: { pagina: number; linea_inicio: number; linea_fin: number };
}

interface LineaPrestacion {
    linea_id: string;
    tipo: "seccion" | "prestacion" | "header_seccion" | "subtitulo";
    nombre: string;
    id_logica: string;
    contexto?: Contexto;
    preferente: {
        aplica: boolean;
        paths: string[];
    };
    libre_eleccion: {
        aplica: boolean;
        porcentaje: number | null;
        tope: Tope;
        heredado: boolean;
        razon_excluido?: string;
    };
    nfe: {
        aplica: boolean;
        valor: number | null;
        unidad: "UF" | null;
        bloque_id: string;
        razon?: string;
        fuente_linea: string;
        clausula_activa?: boolean;
    };
    fuente_visual: {
        pagina: number;
        fila: number;
    };
}

interface LineaEncabezado {
    linea_id: string;
    tipo: "encabezado" | "fase_logica";
    texto: string;
    efecto?: {
        tipo: "cambio_modalidad" | "definicion_regimen";
        nueva_modalidad?: "libre_eleccion" | "preferente";
        porcentaje?: number;
    };
    fuente_visual: {
        pagina: number;
        fila: number;
    };
}

type Linea = LineaPrestacion | LineaEncabezado;

// --- UTILS ---
function cleanProviderName(name: string): string | null {
    if (!name) return null;
    const noisePatterns = [
        /\bHONORARIOS\b/gi, /\bHOSPITALARIOS\b/gi, /\bAMBULATORIOS\b/gi,
        /\bQUIRÚRGICOS\b/gi, /\bHOSPITALARIO\b/gi, /\bAMBULATORIO\b/gi,
        /\bMÉDICOS\b/gi
    ];
    let clean = name;
    for (const pattern of noisePatterns) { clean = clean.replace(pattern, '').trim(); }
    clean = clean.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 3) return null;
    const upper = clean.toUpperCase();
    if (["SIN TOPE", "UF"].some(n => upper.includes(n))) return null;
    return clean;
}

function parseVecesAC2(text: string): number | null {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*veces\s*AC2/i);
    if (!match) return null;
    return Number(match[1].replace(",", "."));
}

function computePreferenteSpans(bloques: Block[], stoppersByPage: Map<number, number[]>) {
    const pref = bloques.filter(b => b.modalidad === "preferente" && b.reglas && b.reglas.length > 0);
    const spanById = new Map<string, { pagina: number; ini: number; fin: number }>();
    for (const cur of pref) {
        const pageStoppers = stoppersByPage.get(cur.pagina_inicio) || [];
        const nextStopper = pageStoppers.find(s => s > cur.linea_inicio);
        const fin = nextStopper ? nextStopper - 1 : 9999;
        spanById.set(cur.bloque_id, { pagina: cur.pagina_inicio, ini: cur.linea_inicio, fin });
    }
    return spanById;
}

interface NfeBlock {
    bloque_id: string;
    pagina: number;
    linea_inicio: number;
    linea_fin: number; // For cartography
    valor: number | null;
    razon?: string;
}

// ============================================================================
// RE-EXPANSION OPERATOR: FORMAL IMPLEMENTATION
// ============================================================================

type BlockEffect = "LIMITANTE" | "NEUTRO" | "EXPANSIVO";

interface OptionNode {
    id: string;
    tipo: "preferente" | "libre_eleccion";
    porcentaje: number | null;
    tope: Tope | string;
    prestadores: string[] | "red_abierta";
    condiciones: string[];
    path_id?: string;
    estado: "ACTIVA" | "LATENTE";
}

interface NonLinearLineState {
    prestacion_id: string;
    opciones_activas: Map<string, OptionNode>;
    opciones_latentes: Map<string, OptionNode>;
    restricciones: Array<{ tipo: string; valor: any; origen: string }>;
    historial_bloques: string[];
    nfe_activo: NfeBlock | null;
}

function classifyBlockEffect(text: string): BlockEffect {
    const upper = text.toUpperCase().trim();

    // EXPANSIVO: Re-enables options
    if (upper.includes("SIN TOPE") || upper === "SIN LÍMITE" || upper === "SIN RESTRICCIÓN") {
        return "EXPANSIVO";
    }

    // LIMITANTE: Reduces options with specific caps
    if (upper.match(/\\d+\\s*(UF|VECES|AC2)/) || upper.includes("TOPE") && !upper.includes("SIN TOPE")) {
        return "LIMITANTE";
    }

    // NEUTRO: Headers, labels, informational
    return "NEUTRO";
}

/**
 * RE Operator: Applies block effect to current state
 * RE(B, S, M) → S'
 * 
 * - LIMITANTE: Moves affected options from activas to latentes
 * - NEUTRO: No change
 * - EXPANSIVO: Moves affected options from latentes back to activas
 */
function applyReExpansion(
    block: { effect: BlockEffect; restriccion?: any; origen: string },
    state: NonLinearLineState
): NonLinearLineState {
    const newState = { ...state };

    switch (block.effect) {
        case "LIMITANTE":
            // Add restriction, options remain but are constrained
            if (block.restriccion) {
                newState.restricciones = [...state.restricciones, {
                    tipo: block.restriccion.tipo,
                    valor: block.restriccion.valor,
                    origen: block.origen
                }];
            }
            newState.historial_bloques = [...state.historial_bloques, block.origen];
            break;

        case "EXPANSIVO":
            // RE-EXPANSION: Move latent options back to active
            // This is the KEY operation that was missing
            for (const [id, option] of state.opciones_latentes) {
                option.estado = "ACTIVA";
                newState.opciones_activas.set(id, option);
            }
            newState.opciones_latentes = new Map();
            newState.historial_bloques = [...state.historial_bloques, block.origen];
            break;

        case "NEUTRO":
            // No change to options
            break;
    }

    return newState;
}

/**
 * Creates initial NonLinearLineState for a prestation
 */
function initializeLineState(prestacionId: string): NonLinearLineState {
    return {
        prestacion_id: prestacionId,
        opciones_activas: new Map(),
        opciones_latentes: new Map(),
        restricciones: [],
        historial_bloques: [],
        nfe_activo: null
    };
}

// ============================================================================
// OPERADOR DE COBERTURA: Formal Definition
// ============================================================================

interface OperadorCobertura {
    tipo: "expand" | "contraer" | "reexpandir";
    ambito: "prestacion" | "grupo_prestaciones" | "global";
    efecto: {
        porcentaje?: number;
        tope?: Tope | "SIN_TOPE";
    };
    condicion_aplicacion: {
        prestaciones_afectadas?: string[];
        columna_origen: string;
    };
    fuente_visual: {
        pagina: number;
        columna: number;
        filas: [number, number];
    };
}

interface TopeActivo {
    tipo: "AC2" | "UF" | "NFE" | "VECES_ARANCEL" | "REGLA_FINANCIERA";
    valor: number | null;
    factor?: number;
    estado: "ACTIVO" | "SIN_TOPE" | "LIMITADO";
    origen: string;
    ambito: "por_prestacion" | "anual_beneficiario";
}

/**
 * Builds the topes_activos stack for a prestation
 * AC2 and NFE coexist as separate layers
 */
function buildTopesStack(
    leTopeTope: Tope | null,
    nfeBlock: NfeBlock | null,
    lineaId: string
): TopeActivo[] {
    const stack: TopeActivo[] = [];

    // Layer 1: AC2 (per-prestation limit from LE)
    if (leTopeTope && leTopeTope.tipo === "AC2") {
        stack.push({
            tipo: "AC2",
            valor: null,
            factor: leTopeTope.factor,
            estado: "ACTIVO",
            origen: leTopeTope.origen || lineaId,
            ambito: "por_prestacion"
        });
    } else if (leTopeTope && leTopeTope.tipo === "UF") {
        stack.push({
            tipo: "UF",
            valor: leTopeTope.valor || null,
            estado: "LIMITADO",
            origen: leTopeTope.origen || lineaId,
            ambito: "por_prestacion"
        });
    }

    // Layer 2: NFE (annual beneficiary limit) - ALWAYS SEPARATE
    if (nfeBlock) {
        stack.push({
            tipo: "NFE",
            valor: nfeBlock.valor,
            estado: nfeBlock.razon === "SIN_TOPE_EXPRESO" ? "SIN_TOPE" : "LIMITADO",
            origen: `L${nfeBlock.pagina}_${nfeBlock.linea_inicio}`,
            ambito: "anual_beneficiario"
        });
    }

    return stack;
}

// ============================================================================
// OPERADOR APLICADO: Dynamic RE Operator History
// ============================================================================

interface OperadorAplicado {
    secuencia: number;
    bloque_id: string;
    tipo_efecto: BlockEffect;
    descripcion: string;
    restriccion_nueva?: {
        tipo: string;
        valor: any;
        ambito: string;
    };
    opciones_afectadas: {
        reactivadas: string[];
        restringidas: string[];
    };
    fuente: string;
}

/**
 * Builds the operadores_aplicados history for a prestation
 * This shows the SEQUENCE of RE operator applications
 */
function buildOperadoresHistorial(
    leTope: Tope | null,
    nfeBlock: NfeBlock | null,
    lineaId: string,
    pathIds: string[]
): OperadorAplicado[] {
    const historial: OperadorAplicado[] = [];
    let seq = 0;

    // Step 1: Base state - all preferente paths are ACTIVA
    // (This is implicit, no operator needed)

    // Step 2: If AC2/UF tope exists, it's a LIMITANTE operator
    if (leTope && (leTope.tipo === "AC2" || leTope.tipo === "UF")) {
        seq++;
        historial.push({
            secuencia: seq,
            bloque_id: leTope.origen || lineaId,
            tipo_efecto: "LIMITANTE",
            descripcion: leTope.tipo === "AC2"
                ? `Tope por evento: ${leTope.factor} veces AC2`
                : `Tope por evento: ${leTope.valor} UF`,
            restriccion_nueva: {
                tipo: leTope.tipo,
                valor: leTope.tipo === "AC2" ? leTope.factor : leTope.valor,
                ambito: "por_prestacion"
            },
            opciones_afectadas: {
                reactivadas: [],
                restringidas: ["libre_eleccion"]  // LE is now constrained
            },
            fuente: leTope.origen || lineaId
        });
    }

    // Step 3: If NFE block exists, classify and apply RE operator
    if (nfeBlock) {
        seq++;
        const isExpansivo = nfeBlock.razon === "SIN_TOPE_EXPRESO";

        historial.push({
            secuencia: seq,
            bloque_id: nfeBlock.bloque_id,
            tipo_efecto: isExpansivo ? "EXPANSIVO" : "LIMITANTE",
            descripcion: isExpansivo
                ? "RE-EXPANSIÓN: Tope anual NFE eliminado (SIN TOPE)"
                : `Tope anual NFE: ${nfeBlock.valor} UF`,
            restriccion_nueva: {
                tipo: "NFE",
                valor: isExpansivo ? null : nfeBlock.valor,
                ambito: "anual_beneficiario"
            },
            opciones_afectadas: {
                // EXPANSIVO reactivates all paths that were latent due to annual limits
                reactivadas: isExpansivo ? [...pathIds, "libre_eleccion"] : [],
                restringidas: isExpansivo ? [] : [...pathIds, "libre_eleccion"]
            },
            fuente: `L${nfeBlock.pagina}_${nfeBlock.linea_inicio}`
        });
    }

    return historial;
}

function computeNfeBlocks(lineas: ExtractionLine[], stoppersByPage: Map<number, number[]>): NfeBlock[] {
    const blocks: NfeBlock[] = [];
    const nfePointsByPage = new Map<number, { linea: number; valor: number | null; razon?: string }[]>();

    // 1. Collect all explicit NFE points
    for (const line of lineas) {
        if (!line.celdas) continue;
        for (const cell of line.celdas) {
            if (cell.indice_columna >= 5) {
                const text = cell.texto?.trim();
                if (!text) continue;
                const upperText = text.toUpperCase();

                let found: { valor: number | null; razon?: string } | null = null;
                if (upperText.includes("SIN TOPE")) {
                    found = { valor: null, razon: "SIN_TOPE_EXPRESO" };
                } else {
                    const ac2Match = text.match(/[\d+[.,]?\d*]*\s*veces\s*AC2/i);
                    let textToScan = text;
                    if (ac2Match) {
                        textToScan = text.replace(ac2Match[0], "");
                    }

                    const isModality = !!textToScan.match(/\(A\.\d\)/) || !!textToScan.match(/A\.\d/);

                    if (!isModality) {
                        const numMatch = textToScan.match(/(\d+[.,]?\d*)/);
                        if (numMatch) {
                            found = { valor: Number(numMatch[1].replace(",", ".")), razon: undefined };
                        }
                    }
                }

                if (found) {
                    if (!nfePointsByPage.has(line.pagina)) nfePointsByPage.set(line.pagina, []);
                    nfePointsByPage.get(line.pagina)!.push({ linea: line.indice_linea, ...found });
                    break;
                }
            }
        }
    }

    // 2. Expand points into DOMINANT BLOCKS (Cartography)
    // A "Sin Tope" block dominates its section. It should expand UPWARDS to the section start (stopper)
    // and DOWNWARDS to the section end or next block.
    for (const [pagina, points] of nfePointsByPage.entries()) {
        const pageStoppers = stoppersByPage.get(pagina) || [];
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const prevP = points[i - 1];
            const nextP = points[i + 1];

            // Find section boundaries
            const sectionStart = [...pageStoppers].reverse().find(s => s <= p.linea) || 0;
            const sectionEnd = pageStoppers.find(s => s > p.linea) || 9999;

            // Determine Start Line
            let startLine = p.linea;
            // If this is the first point in the section, it dominates from the start of the section
            if (!prevP || prevP.linea < sectionStart) {
                startLine = sectionStart;
            } else {
                // If there is a previous point in the same section, we start just after it (or halfway?)
                // Standard logic: Blocks divide the space. Let's make it start just after previous block's end?
                // Or simply: start at definition line if not first.
                // But typically NFE headers are at the top or spanning.
                // For this contract, "Sin Tope" is often centrally placed or at top.
                startLine = prevP.linea + 1;
            }

            // Determine End Line
            const nextBlockStart = nextP ? nextP.linea : 9999;
            const endLine = Math.min(sectionEnd, nextBlockStart - 1);

            blocks.push({
                bloque_id: `NFE_${pagina}_${p.linea}`,
                pagina: pagina,
                linea_inicio: startLine,
                linea_fin: endLine,
                valor: p.valor,
                razon: p.razon
            });
        }
    }

    return blocks;
}

// Helper to parse tope from string
function parseTope(topeStr: string | null, lineId: string): Tope {
    if (!topeStr) return { tipo: "SIN_TOPE" };
    const upperTope = topeStr.toUpperCase();
    if (upperTope.includes("SIN TOPE")) return { tipo: "SIN_TOPE" };
    if (upperTope.includes("UF")) return { tipo: "UF" };
    const ac2Factor = parseVecesAC2(topeStr);
    if (ac2Factor !== null) {
        return { tipo: "AC2", factor: ac2Factor, origen: lineId, sin_tope_adicional: true };
    }
    return { tipo: "VARIABLE" };
}

// --- MAIN FUNCTION ---
async function runCanonizer() {
    if (!fs.existsSync(EXTRACTION_PATH) || !fs.existsSync(EXPANSION_PATH)) {
        console.error("❌ Error: Input files missing");
        process.exit(1);
    }

    const extractionData = JSON.parse(fs.readFileSync(EXTRACTION_PATH, 'utf-8'));
    const expansionData: ExpansionData = JSON.parse(fs.readFileSync(EXPANSION_PATH, 'utf-8'));

    const output = {
        contrato: {
            metadata: {
                fuente: extractionData.metadata?.fuente || "unknown",
                tipo: "salud_isapre",
                fecha_procesamiento: new Date().toISOString()
            },
            tabla_prestaciones: {
                ambito: "Hospitalarias y Cirugía Mayor Ambulatoria",
                herencia_vertical: true,
                oferta_preferente_paths: [] as PreferentePath[],
                lineas: [] as Linea[]
            }
        }
    };

    const asigByLine = new Map<string, Assignment[]>();
    for (const asig of expansionData.asignaciones) {
        const key = `${asig.pagina}_${asig.indice_linea}`;
        if (!asigByLine.has(key)) asigByLine.set(key, []);
        asigByLine.get(key)!.push(asig);
    }

    const stoppersByPage = new Map<number, number[]>();
    for (const line of (extractionData.lineas as ExtractionLine[])) {
        if (line.tipo === 'cabecera_tabla' || line.tipo === 'titulo_seccion') {
            if (!stoppersByPage.has(line.pagina)) stoppersByPage.set(line.pagina, []);
            stoppersByPage.get(line.pagina)!.push(line.indice_linea);
        }
    }

    const prefSpanById = computePreferenteSpans(expansionData.bloques, stoppersByPage);
    const nfeBlocks = computeNfeBlocks(extractionData.lineas, stoppersByPage);

    const preferentePathsById = new Map<string, PreferentePath>();
    const blockIdToPathIds = new Map<string, string[]>();

    for (const b of expansionData.bloques) {
        if (b.modalidad !== "preferente" || !b.reglas?.length) continue;
        const span = prefSpanById.get(b.bloque_id);
        if (!span) continue;
        if (!blockIdToPathIds.has(b.bloque_id)) blockIdToPathIds.set(b.bloque_id, []);
        b.reglas.forEach((r, idx) => {
            const pathId = `${b.bloque_id}_R${idx}`;
            const prestadores = new Set<string>();
            for (const p of r.prestadores) {
                const c = cleanProviderName(p);
                if (c) prestadores.add(c.toUpperCase().trim());
            }
            const path: PreferentePath = {
                path_id: pathId,
                modalidad_codigo: r.codigo_modalidad,
                porcentaje: r.porcentaje ?? b.porcentaje,
                tope: parseTope(r.tope, b.bloque_id),
                prestadores: Array.from(prestadores).sort(),
                condiciones: r.condicion ? [r.condicion] : [],
                fuente: { pagina: span.pagina, linea_inicio: span.ini, linea_fin: span.fin }
            };
            preferentePathsById.set(pathId, path);
            blockIdToPathIds.get(b.bloque_id)!.push(pathId);
        });
    }

    output.contrato.tabla_prestaciones.oferta_preferente_paths = Array.from(preferentePathsById.values());

    function preferentePathsForLine(pagina: number, indice_linea: number): string[] {
        const allPaths: string[] = [];
        const pageStoppers = stoppersByPage.get(pagina) || [];
        for (const [blockId, span] of prefSpanById.entries()) {
            if (span.pagina === pagina) {
                if (indice_linea >= span.ini && indice_linea <= span.fin) {
                    const paths = blockIdToPathIds.get(blockId) || [];
                    allPaths.push(...paths);
                } else if (indice_linea < span.ini) {
                    const prevStopperForLine = [...pageStoppers].reverse().find(s => s <= indice_linea);
                    const prevStopperForBlock = [...pageStoppers].reverse().find(s => s <= span.ini);
                    if (prevStopperForLine === prevStopperForBlock && (span.ini - indice_linea) <= 8) {
                        const paths = blockIdToPathIds.get(blockId) || [];
                        allPaths.push(...paths);
                    }
                }
            }
        }
        return allPaths;
    }

    function getNfeForLine(pagina: number, indice_linea: number): LineaPrestacion['nfe'] {
        const pageStoppers = stoppersByPage.get(pagina) || [];
        const prevStopper = [...pageStoppers].reverse().find(s => s <= indice_linea);

        // Find candidate NFE points (same page, same section)
        const candidates = nfeBlocks.filter(b => b.pagina === pagina);
        if (candidates.length === 0) return { aplica: false, valor: null, unidad: null, bloque_id: "NONE", fuente_linea: "NONE" };

        let bestNfe: NfeBlock | null = null;
        let minDistance = 9999;

        for (const b of candidates) {
            const stopperForBlock = [...pageStoppers].reverse().find(s => s <= b.linea_inicio);
            if (stopperForBlock !== prevStopper) continue;

            const distance = Math.abs(b.linea_inicio - indice_linea);

            // Prioritize local match
            if (distance < minDistance) {
                minDistance = distance;
                bestNfe = b;
            }
        }

        if (bestNfe && minDistance <= 8) {
            return {
                aplica: true,
                valor: bestNfe.valor,
                unidad: bestNfe.valor !== null ? "UF" : null,
                bloque_id: bestNfe.bloque_id,
                razon: bestNfe.razon,
                fuente_linea: `L${bestNfe.pagina}_${bestNfe.linea_inicio}`,
                clausula_activa: bestNfe.razon === "SIN_TOPE_EXPRESO"
            };
        }

        return { aplica: false, valor: null, unidad: null, bloque_id: "NONE", fuente_linea: "NONE" };
    }

    let lastHeaderId: string = "ROOT";
    let lastHeaderText: string = "INICIO CONTRATO";
    const state = {
        modalidad_base: "preferente" as "preferente" | "libre_eleccion",
        tiene_libre_eleccion: true,
        porcentaje_le: 90,
        regla_financiera_le: null as { tipo: "AC2"; factor: number; origen: string; sin_tope_adicional: boolean } | null
    };

    for (const rawLine of (extractionData.lineas as ExtractionLine[])) {
        const key = `${rawLine.pagina}_${rawLine.indice_linea}`;
        const asigs = asigByLine.get(key) || [];
        const textoLimpio = rawLine.texto_plano?.trim() || "";
        const lineId = `L${rawLine.pagina}_${rawLine.indice_linea}`;

        const isExclusionPhrase = textoLimpio.match(/Solo cobertura libre elección/i);
        const isLEHeading = textoLimpio.match(/LIBRE ELECCIÓN/i) && !textoLimpio.match(/OFERTA PREFERENTE/i);

        if (isExclusionPhrase || isLEHeading) {
            state.modalidad_base = "libre_eleccion";
            lastHeaderId = lineId; lastHeaderText = textoLimpio;
            const factorAC2 = parseVecesAC2(textoLimpio);
            if (factorAC2 !== null) { state.regla_financiera_le = { tipo: "AC2", factor: factorAC2, origen: lineId, sin_tope_adicional: true }; }
            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId, tipo: "fase_logica", texto: textoLimpio,
                efecto: { tipo: "cambio_modalidad", nueva_modalidad: "libre_eleccion", porcentaje: 90 },
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
            continue;
        }

        if (textoLimpio.match(/OFERTA PREFERENTE|¿QUÉ ES UN PLAN PREFERENTE?/i) && !asigs.length) {
            state.modalidad_base = "preferente"; state.regla_financiera_le = null;
            lastHeaderId = lineId; lastHeaderText = textoLimpio;
            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId, tipo: "encabezado", texto: textoLimpio,
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
            continue;
        }

        const possibleRule = asigs.length > 0 ? asigs[0].prestacion_textual : textoLimpio;
        const factorAC2 = parseVecesAC2(possibleRule);
        if (factorAC2 !== null) { state.regla_financiera_le = { tipo: "AC2", factor: factorAC2, origen: lineId, sin_tope_adicional: true }; continue; }

        if (asigs.length > 0) {
            const prestacionName = asigs[0].prestacion_textual;
            const prefAsigs = asigs.filter(a => a.modalidad === 'preferente');
            const isExcluded = prefAsigs.some(a => expansionData.bloques.find(b => b.bloque_id === a.bloque_id)?.tipo_bloque === 'exclusion_modalidad');

            if (isExcluded) {
                lastHeaderId = lineId; lastHeaderText = `EXCLUSIÓN PREFERENTE: ${prestacionName}`;
                output.contrato.tabla_prestaciones.lineas.push({
                    linea_id: lineId, tipo: "fase_logica", texto: lastHeaderText,
                    efecto: { tipo: "cambio_modalidad", nueva_modalidad: "libre_eleccion" },
                    fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
                });
                state.modalidad_base = "libre_eleccion"; state.regla_financiera_le = null; continue;
            }

            const pathsAplicables = (state.modalidad_base === "preferente") ? preferentePathsForLine(rawLine.pagina, rawLine.indice_linea) : [];
            let rowTopeLE: Tope | null = null;

            // FORENSIC: Active Block NFE State Logic
            // Check if this line is covered by an expanding Active Block
            let nfeStatus: LineaPrestacion['nfe'] = { aplica: false, valor: null, unidad: null, bloque_id: "NONE", fuente_linea: "NONE" };

            // 1. Is there a dominant active block from the cartography?
            // The active block should have been determined by the loop logic
            const pageBlocks = nfeBlocks.filter(b => b.pagina === rawLine.pagina);
            // Find ALL matching blocks
            const matchingBlocks = pageBlocks.filter(b => rawLine.indice_linea >= b.linea_inicio && rawLine.indice_linea <= b.linea_fin);

            let activeBlock: NfeBlock | undefined;

            if (matchingBlocks.length > 0) {
                // Priority Rule: "SIN_TOPE_EXPRESO" overrides numerical artifacts in overlaps
                // Sort so that Sin Tope comes first
                matchingBlocks.sort((a, b) => {
                    if (a.razon === "SIN_TOPE_EXPRESO" && b.razon !== "SIN_TOPE_EXPRESO") return -1;
                    if (b.razon === "SIN_TOPE_EXPRESO" && a.razon !== "SIN_TOPE_EXPRESO") return 1;

                    // Secondary sort: Proximity of definition line?
                    // If multiple SAME types, maybe closest definition wins?
                    const distA = Math.abs(a.linea_inicio - rawLine.indice_linea); // Actually definition is mostly at start or end?
                    // "p.linea" is not stored in block directly, but usually start or end.
                    // Let's just assume definition line is what created the block.
                    // For now, Sin Tope priority is the key fix.
                    return 0;
                });
                activeBlock = matchingBlocks[0];
            }

            if (activeBlock) {
                nfeStatus = {
                    aplica: true,
                    valor: activeBlock.valor,
                    unidad: activeBlock.valor !== null ? "UF" : null,
                    bloque_id: activeBlock.bloque_id,
                    razon: activeBlock.razon,
                    fuente_linea: `L${activeBlock.pagina}_${activeBlock.linea_inicio}`,
                    clausula_activa: activeBlock.razon === "SIN_TOPE_EXPRESO"
                };
            } else {
                // Fallback to proximity
                nfeStatus = getNfeForLine(rawLine.pagina, rawLine.indice_linea);
            }

            if (rawLine.celdas) {
                for (const cell of rawLine.celdas) {
                    const ct = cell.texto?.trim() || "";
                    const fAC2 = parseVecesAC2(ct);
                    if (fAC2 !== null) { rowTopeLE = { tipo: "AC2", factor: fAC2, origen: lineId, sin_tope_adicional: true }; }
                }
            }

            // Generate Logical ID for Traceability
            const logicalId = `LOG_${rawLine.pagina}_${rawLine.indice_linea}_${asigs[0].prestacion_textual.substring(0, 3)}`;

            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId,
                id_logica: logicalId,
                tipo: "prestacion",
                nombre: prestacionName,
                contexto: {
                    modalidad_base: state.modalidad_base, tiene_libre_eleccion: true, porcentaje_le: state.porcentaje_le,
                    origen_porcentaje_le: state.porcentaje_le === 90 ? "implicit_global" : "explicit",
                    heredada_desde: lastHeaderId, texto_origen: lastHeaderText,
                    origen_herencia: pathsAplicables.length > 0 ? "explicit" : "inherited"
                },
                preferente: { aplica: !isExcluded, paths: pathsAplicables },
                libre_eleccion: {
                    aplica: true, porcentaje: state.porcentaje_le,
                    tope: rowTopeLE || state.regla_financiera_le || { tipo: "VARIABLE" },
                    heredado: !rowTopeLE && !state.regla_financiera_le
                },
                nfe: nfeStatus,
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
        } else if (rawLine.tipo === 'cabecera_tabla' || (textoLimpio.length > 3 && textoLimpio.length < 100)) {
            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId, tipo: "encabezado", texto: textoLimpio,
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
        }
    }

    // --- CONSOLIDATION WITH NON-LINEAR STATE ---
    interface Opcion {
        modalidad: "preferente" | "libre_eleccion";
        grupo_decisional: "OFERTA_PREFERENTE" | "LIBRE_ELECCION";
        subtipo?: string;
        prestadores: string[] | "red_abierta" | "red_preferente";
        porcentaje: number | null;
        tope: Tope | string;
        condiciones: string[];
        estado_opcion: "ACTIVA" | "LATENTE";  // RE Operator tracking
        estado_decisional: "NO_RESUELTA";
        requiere: string[];
        fuente: string[];
    }
    interface PrestacionConsolidada {
        nombre: string;
        ambito: string;
        opciones: Opcion[];  // All options including latent
        topes_activos: TopeActivo[];  // STACK: AC2 + NFE coexist as separate layers
        operadores_aplicados: OperadorAplicado[];  // RE Operator application history
        estado_grafo: {
            opciones_activas: number;
            opciones_latentes: number;
            ultimo_bloque_aplicado?: string;
        };
        nfe_resumen: LineaPrestacion['nfe'];
        decision_final: "PENDIENTE_CUENTA_PACIENTE";
    }

    const consolidationMap = new Map<string, PrestacionConsolidada>();
    function normalizeName(name: string): string { return name.toUpperCase().replace(/[^\wÀ-ÿ\s]/g, '').replace(/\s+/g, ' ').trim(); }

    for (const linea of output.contrato.tabla_prestaciones.lineas) {
        if (linea.tipo !== 'prestacion') continue;
        const prestLinea = linea as LineaPrestacion;
        const normalizedName = normalizeName(prestLinea.nombre);

        if (!consolidationMap.has(normalizedName)) {
            consolidationMap.set(normalizedName, {
                nombre: prestLinea.nombre,
                ambito: "hospitalario",
                opciones: [],
                topes_activos: [],
                operadores_aplicados: [],  // RE Operator history
                estado_grafo: { opciones_activas: 0, opciones_latentes: 0 },
                nfe_resumen: prestLinea.nfe,
                decision_final: "PENDIENTE_CUENTA_PACIENTE"
            });
        }
        const consolidated = consolidationMap.get(normalizedName)!;
        if (prestLinea.nfe.aplica && !consolidated.nfe_resumen.aplica) {
            consolidated.nfe_resumen = prestLinea.nfe;
        }

        // Build topes_activos stack from this line's data
        const leTopeForStack = prestLinea.libre_eleccion.tope && typeof prestLinea.libre_eleccion.tope === 'object' ? prestLinea.libre_eleccion.tope : null;
        const nfeBlockForStack = prestLinea.nfe.aplica ? {
            pagina: prestLinea.fuente_visual.pagina,
            linea_inicio: prestLinea.fuente_visual.fila,
            linea_fin: prestLinea.fuente_visual.fila,
            valor: prestLinea.nfe.valor,
            razon: prestLinea.nfe.razon,
            bloque_id: prestLinea.nfe.bloque_id
        } as NfeBlock : null;
        const lineTopesStack = buildTopesStack(leTopeForStack, nfeBlockForStack, prestLinea.linea_id);

        // Merge into consolidated topes_activos (avoid duplicates by tipo+ambito)
        for (const newTope of lineTopesStack) {
            const existing = consolidated.topes_activos.find(t => t.tipo === newTope.tipo && t.ambito === newTope.ambito);
            if (!existing) {
                consolidated.topes_activos.push(newTope);
            }
        }

        // Build operadores_aplicados historial (RE Operator sequence)
        // Only build once per prestation (first line encounter)
        if (consolidated.operadores_aplicados.length === 0) {
            const pathIds = prestLinea.preferente.paths || [];
            const operadoresHistorial = buildOperadoresHistorial(
                leTopeForStack,
                nfeBlockForStack,
                prestLinea.linea_id,
                pathIds
            );
            consolidated.operadores_aplicados = operadoresHistorial;

            // Update estado_grafo with last applied block
            if (operadoresHistorial.length > 0) {
                consolidated.estado_grafo.ultimo_bloque_aplicado = operadoresHistorial[operadoresHistorial.length - 1].bloque_id;
            }
        }

        if (prestLinea.preferente.aplica && prestLinea.preferente.paths.length > 0) {
            for (const pathId of prestLinea.preferente.paths) {
                const pathBlock = preferentePathsById.get(pathId);
                if (!pathBlock) continue;

                // Determine if this option should be ACTIVA or LATENTE based on NFE block effect
                const nfeEffect = prestLinea.nfe.razon === "SIN_TOPE_EXPRESO" ? "EXPANSIVO" : "NEUTRO";
                const optionEstado: "ACTIVA" | "LATENTE" = nfeEffect === "EXPANSIVO" ? "ACTIVA" : "ACTIVA";

                const newOpcion: Opcion = {
                    modalidad: "preferente",
                    grupo_decisional: "OFERTA_PREFERENTE",
                    subtipo: pathBlock.modalidad_codigo || "institucional",
                    prestadores: pathBlock.prestadores,
                    porcentaje: pathBlock.porcentaje,
                    tope: pathBlock.tope.tipo || "SIN_TOPE",
                    condiciones: pathBlock.condiciones,
                    estado_opcion: optionEstado,
                    estado_decisional: "NO_RESUELTA",
                    requiere: ["prestador_real", "prestacion_facturada", "modalidad_aplicada_en_cuenta"],
                    fuente: [prestLinea.linea_id]
                };
                const existing = consolidated.opciones.find(o => o.modalidad === "preferente" && JSON.stringify(o.prestadores) === JSON.stringify(newOpcion.prestadores) && o.porcentaje === newOpcion.porcentaje && o.tope === newOpcion.tope);
                if (existing) { if (!existing.fuente.includes(prestLinea.linea_id)) existing.fuente.push(prestLinea.linea_id); }
                else { consolidated.opciones.push(newOpcion); consolidated.estado_grafo.opciones_activas++; }
            }
        }
        if (prestLinea.libre_eleccion.aplica && prestLinea.libre_eleccion.porcentaje) {
            const existingLE = consolidated.opciones.find(o => o.modalidad === "libre_eleccion");
            if (existingLE) { if (!existingLE.fuente.includes(prestLinea.linea_id)) existingLE.fuente.push(prestLinea.linea_id); }
            else {
                consolidated.opciones.push({
                    modalidad: "libre_eleccion",
                    grupo_decisional: "LIBRE_ELECCION",
                    prestadores: "red_abierta",
                    porcentaje: prestLinea.libre_eleccion.porcentaje,
                    tope: prestLinea.libre_eleccion.tope,
                    condiciones: [],
                    estado_opcion: "ACTIVA",
                    estado_decisional: "NO_RESUELTA",
                    requiere: ["prestador_real", "prestacion_facturada", "modalidad_aplicada_en_cuenta"],
                    fuente: [prestLinea.linea_id]
                });
                consolidated.estado_grafo.opciones_activas++;
            }
        }
    }

    const outputWithConsolidation = { ...output, prestaciones_consolidadas: Array.from(consolidationMap.values()).filter(p => p.opciones.length > 0) };

    // --- AUDIT SCHEMA ---
    const auditSchema = { agrupaciones_clinicas: [] as any[], definiciones: [] as any[] };
    const urgenciaVariants: string[] = [];
    const consultaVariants: string[] = [];

    auditSchema.definiciones = outputWithConsolidation.prestaciones_consolidadas.map(p => {
        let ambito: "hospitalario" | "ambulatorio" = "hospitalario";
        const upperName = p.nombre.toUpperCase();
        if (upperName.includes("AMBULATORIO") || upperName.includes("CONSULTA") || upperName.includes("VISITA")) { ambito = "ambulatorio"; }
        if (upperName.includes("URGENCIA")) { urgenciaVariants.push(p.nombre); }
        if (upperName.includes("CONSULTA")) { consultaVariants.push(p.nombre); }

        const reglasFinancieras = [];
        for (const opt of p.opciones) {
            if (opt.modalidad === 'libre_eleccion' && typeof opt.tope === 'object' && opt.tope.tipo === 'AC2') {
                reglasFinancieras.push({ tipo: "TOPE_ARANCELARIO", factor: opt.tope.factor, unidad: "AC2", origen: opt.tope.origen });
            }
        }
        return {
            nombre_norm: p.nombre, ambito: ambito,
            agrupacion: upperName.includes("URGENCIA") ? "ATENCIÓN DE URGENCIA" : undefined,
            delta_nfe: {
                aplica: p.nfe_resumen.aplica,
                valor: p.nfe_resumen.valor,
                razon: p.nfe_resumen.razon,
                fuente: [p.nfe_resumen.fuente_linea]
            },
            reglas_financieras: reglasFinancieras
        };
    });

    if (urgenciaVariants.length > 0) auditSchema.agrupaciones_clinicas.push({ nombre_canonico: "ATENCIÓN DE URGENCIA", variantes: urgenciaVariants });
    if (consultaVariants.length > 0) auditSchema.agrupaciones_clinicas.push({ nombre_canonico: "CONSULTAS MÉDICAS", variantes: consultaVariants });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ ...outputWithConsolidation, auditoria_schema: auditSchema }, null, 2));
    console.log(`✅ Canonización forense completa:
   📄 Capa 1 (Lineal): ${output.contrato.tabla_prestaciones.lineas.length} líneas
   🔍 Capa 2 (Consolidada): ${outputWithConsolidation.prestaciones_consolidadas.length} prestaciones
   ⚖️ Capa 3 (Auditoría): ${auditSchema.definiciones.length} definiciones normalizadas`);
}

runCanonizer().catch(console.error);
