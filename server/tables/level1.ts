// tables/level1.ts
import { Table, PamJSON, AuditJSON, AuditCategoriaFinal, AuditHallazgo } from "./types";
import { sum, clampMoney, normText, formatCLP } from "./utils";

type L1RowState = "VALIDABLE" | "EN_CONTROVERSIA" | "INDETERMINADO" | "IMPROCEDENTE";

function categoriaFromHallazgo(h: AuditHallazgo): L1RowState {
    const cat = h.categoria_final;
    if (cat === "A") return "IMPROCEDENTE";
    if (cat === "B") return "EN_CONTROVERSIA";
    if (cat === "Z") return "INDETERMINADO";
    return "INDETERMINADO";
}

function inferPamGroup(desc: string): string {
    const d = normText(desc);
    if (d.includes("HONOR")) return "HONORARIOS";
    if (d.includes("DIA CAMA") || d.includes("HOSPITAL")) return "DIA CAMA / HOSPITALIZACION";
    if (d.includes("PABELLON") || d.includes("QUIROFANO") || d.includes("DERECHO DE PABELLON")) return "PABELLON";
    if (d.includes("MATERIAL")) return "MATERIALES";
    if (d.includes("MEDICAMENTO") || d.includes("FARMAC")) return "MEDICAMENTOS";
    if (d.includes("SIN BONIFIC") || d.includes("PRESTACIONES SIN BONIFICACION")) return "SIN BONIFICACION";
    return "OTROS";
}

/**
 * Regla: el Nivel 1 se arma desde PAM (si existe), y se colorea/etiqueta
 * con hallazgos (si un hallazgo apunta a un grupo, le cambia el estado).
 *
 * Para tu caso Santiago: queremos que "MATERIALES" y "MEDICAMENTOS" queden
 * EN_CONTROVERSIA por opacidad estructural, y "SIN BONIFICACION" pueda ser A o Z
 * según la regla final que adoptes.
 */
export function buildLevel1Table(pam: PamJSON | null, audit: AuditJSON): Table {
    const pamItems = pam?.items ?? [];
    const hallazgos = (audit.hallazgos ?? []).filter(h => !h.isSubsumed);

    // 1) agrupar copago por grupo PAM inferido
    const groupToCopago = new Map<string, number>();
    for (const it of pamItems) {
        const g = it.grupo ? it.grupo : inferPamGroup(it.descripcion);
        const prev = groupToCopago.get(g) ?? 0;
        groupToCopago.set(g, prev + clampMoney(it.copago));
    }

    // si no hay PAM, igual podemos mostrar tabla mínima desde resumenFinanciero/hallazgos
    const fallbackTotal = clampMoney(audit.resumenFinanciero?.totalCopagoInformado);

    // 2) mapear hallazgos a grupos (heurística simple por palabras)
    function hallazgoTargetsGroup(h: AuditHallazgo, group: string): boolean {
        const t = normText([h.titulo, h.glosa, h.codigos].filter(Boolean).join(" "));
        const g = normText(group);
        if (g.includes("MATERIALES") && t.includes("MATERIALES")) return true;
        if (g.includes("MEDICAMENTOS") && t.includes("MEDICAMENTOS")) return true;
        if (g.includes("SIN BONIFIC") && (t.includes("SIN BONIFIC") || t.includes("HOTELERIA") || t.includes("ALIMENTACION"))) return true;
        return false;
    }

    const rows: any[] = [];

    if (pamItems.length > 0) {
        for (const [group, copago] of [...groupToCopago.entries()].sort()) {
            // estado por defecto: validable (hasta que un hallazgo lo cambie)
            let estado: L1RowState = "VALIDABLE";
            let accion = "OK";
            const hits = hallazgos.filter(h => hallazgoTargetsGroup(h, group));

            // prioridad: A (improcedente) > Z (indeterminado) > B (controversia)
            // OJO: tú puedes invertir Z/B según doctrina; aquí dejo un orden razonable.
            const cats = hits.map(h => h.categoria_final).filter(Boolean) as AuditCategoriaFinal[];
            if (cats.includes("A")) {
                estado = "IMPROCEDENTE";
                accion = "IMPUGNAR / EXTORNO";
            } else if (cats.includes("Z")) {
                estado = "INDETERMINADO";
                accion = "SOLICITAR ACLARACION";
            } else if (cats.includes("B")) {
                estado = "EN_CONTROVERSIA";
                accion = "SOLICITAR DESGLOSE / RELIQUIDACION";
            }

            rows.push({
                categoria: group,
                copago: formatCLP(copago),
                estado,
                accion,
                fuente: hits.length ? `Hallazgos: ${hits.length}` : "PAM",
            });
        }

        const totalCopago = sum([...groupToCopago.values()]);
        rows.push({
            categoria: "TOTAL",
            copago: formatCLP(totalCopago),
            estado: "-",
            accion: "-",
            fuente: "-",
        });
    } else {
        // fallback minimalista
        rows.push({
            categoria: "TOTAL (sin PAM)",
            copago: formatCLP(fallbackTotal),
            estado: audit.decisionGlobal?.estado ?? "-",
            accion: "REQUIERE PAM",
            fuente: "resumenFinanciero",
        });
    }

    return {
        id: "nivel1-control-global",
        title: "Nivel 1 — Control Global (PAM → Copago por categoría + estado)",
        description:
            "Tabla balance. Cierra matemáticamente y etiqueta cada bloque según hallazgos (A/B/Z).",
        columns: [
            { key: "categoria", label: "Categoría PAM", align: "left" },
            { key: "copago", label: "Copago", align: "right" },
            { key: "estado", label: "Estado", align: "center" },
            { key: "accion", label: "Acción", align: "left" },
            { key: "fuente", label: "Fuente", align: "left" },
        ],
        rows,
        footnote:
            "Regla: esta tabla es la fuente de verdad del 'balance' (no se contamina con detalle de cuenta clínica).",
    };
}

