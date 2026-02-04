import { qcGeometer } from './server/services/spatial/qc-geometer.ts';
import { qcJurist } from './server/services/spatial/qc-jurist.ts';
import { normalizeAll } from './server/services/spatial/normalizer.ts';
import { packageAuditBundle } from './server/services/spatial/packager.ts';
import * as fs from 'fs';

async function runTest() {
    console.log("--- INDUSTRIAL PIPELINE SMOKE TEST (v1.3) ---");

    // 1. Load data
    const rawData = JSON.parse(fs.readFileSync('./audit_package_rse500.json', 'utf-8'));

    // 2. Test QC-Geometer
    console.log("\n[1] Testing QC-Geometer...");
    const geoReport = qcGeometer(rawData.spatial_map);
    console.log(`Status: ${geoReport.status}`);
    console.log(`Metrics: Rows=${geoReport.metrics.row_count}, AtomicCols=${geoReport.metrics.atomic_columns}`);

    // 3. Test Normalizer (The "Driver")
    console.log("\n[2] Testing Normalizer (Parsing Patterns)...");
    const sampleValues = ["16,0 UF", "Sin Tope", "60 VAM", "Solo cobertura libre elección"];
    const normalizationResult = normalizeAll(sampleValues);
    normalizationResult.atoms.forEach((atom, i) => {
        console.log(`  '${sampleValues[i]}' -> { value: ${atom.value}, unit: '${atom.unit}' }`);
    });

    // 4. Test QC-Jurist (Bounding Box Intersection)
    console.log("\n[3] Testing QC-Jurist (Validation)...");
    const jurReport = qcJurist(rawData.assignments, rawData.spatial_map);
    console.log(`Status: ${jurReport.status}`);
    console.log(`Intersection Pass Rate: ${jurReport.metrics.intersection_pass_rate}%`);

    // 5. Test "Fail Case": Manually corrupting a column ID to C2+C3 (Merged)
    console.log("\n[4] Inducing Fail Case (Merged Column Detection)...");
    const corruptedMap = JSON.parse(JSON.stringify(rawData.spatial_map));
    corruptedMap.columns[1].column_id = "C2+C3"; // Forced merge error
    const failReport = qcGeometer(corruptedMap);
    console.log(`Corrupted Map Status: ${failReport.status}`);
    failReport.warnings.forEach(w => console.log(`  🚨 QC_ALERT: ${w.message}`));

    console.log("\n--- SMOKE TEST COMPLETE ---");
}

runTest().catch(console.error);
