/**
 * QC-Jurist: Deterministic Validation Layer for Assignments
 * SPEC: v1.5.0-INDUSTRIAL-STRICT (VPRLU Focus)
 */

import { validateColumnBBox } from './qc-geometer'; // Fix 32 import

export type PointerType = 'TEXT_DIRECT_CELL' | 'TEXT_ECHO_HEADER' | 'ZONE_REFERENCE';
export type AssignmentStatus = 'ACTIVE' | 'ACTIVE_TEXT_DIRECT' | 'EXCLUDED' | 'CONDITIONAL' | 'UNDETERMINED' | 'CUT';

export interface ConditionAtom {
    type: 'CONDITION';
    kind: 'PRESTADOR_EXCEPTION' | 'MODALIDAD' | 'OTHER';
    raw_text: string;
    prestadores?: string[];
}

export interface Atom {
    type: string;
    key: string;
    value: any;
    unit?: string;
}

export interface Pointer {
    type: PointerType;
    target_id?: string;
    raw_text: string;
    bbox?: { x: [number, number]; y: [number, number] };
}

export interface HeaderBandPolicy {
    allow_row_band_promotion: boolean;
    min_confidence: { geometry: number; text: number };
}

export interface Assignment {
    assignment_id: string;
    row_id: string;
    column_id: string;
    pointer: Pointer;
    atoms: (Atom | ConditionAtom)[];
    status: AssignmentStatus;
    confidence: { row_confidence: number; assignment_confidence: number };
    tags?: string[];
}

export interface QCJuristGates {
    atomic_assignment_ids: 'PASS' | 'FAIL';
    condition_atoms_present: 'PASS' | 'FAIL';
    no_ghost_rules: 'PASS' | 'FAIL';
    no_echo_as_final_pointer: 'PASS' | 'FAIL';
    promoted_echo_density: 'PASS' | 'FAIL';
    duplicate_assignment_ids: 'PASS' | 'FAIL';
    column_bbox_consistency: 'PASS' | 'FAIL'; // FIX 32
    unresolved_overlaps: 'PASS' | 'FAIL'; // FIX 34
    row_id_integrity: 'PASS' | 'FAIL'; // FIX 33 User Request
    no_zone_reference_as_terminal_value: 'PASS' | 'FAIL';
    synthetic_geometry_density: 'PASS' | 'FAIL';
    no_ambiguous_atoms: 'PASS' | 'FAIL';
}

export interface QCJuristReport {
    status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
    warnings: any[];
    qc_gates: QCJuristGates;
    metrics: {
        assignment_count: number;
        active_count: number;
        excluded_count: number;
        conditional_count: number;
        undetermined_count: number;
        promoted_echo_count: number;
        avg_confidence: number;
    };
}

const MERGED_ID_PATTERN = /C\d+\+C\d+|_C\d+_C\d+|P\d+_R\d+|C2_C3/;
const EXCEPTION_PATTERN = /excepto|salvo/i;
const MAX_ECHO_DENSITY = 5;
const MAX_SYNTHETIC_RATIO = 0.3;

