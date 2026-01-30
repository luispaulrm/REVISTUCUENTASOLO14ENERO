import fs from 'fs';
import path from 'path';
// ----------------------
// 1) Core semantic types
// ----------------------

export type BlockEffect = "LIMITANTE" | "NEUTRO" | "EXPANSIVO";

export type BlockScope =
    | "PREFERENTE_RED"
    | "PREFERENTE_MODAL"
    | "PORCENTAJE"
    | "TOPE_EVENTO"
    | "TOPE_ANUAL_NFE"
    | "FINANCIAL_DOMAIN"; // útil para CAMBIO_DOMINIO

export type LatentReason =
    | "HERENCIA_CORTADA"
    | "LIMITANTE_TOPE"
    | "CAMBIO_DOMINIO"
    | "OTRA";

export type Modalidad = "preferente" | "libre_eleccion";

export interface SemanticBlock {
    id: string;              // p.ej. "L2_53_C7" o similar
    text: string;            // texto crudo
    col: number;             // columna (1..n)
    rowId: string;           // id prestación / fila detectada
    segmentId: string;       // sub-tramo horizontal (delta) dentro de la fila
    effect: BlockEffect;
    scope: BlockScope;
}

export interface Restriction {
    scope: BlockScope;
    kind: "TOPE_UF" | "TOPE_AC2" | "SIN_TOPE" | "PORCENTAJE" | "OTRA";
    value?: number;          // UF o factor AC2 o porcentaje
    raw: string;
    byBlock: string;
}

export interface SemanticOptionNode {
    id: string;              // OptionID estable (NO usar modalidad como key)
    modalidad: Modalidad;
    scopes: Set<BlockScope>;
    porcentaje?: number;     // 80 / 90
    prestadores: string[];   // clínicas/red
    tope_evento?: { tipo: "UF" | "AC2" | "SIN_TOPE"; valor?: number };
    tope_anual?: { tipo: "UF" | "AC2" | "SIN_TOPE"; valor?: number }; // NFE
    meta?: Record<string, any>;
}

export interface OptionGraph {
    rowId: string;
    options: Map<string, SemanticOptionNode>; // id -> node
    edges: Array<{ from: string; to: string; type: "COMPATIBLE" | "CONFLICT" }>;
}

export interface LatentOption {
    id: string;
    reason: LatentReason;
    scope: BlockScope;
    byBlock: string;
}

export interface LineState {
    opciones_activas: Set<string>;        // OptionIDs
    opciones_latentes: LatentOption[];    // con razón
    restricciones: Restriction[];
    historial_bloques: string[];
    dominio: "CLINICO" | "FINANCIERO";    // cambio de dominio
    herencia_cortada: boolean;            // línea verde / solo LE
    nfe?: {
        valor: number | null;
        bloque_id: string;
        razon?: string;
        fuente_linea: string;
    };
}

// Utilidad para comparar scope
export function intersectsScope(blockScope: BlockScope, optionScopes: Set<BlockScope>) {
    return optionScopes.has(blockScope);
}

// Added Missing Exports
export type SemanticOperator =
    | { type: "HERENCIA_CORTADA"; byBlock: string }
    | { type: "CAMBIO_DOMINIO_FINANCIERO"; byBlock: string }
    | { type: "TOPE_EVENTO"; restr: Restriction }
    | { type: "TOPE_ANUAL_NFE"; restr: Restriction }
    | { type: "PORCENTAJE"; restr: Restriction };

export interface HistorialFinancieroEntry {
    tipo: "exclusion_modal" | "regimen" | "tope_evento" | "tope_anual";
    valor?: any;
    unidad?: string;
    porcentaje?: number;
    descripcion?: string;
    fuente?: string;
}

export type ForensicOperatorType =
    | "OP_CORTE_HERENCIA"
    | "OP_CAMBIO_DOMINIO"
    | "OP_RE_EXPANSION_NFE"
    | "OP_VACIO_CONTRACTUAL";

export interface ForensicOperator {
    tipo: ForensicOperatorType;
    fuente_linea: string;
    detalle?: string;
}

// -----------------------------------------------------
// 2) Clasificación de bloques (BlockEffect + BlockScope)
// -----------------------------------------------------

export function classifyBlockEffect(text: string): BlockEffect {
    const t = text.toLowerCase();

    if (t.includes("sin tope")) return "EXPANSIVO";

    // limitantes típicos: "tope", "uf", "ac2", "veces", "x"
    if (t.includes("tope") || t.includes("uf") || t.includes("ac2") || t.includes("veces") || t.match(/\b\d+([.,]\d+)?\s*x\b/)) {
        return "LIMITANTE";
    }

    return "NEUTRO";
}

export function inferScope(col: number, text: string): BlockScope {
    const t = text.toLowerCase();

    // Señal fuerte: "solo cobertura libre elección" corta herencia preferente
    if (t.includes("solo") && t.includes("libre elecci")) return "PREFERENTE_RED";

    // Columnas (Refined based on extraction):
    // Col 2, 4, 5, 6 = EVENTO (Tope 6 often shifts)
    // Col 7 = ANUAL (Tope 7)
    if (col === 2 || col === 4 || col === 5 || col === 6) return "TOPE_EVENTO";
    if (col === 7) return "TOPE_ANUAL_NFE";

    // Porcentaje
    if (t.includes("%")) return "PORCENTAJE";

    // Prestadores/red/modalidad A.1/A.2
    if (t.includes("a.1") || t.includes("a.2") || t.includes("institucional")) return "PREFERENTE_MODAL";
    if (t.includes("clínica") || t.includes("red") || t.includes("uc") || t.includes("christus") || t.includes("davila") || t.includes("vespucio")) {
        return "PREFERENTE_RED";
    }

    return "FINANCIAL_DOMAIN"; // fallback seguro
}