export function buildReconciliationTable(audit: AuditJSON): Table {
    // Retrieve values from updated audit structure
    const rf = audit.resumenFinanciero || {};
    const catA = clampMoney(rf.cobros_improcedentes_exigibles); // Cat A
    const catB = clampMoney(rf.copagos_bajo_controversia);      // Cat B
    const catZ = clampMoney(rf.monto_indeterminado);            // Cat Z
    const catOK = clampMoney(rf.monto_no_observado);            // Cat OK (Calculated in auditEngine)
    const totalReal = clampMoney(rf.totalCopagoReal);

    // If totalReal is not populated (old audit), use sum of parts + fallback
    const totalDisplayed = totalReal > 0 ? totalReal : (catA + catB + catOK + catZ);

    const rows = [
        {
            categoria: "Cat A (Improcedente)",
            monto: formatCLP(catA),
            estado: "Exigible / Improcedente",
            significado: "Cobro objetado con evidencia"
        },
        {
            categoria: "Cat B (En controversia)",
            monto: formatCLP(catB),
            estado: "En controversia",
            significado: "Copago no auditable por opacidad"
        },
        {
            categoria: "Cat OK (No observado)",
            monto: formatCLP(catOK),
            estado: "No observado",
            significado: "Copago no impugnado"
        },
        {
            categoria: "Cat Z (Indeterminado)",
            monto: formatCLP(catZ),
            estado: "Indeterminado",
            significado: "Sin información"
        },
        {
            categoria: "TOTAL",
            monto: formatCLP(totalDisplayed),
            estado: "—",
            significado: "Cierre contable"
        }
    ];

    return {
        id: "nivel1-reconciliacion",
        title: "Tabla de Reconciliación Total del Copago",
        description: "Diagnóstico exacto de cierre contable.",
        columns: [
            { key: "categoria", label: "Categoría", align: "left" },
            { key: "monto", label: "Monto", align: "right" },
            { key: "estado", label: "Estado", align: "left" },
            { key: "significado", label: "Significado", align: "left" },
        ],
        rows,
        footnote: "Con esta tabla, el copago CIERRA."
    };
}
