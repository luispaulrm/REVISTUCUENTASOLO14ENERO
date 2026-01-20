// tables/level2.ts
import { Table, CuentaJSON, PamJSON } from "./types";
import { sum, clampMoney, normText, formatCLP } from "./utils";

type GroupRule = {
    groupName: string;
    match: (desc: string, seccion?: string) => boolean;
};

const MATERIAL_RULES: GroupRule[] = [
    { groupName: "Kits / Implantes / Sistemas", match: (d) => /KIT|FLAPFIX|IMPLANTE|SISTEMA|SET/i.test(d) },
    { groupName: "Hemostáticos / Sellantes", match: (d) => /SURGIFLO|SURGICEL|HEMOST|FIBRIL/i.test(d) },
    { groupName: "Instrumental descartable", match: (d) => /PINZA|BIPOLAR|FUNDA|PROTECTORA/i.test(d) },
    { groupName: "Fresas / Brocas", match: (d) => /FRESA|BROCA/i.test(d) },
    { groupName: "Catéteres / Accesos", match: (d) => /CAT( |.)?VENOSO|CENT/i.test(d) },
    { groupName: "Otros materiales", match: (_d) => true },
];

const HOTELERIA_RULES: GroupRule[] = [
    { groupName: "Alimentación", match: (d, s) => /ALMUERZO|CENA|DESAYUNO|REGIMEN/i.test(d) || /ALIMENTACION/i.test(s ?? "") },
    { groupName: "Kits / Aseo / Confort", match: (d) => /KIT INGRESO|PAÑO|TOALLA|ASEO|CONFORT/i.test(d) },
    { groupName: "Equipamiento básico", match: (d) => /TERMOMETRO/i.test(d) },
    { groupName: "Otros (revisar)", match: (_d) => true },
];

function groupItems(items: { descripcion: string; seccion?: string; total?: number }[], rules: GroupRule[]) {
    const buckets = new Map<string, { total: number; count: number }>();
    for (const it of items) {
        const desc = it.descripcion ?? "";
        const sec = it.seccion ?? "";
        const amount = clampMoney(it.total);
        const rule = rules.find(r => r.match(desc, sec)) ?? rules[rules.length - 1];

        const prev = buckets.get(rule.groupName) ?? { total: 0, count: 0 };
        buckets.set(rule.groupName, { total: prev.total + amount, count: prev.count + 1 });
    }
    return buckets;
}

/**
 * Construye tablas de agrupación matemática desde CUENTA.
 * - No depende del PAM.
 * - Sirve para explicar "de qué está hecho" el bloque, aunque el PAM lo oculte.
 */
export function buildLevel2Tables(cuenta: CuentaJSON | null): Table[] {
    const items = cuenta?.items ?? [];
    if (!items.length) return [];

    // Heurística de "materiales" por sección o keyword
    const materiales = items.filter(it => {
        const d = normText(it.descripcion);
        const s = normText(it.seccion ?? "");
        return s.includes("MATERIALES") || d.includes("MATERIAL") || s.includes("FARMACIA") || s.includes("INSUM");
    });

    const hoteleria = items.filter(it => {
        const d = normText(it.descripcion);
        const s = normText(it.seccion ?? "");
        return s.includes("ALIMENTACION") || d.includes("ALMUERZO") || d.includes("KIT INGRESO") || d.includes("TERMOMETRO") || d.includes("PAÑO");
    });

    const tables: Table[] = [];

    // Tabla materiales
    const matBuckets = groupItems(materiales, MATERIAL_RULES);
    const matTotalSum = sum([...matBuckets.values()].map(v => v.total));
    const matTotalCount = sum([...matBuckets.values()].map(v => v.count));

    const matRows = [...matBuckets.entries()]
        .map(([grupo, val]) => ({
            grupo,
            count: val.count.toString(),
            total: formatCLP(val.total)
        }))
        .sort((a, b) => (a.grupo > b.grupo ? 1 : -1));

    matRows.push({
        grupo: "TOTAL",
        count: `${matTotalCount} ítems`,
        total: formatCLP(matTotalSum)
    });

    // Checksum row
    matRows.push({
        grupo: "Checksum de verificación",
        count: "Σ ítems",
        total: `${formatCLP(matTotalSum)} ✔`
    });

    const descriptionText = `
        La cuenta clínica contiene más de ${matTotalCount} ítems individuales en esta sección.
        Para optimizar visualización, no se listan individualmente.
        Sin embargo, se presenta un resumen de composición que demuestra que el total cobrado (${formatCLP(matTotalSum)}) se distribuye en múltiples categorías de insumos.
        La presencia de ítems no clínicos dentro de esta agregación refuerza la imposibilidad de validar el copago desde el PAM.
    `.replace(/\s+/g, ' ').trim();

    tables.push({
        id: "nivel2-materiales",
        title: "Nivel 2 — Resumen de Composición (Materiales)",
        description: descriptionText,
        columns: [
            { key: "grupo", label: "Tipo de insumo", align: "left" },
            { key: "count", label: "Nº Ítems", align: "center" },
            { key: "total", label: "Total", align: "right" },
        ],
        rows: matRows,
        footnote: "Regla forense: Nunca ocultar volumen sin mostrar agregación verificable."
    });

    // Tabla hotelería/alimentación (solo composición)
    const hotBuckets = groupItems(hoteleria, HOTELERIA_RULES);
    const hotTotalSum = sum([...hotBuckets.values()].map(v => v.total));
    const hotTotalCount = sum([...hotBuckets.values()].map(v => v.count));

    const hotRows = [...hotBuckets.entries()]
        .map(([grupo, val]) => ({
            grupo,
            count: val.count.toString(),
            total: formatCLP(val.total)
        }))
        .sort((a, b) => (a.grupo > b.grupo ? 1 : -1));

    hotRows.push({
        grupo: "TOTAL",
        count: `${hotTotalCount} ítems`,
        total: formatCLP(hotTotalSum)
    });

    // Checksum row
    hotRows.push({
        grupo: "Checksum de verificación",
        count: "Σ ítems",
        total: `${formatCLP(hotTotalSum)} ✔`
    });

    tables.push({
        id: "nivel2-hoteleria",
        title: "Nivel 2 — Resumen de Composición (Hotelería/Alimentación)",
        description: "Resumen forense de alta densidad para ítems de hotelería detectados.",
        columns: [
            { key: "grupo", label: "Grupo", align: "left" },
            { key: "count", label: "Nº Ítems", align: "center" },
            { key: "total", label: "Total", align: "right" },
        ],
        rows: hotRows,
        footnote: "Esto alimenta el Nivel 3 (probatorio). No se mezcla con el Nivel 1."
    });

    return tables;
}
