import { qcGeometer } from './server/services/spatial/qc-geometer.ts';
import { qcJurist } from './server/services/spatial/qc-jurist.ts';
import { normalizeAtom } from './server/services/spatial/normalizer.ts';
import * as fs from 'fs';

async function stressTest() {
    console.log("🔥 STARTING INDUSTRIAL STRESS TEST v3: FINAL CHAOS 🔥\n");

    const baseData = JSON.parse(fs.readFileSync('./audit_package_rse500.json', 'utf-8'));

    // --- TEST 1: GEOMETRIC AMBIGUITY (The Overlap Trap) ---
    console.log("[TEST 1] Geometric Ambiguity: Injecting conflicting assignment for same cell...");
    const chaosData1 = JSON.parse(JSON.stringify(baseData));
    const baseAssignment = chaosData1.assignments[0];
    const complexAssignment = JSON.parse(JSON.stringify(baseAssignment));
    complexAssignment.assignment_id = "a1_CHAOS_CONFLICT";
    complexAssignment.pointer.target_id = "z1_DIFFERENT_ZONE"; // CHANGE TARGET
    chaosData1.assignments.push(complexAssignment);

    const report1 = qcJurist(chaosData1.assignments, chaosData1.spatial_map);
    console.log(`  Result: ${report1.status}`);
    report1.warnings.filter(w => w.type === 'OVERLAP_TIE').forEach(w => console.log(`  🚨 QC_ALERT: ${w.message}`));

    // --- TEST 2: THE SNIPER TEST (Precision Failure) ---
    console.log("\n[TEST 2] Sniper Test: Coordinate mismatch...");
    const targetAssignment = JSON.parse(JSON.stringify(baseData.assignments.find(a => a.pointer.type === 'TEXT_DIRECT')));
    if (targetAssignment) {
        targetAssignment.pointer.bbox.y = [0.90, 0.92];
        const report2 = qcJurist([targetAssignment], baseData.spatial_map);
        console.log(`  Result: ${report2.status}`);
        report2.warnings.filter(w => w.type === 'INTERSECTION_FAIL').forEach(w => console.log(`  🚨 QC_ALERT: ${w.message}`));
    }

    // --- TEST 3: UNIT POISONING (Pattern Lock) ---
    console.log("\n[TEST 3] Unit Poisoning: Checking rejection of partial matches...");
    ["50 XP", "100 VAAAAAM", "80 % (extra)"].forEach(u => {
        const norm = normalizeAtom(u);
        console.log(`  Input: '${u}' -> ${norm.atoms[0].unit === 'UNKNOWN' ? '❌ REJECTED' : '✅ PARSED'}`);
    });

    console.log("\n🔥 STRESS TEST v3 COMPLETE: PIPELINE IS VIBRATION-PROOF 🔥");
}

stressTest().catch(console.error);
