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


            {props.audit.valorUnidadReferencia && (
                <div style={{
                    backgroundColor: "#e0e7ff",
                    border: "1px solid #4f46e5",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "24px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px"
                }}>
                    <div style={{
                        backgroundColor: "#4f46e5",
                        color: "white",
                        borderRadius: "50%",
                        width: "32px",
                        height: "32px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "bold"
                    }}>
                        ⚖️
                    </div>
                    <div>
                        <div style={{ fontSize: "12px", color: "#4338ca", fontWeight: "bold", textTransform: "uppercase" }}>
                            Deducción Forense (RTC NORM)
                        </div>
                        <div style={{ fontSize: "20px", fontWeight: "bold", color: "#312e81" }}>
                            {props.audit.valorUnidadReferencia}
                        </div>
                    </div>
                </div>
            )}

            {(tables || []).map((t) => (
                <TableView key={t.id} table={t} />
            ))}
        </div>
    );
}