// ----------------------------------------------
// 3) OperatorEngine (detectOperators + applyOperators)
// ----------------------------------------------

export function detectOperators(block: SemanticBlock): SemanticOperator[] {
    const ops: SemanticOperator[] = [];
    const t = block.text.toLowerCase();

    // Línea verde / barrera semántica
    if (t.includes("solo") && t.includes("libre elecci")) {
        ops.push({ type: "HERENCIA_CORTADA", byBlock: block.id });
    }

    // Cambio dominio (meds/mats/transfers/etc.)
    const isFinancialDomain =
        t.includes("medic") ||
        t.includes("material") ||
        t.includes("traslado") ||
        t.includes("prótesis") || t.includes("protesis") ||
        t.includes("órtesis") || t.includes("ortesis") ||
        t.includes("osteosíntesis") || t.includes("osteosintesis") ||
        t.includes("quimioterapia");

    if (isFinancialDomain) {
        ops.push({ type: "CAMBIO_DOMINIO_FINANCIERO", byBlock: block.id });
    }

    // Restricciones por scope
    const effect = block.effect;
    const scope = block.scope;

    if (scope === "TOPE_EVENTO") {
        ops.push({ type: "TOPE_EVENTO", restr: parseRestriction(block, "TOPE_EVENTO") });
    }

    // FORENSIC IMPROVEMENT: If "Sin Tope" exists in a financial domain line (like Traslados),
    // we must treat it as an NFE expander, BUT ONLY if it's NOT explicitly an event limit column.
    if (scope === "TOPE_ANUAL_NFE" || (isFinancialDomain && t.includes("sin tope") && scope !== "TOPE_EVENTO")) {
        ops.push({ type: "TOPE_ANUAL_NFE", restr: parseRestriction(block, "TOPE_ANUAL_NFE") });
    }

    if (scope === "PORCENTAJE") {
        ops.push({ type: "PORCENTAJE", restr: parseRestriction(block, "PORCENTAJE") });
    }

    return ops;
}

// Parse básico: detecta SIN TOPE, UF, AC2 factor, porcentaje
export function parseRestriction(block: SemanticBlock, scope: BlockScope): Restriction {
    const raw = block.text;
    const t = raw.toLowerCase();

    if (t.includes("sin tope")) {
        return { scope, kind: "SIN_TOPE", raw, byBlock: block.id };
    }

    // porcentaje
    const mPct = raw.match(/(\d{1,3})\s*%/);
    if (mPct) {
        return { scope, kind: "PORCENTAJE", value: Number(mPct[1]), raw, byBlock: block.id };
    }

    // UF (Explicit or Bare Number in Event Column)
    const mUf = raw.match(/(\d+([.,]\d+)?)\s*uf/i);
    if (mUf) {
        return { scope, kind: "TOPE_UF", value: Number(mUf[1].replace(",", ".")), raw, byBlock: block.id };
    }

    // Bare number check (Implicit UF context)
    // If we are in TOPE_EVENTO column and see a bare number like "20" or "20,5", assume UF.
    if (scope === "TOPE_EVENTO") {
        const mBare = raw.match(/^(\d+([.,]\d+)?)$/);
        if (mBare) {
            return { scope, kind: "TOPE_UF", value: Number(mBare[1].replace(",", ".")), raw, byBlock: block.id };
        }
    }

    // AC2 factor: "1.2 veces AC2" / "2.0 x AC2"
    const mAc2 = raw.match(/(\d+([.,]\d+)?)\s*(x|veces)\s*ac2/i);
    if (mAc2) {
        return { scope, kind: "TOPE_AC2", value: Number(mAc2[1].replace(",", ".")), raw, byBlock: block.id };
    }

    return { scope, kind: "OTRA", raw, byBlock: block.id };
}

export function applyOperators(state: LineState, ops: SemanticOperator[]): LineState {
    let s = { ...state };

    for (const op of ops) {
        switch (op.type) {
            case "HERENCIA_CORTADA":
                s.herencia_cortada = true;
                // mueve cualquier opción que tenga scopes preferentes a latente (NO destruir)
                s = cutPreferenteInheritance(s, op.byBlock);
                break;

            case "CAMBIO_DOMINIO_FINANCIERO":
                s.dominio = "FINANCIERO";
                break;

            case "TOPE_EVENTO":
            case "TOPE_ANUAL_NFE":
            case "PORCENTAJE":
                s.restricciones = [...s.restricciones, op.restr];
                break;
        }
    }

    return s;
}

function cutPreferenteInheritance(s: LineState, byBlock: string): LineState {
    const actives = new Set(s.opciones_activas);
    const latents = [...s.opciones_latentes];

    // En esta capa NO sabemos aún el scope de la option sin tener el graph;
    // así que aquí el corte es "global" y se refina en RE/interpret cuando ya conoces option.scopes.
    // Si tú ya tienes optionScopes accesible acá, mejor: mover solo las que intersecten PREFERENTE_*.

    // Aproximación segura: marca bandera; el movimiento fino lo hace RE expand/limit.
    return { ...s, opciones_activas: actives, opciones_latentes: latents };
}

// ----------------------------------------------
// 4) RE Operator (Phase 2 + Phase 7)
// ----------------------------------------------

export interface Memory {
    // memoria por fila/segmento si quieres
    latentes_global: LatentOption[];
}

