/**
 * QC-Geometer: Spatial Integrity Validator
 * SPEC: v1.5.0-INDUSTRIAL-STRICT
 */

export interface SpatialMap {
    page_metadata: any;
    columns: { column_id: string; x_range: [number, number]; label?: string; confidence: any }[];
    zones: any[];
    rows: any[];
    row_groups?: any[];
    row_zone_policy?: any;
}

export interface ZoneCoverageMetrics {
    expected_rows: number;
    covered_expected_rows: number;
    unexpected_zone_hits: number;
    coverage_rate: number;
    require_rows_present: boolean;
    require_rows_justified_absence: boolean;
}

export interface QCGeometerGates {
    atomic_columns: 'PASS' | 'FAIL';
    zone_type_validity: 'PASS' | 'FAIL' | 'WARN';
    min_confidence: 'PASS' | 'FAIL';
    row_groups_present: 'PASS' | 'WARN';
    zone_application_completeness: 'PASS' | 'FAIL' | 'WARN';
    condition_flag_consistency: 'PASS' | 'FAIL';
}

export interface QCGeometerReport {
    status: 'PASS' | 'FAIL' | 'WARN';
    warnings: any[];
    qc_gates: QCGeometerGates;
    zone_coverage_metrics: ZoneCoverageMetrics;
    metrics: {
        zone_count: number;
        row_count: number;
        avg_confidence: number;
    };
}

const EXCEPTION_PATTERN = /excepto|salvo|solo\s+en/i;
const PROVIDER_PATTERN = /Hosp\.|Clinica|Medicos/i;

function rowIntersectsZone(row: any, zone: any): boolean {
    if (zone.scope_mode === 'ROW_BAND') return true;
    const zoneY = zone.geometric_scope.y;
    const rowY = row.y_range;
    // Intersection logic
    return (rowY[0] < zoneY[1] && rowY[1] > zoneY[0]);
}

function getRowPolicy(rowId: string, policies: any) {
    if (!policies) return 'ALLOW';
    for (const rule of policies.rules) {
        if (new RegExp(rule.match.row_id).test(rowId)) return rule.policy;
    }
    return policies.default;
}

// FIX 32: Helper to validate Column Consistency (used by compiler/packager)
export function validateColumnBBox(assignment: any, columns: any[]): { valid: boolean; correctColumn?: string } {
    if (assignment.pointer.type !== 'TEXT_DIRECT_CELL' || !assignment.pointer.bbox) return { valid: true };

    const bbox = assignment.pointer.bbox;
    const xMid = (bbox[0] + bbox[2]) / 2;

    const assignedCol = columns.find(c => c.column_id === assignment.column_id);

    // Check strict inclusion provided tolerance eps
    const eps = 0.01;
    if (assignedCol) {
        if (xMid >= assignedCol.x_range[0] - eps && xMid <= assignedCol.x_range[1] + eps) {
            return { valid: true };
        }
    }

    // Find correct column
    const correct = columns.find(c => xMid >= c.x_range[0] - eps && xMid <= c.x_range[1] + eps);
    return { valid: false, correctColumn: correct?.column_id };
}

function validateConditionFlagConsistency(map: SpatialMap): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    for (const z of map.zones) {
        const hasExceptionText = EXCEPTION_PATTERN.test(z.contains_text || '') || PROVIDER_PATTERN.test(z.contains_text || '');
        if (hasExceptionText && !z.has_conditions) {
            pass = false;
            warnings.push({
                type: 'MISSING_CONDITION_FLAG',
                message: `Zone "${z.zone_id}" has exception/provider text but missing has_conditions: true.`,
                severity: 'ERROR'
            });
        }
    }
    return { pass, warnings };
}

