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
    | "OP_VACIO_CONTRACTUAL"
    | "OP_LOCK_MODALIDAD";

export interface ForensicOperator {
    tipo: ForensicOperatorType;
    fuente_linea: string;
    detalle?: string;
}

// "Giant Table" Column Context
export interface ColumnContext {
    providers: string[]; // e.g. "UC Christus", "Dávila"
    percentage?: number; // e.g. 70, 80
    tope?: string;       // e.g. "1,0 veces AC2" (raw)
    source: string;      // Debug line ID
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

export function detectOperators(block: SemanticBlock, headerMap?: Map<number, string>): SemanticOperator[] {
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
        ops.push({ type: "TOPE_EVENTO", restr: parseRestriction(block, "TOPE_EVENTO", headerMap) });
    }

    // FORENSIC IMPROVEMENT: If "Sin Tope" exists in a financial domain line (like Traslados),
    // we must treat it as an NFE expander, BUT ONLY if it's NOT explicitly an event limit column.
    if (scope === "TOPE_ANUAL_NFE" || (isFinancialDomain && t.includes("sin tope") && scope !== "TOPE_EVENTO")) {
        ops.push({ type: "TOPE_ANUAL_NFE", restr: parseRestriction(block, "TOPE_ANUAL_NFE", headerMap) });
    }

    if (scope === "PORCENTAJE") {
        ops.push({ type: "PORCENTAJE", restr: parseRestriction(block, "PORCENTAJE", headerMap) });
    }

    return ops;
}