export function applyReExpansion(block: SemanticBlock, state: LineState, memory: Memory, optGraph?: OptionGraph): LineState {
    const s: LineState = {
        ...state,
        historial_bloques: [...state.historial_bloques, block.id],
    };

    if (block.effect === "NEUTRO") return s;

    if (block.effect === "LIMITANTE") {
        return limitState(block, s, optGraph);
    }

    // EXPANSIVO
    return expandState(block, s, memory, optGraph);
}

function limitState(block: SemanticBlock, s: LineState, optGraph?: OptionGraph): LineState {
    if (!optGraph) return s;

    const newActives = new Set<string>();
    const newLatents = [...s.opciones_latentes];

    for (const optId of s.opciones_activas) {
        const opt = optGraph.options.get(optId);
        if (!opt) continue;

        const affected = intersectsScope(block.scope, opt.scopes);
        if (!affected) {
            newActives.add(optId);
            continue;
        }

        // si afectado por limitante, lo mandamos a latente
        newLatents.push({ id: optId, reason: "LIMITANTE_TOPE", scope: block.scope, byBlock: block.id });
    }

    return { ...s, opciones_activas: newActives, opciones_latentes: newLatents };
}

function expandState(block: SemanticBlock, s: LineState, memory: Memory, optGraph?: OptionGraph): LineState {
    if (!optGraph) return s;

    const newActives = new Set(s.opciones_activas);
    const remainingLatents: LatentOption[] = [];

    // reactivación: solo latentes afectados por scope y reason != HERENCIA_CORTADA
    for (const lo of s.opciones_latentes) {
        if (lo.reason === "HERENCIA_CORTADA") {
            remainingLatents.push(lo);
            continue;
        }

        const opt = optGraph.options.get(lo.id);
        if (!opt) {
            remainingLatents.push(lo);
            continue;
        }

        const affected = intersectsScope(block.scope, opt.scopes);
        if (affected) {
            newActives.add(lo.id);
            continue;
        }

        remainingLatents.push(lo);
    }

    return { ...s, opciones_activas: newActives, opciones_latentes: remainingLatents };
}


// ----------------------------------------------
// 5) Stoppers (línea verde) para MEDICAMENTOS/MATERIALES
// ----------------------------------------------

export function isGreenLineBarrier(text: string): boolean {
    const t = text.toLowerCase();
    return (
        (t.includes("solo") && t.includes("libre elecci")) ||
        t.includes("medicamentos hospitalarios") ||
        t.includes("materiales clínicos") ||
        t.includes("materiales clinicos")
    );
}

// ----------------------------------------------
// 6) Checker 6-Puntos
// ----------------------------------------------

export interface Violation {
    code: string;
    severity: "CRITICA" | "ALTA" | "MEDIA" | "BAJA";
    rowId: string;
    message: string;
    evidence?: any;
}

export function run6PointChecker(prestacion: {
    rowId: string;
    nombre: string;
    opciones: Array<{
        id: string;
        modalidad: Modalidad;
        porcentaje?: number;
        prestadores?: string[];
        tope_evento?: any;
        tope_anual?: any;
        flags?: { herencia_cortada?: boolean; dominio?: string };
    }>;
    flags?: { herencia_cortada?: boolean; dominio?: string };
}): Violation[] {
    const v: Violation[] = [];
    const { rowId, nombre, opciones } = prestacion;

    // (1) No provider mixing entre grupos distintos % en misma “familia” (A.2-80 vs A.2-90)
    // Heurística: si hay 80 y 90 en preferente, sus prestadores deben ser disjuntos.
    const pref80 = new Set<string>();
    const pref90 = new Set<string>();

    for (const o of opciones) {
        if (o.modalidad !== "preferente") continue;
        const ps = o.prestadores ?? [];
        if (o.porcentaje === 80) ps.forEach(p => pref80.add(p));
        if (o.porcentaje === 90) ps.forEach(p => pref90.add(p));
    }

    for (const p of pref80) {
        if (pref90.has(p)) {
            v.push({
                code: "E1_PROVIDER_MIXING",
                severity: "CRITICA",
                rowId,
                message: `Prestador mezclado entre preferente 80% y 90%: ${p}`,
                evidence: { prestador: p, nombre }
            });
            break;
        }
    }

    // (2) A.2 80% re-expansion: si aparecen Santa María/Tabancura/Indisa en contrato esperado,
    // deberían estar agrupadas en alguna opción 80% preferente (esto requiere expectedProviders externo).
    // Aquí solo validamos que si están, NO estén repartidas en opciones de 90%.
    const suspicious = ["Santa María", "Tabancura", "Indisa"];
    for (const sName of suspicious) {
        const in90 = opciones.some(o => o.modalidad === "preferente" && o.porcentaje === 90 && (o.prestadores ?? []).some(p => p.includes(sName)));
        if (in90) {
            v.push({
                code: "E2_A2_80_BAD_REEXPANSION",
                severity: "ALTA",
                rowId,
                message: `${sName} apareció en grupo preferente 90% (debería estar en 80% si corresponde al tramo A.2-80).`,
                evidence: { sName, nombre }
            });
        }
    }

    // (3) Missing providers (requiere expectedProviders)
    // -> Te dejo la firma para que la llames con expectedProviders cuando lo tengas.
    // validateMissingProviders(rowId, opciones, expectedProviders)

    // (4) Distinct paths: no opción debe tener prestadores de dos grupos distintos %.
    for (const o of opciones) {
        if (!o.prestadores?.length) continue;
        if (o.modalidad !== "preferente") continue;

        // regla simple: cada opción preferente debe tener porcentaje definido
        if (typeof o.porcentaje !== "number") {
            v.push({
                code: "E4_WIDE_PATH_NO_PERCENT",
                severity: "MEDIA",
                rowId,
                message: `Opción preferente sin porcentaje (path demasiado ancho / colapso).`,
                evidence: { optionId: o.id, nombre }
            });
        }
    }

    // (5) Herencia cortada: si flags herencia_cortada, NO debe haber preferente aplica
    const hc = prestacion.flags?.herencia_cortada || opciones.some(o => o.flags?.herencia_cortada);
    if (hc) {
        const hasPreferente = opciones.some(o => o.modalidad === "preferente" && (o.prestadores?.length ?? 0) > 0);
        if (hasPreferente) {
            v.push({
                code: "E5_HERENCIA_CORTADA_BROKEN",
                severity: "CRITICA",
                rowId,
                message: `Herencia cortada activa, pero aún existen opciones preferentes con prestadores.`,
                evidence: { nombre }
            });
        }
    }

    // (6) Tope separation: evento vs anual deben estar en campos distintos.
    for (const o of opciones) {
        if (o.tope_evento && o.tope_anual && JSON.stringify(o.tope_evento) === JSON.stringify(o.tope_anual)) {
            v.push({
                code: "E6_TOPE_COLLAPSE",
                severity: "ALTA",
                rowId,
                message: `Posible colapso: tope_evento y tope_anual idénticos (separación falló).`,
                evidence: { optionId: o.id, nombre, tope_evento: o.tope_evento, tope_anual: o.tope_anual }
            });
        }
    }

    return v;
}

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
    operadores_forenses?: ForensicOperator[];
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
function isValidProvider(name: string): boolean {
    if (!name) return false;
    const n = name.toUpperCase().trim();
    // Regex filtering: Must start with provider keywords
    const validStartRegex = /^(CLÍNICA|HOSPITAL|RED|INTEGRAMÉDICA|CENTRO MÉDICO|CM)\b/i;
    // Blacklist: Explicitly reject clinical terms that match column 1 content
    const clinicalBlacklist = [
        "DIA CAMA", "ENFERMERÍA", "ENFERMERIA", "MEDICINA", "PEDIATRIA", "PEDIATRÍA",
        "GINECO", "OBSTETRICIA", "SALA CUNA", "UCI", "UTI", "CORONARIOS", "PABELLÓN",
        "PABELLON", "CIRUGIA", "CIRUGÍA", "OBSERVACIÓN", "OBSERVACION", "INTERMEDIO",
        "EXÁMENES", "EXAMENES", "KINESIOLOGÍA", "KINESIOLOGIA", "NUTRICIONISTA"
    ];

    if (!validStartRegex.test(n)) return false;
    if (clinicalBlacklist.some(term => n.includes(term))) return false;

    return true;
}

