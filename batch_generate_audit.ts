import { qcGeometer } from './server/services/spatial/qc-geometer.ts';
import { qcJurist } from './server/services/spatial/qc-jurist.ts';
import { packageAuditBundle } from './server/services/spatial/packager.ts';
import * as fs from 'fs';

function generatePackage(baseName, docTitle, page) {
    console.log(`\n--- Processing ${baseName} ---`);

    const mapPath = `./spatial_map_${baseName}.json`;
    let assignPath = `./assignments_${baseName}.json`;

    if (baseName === 'rse500' || baseName === 'vprlu') {
        assignPath = `./final_spatial_assignments_${baseName}.json`;
    }

    if (!fs.existsSync(mapPath) || !fs.existsSync(assignPath)) {
        console.error(`Missing data for ${baseName}`);
        return;
    }

    const spatialMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    const assignmentsData = JSON.parse(fs.readFileSync(assignPath, 'utf-8'));

    const assignments = assignmentsData.assignments || assignmentsData.spatial_assignments || assignmentsData;

    const geoReport = qcGeometer(spatialMap);
    const jurReport = qcJurist(assignments, spatialMap);

    const finalPackage = packageAuditBundle(
        { source_document: docTitle, page: page },
        spatialMap,
        assignments,
        geoReport,
        jurReport
    );

    fs.writeFileSync(`./audit_package_${baseName}.json`, JSON.stringify(finalPackage, null, 2));
    console.log(`Saved audit_package_${baseName}.json (Final Status: ${finalPackage.quality_metrics.overall_status})`);
}

generatePackage('rse500', '13-RSE500-17-2', 1);
generatePackage('vprlu', 'VPRLU204B2', 1);
