// components/tables/AuditTablesSection.tsx
import React, { useMemo } from "react";
import type { AuditJSON, PamJSON, CuentaJSON } from "../../../server/tables/types";
import { buildAllTables } from "../../../server/tables/buildAll";
import { TableView } from "./TableView";

export function AuditTablesSection(props: {
    audit: AuditJSON;
    pam?: PamJSON | null;
    cuenta?: CuentaJSON | null;
}) {
    const tables = useMemo(() => buildAllTables(props), [props.audit, props.pam, props.cuenta]);

    return (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
            <h2 style={{ fontSize: 22, margin: "8px 0 16px" }}>Tablas de Auditoría (3 niveles)</h2>

            {props.audit.decisionGlobal?.fundamento && (
                <div style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "24px",
                    whiteSpace: "pre-wrap",
                    fontFamily: "sans-serif",
                    color: "#334155",
                    fontSize: "14px",
                    lineHeight: "1.6"
                }}>
                    <strong>Fundamento del Cierre Contable:</strong><br /><br />
                    {props.audit.decisionGlobal.fundamento}
                </div>
            )}

            {(tables || []).map((t) => (
                <TableView key={t.id} table={t} />
            ))}
        </div>
    );
}
