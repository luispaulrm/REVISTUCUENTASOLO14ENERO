import fs from 'fs';

const SIG = 'COL_LE_PCT|COL_LE_TOPE_ANUAL|COL_LE_TOPE_EVENTO|COL_PREF_PCT|COL_PREF_TOPE_ANUAL|COL_PREF_TOPE_EVENTO|COL_PRESTACIONES';

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

function analyzeAnomalies() {
    const files = fs.readdirSync('.').filter(f => f.startsWith('audit_package_') && f.endsWith('_v1.5.0.json'));
    const familyA: AuditPackage[] = files
        .map(f => JSON.parse(fs.readFileSync(f, 'utf-8')) as AuditPackage)
        .filter(data => data.spatial_map.columns.map(c => c.column_id).sort().join('|') === SIG);

    console.log(`Analyzing ${familyA.length} family members for anomalies...\n`);

    // Target rows for comparison
    const targetRows = ['R_DIA_CAMA', 'R_HONORARIOS', 'R_UTI_UCI', 'R_PABELLON'];
    const targetCols = ['COL_PREF_PCT', 'COL_LE_PCT'];

    const stats: Record<string, Record<string, string[]>> = {};

    familyA.forEach(pkg => {
        const doc = pkg.metadata.source_document;

        targetRows.forEach(targetRow => {
            targetCols.forEach(col => {
                const key = `${targetRow}|${col}`;
                // Fuzzy match for row_id
                const assignment = pkg.assignments.find(a =>
                    (a.row_id === targetRow ||
                        a.row_id.includes(targetRow.replace('R_', ''))) &&
                    a.column_id === col
                );
                const val = assignment?.atoms[0]?.value || 'MISSING';

                if (!stats[key]) stats[key] = {};
                if (!stats[key][val]) stats[key][val] = [];
                stats[key][val].push(doc);
            });
        });
    });

    console.log("### ANOMALY REPORT ###\n");
    Object.entries(stats).forEach(([key, values]) => {
        console.log(`Metric: ${key}`);
        const entries = Object.entries(values);
        if (entries.length > 1) {
            console.log("  ⚠️ VARIANCE DETECTED:");
            entries.forEach(([val, docs]) => {
                console.log(`    - [${val}]: ${docs.length} docs (${docs.join(', ')})`);
            });
        } else {
            console.log(`  ✅ UNIFORM: [${entries[0][0]}]`);
        }
        console.log("");
    });
}

analyzeAnomalies();