function cleanProviderName(name: string): string | null {
    if (!name) return null;
    const noisePatterns = [
        /\bHONORARIOS\b/gi, /\bHOSPITALARIOS\b/gi, /\bAMBULATORIOS\b/gi,
        /\bQUIRÚRGICOS\b/gi, /\bHOSPITALARIO\b/gi, /\bAMBULATORIO\b/gi,
        /\bMÉDICOS\b/gi, /\bSIN TOPE\b/gi
    ];
    let clean = name;
    for (const pattern of noisePatterns) { clean = clean.replace(pattern, '').trim(); }
    clean = clean.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 3) return null;

    // Strict forensic filter
    if (!isValidProvider(clean)) return null;

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

// -----------------------------------------------------
// 4) RE Operator (Deprecated local version removed)
// -----------------------------------------------------

/**
 * Builds the EFNL (Estado Financiero No Lineal) history
 * Captures the forest of rules without collapsing them.
 */
function buildHistorialFinanciero(
    leTope: Tope | null,
    nfeBlock: NfeBlock | null,
    lineaId: string,
    contexto: any,
    isExcluded: boolean
): HistorialFinancieroEntry[] {
    const historial: HistorialFinancieroEntry[] = [];

    // Layer 1: Exclusion (Green Line)
    if (isExcluded || contexto.modalidad_base === "libre_eleccion") {
        historial.push({
            tipo: "exclusion_modal",
            valor: "solo_libre_eleccion",
            descripcion: isExcluded ? "BARRERA: Green Line Cut (Solo Libre Elección)" : "Régimen General Libre Elección",
            fuente: contexto.heredada_desde || lineaId
        });
    }

    // Layer 2: Regime (Base Coverage)
    historial.push({
        tipo: "regimen",
        porcentaje: contexto.porcentaje_le || 90,
        descripcion: `Cobertura base del ${contexto.porcentaje_le || 90}%`
    });

    // Layer 3: Event Tope
    if (leTope && (leTope.tipo === "AC2" || leTope.tipo === "UF" || leTope.tipo === "VARIABLE")) {
        historial.push({
            tipo: "tope_evento",
            unidad: leTope.tipo === "AC2" ? "veces AC2" : (leTope.tipo === "UF" ? "UF" : "VARIABLE"),
            valor: leTope.tipo === "AC2" ? leTope.factor : (leTope.tipo === "UF" ? leTope.valor : null),
            descripcion: leTope.tipo === "VARIABLE" ? "Variable según arancel" : `Límite por evento: ${leTope.tipo === "AC2" ? leTope.factor + "x AC2" : leTope.valor + " UF"}`,
            fuente: leTope.origen || lineaId
        });
    }

    // Layer 4: Annual Tope (NFE)
    if (nfeBlock) {
        const isSinTope = nfeBlock.razon === "SIN_TOPE_EXPRESO";
        historial.push({
            tipo: "tope_anual",
            unidad: isSinTope ? null : "UF",
            valor: isSinTope ? "SIN_TOPE" : nfeBlock.valor,
            descripcion: isSinTope ? "Re-expansión: Cobertura anual ILIMITADA" : `Límite máximo año beneficiario: ${nfeBlock.valor} UF`,
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
                    const ac2Match = text.match(/\d+([.,]\d+)?\s*veces\s*AC2/i);
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
                    const existing = nfePointsByPage.get(line.pagina)!.find(p => p.linea === line.indice_linea);
                    if (existing) {
                        if (found.razon === "SIN_TOPE_EXPRESO") {
                            existing.valor = null;
                            existing.razon = "SIN_TOPE_EXPRESO";
                        }
                    } else {
                        nfePointsByPage.get(line.pagina)!.push({ linea: line.indice_linea, ...found });
                    }
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

    // --- EXTRACTION: ARANCEL AC2 VALOR EN PESOS (PAG 3) ---
    let ac2PesosValue: number | null = null;
    for (const line of extractionData.lineas as ExtractionLine[]) {
        if (line.pagina === 3 && line.texto_plano) {
            const t = line.texto_plano.toUpperCase();
            if (t.includes("NOMBRE DEL ARANCEL : AC2") && t.includes("PESOS")) {
                const idx = (extractionData.lineas as ExtractionLine[]).indexOf(line);
                // Look ahead 5 lines for a peso amount
                for (let i = idx; i < idx + 5; i++) {
                    const l = (extractionData.lineas as ExtractionLine[])[i];
                    if (!l || !l.texto_plano) continue;
                    const m = l.texto_plano.match(/\$\s*([\d.]+)/);
                    if (m) {
                        ac2PesosValue = Number(m[1].replace(/\./g, ''));
                        break;
                    }
                }
            }
        }
    }

    const output = {
        contrato: {
            metadata: {
                ...extractionData.metadata,
                fecha_procesamiento: new Date().toISOString(),
                aranceles: {
                    AC2: {
                        nombre: "Arancel Consalud 2",
                        unidad: "PESOS",
                        valor_pesos: ac2PesosValue
                    }
                }
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
        const text = line.texto_plano?.toUpperCase() || "";
        const isStructuralStopper = line.tipo === 'cabecera_tabla' || line.tipo === 'titulo_seccion';
        const isForensicStopper = text.includes("MEDICAMENTOS") || text.includes("MATERIALES") || text.includes("TRASLADOS");

        if (isStructuralStopper || isForensicStopper) {
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

    function getNfeForLine(pagina: number, indice_linea: number, text: string): LineaPrestacion['nfe'] {
        const t = text.toUpperCase();
        const isFinancialSensitive = t.includes("PRÓTESIS") || t.includes("PROTESIS") || t.includes("ÓRTESIS") || t.includes("ORTESIS") || t.includes("TRASLADO") || t.includes("TRANSPLANTE");
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

        // RADIUS CONTROL: Sensitive financial items (Gold Standard) have zero tolerance for inheritance.
        // They must either have an explicit NFE on the same line or they are a VACUUM.
        const radius = isFinancialSensitive ? 0 : 8;

        if (bestNfe && minDistance <= radius) {
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

        if (isFinancialSensitive && !t.includes("SIN TOPE")) {
            return {
                aplica: true,
                valor: null,
                unidad: null,
                bloque_id: "NFE_VACUUM",
                razon: "VACIO_CONTRACTUAL_FORENSE", // Strict Forensic Gold Standard
                fuente_linea: `L${pagina}_${indice_linea}`,
                clausula_activa: false
            };
        }

        return { aplica: false, valor: null, unidad: null, bloque_id: "NONE", fuente_linea: "NONE" };
    }

    // State management
    const stateByRowSeg = new Map<string, LineState>();

    // Initial global state (inherited)
    let currentInheritedState: LineState = {
        opciones_activas: new Set(),
        opciones_latentes: [],
        restricciones: [],
        historial_bloques: [],
        dominio: "CLINICO",
        herencia_cortada: false,
        nfe: {
            valor: null,
            bloque_id: "NONE",
            razon: "INITIAL",
            fuente_linea: "INITIAL"
        }
    };

    for (const rawLine of (extractionData.lineas as ExtractionLine[])) {
        const lineId = `L${rawLine.pagina}_${rawLine.indice_linea}`;
        const textoLimpio = rawLine.texto_plano?.trim() || "";
        const asigs = asigByLine.get(`${rawLine.pagina}_${rawLine.indice_linea}`) || [];

        // 1. Create Segment Block (Conceptual)
        // We treat the whole line as one block for operator detection initially
        const block: SemanticBlock = {
            id: lineId,
            text: textoLimpio,
            col: 0, // Text mode
            rowId: lineId,
            segmentId: "MAIN",
            effect: "NEUTRO",
            scope: inferScope(0, textoLimpio)
        };
        block.effect = classifyBlockEffect(textoLimpio);

        // 2. Detect Operators
        const ops = detectOperators(block);
        const rowLocalOps = [...ops]; // Collection for this specific row
        const forensicOps: ForensicOperator[] = []; // Collect forensic operators for this line

        // 3. Apply Operators to State
        // First, apply "vertical" operators (like HERENCIA_CORTADA persisting downwards)
        // If HERENCIA_CORTADA is detected, it modifies the *inherited* state for this and future lines
        // Detección estricta de NFE por Columna 7 o 8 (Geometric Evidence)
        const hasCellInNfeCols = rawLine.celdas?.some(c => c.indice_columna >= 7);
        const cellText78 = rawLine.celdas?.filter(c => c.indice_columna >= 7).map(c => c.texto).join(" ");

        let nfeStateValue = currentInheritedState.nfe?.valor;
        let nfeStateBloqueId = currentInheritedState.nfe?.bloque_id;
        let nfeStateRazon = currentInheritedState.nfe?.razon;
        let nfeStateFuente = currentInheritedState.nfe?.fuente_linea;

        if (hasCellInNfeCols && cellText78!.trim() !== "") {
            const nfeText = cellText78!;
            const mUF = nfeText.match(/(\d+([.,]\d+)?)\s*UF/i);
            const isSinTopeExpreso = /SIN\s*TOPE/i.test(nfeText);

            if (isSinTopeExpreso) {
                nfeStateValue = null;
                nfeStateBloqueId = `NFE_${rawLine.pagina}_${rawLine.indice_linea}`;
                nfeStateRazon = "SIN_TOPE_EXPRESO";
                nfeStateFuente = `L${rawLine.pagina}_${rawLine.indice_linea}`;
            } else if (mUF) {
                nfeStateValue = Number(mUF[1].replace(",", "."));
                nfeStateBloqueId = `NFE_${rawLine.pagina}_${rawLine.indice_linea}`;
                nfeStateRazon = "TOPE_UF_EXPRESO";
                nfeStateFuente = `L${rawLine.pagina}_${rawLine.indice_linea}`;
            }
        } else if (hasCellInNfeCols && cellText78!.trim() === "") {
            // Inherit (rowspan evidence)
        } else {
            // No cell in NFE columns: Reset inheritance
            nfeStateValue = null;
            nfeStateBloqueId = "NFE_DEFAULT";
            nfeStateRazon = "INHERITANCE_RESET";
            nfeStateFuente = "RESET";
        }

        // Update inherited state for next iterations
        currentInheritedState = {
            ...currentInheritedState,
            nfe: {
                valor: nfeStateValue,
                bloque_id: nfeStateBloqueId,
                razon: nfeStateRazon,
                fuente_linea: nfeStateFuente
            }
        };

        let currentState = { ...currentInheritedState };
        currentState = applyOperators(currentState, ops);

        // Update inherited state for next lines if we are in a section header logic
        // But mainly we process the CURRENT line

        // Maintain state by row
        stateByRowSeg.set(lineId, currentState);

        if (textoLimpio.match(/OFERTA PREFERENTE|¿QUÉ ES UN PLAN PREFERENTE?/i) && !asigs.length) {
            currentInheritedState.dominio = "CLINICO";
            currentInheritedState.herencia_cortada = false;
            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId, tipo: "encabezado", texto: textoLimpio,
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
            continue;
        }

        const isExclusionPhrase = ops.some(op => op.type === "HERENCIA_CORTADA");
        const isLEHeading = textoLimpio.match(/LIBRE ELECCIÓN/i) && !textoLimpio.match(/OFERTA PREFERENTE/i);

        if (isExclusionPhrase || isLEHeading) {
            currentState.herencia_cortada = true;
            currentState.dominio = "FINANCIERO"; // Often implies financial mode
            currentInheritedState = { ...currentState }; // Persist this mode

            // FORENSIC RECORDING
            if (isExclusionPhrase) forensicOps.push({ tipo: "OP_CORTE_HERENCIA", fuente_linea: lineId });
            if (isLEHeading) forensicOps.push({ tipo: "OP_CAMBIO_DOMINIO", fuente_linea: lineId });

            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId, tipo: "fase_logica", texto: textoLimpio,
                efecto: { tipo: "cambio_modalidad", nueva_modalidad: "libre_eleccion", porcentaje: 90 },
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });

            // CRITICAL FIX: Only skip if NO assignments. If there ARE assignments (like TRASLADOS),
            // we must proceed to the prestation processing below.
            if (!asigs.length) continue;
        }

        // Logic for PRESTACIONES lines
        const factorAC2 = parseVecesAC2(textoLimpio);
        if (factorAC2 !== null) {
            // Register implicit financial rule if found in text
            currentState.restricciones.push({
                scope: "TOPE_EVENTO", kind: "TOPE_AC2", value: factorAC2, raw: "Implicit Text", byBlock: lineId
            });

            // CRITICAL FIX: Only skip if this is ONLY a financial factor line without a prestation assignment.
            // Prestations like "TRASLADOS" often have the factor in the name line.
            if (!asigs.length) continue;
        }

        if (asigs.length > 0) {
            const prestacionName = asigs[0].prestacion_textual;

            // Check Explicit Exclusion from Assignment
            const prefAsigs = asigs.filter(a => a.modalidad === 'preferente');
            const isExcluded = prefAsigs.some(a => expansionData.bloques.find(b => b.bloque_id === a.bloque_id)?.tipo_bloque === 'exclusion_modalidad');

            if (isExcluded) {
                currentState.herencia_cortada = true;
            }

            const pathsAplicables = (!currentState.herencia_cortada) ? preferentePathsForLine(rawLine.pagina, rawLine.indice_linea) : [];
            let rowTopeLE: Tope | null = null;

            // Extract Restrictions from cells
            if (rawLine.celdas) {
                for (const cell of rawLine.celdas) {
                    // Create pseudo-block for cell
                    const cellBlock: SemanticBlock = {
                        id: `${lineId}_C${cell.indice_columna}`,
                        text: cell.texto || "",
                        col: cell.indice_columna,
                        rowId: lineId,
                        segmentId: `SEG_C${cell.indice_columna}`,
                        effect: classifyBlockEffect(cell.texto || ""),
                        scope: inferScope(cell.indice_columna, cell.texto || "")
                    };
                    const cellOps = detectOperators(cellBlock);
                    rowLocalOps.push(...cellOps);
                    currentState = applyOperators(currentState, cellOps);
                }
            }

            // Mapping State Restrictions to Legacy Logic (Hybrid Glue)
            // FORENSIC: Prioritize operators found in THIS row (rowLocalOps) over inherited ones
            const localAc2Op = rowLocalOps.find(op => op.type === "TOPE_EVENTO" && op.restr.kind === "TOPE_AC2") as any;
            const localUfOp = rowLocalOps.find(op => op.type === "TOPE_EVENTO" && op.restr.kind === "TOPE_UF") as any;

            const inheritedAc2Restr = currentState.restricciones.find(r => r.kind === "TOPE_AC2");
            const inheritedUfRestr = currentState.restricciones.find(r => r.kind === "TOPE_UF" && (r.scope === "TOPE_EVENTO" || r.scope === "FINANCIAL_DOMAIN"));

            if (localAc2Op) {
                rowTopeLE = { tipo: "AC2", factor: localAc2Op.restr.value, origen: localAc2Op.restr.byBlock, sin_tope_adicional: true };
            } else if (localUfOp) {
                rowTopeLE = { tipo: "UF", valor: localUfOp.restr.value, origen: localUfOp.restr.byBlock };
            } else if (inheritedAc2Restr && inheritedAc2Restr.value) {
                rowTopeLE = { tipo: "AC2", factor: inheritedAc2Restr.value, origen: inheritedAc2Restr.byBlock, sin_tope_adicional: true };
            } else if (inheritedUfRestr && inheritedUfRestr.value) {
                rowTopeLE = { tipo: "UF", valor: inheritedUfRestr.value, origen: inheritedUfRestr.byBlock };
            }

            // FORENSIC: Active Block NFE State Logic (Legacy Integration)
            let nfeStatus = getNfeForLine(rawLine.pagina, rawLine.indice_linea, textoLimpio);




            let nfeOp = rowLocalOps.find(op => op.type === "TOPE_ANUAL_NFE") as any;
            if (nfeOp) {
                const restr = nfeOp.restr;
                nfeStatus = {
                    aplica: true,
                    valor: restr.kind === "SIN_TOPE" ? null : restr.value || null,
                    unidad: restr.kind !== "SIN_TOPE" ? "UF" : null,
                    bloque_id: restr.byBlock,
                    razon: restr.kind === "SIN_TOPE" ? "SIN_TOPE_EXPRESO" : undefined,
                    fuente_linea: lineId,
                    clausula_activa: restr.kind === "SIN_TOPE"
                };

                if (restr.kind === "SIN_TOPE") {
                    forensicOps.push({ tipo: "OP_RE_EXPANSION_NFE", fuente_linea: lineId, detalle: "Sin Tope Expreso" });
                }
            } else if (nfeStatus.razon === "VACIO_CONTRACTUAL_FORENSE" || ((rowLocalOps.some(op => op.type === "CAMBIO_DOMINIO_FINANCIERO") || textoLimpio.includes("PRÓTESIS") || textoLimpio.includes("ÓRTESIS")) && nfeStatus.bloque_id === "NONE")) {

                // Force NFE active state for Vacuum
                if (nfeStatus.bloque_id === "NONE") {
                    nfeStatus = {
                        aplica: true, valor: null, unidad: null,
                        bloque_id: "NFE_VACUUM", razon: "VACIO_CONTRACTUAL_FORENSE",
                        fuente_linea: lineId, clausula_activa: false
                    };
                }

                forensicOps.push({ tipo: "OP_VACIO_CONTRACTUAL", fuente_linea: lineId, detalle: "Vacuum detected in financial domain" });
            }

            // Generate Logical ID for Traceability
            const logicalId = `LOG_${rawLine.pagina}_${rawLine.indice_linea}_${asigs[0].prestacion_textual.substring(0, 3)}`;

            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId,
                id_logica: logicalId,
                tipo: "prestacion",
                nombre: prestacionName,
                contexto: {
                    modalidad_base: currentState.herencia_cortada ? "libre_eleccion" : "preferente",
                    tiene_libre_eleccion: true,
                    porcentaje_le: 90, // Default 90 if not specified
                    origen_porcentaje_le: "implicit_global",
                    heredada_desde: "ROOT", // Simplified
                    origen_herencia: currentState.herencia_cortada ? "explicit" : "inherited"
                },
                preferente: {
                    aplica: !currentState.herencia_cortada && pathsAplicables.length > 0,
                    paths: (!currentState.herencia_cortada) ? pathsAplicables : []
                },
                libre_eleccion: {
                    aplica: true, porcentaje: 90,
                    tope: rowTopeLE || { tipo: "VARIABLE" },
                    heredado: !rowTopeLE
                },
                nfe: nfeStatus,
                operadores_forenses: forensicOps,
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
        historial_financiero: HistorialFinancieroEntry[];  // EFNL model
        estado_no_lineal_de_linea: {
            opciones_activas: number;
            opciones_latentes: number;
            ultimo_bloque_aplicado?: string;
        };
        nfe_resumen: LineaPrestacion['nfe'];
        operadores_forenses?: ForensicOperator[]; // Exposed in Consolidated View
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
                historial_financiero: [],  // EFNL sequence
                estado_no_lineal_de_linea: { opciones_activas: 0, opciones_latentes: 0 },
                nfe_resumen: prestLinea.nfe,
                // Inherit forensic ops from the first line definition
                operadores_forenses: prestLinea.operadores_forenses || [],
                decision_final: "PENDIENTE_CUENTA_PACIENTE"
            });
        }
        const consolidated = consolidationMap.get(normalizedName)!;

        // Merge forensic operators from all lines (deduplicate by type)
        if (prestLinea.operadores_forenses) {
            for (const fOp of prestLinea.operadores_forenses) {
                if (!consolidated.operadores_forenses) consolidated.operadores_forenses = [];
                if (!consolidated.operadores_forenses.some(existing => existing.tipo === fOp.tipo)) {
                    consolidated.operadores_forenses.push(fOp);
                }
            }
        }

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

        // Build historial_financiero (EFNL model)
        if (consolidated.historial_financiero.length === 0) {
            const hist = buildHistorialFinanciero(
                leTopeForStack,
                nfeBlockForStack,
                prestLinea.linea_id,
                prestLinea.contexto,
                !prestLinea.preferente.aplica || prestLinea.preferente.paths.length === 0
            );
            consolidated.historial_financiero = hist;

            // Update state with last relevant block
            if (nfeBlockForStack) {
                consolidated.estado_no_lineal_de_linea.ultimo_bloque_aplicado = nfeBlockForStack.bloque_id;
            } else if (leTopeForStack) {
                consolidated.estado_no_lineal_de_linea.ultimo_bloque_aplicado = leTopeForStack.origen;
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
                    prestadores: [...pathBlock.prestadores],
                    porcentaje: pathBlock.porcentaje,
                    tope: pathBlock.tope.tipo || "SIN_TOPE",
                    condiciones: pathBlock.condiciones,
                    estado_opcion: optionEstado,
                    estado_decisional: "NO_RESUELTA",
                    requiere: ["prestador_real", "prestacion_facturada", "modalidad_aplicada_en_cuenta"],
                    fuente: [prestLinea.linea_id]
                };

                // --- LOCAL ENRICHMENT (Per-Prestation and Per-Percentage) ---
                const targetNameUpper = prestLinea.nombre.toUpperCase();
                const targetShort = targetNameUpper.includes("LABORATORIO") ? "LABORATORIO" :
                    targetNameUpper.includes("KINESIOLOGÍA") ? "KINESIOLOGÍA" : targetNameUpper.split(":")[0];
                const span = prefSpanById.get(pathId.split('_R')[0]); // Get block span from pathId

                if (span) {
                    const linesInBlock = (extractionData.lineas as ExtractionLine[]).filter(l =>
                        l.pagina === span.pagina && l.indice_linea >= span.ini && l.indice_linea <= span.fin
                    );

                    let sectionPct: number | null = null;
                    let currentRowPct: number | null = null;
                    const enrichedProviders = new Set<string>(newOpcion.prestadores as string[]);

                    for (const line of linesInBlock) {
                        const lineText = (line.texto_plano || "").toUpperCase();
                        const firstCell = (line.celdas?.[0]?.texto || "").toUpperCase().trim();
                        const isContinuation = firstCell === "";

                        // 1. Trace context (%)
                        // Regex for both "80%" and " 80 " when in percentage plausible range
                        const pctMatch = lineText.match(/(?:^|\s)(20|30|35|40|50|60|70|75|80|90|100)(?:\s*%|\s|$)/);
                        const foundLinePct = pctMatch ? parseInt(pctMatch[1]) : null;

                        if (!isContinuation) {
                            currentRowPct = foundLinePct;
                            // If it's a section header (Caps and relatively short), update sectionPct
                            if (firstCell.length > 5 && firstCell.length < 50 && !firstCell.includes(":") && foundLinePct) {
                                sectionPct = foundLinePct;
                            }
                        } else if (foundLinePct) {
                            currentRowPct = foundLinePct;
                        }

                        const activePct = currentRowPct ?? sectionPct;

                        // 2. Relevance Check
                        const isTarget = lineText.includes(targetShort) || lineText.includes(targetNameUpper);
                        if (!isTarget && !isContinuation) continue;

                        // 3. Percentage Match (be lenient if no percentage is found in context)
                        if (activePct !== null && newOpcion.porcentaje !== activePct) continue;

                        // 4. Extract Providers
                        if (line.celdas) {
                            for (const cell of line.celdas) {
                                if (cell.indice_columna === 0 && !isContinuation) continue;
                                const rawParts = cell.texto.split(/[,;\n]/);
                                for (const part of rawParts) {
                                    const cleaned = cleanProviderName(part);
                                    if (!cleaned || cleaned.length < 4) continue;
                                    const upper = cleaned.toUpperCase().trim();

                                    const noise = ["AC2", "VECES", "UF", "TOPE", "COPAGO", "PREFERENTE", "MODALIDAD", "HABITACIÓN", "HOSPITALARIA", "AMBULATORIA", "MEDICAMENTO", "INSUMO", "MATERIALES"];
                                    if (noise.some(kw => upper.includes(kw))) continue;

                                    if (!Array.from(enrichedProviders).some(ext => ext.includes(upper) || upper.includes(ext))) {
                                        enrichedProviders.add(upper);
                                    }
                                }
                            }
                        }
                    }
                    newOpcion.prestadores = Array.from(enrichedProviders).sort();
                }

                const existing = consolidated.opciones.find(o => o.modalidad === "preferente" && JSON.stringify(o.prestadores) === JSON.stringify(newOpcion.prestadores) && o.porcentaje === newOpcion.porcentaje && o.tope === newOpcion.tope);
                if (existing) { if (!existing.fuente.includes(prestLinea.linea_id)) existing.fuente.push(prestLinea.linea_id); }
                else { consolidated.opciones.push(newOpcion); consolidated.estado_no_lineal_de_linea.opciones_activas++; }
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
                consolidated.estado_no_lineal_de_linea.opciones_activas++;
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
