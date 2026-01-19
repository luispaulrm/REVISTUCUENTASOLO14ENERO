
// Mock subsetSumExact (copied from auditEngine logic for testing)
function subsetSumExact(target, items, maxNodes = 50000) {
    const values = items.map(i => i.total);
    const sortedIndices = items.map((_, i) => i).sort((a, b) => items[b].total - items[a].total);

    let nodes = 0;

    function dfs(idx, currentSum, chosenIndices) {
        nodes++;
        if (nodes > maxNodes) return null;

        if (currentSum === target) return chosenIndices;
        if (currentSum > target) return null;
        if (idx >= sortedIndices.length) return null;

        const originalIdx = sortedIndices[idx];
        const val = items[originalIdx].total;

        // Option 1
        const withItem = dfs(idx + 1, currentSum + val, [...chosenIndices, originalIdx]);
        if (withItem) return withItem;

        // Option 2
        return dfs(idx + 1, currentSum, chosenIndices);
    }

    const resultIndices = dfs(0, 0, []);
    if (resultIndices) return resultIndices.map(i => items[i]);
    return null;
}

// Test Case 1: Exact Match (Santiago's case)
const santiagoItems = [
    { description: "ALMUERZO", total: 12839 },
    { description: "ALMUERZO", total: 12839 },
    { description: "ALMUERZO", total: 12839 },
    { description: "ALMUERZO", total: 12839 },
    { description: "OTRO", total: 5000 }
];
const targetSantiago = 51356; // 4 * 12839

console.log("Test 1 (Santiago Match):");
const result1 = subsetSumExact(targetSantiago, santiagoItems);
console.log(result1 ? "✅ MATCH FOUND" : "❌ NO MATCH");
if (result1) console.log("Items:", result1.map(i => i.total));

// Test Case 2: No Match (PAM 66752 vs 4x12839)
const targetMismatch = 66752;
console.log("\nTest 2 (Mismatch):");
const result2 = subsetSumExact(targetMismatch, santiagoItems);
console.log(result2 ? "❌ MATCH FOUND (Unexpected)" : "✅ NO MATCH (Correct)");

// Test Case 3: Partial Subset
const targetPartial = 25678; // 2 * 12839
console.log("\nTest 3 (Partial 2 items):");
const result3 = subsetSumExact(targetPartial, santiagoItems);
console.log(result3 ? "✅ MATCH FOUND" : "❌ NO MATCH");
if (result3) console.log("Items:", result3.map(i => i.total));
