
import {
    Block, BlockEffect, BlockScope, LineState, OptionGraph, Restriction,
    SemanticOperator, LatentOption, intersectsScope, OptionNode, Modalidad
} from "./core_types.ts";

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

    // Columnas (AJUSTA a tu tabla real):
    // Ej: col5/6 = evento, col7 = anual/NFE
    if (col === 5 || col === 6) return "TOPE_EVENTO";
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

export function detectOperators(block: Block): SemanticOperator[] {
    const ops: SemanticOperator[] = [];
    const t = block.text.toLowerCase();

    // Línea verde / barrera semántica
    if (t.includes("solo") && t.includes("libre elecci")) {
        ops.push({ type: "HERENCIA_CORTADA", byBlock: block.id });
    }

    // Cambio dominio (meds/mats/transfers/etc.)
    if (
        t.includes("medic") ||
        t.includes("material") ||
        t.includes("traslado") ||
        t.includes("prótesis") || t.includes("protesis") ||
        t.includes("órtesis") || t.includes("ortesis") ||
        t.includes("osteosíntesis") || t.includes("osteosintesis") ||
        t.includes("quimioterapia")
    ) {
        ops.push({ type: "CAMBIO_DOMINIO_FINANCIERO", byBlock: block.id });
    }

    // Restricciones por scope
    const effect = block.effect;
    const scope = block.scope;

    if (scope === "TOPE_EVENTO") {
        ops.push({ type: "TOPE_EVENTO", restr: parseRestriction(block, "TOPE_EVENTO") });
    }
    if (scope === "TOPE_ANUAL_NFE") {
        ops.push({ type: "TOPE_ANUAL_NFE", restr: parseRestriction(block, "TOPE_ANUAL_NFE") });
    }
    if (scope === "PORCENTAJE") {
        ops.push({ type: "PORCENTAJE", restr: parseRestriction(block, "PORCENTAJE") });
    }

    return ops;
}

// Parse básico: detecta SIN TOPE, UF, AC2 factor, porcentaje
export function parseRestriction(block: Block, scope: BlockScope): Restriction {
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

    // UF
    const mUf = raw.match(/(\d+([.,]\d+)?)\s*uf/i);
    if (mUf) {
        return { scope, kind: "TOPE_UF", value: Number(mUf[1].replace(",", ".")), raw, byBlock: block.id };
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

export function applyReExpansion(block: Block, state: LineState, memory: Memory, optGraph?: OptionGraph): LineState {
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

function limitState(block: Block, s: LineState, optGraph?: OptionGraph): LineState {
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

function expandState(block: Block, s: LineState, memory: Memory, optGraph?: OptionGraph): LineState {
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
