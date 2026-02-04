/**
 * Packager: Bundle All Layers into Audit Package
 * SPEC: v1.5.0-INDUSTRIAL-STRICT (VPRLU Focus)
 */

import { SpatialMap, QCGeometerReport, ZoneCoverageMetrics } from './qc-geometer';
import { Assignment, QCJuristReport } from './qc-jurist';

/**
 * ⚖️ LEGAL AUDIT PACKAGE
 * "Contrato compilado. Cada regla tiene geometría, precedencia y responsabilidad legal."
 * Función: Ser auditable, reproducible y defendible.
 */
export interface LegalAuditPackage {
    metadata: {
        pipeline_version: string;
        spec_version: string;
        source_document: string;
        page: number;
        timestamp: string;
    };
    spatial_map: SpatialMap;
    assignments: Assignment[];
    warnings: any[];
    qc_gates: {
        atomic_columns: 'PASS' | 'FAIL';
        zone_type_validity: 'PASS' | 'FAIL';
        min_confidence: 'PASS' | 'FAIL';
        row_groups_present: 'PASS' | 'WARN';
        zone_application_completeness: 'PASS' | 'FAIL' | 'WARN';
        condition_flag_consistency: 'PASS' | 'FAIL';
        unresolved_overlaps: 'PASS' | 'FAIL';
        condition_atoms_present: 'PASS' | 'FAIL';
        no_ghost_rules: 'PASS' | 'FAIL';
        promoted_echo_density: 'PASS' | 'FAIL';
        duplicate_assignment_ids: 'PASS' | 'FAIL';
        row_id_integrity: 'PASS' | 'FAIL'; // FIX 33
        column_bbox_consistency: 'PASS' | 'FAIL'; // FIX 32
        no_zone_reference_as_terminal_value: 'PASS' | 'FAIL';
        synthetic_geometry_density: 'PASS' | 'FAIL';
    };
    zone_coverage_metrics: ZoneCoverageMetrics;
    quality_metrics: {
        laws_applied: string;
        overall_status: 'PASS' | 'WARN' | 'NEEDS_REVIEW';
        avg_confidence: number;
        undetermined_count: number;
        conditional_count: number;
        promoted_echo_count: number;
        promoted_zone_count: number;
    };
}

function resolveOverallStatus(
    qc_gates: any,
    undeterminedCount: number,
    conditionalCount: number
): 'PASS' | 'WARN' | 'NEEDS_REVIEW' {

    const hasFail = Object.values(qc_gates).some(v => v === 'FAIL');
    if (hasFail) return 'NEEDS_REVIEW';

    if (undeterminedCount > 0) return 'NEEDS_REVIEW';
    if (qc_gates.promoted_echo_density === 'WARN') return 'WARN';
    if (conditionalCount > 0) return 'WARN';

    const hasWarn = Object.values(qc_gates).some(v => v === 'WARN');
    return hasWarn ? 'WARN' : 'PASS';
}

export function packageAuditBundle(
    metadata: any,
    spatialMap: SpatialMap,
    assignments: Assignment[],
    geoReport: QCGeometerReport,
    jurReport: QCJuristReport,
    pseudoZones: any[]
): LegalAuditPackage {

    const finalSpatialMap = {
        ...spatialMap,
        zones: [...spatialMap.zones, ...pseudoZones]
    };

    const atomicColumnsGate: 'PASS' | 'FAIL' = (geoReport.qc_gates.atomic_columns === 'PASS' &&
        jurReport.qc_gates.atomic_assignment_ids === 'PASS')
        ? 'PASS' : 'FAIL';

    const qc_gates = {
        ...geoReport.qc_gates,
        atomic_columns: atomicColumnsGate,
        zone_type_validity: (geoReport.qc_gates.zone_type_validity as string === 'WARN' ? 'FAIL' : geoReport.qc_gates.zone_type_validity) as 'PASS' | 'FAIL',
        min_confidence: geoReport.qc_gates.min_confidence,
        unresolved_overlaps: jurReport.qc_gates.unresolved_overlaps,
        condition_atoms_present: jurReport.qc_gates.condition_atoms_present,
        no_ghost_rules: jurReport.qc_gates.no_ghost_rules,
        no_echo_as_final_pointer: jurReport.qc_gates.no_echo_as_final_pointer,
        promoted_echo_density: jurReport.qc_gates.promoted_echo_density,
        duplicate_assignment_ids: jurReport.qc_gates.duplicate_assignment_ids,
        row_id_integrity: jurReport.qc_gates.row_id_integrity,
        column_bbox_consistency: jurReport.qc_gates.column_bbox_consistency,
        no_zone_reference_as_terminal_value: jurReport.qc_gates.no_zone_reference_as_terminal_value,
        synthetic_geometry_density: jurReport.qc_gates.synthetic_geometry_density
    };

    const overallStatus = resolveOverallStatus(
        qc_gates,
        jurReport.metrics.undetermined_count,
        jurReport.metrics.conditional_count
    );

    return {
        metadata: {
            pipeline_version: '1.5.0',
            spec_version: 'v1.5.0-INDUSTRIAL-STRICT',
            source_document: metadata.source_document,
            page: metadata.page,
            timestamp: new Date().toISOString()
        },
        spatial_map: finalSpatialMap,
        assignments,
        warnings: [...geoReport.warnings, ...jurReport.warnings],
        qc_gates,
        zone_coverage_metrics: geoReport.zone_coverage_metrics,
        quality_metrics: {
            laws_applied: 'EXCLUSION > ACTIVE_TEXT_DIRECT > ZONE_GRAPHIC_RULE(ROW_BAND) > ZONE_GRAPHIC_RULE(RECT_FALL)',
            overall_status: overallStatus,
            avg_confidence: (geoReport.metrics.avg_confidence + jurReport.metrics.avg_confidence) / 2,
            undetermined_count: jurReport.metrics.undetermined_count,
            conditional_count: jurReport.metrics.conditional_count,
            promoted_echo_count: jurReport.metrics.promoted_echo_count,
            promoted_zone_count: pseudoZones.length
        }
    };
}

export default packageAuditBundle;
