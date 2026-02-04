import fs from 'fs';
import path from 'path';

interface AuditPackage {
    spatial_map: {
        columns: { column_id: string }[];
        rows: { row_id: string }[];
    };
    metadata: {
        source_document: string;
    };
}

function getSignatures() {
    const files = fs.readdirSync('.').filter(f => f.startsWith('audit_package_') && f.endsWith('_v1.5.0.json'));
    const clusters: Record<string, string[]> = {};

    files.forEach(f => {
        try {
            const data: AuditPackage = JSON.parse(fs.readFileSync(f, 'utf-8'));

            // 1. Column Signature (Sorted Column IDs)
            const colSig = data.spatial_map.columns.map(c => c.column_id).sort().join('|');

            // 2. Row Signature (Complexity level based on row count)
            const rowCount = data.spatial_map.rows.length;
            const rowLevel = rowCount < 5 ? 'LITE' : rowCount < 15 ? 'STANDARD' : 'COMPLEX';

            // Combine for Family Signature
            const familyId = `FAMILY[${colSig}][${rowLevel}]`;

            if (!clusters[familyId]) clusters[familyId] = [];
            clusters[familyId].push(data.metadata.source_document);
        } catch (e) {
            console.error(`Error processing ${f}:`, e);
        }
    });

    console.log(JSON.stringify(clusters, null, 2));
}

getSignatures();
