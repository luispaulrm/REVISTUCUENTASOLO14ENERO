import fs from 'fs';
import path from 'path';

function summarize() {
    const files = fs.readdirSync('.').filter(f => f.startsWith('audit_package_') && f.endsWith('_v1.5.0.json'));
    console.log(`Summary of ${files.length} contracts:\n`);

    let passCount = 0;
    let failCount = 0;
    let rowIntegrityPass = 0;

    files.forEach(f => {
        const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
        const gates = data.qc_gates || {};
        const qm = data.quality_metrics || {};
        const status = qm.overall_status || 'UNKNOWN';

        if (status === 'PASS' || status === 'WARN') passCount++;
        else failCount++;

        if (gates.row_id_integrity === 'PASS') rowIntegrityPass++;

        console.log(`${f.replace('audit_package_', '').replace('_v1.5.0.json', '')}: ${status} | RowIntegrity: ${gates.row_id_integrity || 'N/A'} | BBox: ${gates.column_bbox_consistency || 'N/A'}`);
    });

    console.log(`\nFinal Stats:`);
    console.log(`Total: ${files.length}`);
    console.log(`Overall PASS/WARN: ${passCount}`);
    console.log(`Overall FAIL (NEEDS_REVIEW): ${failCount}`);
    console.log(`Row ID Integrity PASS Rate: ${((rowIntegrityPass / files.length) * 100).toFixed(1)}%`);
}

summarize();