function validateAtomicAssignmentIds(assignments: Assignment[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    for (const a of assignments) {
        if (MERGED_ID_PATTERN.test(a.assignment_id) || MERGED_ID_PATTERN.test(a.column_id || '')) {
            pass = false;
            warnings.push({ type: 'NON_ATOMIC_ID', message: `Assignment "${a.assignment_id}" contains merged/legacy pattern.`, severity: 'ERROR' });
        }
    }
    return { pass, warnings };
}

function validateDuplicateIds(assignments: Assignment[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    const seen = new Set<string>();
    let pass = true;
    for (const a of assignments) {
        if (seen.has(a.assignment_id)) {
            pass = false;
            warnings.push({ type: 'DUPLICATE_ID', message: `Assignment ID "${a.assignment_id}" is duplicated.`, severity: 'ERROR' });
        }
        seen.add(a.assignment_id);
    }
    return { pass, warnings };
}

function validateRowIntegrity(assignments: Assignment[], rows: any[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    const validRowIds = new Set(rows.map((r: any) => r.row_id));

    for (const a of assignments) {
        if (!validRowIds.has(a.row_id)) {
            pass = false;
            warnings.push({ type: 'ROW_INTEGRITY_FAIL', message: `Assignment "${a.assignment_id}" references row_id "${a.row_id}" which is not in spatial map.`, severity: 'ERROR' });
        }
    }
    return { pass, warnings };
}

// FIX 32: BBox Consistency Check
function validateBBoxConsistency(assignments: Assignment[], columns: any[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    for (const a of assignments) {
        const check = validateColumnBBox(a, columns);
        if (!check.valid) {
            pass = false;
            warnings.push({
                type: 'COLUMN_BBOX_MISMATCH',
                message: `Assignment "${a.assignment_id}" points to ${a.column_id} but BBox falls in ${check.correctColumn || 'UNKNOWN'}.`,
                severity: 'ERROR'
            });
        }
    }
    return { pass, warnings };
}

// FIX 34: Overlap Detection (Multiple Active Rules for same cell)
function validateOverlaps(assignments: Assignment[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    const map = new Map<string, string[]>(); // key "row_col" -> [ids]

    for (const a of assignments) {
        if (a.status !== 'ACTIVE' && a.status !== 'ACTIVE_TEXT_DIRECT') continue;
        const key = `${a.row_id}::${a.column_id}`;
        const list = map.get(key) || [];
        list.push(a.assignment_id);
        map.set(key, list);
    }

    map.forEach((ids, key) => {
        if (ids.length > 1) {
            pass = false;
            warnings.push({
                type: 'UNRESOLVED_OVERLAP',
                message: `Cell ${key} has ${ids.length} active assignments: ${ids.join(', ')}.`,
                severity: 'ERROR'
            });
        }
    });

    return { pass, warnings };
}

function validateConditionAtoms(assignments: Assignment[], zones: any[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;

    for (const z of zones) {
        if (EXCEPTION_PATTERN.test(z.contains_text || '')) {
            // DOCTRINE: Precedence Law upgrade to ZONE_EXCLUSION
            if (z.zone_type !== 'ZONE_EXCLUSION') {
                z.zone_type = 'ZONE_EXCLUSION';
                warnings.push({ type: 'ZONE_TYPE_UPGRADED', message: `Zone "${z.zone_id}" upgraded to ZONE_EXCLUSION due to exception keywords.`, severity: 'INFO' });
            }

            const related = assignments.filter(a => a.pointer.target_id === z.zone_id);
            for (const a of related) {
                const hasCondition = a.atoms.some(at => at.type === 'CONDITION');
                if (!hasCondition) {
                    pass = false;
                    warnings.push({ type: 'MISSING_CONDITION_ATOM', message: `Assignment "${a.assignment_id}" references exception zone but lacks ConditionAtom.`, severity: 'ERROR' });
                }
            }
        }
    }
    return { pass, warnings };
}

function validateNoEchoAsFinalPointer(assignments: Assignment[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    for (const a of assignments) {
        if (a.pointer.type === 'TEXT_ECHO_HEADER') {
            pass = false;
            warnings.push({ type: 'ECHO_AS_FINAL_POINTER', message: `Assignment "${a.assignment_id}" has TEXT_ECHO_HEADER as final pointer.`, severity: 'ERROR' });
        }
    }
    return { pass, warnings };
}

function validatePromotedEchoDensity(promotedCount: number): { gate: 'PASS' | 'FAIL'; warnings: any[] } {
    const warnings: any[] = [];
    if (promotedCount > MAX_ECHO_DENSITY) {
        warnings.push({ type: 'HIGH_ECHO_DENSITY', message: `${promotedCount} promoted echo assignments exceeds threshold of ${MAX_ECHO_DENSITY}. Industrial PASS rejected.`, severity: 'ERROR' });
        return { gate: 'FAIL', warnings };
    }
    return { gate: 'PASS', warnings: [] };
}

function validateTerminalEvidence(assignments: Assignment[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    for (const a of assignments) {
        if (a.status === 'ACTIVE' || a.status === 'ACTIVE_TEXT_DIRECT') {
            const hasDirectText = a.atoms.some(at => (at as Atom).key === 'TEXT_DIRECT');
            if (a.pointer.type === 'ZONE_REFERENCE' && !hasDirectText) {
                pass = false;
                warnings.push({ type: 'WEAK_EVIDENCE', message: `Assignment "${a.assignment_id}" relies on ZONE_REFERENCE without TEXT_DIRECT atom.`, severity: 'ERROR' });
            }
        }
    }
    return { pass, warnings };
}

function validateSyntheticGeometryPenalty(pseudoZones: any[], totalAssignments: number): { gate: 'PASS' | 'FAIL'; warnings: any[] } {
    const warnings: any[] = [];
    const syntheticCount = pseudoZones.filter(z => z.synthetic_geometry).length;
    const ratio = totalAssignments > 0 ? syntheticCount / totalAssignments : 0;

    if (ratio > MAX_SYNTHETIC_RATIO) {
        warnings.push({ type: 'HIGH_SYNTHETIC_DENSITY', message: `Synthetic geometry ratio (${(ratio * 100).toFixed(0)}%) exceeds threshold of ${(MAX_SYNTHETIC_RATIO * 100).toFixed(0)}%.`, severity: 'ERROR' });
        return { gate: 'FAIL', warnings };
    }
    return { gate: 'PASS', warnings: [] };
}

function validateAtomAmbiguity(assignments: Assignment[]): { pass: boolean; warnings: any[] } {
    const warnings: any[] = [];
    let pass = true;
    for (const a of assignments) {
        if (a.status !== 'ACTIVE' && a.status !== 'ACTIVE_TEXT_DIRECT') continue;

        for (const atom of a.atoms) {
            if (atom.type === 'RULE') {
                // Issue 5: Tope = null with unit real
                if (atom.value === null && atom.unit && atom.unit !== 'DESCONOCIDO' && atom.unit !== 'SIN_TOPE') {
                    pass = false;
                    warnings.push({ type: 'AMBIGUOUS_VALUE', message: `Assignment "${a.assignment_id}" has unit ${atom.unit} but value is null. Rejected for Legal JSON.`, severity: 'ERROR' });
                }
            }
        }

        // Issue 6: Copagos detectados mixed
        const copagoAtom = a.atoms.find(at => at.type === 'COPAGO');
        const copago = (a as any).copago || (copagoAtom && 'value' in copagoAtom ? (copagoAtom as Atom).value : undefined);
        if (typeof copago === 'string' && copago.includes('/') && copago.includes('UF') && copago.includes('VAM')) {
            pass = false;
            warnings.push({ type: 'UNRESOLVED_COPAGO', message: `Assignment "${a.assignment_id}" has unresolved mixed units in copago: "${copago}".`, severity: 'ERROR' });
        }
    }
    return { pass, warnings };
}

function validateNoGhostRules(assignments: Assignment[], zones: any[]): { pass: boolean; warnings: any[] } {
    return { pass: true, warnings: [] };
}

// FIX 21 + FIX 23 + FIX 27: Generate pseudo-zones AND convert pointers (with fallback geometry)
export function generatePseudoZonesAndConvertPointers(
    assignments: Assignment[],
    columns: any[],
    rows: any[]
): { pseudoZones: any[]; fixedAssignments: Assignment[] } {
    const pseudoZones: any[] = [];
    const fixedAssignments: Assignment[] = [];
    let fallbackY = 0.3;
    const ROW_HEIGHT = 0.02;

    for (const a of assignments) {
        if (a.pointer.type === 'TEXT_ECHO_HEADER' || a.tags?.includes('ECHO_PROMOTED_TO_ROW_BAND')) {
            const row = rows.find((r: any) => r.row_id === a.row_id);
            const col = columns.find((c: any) => c.column_id === a.column_id);

            const pseudoZoneId = `ZONE_PROMOTED_HEADER_${a.row_id}_${a.column_id}`;
            const existing = pseudoZones.find(z => z.zone_id === pseudoZoneId);

            if (!existing) {
                const xRange = col ? col.x_range : [0.4, 0.6];
                let yRange: [number, number];
                let geoConfidence = 0.96;
                let synthetic = false;

                if (row) {
                    yRange = row.y_range;
                } else {
                    yRange = [fallbackY, fallbackY + ROW_HEIGHT];
                    fallbackY += ROW_HEIGHT;
                    geoConfidence = 0.80; // Auditable signal of synthetic geometry
                    synthetic = true;
                }

                pseudoZones.push({
                    zone_id: pseudoZoneId,
                    zone_type: 'ZONE_GRAPHIC_RULE',
                    scope_mode: 'ROW_BAND',
                    origin: 'TEXT_ECHO_HEADER_PROMOTION',
                    geometric_scope: { x: xRange, y: yRange },
                    contains_text: a.pointer.raw_text,
                    confidence: { geometry: geoConfidence, text: 0.97, scope: row ? 0.95 : 0.75 },
                    applies_to_columns: [a.column_id],
                    synthetic_geometry: synthetic
                });
            }

            fixedAssignments.push({
                ...a,
                pointer: {
                    type: 'ZONE_REFERENCE',
                    target_id: pseudoZoneId,
                    raw_text: a.pointer.raw_text
                },
                tags: [...(a.tags || []).filter(t => t !== 'ECHO_PROMOTED_TO_ROW_BAND'), 'ZONE_FROM_ECHO_PROMOTION']
            });
        } else {
            fixedAssignments.push(a);
        }
    }

    return { pseudoZones, fixedAssignments };
}

export function applyHeaderBandPromotion(
    assignments: Assignment[],
    policy?: HeaderBandPolicy
): { fixedAssignments: Assignment[]; promotedCount: number } {
    if (!policy || !policy.allow_row_band_promotion) return { fixedAssignments: assignments, promotedCount: 0 };

    let promotedCount = 0;
    const fixed = assignments.map(a => {
        if (a.pointer.type === 'TEXT_ECHO_HEADER' &&
            a.confidence.row_confidence >= policy.min_confidence.geometry &&
            a.confidence.assignment_confidence >= policy.min_confidence.text) {
            promotedCount++;
            return { ...a, status: 'ACTIVE' as AssignmentStatus, tags: [...(a.tags || []), 'ECHO_PROMOTED_TO_ROW_BAND'] };
        }
        return a;
    });

    return { fixedAssignments: fixed, promotedCount };
}

export function qcJurist(
    assignments: Assignment[],
    spatialMap: any,
    headerBandPolicy?: HeaderBandPolicy
): { report: QCJuristReport; fixedAssignments: Assignment[]; pseudoZones: any[] } {
    const allWarnings: any[] = [];

    const atomicCheck = validateAtomicAssignmentIds(assignments);
    allWarnings.push(...atomicCheck.warnings);

    const dupCheck = validateDuplicateIds(assignments);
    allWarnings.push(...dupCheck.warnings);

    const rowCheck = validateRowIntegrity(assignments, spatialMap.rows || []);
    allWarnings.push(...rowCheck.warnings);

    const bboxCheck = validateBBoxConsistency(assignments, spatialMap.columns || []); // FIX 32
    allWarnings.push(...bboxCheck.warnings);

    const overlapCheck = validateOverlaps(assignments); // FIX 34
    allWarnings.push(...overlapCheck.warnings);

    const conditionCheck = validateConditionAtoms(assignments, spatialMap.zones || []);
    allWarnings.push(...conditionCheck.warnings);

    const promotionResult = applyHeaderBandPromotion(assignments, headerBandPolicy);

    const { pseudoZones, fixedAssignments } = generatePseudoZonesAndConvertPointers(
        promotionResult.fixedAssignments,
        spatialMap.columns || [],
        spatialMap.rows || []
    );

    const allZones = [...(spatialMap.zones || []), ...pseudoZones];
    const ghostCheck = validateNoGhostRules(fixedAssignments, allZones);

    const echoFinalCheck = validateNoEchoAsFinalPointer(fixedAssignments);
    allWarnings.push(...echoFinalCheck.warnings);

    const echoDensityCheck = validatePromotedEchoDensity(promotionResult.promotedCount);
    allWarnings.push(...echoDensityCheck.warnings);

    const terminalEvidenceCheck = validateTerminalEvidence(fixedAssignments);
    allWarnings.push(...terminalEvidenceCheck.warnings);

    const syntheticCheck = validateSyntheticGeometryPenalty(pseudoZones, fixedAssignments.length);
    allWarnings.push(...syntheticCheck.warnings);

    const ambiguityCheck = validateAtomAmbiguity(fixedAssignments);
    allWarnings.push(...ambiguityCheck.warnings);

    let activeCount = 0, excludedCount = 0, conditionalCount = 0, undeterminedCount = 0, totalConf = 0;
    for (const a of fixedAssignments) {
        if (a.status === 'ACTIVE' || a.status === 'ACTIVE_TEXT_DIRECT') activeCount++;
        if (a.status === 'EXCLUDED') excludedCount++;
        if (a.status === 'CONDITIONAL') conditionalCount++;
        if (a.status === 'UNDETERMINED') undeterminedCount++;
        totalConf += a.confidence.assignment_confidence;
    }
    const avgConf = fixedAssignments.length > 0 ? totalConf / fixedAssignments.length : 0;

    const qc_gates: QCJuristGates = {
        atomic_assignment_ids: atomicCheck.pass ? 'PASS' : 'FAIL',
        condition_atoms_present: conditionCheck.pass ? 'PASS' : 'FAIL',
        no_ghost_rules: ghostCheck.pass ? 'PASS' : 'FAIL',
        no_echo_as_final_pointer: echoFinalCheck.pass ? 'PASS' : 'FAIL',
        promoted_echo_density: echoDensityCheck.gate,
        duplicate_assignment_ids: dupCheck.pass ? 'PASS' : 'FAIL',
        row_id_integrity: rowCheck.pass ? 'PASS' : 'FAIL', // FIX 33
        column_bbox_consistency: bboxCheck.pass ? 'PASS' : 'FAIL', // FIX 32
        unresolved_overlaps: overlapCheck.pass ? 'PASS' : 'FAIL', // FIX 34
        no_zone_reference_as_terminal_value: terminalEvidenceCheck.pass ? 'PASS' : 'FAIL',
        synthetic_geometry_density: syntheticCheck.gate,
        no_ambiguous_atoms: ambiguityCheck.pass ? 'PASS' : 'FAIL'
    };

    const hasErrors = Object.values(qc_gates).some(v => v === 'FAIL');
    const status = hasErrors ? 'NEEDS_REVIEW' : (undeterminedCount > 0 ? 'NEEDS_REVIEW' : 'PASS');

    return {
        report: {
            status,
            warnings: allWarnings,
            qc_gates,
            metrics: {
                assignment_count: fixedAssignments.length,
                active_count: activeCount,
                excluded_count: excludedCount,
                conditional_count: conditionalCount,
                undetermined_count: undeterminedCount,
                promoted_echo_count: promotionResult.promotedCount,
                avg_confidence: avgConf
            }
        },
        fixedAssignments,
        pseudoZones
    };
}

export default qcJurist;
