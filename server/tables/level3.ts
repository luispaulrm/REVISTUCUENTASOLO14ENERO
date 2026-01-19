// tables/level3.ts
import { Table, AuditJSON, AuditHallazgo } from "./types";
import { clampMoney, formatCLP, normText } from "./utils";

function humanEstado(cat?: string): string {
    if (cat === "A") return "IMPROCEDENTE (Exigible)";
    if (cat === "B") return "EN CONTROVERSIA";
    if (cat === "Z") return "INDETERMINADO";
    return "N/A";
}

/**
 * Regla crítica de estabilidad:
 * - Solo mostramos hallazgos sumables (no subsumidos) como filas.
 * - Si quieres "subtablas" por hallazgo, esto se puede expandir.
 */
export function buildLevel3Table(audit: AuditJSON): Table {
    const hallazgos = (audit.hallazgos ?? []).filter(h => !h.isSubsumed);

    const rows = hallazgos.map((h: AuditHallazgo, idx: number) => ({
        n: idx + 1,
        glosa: h.glosa ?? h.titulo ?? "(sin título)",
        categoria: humanEstado(h.categoria_final),
        monto: formatCLP(clampMoney(h.montoObjetado)),
        accion: h.recomendacion_accion ?? "-",
        evidencia: evidenceNeeded(h),
    }));

    return {
        id: "nivel3-probatorio",
        title: "Nivel 3 — Hallazgos probatorios (qué se impugna y qué evidencia falta)",
        description: "Tabla jurídica: no mezcla cálculo global; aterriza impugnaciones y solicitudes.",
        columns: [
            { key: "n", label: "#", align: "center" },
            { key: "glosa", label: "Hallazgo / Ítem", align: "left" },
            { key: "categoria", label: "Estado", align: "center" },
            { key: "monto", label: "Monto asociado", align: "right" },
            { key: "accion", label: "Acción", align: "left" },
            { key: "evidencia", label: "Qué falta / qué pedir", align: "left" },
        ],
        rows,
        footnote:
            "Esta tabla define el 'qué hacer'. La matemática del balance vive en Nivel 1; la composición vive en Nivel 2.",
    };
}

function evidenceNeeded(h: AuditHallazgo): string {
    const t = normText([h.glosa, h.titulo, h.codigos].filter(Boolean).join(" "));
    if (t.includes("OPACIDAD") || t.includes("SIN DESGLOSE") || t.includes("CAJA NEGRA")) {
        return "Solicitar reliquidación con desglose ítem a ítem (código, cantidad, valor unitario, criterio de cobertura y tope aplicado).";
    }
    if (t.includes("HOTELERIA") || t.includes("ALIMENTACION") || t.includes("UNBUNDLING")) {
        return "Exigir aclaración de destinatario (paciente vs acompañante) y fundamento del cobro separado; pedir extorno/nota de crédito si corresponde a régimen del paciente.";
    }
    return "Solicitar antecedentes de respaldo (glosa detallada, epicrisis/indicaciones, consumos, y documento formal de liquidación).";
}
