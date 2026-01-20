// tables/buildAll.ts
import type { AuditJSON, PamJSON, CuentaJSON, Table } from "./types";
import { buildLevel1Table, buildReconciliationTable } from "./level1";
import { buildLevel2Tables } from "./level2";
import { buildLevel3Table } from "./level3";

export function buildAllTables(input: {
    audit: AuditJSON;
    pam?: PamJSON | null;
    cuenta?: CuentaJSON | null;
}): Table[] {
    const { audit, pam = null, cuenta = null } = input;
    const out: Table[] = [];

    out.push(buildReconciliationTable(audit));
    out.push(buildLevel1Table(pam, audit));
    out.push(...buildLevel2Tables(cuenta));
    out.push(buildLevel3Table(audit));

    return out;
}