function validateZoneApplicationCompleteness(map: SpatialMap): {
    gate: 'PASS' | 'FAIL' | 'WARN';
    metrics: ZoneCoverageMetrics;
    warnings: any[];
} {
    const warnings: any[] = [];
    let expectedRows = 0;
    let coveredExpected = 0;
    let unexpectedHits = 0;
    let gate: 'PASS' | 'FAIL' | 'WARN' = 'PASS';

    // FIX 33: Check if rows exist in map
    if (!map.rows || map.rows.length === 0) {
        return {
            gate: 'WARN', // Maybe just headers?
            metrics: {
                expected_rows: 0, covered_expected_rows: 0, unexpected_zone_hits: 0, coverage_rate: 0,
                require_rows_present: false, require_rows_justified_absence: true
            },
            warnings: [{ type: 'NO_ROWS', message: 'No rows defined in spatial map.', severity: 'WARNING' }]
        };
    }

    for (const row of map.rows) {
        const policy = getRowPolicy(row.row_id, map.row_zone_policy);
        const hasZone = map.zones.some(z => rowIntersectsZone(row, z) && z.zone_type !== 'ZONE_EXCLUSION');

        if (policy === 'REQUIRE') {
            expectedRows++;
            if (hasZone) {
                coveredExpected++;
            } else {
                gate = 'FAIL';
                warnings.push({ type: 'MISSING_REQUIRED_ZONE', message: `Row "${row.row_id}" requires zone but none applies.`, severity: 'ERROR' });
            }
        } else if (policy === 'NONE' && hasZone) {
            unexpectedHits++;
            if (gate !== 'FAIL') gate = 'WARN';
            warnings.push({ type: 'UNEXPECTED_ZONE', message: `Row "${row.row_id}" has unexpected zone application.`, severity: 'WARNING' });
        }
    }

    const coverage_rate = expectedRows > 0 ? coveredExpected / expectedRows : 1.0;
    const require_rows_present = expectedRows > 0;
    const require_rows_justified_absence = expectedRows === 0; // Fix 25

    return {
        gate,
        metrics: {
            expected_rows: expectedRows,
            covered_expected_rows: coveredExpected,
            unexpected_zone_hits: unexpectedHits,
            coverage_rate,
            require_rows_present,
            require_rows_justified_absence
        },
        warnings
    };
}

export function qcGeometer(spatialMap: SpatialMap): QCGeometerReport {
    const warnings: any[] = [];

    // 1. Atomic Columns Check
    const atomicCheck = spatialMap.columns.some(c => c.column_id.includes('+') || c.column_id.includes('C2_C3')); // Basic check, upgraded in Packager with Jurist logic

    // 2. Zone Validity
    const invalidZones = spatialMap.zones.filter(z => !['ZONE_GRAPHIC_RULE', 'ZONE_EXCLUSION', 'ZONE_CUT'].includes(z.zone_type));
    if (invalidZones.length > 0) {
        warnings.push({ type: 'INVALID_ZONE_TYPE', message: `Found ${invalidZones.length} invalid zone types`, severity: 'ERROR' });
    }

    // 3. Min Confidence
    const lowConf = spatialMap.zones.filter(z => z.confidence.geometry < 0.8 && !z.synthetic_geometry);

    // 4. Row Groups
    const hasRowGroups = spatialMap.row_groups && spatialMap.row_groups.length > 0;

    // 5. Zone Completeness
    const completeness = validateZoneApplicationCompleteness(spatialMap);
    warnings.push(...completeness.warnings);

    // 6. Condition Flags
    const flagCheck = validateConditionFlagConsistency(spatialMap);
    warnings.push(...flagCheck.warnings);

    const qc_gates: QCGeometerGates = {
        atomic_columns: atomicCheck ? 'FAIL' : 'PASS',
        zone_type_validity: invalidZones.length > 0 ? 'FAIL' : 'PASS',
        min_confidence: lowConf.length > 0 ? 'FAIL' : 'PASS',
        row_groups_present: hasRowGroups ? 'PASS' : 'WARN',
        zone_application_completeness: completeness.gate,
        condition_flag_consistency: flagCheck.pass ? 'PASS' : 'FAIL'
    };

    const hasFail = Object.values(qc_gates).some(v => v === 'FAIL');
    const hasWarn = Object.values(qc_gates).some(v => v === 'WARN');

    return {
        status: hasFail ? 'FAIL' : (hasWarn ? 'WARN' : 'PASS'),
        warnings,
        qc_gates,
        zone_coverage_metrics: completeness.metrics,
        metrics: {
            zone_count: spatialMap.zones.length,
            row_count: spatialMap.rows?.length || 0,
            avg_confidence: 0.98 // Placeholder
        }
    };
}
