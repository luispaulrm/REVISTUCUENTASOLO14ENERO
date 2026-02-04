/**
 * Regression Harness: Test Suite for Spatial Extraction Pipeline
 * 
 * This module runs the pipeline against a golden set and reports diffs.
 * 
 * SPEC: v1.3-AUDIT-GRADE
 */

import { SpatialMap, qcGeometer } from './qc-geometer';
import { Assignment, qcJurist } from './qc-jurist';
import { packageAuditBundle, LegalAuditPackage } from './packager';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface GoldenSetEntry {
    id: string;
    source_document: string;
    page: number;
    expected_spatial_map: SpatialMap;
    expected_assignments: Assignment[];
}

export interface RegressionResult {
    id: string;
    status: 'PASS' | 'FAIL' | 'REGRESSION';
    diffs: Diff[];
    metrics: {
        column_diff: number;
        row_diff: number;
        zone_diff: number;
        assignment_diff: number;
    };
}

export interface Diff {
    path: string;
    expected: any;
    actual: any;
    type: 'MISSING' | 'EXTRA' | 'MISMATCH';
}

// ============================================================================
// GOLDEN SET MANAGEMENT
// ============================================================================

const GOLDEN_SET_PATH = path.join(__dirname, '../../../golden_set');

/**
 * Loads the golden set from disk.
 */
export function loadGoldenSet(): GoldenSetEntry[] {
    const indexPath = path.join(GOLDEN_SET_PATH, 'index.json');
    if (!fs.existsSync(indexPath)) {
        console.warn('Golden set not found at', indexPath);
        return [];
    }

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entries: GoldenSetEntry[] = [];

    for (const entry of index.entries) {
        const mapPath = path.join(GOLDEN_SET_PATH, entry.spatial_map_file);
        const assignPath = path.join(GOLDEN_SET_PATH, entry.assignments_file);

        if (fs.existsSync(mapPath) && fs.existsSync(assignPath)) {
            entries.push({
                id: entry.id,
                source_document: entry.source_document,
                page: entry.page,
                expected_spatial_map: JSON.parse(fs.readFileSync(mapPath, 'utf-8')),
                expected_assignments: JSON.parse(fs.readFileSync(assignPath, 'utf-8')),
            });
        }
    }

    return entries;
}

// ============================================================================
// DIFF FUNCTIONS
// ============================================================================

function diffArrays(expected: any[], actual: any[], idKey: string): Diff[] {
    const diffs: Diff[] = [];

    const expectedIds = new Set(expected.map(e => e[idKey]));
    const actualIds = new Set(actual.map(a => a[idKey]));

    // Find missing
    for (const e of expected) {
        if (!actualIds.has(e[idKey])) {
            diffs.push({
                path: `${idKey}:${e[idKey]}`,
                expected: e,
                actual: null,
                type: 'MISSING',
            });
        }
    }

    // Find extra
    for (const a of actual) {
        if (!expectedIds.has(a[idKey])) {
            diffs.push({
                path: `${idKey}:${a[idKey]}`,
                expected: null,
                actual: a,
                type: 'EXTRA',
            });
        }
    }

    return diffs;
}

// ============================================================================
// REGRESSION RUNNER
// ============================================================================

/**
 * Runs a single golden set entry against the current pipeline output.
 */
export function runRegression(
    goldenEntry: GoldenSetEntry,
    actualMap: SpatialMap,
    actualAssignments: Assignment[]
): RegressionResult {
    const diffs: Diff[] = [];

    // Diff columns
    diffs.push(...diffArrays(
        goldenEntry.expected_spatial_map.columns,
        actualMap.columns,
        'column_id'
    ));

    // Diff rows
    diffs.push(...diffArrays(
        goldenEntry.expected_spatial_map.rows,
        actualMap.rows,
        'row_id'
    ));

    // Diff zones
    diffs.push(...diffArrays(
        goldenEntry.expected_spatial_map.zones,
        actualMap.zones,
        'zone_id'
    ));

    // Diff assignments
    diffs.push(...diffArrays(
        goldenEntry.expected_assignments,
        actualAssignments,
        'assignment_id'
    ));

    // Determine status
    let status: 'PASS' | 'FAIL' | 'REGRESSION';
    if (diffs.length === 0) {
        status = 'PASS';
    } else if (diffs.some(d => d.type === 'MISSING' || d.type === 'MISMATCH')) {
        status = 'REGRESSION';
    } else {
        status = 'FAIL';
    }

    return {
        id: goldenEntry.id,
        status,
        diffs,
        metrics: {
            column_diff: diffs.filter(d => d.path.startsWith('column_id')).length,
            row_diff: diffs.filter(d => d.path.startsWith('row_id')).length,
            zone_diff: diffs.filter(d => d.path.startsWith('zone_id')).length,
            assignment_diff: diffs.filter(d => d.path.startsWith('assignment_id')).length,
        },
    };
}

/**
 * Runs all golden set entries and generates a summary report.
 */
export function runAllRegressions(
    actualOutputs: Map<string, { map: SpatialMap; assignments: Assignment[] }>
): {
    summary: { pass: number; fail: number; regression: number };
    results: RegressionResult[];
} {
    const goldenSet = loadGoldenSet();
    const results: RegressionResult[] = [];

    let pass = 0, fail = 0, regression = 0;

    for (const entry of goldenSet) {
        const actual = actualOutputs.get(entry.id);
        if (!actual) {
            results.push({
                id: entry.id,
                status: 'FAIL',
                diffs: [{ path: 'output', expected: 'present', actual: null, type: 'MISSING' }],
                metrics: { column_diff: 0, row_diff: 0, zone_diff: 0, assignment_diff: 0 },
            });
            fail++;
            continue;
        }

        const result = runRegression(entry, actual.map, actual.assignments);
        results.push(result);

        if (result.status === 'PASS') pass++;
        else if (result.status === 'REGRESSION') regression++;
        else fail++;
    }

    return { summary: { pass, fail, regression }, results };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default { loadGoldenSet, runRegression, runAllRegressions };
