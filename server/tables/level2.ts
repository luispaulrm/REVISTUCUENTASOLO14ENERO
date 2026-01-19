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
    const buckets = new Map<string, number>();
    for (const it of items) {
        const desc = it.descripcion ?? "";
        const sec = it.seccion ?? "";
        const amount = clampMoney(it.total);
        const rule = rules.find(r => r.match(desc, sec)) ?? rules[rules.length - 1];
        buckets.set(rule.groupName, (buckets.get(rule.groupName) ?? 0) + amount);
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
    const matRows = [...matBuckets.entries()]
        .map(([grupo, total]) => ({ grupo, total: formatCLP(total) }))
        .sort((a, b) => (a.grupo > b.grupo ? 1 : -1));
    matRows.push({ grupo: "TOTAL (Cuenta)", total: formatCLP(sum([...matBuckets.values()])) });

    tables.push({
        id: "nivel2-materiales",
        title: "Nivel 2 — Cuenta Clínica (Agrupación matemática de Materiales)",
        description: "Agrupa ítems detallados en grupos técnicos para sumar y explicar composición.",
        columns: [
            { key: "grupo", label: "Grupo técnico", align: "left" },
            { key: "total", label: "Total", align: "right" },
        ],
        rows: matRows,
        footnote: "Importante: esta suma describe la Cuenta Clínica; no prueba por sí sola cómo el PAM determinó el copago.",
    });

    // Tabla hotelería/alimentación (solo composición)
    const hotBuckets = groupItems(hoteleria, HOTELERIA_RULES);
    const hotRows = [...hotBuckets.entries()]
        .map(([grupo, total]) => ({ grupo, total: formatCLP(total) }))
        .sort((a, b) => (a.grupo > b.grupo ? 1 : -1));
    hotRows.push({ grupo: "TOTAL (Cuenta)", total: formatCLP(sum([...hotBuckets.values()])) });

    tables.push({
        id: "nivel2-hoteleria",
        title: "Nivel 2 — Cuenta Clínica (Agrupación matemática de Hotelería/Alimentación detectada)",
        description: "Señala cuánto del detalle luce como hotelería/alimentación/comfort en la cuenta.",
        columns: [
            { key: "grupo", label: "Grupo", align: "left" },
            { key: "total", label: "Total", align: "right" },
        ],
        rows: hotRows,
        footnote: "Esto alimenta el Nivel 3 (probatorio). No se mezcla con el Nivel 1.",
    });

    return tables;
}
