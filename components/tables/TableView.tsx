// components/TableView.tsx
import React from "react";
import type { Table } from "../../server/tables/types";

export function TableView({ table }: { table: Table }) {
    return (
        <div style={{ margin: "16px 0", padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{table.title}</div>
                {table.description && <div style={{ opacity: 0.8, marginTop: 4 }}>{table.description}</div>}
            </div>

            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr>
                            {table.columns.map((c) => (
                                <th
                                    key={c.key}
                                    style={{
                                        textAlign: c.align ?? "left",
                                        padding: "8px 10px",
                                        borderBottom: "1px solid #e5e7eb",
                                        fontSize: 12,
                                        opacity: 0.9,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map((r, i) => (
                            <tr key={i}>
                                {table.columns.map((c) => (
                                    <td
                                        key={c.key}
                                        style={{
                                            textAlign: c.align ?? "left",
                                            padding: "8px 10px",
                                            borderBottom: "1px solid #f1f5f9",
                                            verticalAlign: "top",
                                            fontSize: 13,
                                        }}
                                    >
                                        {String(r[c.key] ?? "")}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {table.footnote && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    {table.footnote}
                </div>
            )}
        </div>
    );
}