// Parse básico: detecta SIN TOPE, UF, AC2 factor, porcentaje
export function parseRestriction(block: SemanticBlock, scope: BlockScope, headerMap?: Map<number, string>): Restriction {
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

    // 0. PRIORITY: If TOPE_ANUAL_NFE is forced (e.g. by last-cell geometry), 
    // we must interpret it as a number even if regex is strict or headers are missing.
    if (scope === "TOPE_ANUAL_NFE") {
        // Aggressive parse: remove UF, spaces, etc.
        const clean = raw.toLowerCase().replace("uf", "").trim().replace(",", ".");
        if (clean.length === 0) return { scope, kind: "OTRA", raw, byBlock: block.id }; // Avoid empty cells becoming 0
        const val = Number(clean);
        if (!isNaN(val)) {
            return { scope: "TOPE_ANUAL_NFE", kind: "TOPE_UF", value: val, raw, byBlock: block.id };
        }
    }

    // Bare number check (Implicit UF context OR Header Context)
    const mBare = raw.match(/^(\d+([.,]\d+)?)$/);
    if (mBare) {
        const val = Number(mBare[1].replace(",", "."));

        // 1. Check Header Context FIRST
        if (headerMap) {
            let h = headerMap.get(block.col) || "";

            // PRIORITY: If we already forced TOPE_ANUAL_NFE (e.g. last cell heuristic), 
            // don't let the neighbor hack turn it into a percentage.
            if (scope === "TOPE_ANUAL_NFE") {
                return { scope: "TOPE_ANUAL_NFE", kind: "TOPE_UF", value: val, raw, byBlock: block.id };
            }

            // Check left neighbor if current is empty (often merged headers like "BONIFICACION | DEL PLAN")
            if (!h && headerMap.has(block.col - 1)) {
                const hLeft = headerMap.get(block.col - 1)!;
                if (hLeft.includes("PLAN") || hLeft.includes("BONIFIC")) {
                    h = "PORCENTAJE"; // Infer percentage context
                }
            }

            if (h.includes("AÑO") || h.includes("ANUAL") || h.includes("MAX")) {
                return { scope: "TOPE_ANUAL_NFE", kind: "TOPE_UF", value: val, raw, byBlock: block.id };
            }
            if (h.includes("%") || h.includes("BONIFIC") || h.includes("COBERTURA") || h.includes("PLAN") || h === "PORCENTAJE") {
                return { scope: "PORCENTAJE", kind: "PORCENTAJE", value: val, raw, byBlock: block.id };
            }
            if (h.includes("UF")) {
                return { scope, kind: "TOPE_UF", value: val, raw, byBlock: block.id };
            }
            if (h.includes("AC2") || h.includes("VECES")) {
                return { scope, kind: "TOPE_AC2", value: val, raw, byBlock: block.id };
            }
        }

        // 2. Fallback to Scope Default
        if (scope === "TOPE_EVENTO") {
            // Default to UF for Event Tope if no header info contradicts
            return { scope, kind: "TOPE_UF", value: val, raw, byBlock: block.id };
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

export function isExclusiveModalityLock(text: string): boolean {
    const t = text.toLowerCase();
    // Deterministic patterns for Exclusive Modality Lock (Kill Switch)
    return (
        t.match(/(solo|exclusivo|únicamente|unicamente).*libre\s+elecc/i) !== null ||
        t.match(/no\s+aplica.*oferta\s+preferente/i) !== null ||
        t.match(/se\s+bonifica\s+solo\s+en\s+libre/i) !== null ||
        t.includes("medicamentos hospitalarios") ||
        t.includes("materiales clínicos") ||
        t.includes("materiales clinicos")
    );
}

export function isGreenLineBarrier(text: string): boolean {
    const t = text.toLowerCase();
    return (
        t.match(/(solo|únicamente|unicamente).*libre\s+elecci/i) !== null ||
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

export interface Tope {
    tipo: "SIN_TOPE" | "UF" | "AC2" | "VECES_ARANCEL" | "VARIABLE" | "REGLA_FINANCIERA" | null;
    valor?: number | null;
    factor?: number;           // For AC2: the multiplier (0.8, 2.0, etc.)
    sigla?: string;
    origen?: string;
    sin_tope_adicional?: boolean;  // True when AC2 is the only limit (no UF cap)
}

// Fixed ForensicOperator definition
export interface ForensicOperator {
    tipo: ForensicOperatorType;
    fuente_linea: string;
    detalle?: string;
    [key: string]: any;
}

export interface ContractOutput {
    contrato: {
        metadata: {
            origen: string;
            fuente: string;
            paginas_total: number;
            fecha_procesamiento: string;
            aranceles: {
                AC2: {
                    nombre: string;
                    unidad: string;
                    valor_pesos: number | null;
                }
            }
        };
        tabla_prestaciones: {
            ambito: string;
            herencia_vertical: boolean;
            oferta_preferente_paths: PreferentePath[];
            lineas: (LineaPrestacion | LineaEncabezado)[]; // or Linea[] if it includes headers
        };
    };
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

export interface PreferentePath {
    path_id: string;            // e.g. "PREF_A", "PREF_B", "PREF_C" o el mismo bloque_id
    modalidad_codigo?: string;  // A.1 / A.2
    porcentaje: number | null;
    tope: Tope;
    prestadores: string[];
    condiciones: string[];
    fuente: { pagina: number; linea_inicio: number; linea_fin: number };
}

export interface LineaPrestacion {
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

export interface LineaEncabezado {
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

export interface NfeBlock {
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
export function executeCanonizer(extractionData: any, expansionData?: ExpansionData) {
    if (!expansionData) {
        if (!fs.existsSync(EXPANSION_PATH)) {
            console.error("❌ Error: expansion_result.json missing");
            return null;
        }
        expansionData = JSON.parse(fs.readFileSync(EXPANSION_PATH, 'utf-8'));
    }

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

    // --- HEADER MAP EXTRACTION (Lines 1-20) ---
    const headerMap = new Map<number, string>();
    const linesToScan = (extractionData.lineas as ExtractionLine[]).slice(0, 20);
    for (const line of linesToScan) {
        if (!line.celdas) continue;
        for (const cell of line.celdas) {
            const t = cell.texto?.toUpperCase() || "";
            if (t.includes("TOPE") || t.includes("BONIFIC") || t.includes("COBERTURA") || t.includes("%") || t.includes("PLAN") || t.includes("AÑO") || t.includes("ANUAL")) {
                // If header found, store it. Prefer "TOPE" or "BONIFIC" over generic text.
                if (!headerMap.has(cell.indice_columna) || t.includes("TOPE") || t.includes("%") || t.includes("AÑO")) {
                    headerMap.set(cell.indice_columna, t);
                }
            }
        }
    }
    console.log("DETECTED HEADERS:", Object.fromEntries(headerMap));

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

    // State for Vertical Persistence ("Sticky" Logic)
    let lastExplicitPercentage: number | null = null;
    let lastExplicitValuesSource: string | null = null;

    // GIANT TABLE CONTEXT (Vertical Column Inheritance)
    const columnContext = new Map<number, ColumnContext>();

    for (const rawLine of (extractionData.lineas as ExtractionLine[])) {
        const lineId = `L${rawLine.pagina}_${rawLine.indice_linea}`;
        const textoLimpio = rawLine.texto_plano?.trim() || "";
        const asigs = asigByLine.get(`${rawLine.pagina}_${rawLine.indice_linea}`) || [];

        // --- DEBUG CABECERA ---
        if ((rawLine as any).cabecera_activa) {
            console.log(`DEBUG META: L${rawLine.pagina}_${rawLine.indice_linea} has Cabecera: `, JSON.stringify((rawLine as any).cabecera_activa));
        }
        // ----------------------

        // --- HEADER METADATA PARSING ---
        // If the line carries 'cabecera_activa', use it to prime the columnContext.
        if ((rawLine as any).cabecera_activa && Array.isArray((rawLine as any).cabecera_activa)) {
            (rawLine as any).cabecera_activa.forEach((headerText: any, idx: number) => {
                const colIndex = idx + 1; // 1-based index assumption
                if (headerText && typeof headerText === 'string') {
                    // Look for patterns like "PREFERENTE (Provider)"
                    if (headerText.match(/(PREFERENTE|CL[ÍI]NICA|HOSPITAL|CENTRO|RED|SALUD|INTEGRA)/i)) {
                        const existing = columnContext.get(colIndex) || { providers: [], source: `HEADER_META_${rawLine.pagina}` };
                        let potentialProvider = headerText;
                        const parenMatch = headerText.match(/\((.*?)\)/);
                        if (parenMatch) {
                            potentialProvider = parenMatch[1];
                        }
                        // Clean up "PREFERENTE 1"
                        potentialProvider = potentialProvider.replace(/PREFERENTE\s*\d*/i, "").trim();

                        if (potentialProvider.length > 3) {
                            existing.providers = [potentialProvider];
                            columnContext.set(colIndex, existing);
                            console.log(`CONTEXT HEADER UPDATE Col ${colIndex}:`, existing);
                        }
                    }
                }
            });
        }
        // --------------------------------

        // Reset Context on Section Headers (Heuristic)
        const isHeader = rawLine.texto_plano.match(/(HOSPITALARI|AMBULATORI|URGENCIA|MATERNIDAD|HONORARIOS|MEDICAMENTOS|MATERIALES)/i);
        if (isHeader) {
            // ONLY Clear Context if it's a MAIN Section Header AND NOT a Sub-Item
            if (rawLine.texto_plano.match(/(HOSPITALARI|AMBULATORI|URGENCIA|MATERNIDAD)/i) &&
                !rawLine.texto_plano.match(/(MEDICAMENTOS|HONORARIOS|MATERIALES|INSUMOS)/i)) {
                columnContext.clear();
            }
            currentInheritedState.herencia_cortada = false; // Reset inherited exclusion before newState creation
            // console.log(`CONTEXT RESET by Header: ${textoLimpio}`);
        }

        // Update Column Context
        if (rawLine.celdas) {
            for (const cell of rawLine.celdas) {
                const col = cell.indice_columna;
                const txt = cell.texto;
                if (!txt || txt.trim() === "") continue;

                // Extract Providers
                const providers = [];
                if (txt.match(/Clínica|Hospital|Centro|Red|Integramédica|Dávila/i)) { // Simple keyword heuristic
                    providers.push(txt.trim());
                }

                // Extract Percentage
                let pct = null;
                const pctMatch = txt.match(/(\d+)%/);
                if (pctMatch) pct = parseInt(pctMatch[1]);

                // GUARD: Context Poisoning Defense
                // Do not allow "Modalidad Institucional" or "Solo Libre Eleccion" to become the Provider Context.
                const validProviders = providers.filter(p => !p.match(/(MODALIDAD.*INSTITUCIONAL|SOLO.*LIBRE.*ELECCION)/i));

                if (validProviders.length > 0 || pct) {
                    const existing = columnContext.get(col) || { providers: [], source: lineId };
                    // Merge or Overwrite? 
                    // If new providers found, overwrite list. If only %, keep providers?
                    // Strategy: Overwrite if present.
                    if (validProviders.length > 0) existing.providers = validProviders;
                    if (pct) existing.percentage = pct;
                    existing.source = lineId; // Update source
                    columnContext.set(col, existing);
                    console.log(`CONTEXT UPDATE Col ${col}:`, existing);
                }
            }
        }

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
        const ops = detectOperators(block, headerMap);
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

        // --- EXCLUSIVE MODALITY LOCK (Kill Switch) ---
        // If the row text contains an absolute exclusion, we forbid preferred options.
        const isModalityLocked = isExclusiveModalityLock(textoLimpio);
        if (isModalityLocked) {
            currentState.herencia_cortada = true; // Lock vertical inheritance
            console.log(`[KILL SWITCH] Modality Lock triggered for: ${textoLimpio}`);
        }

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

            if (isExcluded && !textoLimpio.match(/(HOSPITALARI|AMBULATORI|URGENCIA|MATERNIDAD|HONORARIOS|MEDICAMENTOS|MATERIALES)/i)) {
                currentState.herencia_cortada = true;
            }

            // Base paths from Graph
            let pathsAplicables = (!currentState.herencia_cortada) ? preferentePathsForLine(rawLine.pagina, rawLine.indice_linea) : [];

            // --- GIANT TABLE INJECTION (Vertical Persistence) ---
            // If current row has specific empty columns (3, 5, etc.), check if we have inherited providers.
            if (!currentState.herencia_cortada) {
                const syntheticPaths: string[] = [];
                const checkCols = [3, 5];

                checkCols.forEach(col => {
                    const localCell = rawLine.celdas ? rawLine.celdas.find(c => c.indice_columna === col) : null;
                    const isLocalEmpty = !localCell || !localCell.texto || localCell.texto.trim() === "";

                    if (isLocalEmpty) {
                        const ctx = columnContext.get(col);
                        if (textoLimpio.includes("PABELLÓN")) {
                            console.log(`DEBUG GIANT: L${lineId} C${col} Empty? ${isLocalEmpty} Context? ${!!ctx} Providers: ${ctx?.providers}`);
                        }

                        if (ctx && ctx.providers.length > 0) {
                            // Synthesize Option ID
                            const syntheticId = `OPT_GIANT_${lineId}_C${col}`;

                            // Check if already registered
                            if (!preferentePathsById.has(syntheticId)) {
                                const newPath: any = { // Construct Output Type
                                    id: syntheticId,
                                    modalidad: "preferente",
                                    grupo_decisional: "PREFERENTE_RED",
                                    porcentaje: ctx.percentage || 90,
                                    // Use explicit tope if known, or generic. 
                                    // NOTE: Pabellon might have 2.0 AC2 local. 
                                    // Preferred options usually have their own tope. 
                                    // If context header implies "Sin Tope" (L63), we use it.
                                    tope: ctx.percentage === 70 ? { tipo: "SIN_TOPE" } : { tipo: "VARIABLE" },
                                    prestadores: [...ctx.providers],
                                    condiciones: [],
                                    fuente: {
                                        pagina: rawLine.pagina,
                                        linea_inicio: rawLine.indice_linea,
                                        linea_fin: rawLine.indice_linea
                                    }
                                };
                                preferentePathsById.set(syntheticId, newPath);
                                // IMPORTANT: Sync with Output List
                                output.contrato.tabla_prestaciones.oferta_preferente_paths.push(newPath);
                                console.log(`DEBUG GIANT: Injected ${syntheticId}`);
                            }
                            syntheticPaths.push(syntheticId);
                        }
                    } else if (textoLimpio.includes("PABELLÓN")) {
                        console.log(`DEBUG GIANT: L${lineId} C${col} NOT EMPTY: '${localCell?.texto}'`);
                    }
                });

                if (syntheticPaths.length > 0) {
                    pathsAplicables = [...pathsAplicables, ...syntheticPaths];
                }
            } else if (textoLimpio.includes("PABELLÓN")) {
                console.log(`DEBUG GIANT: L${lineId} Herencia Cortada!`);
            }

            let rowTopeLE: Tope | null = null;

            // Extract Restrictions from cells
            if (rawLine.celdas) {
                const nonEmptyCells = rawLine.celdas.filter(c => c.texto && c.texto.trim().length > 0);
                const lastCell = nonEmptyCells.length > 0 ? nonEmptyCells[nonEmptyCells.length - 1] : null;

                for (const cell of rawLine.celdas) {
                    const isLast = lastCell && cell.indice_columna === lastCell.indice_columna;
                    const cellText = cell.texto || "";

                    // HEURISTIC: If it's the last non-empty cell in a financial row, it's likely TOPE_ANUAL_NFE
                    // especially if it's a number or contains "Sin Tope".
                    let forcedScope: BlockScope | undefined = undefined;
                    if (isLast && (cellText.match(/^\d+([.,]\d+)?$/) || cellText.toLowerCase().includes("sin tope"))) {
                        forcedScope = "TOPE_ANUAL_NFE";
                    }

                    // Create pseudo-block for cell
                    const cellBlock: SemanticBlock = {
                        id: `${lineId}_C${cell.indice_columna}`,
                        text: cellText.trim(),
                        col: cell.indice_columna,
                        rowId: lineId,
                        segmentId: `SEG_C${cell.indice_columna}`,
                        effect: classifyBlockEffect(cellText),
                        scope: forcedScope || inferScope(cell.indice_columna, cellText)
                    };

                    if (prestacionName.includes("MARCOS Y CRISTALES") && cell.indice_columna > 6) {
                        console.log(`DEBUG MARCOS Col ${cell.indice_columna}: Text='${cellBlock.text}' Scope='${cellBlock.scope}' Forced='${forcedScope}'`);
                    }

                    const cellOps = detectOperators(cellBlock, headerMap);

                    // FILTER: Don't push useless OTRA/unknown ops for NFE, as they mask valid ones found later in row
                    const validOps = cellOps.filter(op => {
                        if (op.type === "TOPE_ANUAL_NFE") return op.restr.kind !== "OTRA";
                        return true;
                    });

                    if (prestacionName.includes("MARCOS Y CRISTALES") && cell.indice_columna > 6) {
                        console.log(`DEBUG MARCOS OPS (After Filter):`, JSON.stringify(validOps));
                    }

                    rowLocalOps.push(...validOps);
                    currentState = applyOperators(currentState, validOps);
                }
            }

            // Mapping State Restrictions to Legacy Logic (Hybrid Glue)
            // FORENSIC: Prioritize operators found in THIS row (rowLocalOps) over inherited ones
            // (Debug block removed for cleanup)

            // --- SPLIT UNIT HEURISTIC: Merge "Value" + "Unit" separated in columns ---
            // Example: Col 2="2.0", Col 4="veces AC2" -> TOPE_AC2 value 2.0
            // We are less strict: If we have a UF value (default guess) and an AC2 unit nearby, we merge.
            const valueOpIndex = rowLocalOps.findIndex(op => op.type === "TOPE_EVENTO" && op.restr.kind === "TOPE_UF");
            const unitAc2OpIndex = rowLocalOps.findIndex(op => op.type === "TOPE_EVENTO" && op.restr.kind === "TOPE_AC2");

            if (textoLimpio.includes("PABELLÓN AMBULATORIO")) {
                console.log("DEBUG PABELLON RAW OPS:", JSON.stringify(rowLocalOps, null, 2));
                console.log("DEBUG INDICES:", valueOpIndex, unitAc2OpIndex);
            }

            if (valueOpIndex !== -1 && unitAc2OpIndex !== -1) {
                // Merge into the AC2 Op
                const valOp = rowLocalOps[valueOpIndex];
                const unitOp = rowLocalOps[unitAc2OpIndex];

                // Update AC2 Op with the value from the other column
                (unitOp as any).restr.value = (valOp as any).restr.value;
                (unitOp as any).restr.raw += " + " + (valOp as any).restr.raw;
                // Remove the "UF" op (which was just a guess)
                rowLocalOps.splice(valueOpIndex, 1);
            }

            if (textoLimpio.includes("PABELLÓN AMBULATORIO")) {
                console.log("DEBUG PABELLON POST-MERGE OPS:", JSON.stringify(rowLocalOps, null, 2));
            }
            // --------------------------------------------------------------------------

            // --- TEXTUAL FORCE FIX (The "Desconfiado" Rule) ---
            // If we have a value (e.g. 2.0) detected as UF (default), but the text explicitly says "AC2",
            // we FORCE the unit to AC2. This overrides brittle column splitting.
            const hasAc2Text = textoLimpio.match(/\bAC2\b/i);
            const ufOpForForce = rowLocalOps.find(op => op.type === "TOPE_EVENTO" && (op as any).restr.kind === "TOPE_UF");
            const ac2OpForForce = rowLocalOps.find(op => op.type === "TOPE_EVENTO" && (op as any).restr.kind === "TOPE_AC2");

            if (hasAc2Text && ufOpForForce) {
                console.log("FORCE FIX APPLIED: Converting UF -> AC2 for", textoLimpio);
                // Mutate the UF op to be AC2
                (ufOpForForce as any).restr.kind = "TOPE_AC2";
                (ufOpForForce as any).restr.raw += " (Textual Force AC2)";
            }
            // --------------------------------------------------------------------------

            const localAc2Op = rowLocalOps.find(op => op.type === "TOPE_EVENTO" && (op as any).restr.kind === "TOPE_AC2") as any;
            const localUfOp = rowLocalOps.find(op => op.type === "TOPE_EVENTO" && (op as any).restr.kind === "TOPE_UF") as any;
            const localPctOp = rowLocalOps.find(op => op.type === "PORCENTAJE") as any;
            const localNfeOp = rowLocalOps.find(op => op.type === "TOPE_ANUAL_NFE") as any;

            const inheritedAc2Restr = currentState.restricciones.find(r => r.kind === "TOPE_AC2");
            const inheritedUfRestr = currentState.restricciones.find(r => r.kind === "TOPE_UF" && (r.scope === "TOPE_EVENTO" || r.scope === "FINANCIAL_DOMAIN"));
            const inheritedPctRestr = currentState.restricciones.find(r => r.kind === "PORCENTAJE");
            const inheritedNfeRestr = currentState.restricciones.find(r => r.scope === "TOPE_ANUAL_NFE");

            if (localAc2Op) {
                rowTopeLE = { tipo: "AC2", factor: localAc2Op.restr.value, origen: localAc2Op.restr.byBlock, sin_tope_adicional: true };
            } else if (localUfOp) {
                rowTopeLE = { tipo: "UF", valor: localUfOp.restr.value, origen: localUfOp.restr.byBlock };
            } else if (inheritedAc2Restr && inheritedAc2Restr.value) {
                rowTopeLE = { tipo: "AC2", factor: inheritedAc2Restr.value, origen: inheritedAc2Restr.byBlock, sin_tope_adicional: true };
            } else if (inheritedUfRestr && inheritedUfRestr.value) {
                rowTopeLE = { tipo: "UF", valor: inheritedUfRestr.value, origen: inheritedUfRestr.byBlock };
            }

            // Percentage Resolution & Sticky Logic
            let finalPct = 90; // Default

            // 1. Detect Explicit Local Percentage
            if (localPctOp && localPctOp.restr.value) {
                finalPct = localPctOp.restr.value;

                // Sticky Logic: Update persistence if valid
                lastExplicitPercentage = finalPct;
                lastExplicitValuesSource = lineId;

            } else if (lastExplicitPercentage !== null) {
                // 2. Vertical Fill (Sticky) - Apply if no local pct
                // ALLOW STICKY even if herencia_cortada is true (LE Mode)
                finalPct = lastExplicitPercentage;

                // CRITICAL: Push restriction to currentState
                const stickyRestr: Restriction = {
                    scope: "PORCENTAJE",
                    kind: "PORCENTAJE",
                    value: finalPct,
                    scope_raw: "PORCENTAJE",
                    raw: "Vertical Inheritance",
                    byBlock: lastExplicitValuesSource || "UNKNOWN"
                } as any;

                rowLocalOps.push({
                    type: "PORCENTAJE",
                    restr: stickyRestr
                });
                currentState.restricciones.push(stickyRestr);
            } else if (inheritedPctRestr && inheritedPctRestr.value) {
                // 3. Fallback to Global Inheritance (Header-based)
                finalPct = inheritedPctRestr.value;
            }

            // RESET Sticky Percentage on Section Boundaries
            if (textoLimpio.match(/HOSPITALARIA|AMBULATORIA|URGENCIA/i)) {
                lastExplicitPercentage = null;
            }

            // FORENSIC: Active Block NFE State Logic
            let nfeStatus = getNfeForLine(rawLine.pagina, rawLine.indice_linea, textoLimpio);

            // STOP NFE INHERITANCE if we have a local NFE Op
            if (localNfeOp) {
                const restr = localNfeOp.restr;
                nfeStatus = {
                    aplica: true,
                    valor: restr.kind === "SIN_TOPE" ? null : restr.value || null,
                    unidad: restr.kind !== "SIN_TOPE" ? "UF" : null,
                    bloque_id: restr.byBlock,
                    razon: restr.kind === "SIN_TOPE" ? "SIN_TOPE_EXPRESO" : "NFE_PROPIO",
                    fuente_linea: lineId,
                    clausula_activa: restr.kind === "SIN_TOPE"
                };
            } else if (inheritedNfeRestr && inheritedNfeRestr.value) {
                // Potentially use inherited if no local found
            }

            let nfeOp = localNfeOp; // Simplified variable reuse
            if (nfeOp) {
                // Already handled above
                if (nfeOp.restr.kind === "SIN_TOPE") {
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

            // --- EXCLUSIVE MODALITY LOCK (Kill Switch) ---
            // Force purge if explicitly locked, even if inheritance tried to leak in.
            if (isModalityLocked) {
                pathsAplicables = [];
                forensicOps.push({
                    tipo: "OP_LOCK_MODALIDAD" as any,
                    fuente_linea: lineId,
                    detalle: "Exclusión expresa: Solo Libre Elección"
                });
            }

            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId,
                id_logica: logicalId,
                tipo: "prestacion",
                nombre: prestacionName,
                contexto: {
                    modalidad_base: (currentState.herencia_cortada || isModalityLocked) ? "libre_eleccion" : "preferente",
                    tiene_libre_eleccion: true,
                    porcentaje_le: finalPct, // Used calculated pct
                    origen_porcentaje_le: "implicit_global",
                    heredada_desde: "ROOT", // Simplified
                    origen_herencia: (currentState.herencia_cortada || isModalityLocked) ? "explicit" : "inherited"
                },
                preferente: {
                    aplica: !currentState.herencia_cortada && !isModalityLocked && pathsAplicables.length > 0,
                    paths: (!currentState.herencia_cortada && !isModalityLocked) ? pathsAplicables : []
                },
                libre_eleccion: {
                    aplica: true, porcentaje: finalPct,
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

    // --- FINAL OUTPUT GENERATION ---
    const atomicResult: ContractOutput = {
        contrato: output.contrato
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(atomicResult, null, 2));
    console.log(`✅ Canonización atómica completa: ${output.contrato.tabla_prestaciones.lineas.length} líneas`);

    return atomicResult;
}

// Self-run if called directly
const isMain = import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) || process.argv[1].endsWith('execute_canonizer.ts');
if (isMain) {
    const ext = JSON.parse(fs.readFileSync(EXTRACTION_PATH, 'utf-8'));
    executeCanonizer(ext);
}
