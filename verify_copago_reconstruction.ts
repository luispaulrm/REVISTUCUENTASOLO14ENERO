
import { ArithmeticReconstructor } from './server/services/reconstruction.service.js';
import { ExtractedAccount } from './types.js';

console.log("=== VERIFYING COPAGO-AWARE RECONSTRUCTION (FINAL) ===");

const mockBill: ExtractedAccount = {
    sections: [
        {
            category: "EXAMENES",
            items: [
                { index: 1, description: "GASA ESTERIL", total: 1000, copago: 200 },
                { index: 2, description: "SUTURA SEDA", total: 2000, copago: 400 },
                { index: 3, description: "JERINGA 10CC", total: 3000, copago: 600 }
            ]
        }
    ]
} as any;

// Case 1: Match against Copago sum
console.log("\nCase 1: Target $600 (Copago matching)");
const rec1 = new ArithmeticReconstructor(mockBill);
const result1 = rec1.findMatches(600, "MATERIALES");

if (result1.success && result1.matchedItems.length >= 1) {
    console.log("[PASS] Successfully matched against Copago amounts.");
    console.log(`- Items: ${result1.matchedItems.map(i => i.description).join(", ")}`);
    console.log(`- Rationale: ${result1.compatibilityRationale}`);
} else {
    console.log("[FAIL] Failed to match against Copago sum.");
}

// Case 2: Match against Gross Total sum (fallback)
console.log("\nCase 2: Target $3000 (Gross Total fallback)");
const rec2 = new ArithmeticReconstructor(mockBill);
const result2 = rec2.findMatches(3000, "MATERIALES");

if (result2.success && result2.matchedItems.length === 1 && result2.matchedItems[0].index === 3) {
    console.log("[PASS] Successfully matched against Gross Total amount (fallback).");
} else {
    console.log("[FAIL] Failed to match against Gross Total.");
}

console.log("\n=== RECONSTRUCTION VERIFICATION COMPLETE ===");
