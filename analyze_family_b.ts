import fs from 'fs';

interface Assignment {
    row_id: string;
    column_id: string;
    atoms: { value: string }[];
}

interface AuditPackage {
    spatial_map: {
        columns: { column_id: string }[];
        rows: { row_id: string }[];
    };
    assignments: Assignment[];
    metadata: {
        source_document: string;
    };
}

function analyzeFamilyB() {
    const files = fs.readdirSync('.').filter(f => f.startsWith('audit_package_') && f.endsWith('_v1.5.0.json'));
    const members = files.filter(f => {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        const hasLE = data.spatial_map.columns.some((c: any) => c.column_id === 'COL_LE_PCT');
        const rowCount = data.spatial_map.rows.length;
        return !hasLE && rowCount < 18;
    }).map(f => JSON.parse(fs.readFileSync(f, 'utf8')) as AuditPackage);

    console.log(`Analyzing ${members.length} Family B (Selective) members for anomalies...\n`);

    const targetRows = ['R_CIRUGIAS', 'R_CONSULTAS', 'R_URGENCIAS', 'R_TELEMEDICINA', 'R_SALUD_DENTAL'];
    const targetCols = ['COL_PREF_PCT', 'COL_PREF_TOPE_EVENTO'];

    const stats: Record<string, Record<string, string[]>> = {};

    members.forEach(pkg => {
        const doc = pkg.metadata.source_document;

        targetRows.forEach(targetRow => {
            targetCols.forEach(col => {
                const key = `${targetRow}|${col}`;
                const assignment = pkg.assignments.find(a =>
                    (a.row_id === targetRow || a.row_id.includes(targetRow.replace('R_', ''))) &&
                    a.column_id === col
                );
                const val = assignment?.atoms[0]?.value || 'MISSING';

                if (!stats[key]) stats[key] = {};
                if (!stats[key][val]) stats[key][val] = [];
                stats[key][val].push(doc);
            });
        });
    });

    console.log("### FAMILY B ANOMALY REPORT ###\n");
    Object.entries(stats).forEach(([key, values]) => {
        console.log(`Metric: ${key}`);
        const entries = Object.entries(values);
        if (entries.length > 1) {
            console.log("  ⚠️ VARIANCE DETECTED:");
            entries.forEach(([val, docs]) => {
                console.log(`    - [${val}]: ${docs.length} docs (${docs.join(', ')})`);
            });
        } else {
            console.log(`  ✅ UNIFORM: [${entries[0][0] || 'NONE'}]`);
        }
        console.log("");
    });
}

analyzeFamilyB();
