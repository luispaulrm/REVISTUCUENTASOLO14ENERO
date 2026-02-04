import { qcGeometer } from './server/services/spatial/qc-geometer.ts';
import { qcJurist } from './server/services/spatial/qc-jurist.ts';
import { packageAuditBundle } from './server/services/spatial/packager.ts';
import * as fs from 'fs';

async function generatePle847() {
    console.log("Generating PLE847 v1.3 Audit Package...");

    const spatialMap = JSON.parse(fs.readFileSync('./spatial_map_ple847.json', 'utf-8'));
    const assignmentsData = JSON.parse(fs.readFileSync('./assignments_ple847.json', 'utf-8'));

    // 1. Normalize Rows (row_model -> rows)
    spatialMap.rows = spatialMap.row_model.map(r => ({
        row_id: r.row_id,
        y_range: r.y_range,
        raw_text: r.text || r.raw_text,
        text_hash: r.text_hash || 'p2_h123'
    }));
    delete spatialMap.row_model;

    // 2. Normalize Columns to ATOMIC IDs
    const colMap = {
        "C1_PRESTACIONES": "COL_PRESTACIONES",
        "C2_PCT": "COL_PREF_PCT",
        "C3_TOPE_1": "COL_PREF_TOPE_EVENTO",
        "C4_TOPE_MAX_2": "COL_PREF_TOPE_ANUAL",
        "C5_TOPE_INT_3": "COL_LE_TOPE_EVENTO",
        "C6_AMPLIACION_4": "COL_AMPLIACION"
    };
    spatialMap.columns.forEach(col => {
        if (colMap[col.column_id]) col.column_id = colMap[col.column_id];
    });

    // 3. Normalize Assignments and flatten the nested results
    const flattenedAssignments = [];
    assignmentsData.assignments.forEach(rowGroup => {
        Object.keys(rowGroup.results).forEach(colId => {
            const result = rowGroup.results[colId];
            const targetColId = colMap[colId] || colId;

            flattenedAssignments.push({
                assignment_id: `a2_${rowGroup.row_id}_${targetColId}`,
                row_id: rowGroup.row_id,
                column_id: targetColId,
                pointer: {
                    type: result.type === 'ZONE_ASSIGNED' ? 'ZONE_REFERENCE' : 'TEXT_DIRECT',
                    target_id: result.source_zone || (result.type === 'ZONE_ASSIGNED' ? 'ZONE_EXCEPCION_CLINICAS' : undefined),
                    raw_text: result.value?.toString() || ""
                },
                atoms: [
                    {
                        type: 'RULE',
                        key: result.type,
                        value: result.value,
                        unit: result.unit
                    }
                ],
                status: 'VALID'
            });
        });
    });

    const geoReport = qcGeometer(spatialMap);
    const jurReport = qcJurist(flattenedAssignments, spatialMap);

    const finalPackage = packageAuditBundle(
        { source_document: 'PLAN PLENO PLE 847', page: 2 },
        spatialMap,
        flattenedAssignments,
        geoReport,
        jurReport
    );

    fs.writeFileSync('./audit_package_ple847.json', JSON.stringify(finalPackage, null, 2));
    console.log("Success: audit_package_ple847.json created.");
}

generatePle847().catch(console.error);
