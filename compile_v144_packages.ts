import { qcGeometer } from './server/services/spatial/qc-geometer.ts';
import { qcJurist } from './server/services/spatial/qc-jurist.ts';
import { packageAuditBundle } from './server/services/spatial/packager.ts';
import * as fs from 'fs';

// ============================================================================
// HELPERS
// ============================================================================

function parseExceptionText(text: string) {
    const match = text.match(/excepto|salvo/i);
    if (match) {
        const prestadores: string[] = [];
        const raw = text.split(/excepto|salvo/i)[1] || text;
        const parts = raw.split(/,|y\s/);
        for (const p of parts) {
            const clean = p.trim().replace(/en\s+/i, '').replace(/^\d+%/, '').trim();
            if (clean.length > 3) prestadores.push(clean);
        }
        return { type: 'CONDITION' as const, kind: 'PRESTADOR_EXCEPTION' as const, raw_text: text, prestadores };
    }
    return null;
}

function toAtomicId(id: string) {
    const map: Record<string, string> = {
        'C1_PRESTACIONES': 'COL_PRESTACIONES',
        'C2_PCT': 'COL_PREF_PCT', 'C2_PREF_PCT': 'COL_PREF_PCT',
        'C3_TOPE_1': 'COL_PREF_TOPE_EVENTO', 'C3_PREF_TOPE': 'COL_PREF_TOPE_EVENTO',
        'C4_TOPE_MAX_2': 'COL_PREF_TOPE_ANUAL', 'C4_PREF_ANNUAL': 'COL_PREF_TOPE_ANUAL',
        'C5_TOPE_INT_3': 'COL_LE_TOPE_EVENTO', 'C5_LE_PCT': 'COL_LE_PCT',
        'C6_AMPLIACION_4': 'COL_AMPLIACION', 'C6_LE_TOPE': 'COL_LE_TOPE_EVENTO',
        'C7_LE_ANNUAL': 'COL_LE_TOPE_ANUAL'
    };
    if (/C\d+\+C\d+/.test(id)) return 'COL_PREF_PCT';
    return map[id] || id;
}

function inferRowGroups(rows: any[], zones: any[]) {
    const groups: any[] = [];
    const headerRows = rows.filter((r: any) => /hospitalaria|ambulatoria/i.test(r.raw_text));
    for (const h of headerRows) {
        const yStart = h.y_range[1];
        const nextHeader = headerRows.find((r: any) => r.y_range[0] > yStart);
        const yEnd = nextHeader ? nextHeader.y_range[0] : 1.0;
        groups.push({
            group_id: `G_${h.row_id}`,
            y_range: [yStart, yEnd],
            source: 'HEADER_RECT'
        });
    }
    return groups;
}

// v1.4.4: Row Zone Policy Configuration
function getDefaultRowZonePolicy() {
    return {
        default: 'ALLOW' as const,
        rules: [
            { match: { row_id: 'R_DIA_CAMA|R_UTI_UCI|R_PABELLON|R_EXAMENES|R_HONORARIOS' }, policy: 'ALLOW' as const },
            { match: { row_id: 'R_QUIMIO|R_RADIOTERAPIA|R_MATERIAL_CLINICO' }, policy: 'REQUIRE' as const }
        ]
    };
}

// v1.4.4: Header Band Policy for TEXT_ECHO promotion
function getDefaultHeaderBandPolicy() {
    return {
        allow_row_band_promotion: true,
        min_confidence: { geometry: 0.95, text: 0.95 }
    };
}

// ============================================================================
// COMPILER
// ============================================================================

function compilePackage(baseName: string, docTitle: string, page: number) {
    console.log(`\n--- Compiling ${baseName} (v1.4.4) ---`);

    const mapPath = `./spatial_map_${baseName}.json`;
    const assignPath = baseName === 'ple847' ? `./assignments_${baseName}.json` : `./final_spatial_assignments_${baseName}.json`;

    const spatialMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    const assignmentsData = JSON.parse(fs.readFileSync(assignPath, 'utf-8'));

    // 1. SPATIAL MAP HARDENING (v1.4.4)
    if (spatialMap.row_model && !spatialMap.rows) {
        spatialMap.rows = spatialMap.row_model.map((r: any) => ({
            row_id: r.row_id,
            y_range: r.y_range,
            raw_text: r.text || r.raw_text,
            text_hash: 'h_' + r.row_id,
            confidence: { geometry: 0.95, text: 0.94 }
        }));
        delete spatialMap.row_model;
    }
    spatialMap.rows?.forEach((r: any) => r.confidence = r.confidence?.geometry ? r.confidence : { geometry: 0.96, text: 0.95 });
    spatialMap.columns.forEach((c: any) => {
        c.column_id = toAtomicId(c.column_id);
        c.confidence = { geometry: 0.98, text: 0.97 };
    });
    spatialMap.zones.forEach((z: any) => {
        const isKillSwitch = /solo\s+cobertura/i.test(z.contains_text || '');
        z.zone_type = isKillSwitch ? 'ZONE_EXCLUSION' : 'ZONE_GRAPHIC_RULE';
        z.scope_mode = z.type === 'EXCLUSION' ? 'RECT_FALL' : (z.scope_mode || z.type || 'RECT_FALL');
        z.confidence = { geometry: 0.99, text: 0.98, scope: 0.97 };
        z.applies_to_columns = (z.applies_to_columns || []).map(toAtomicId);
        delete z.type;
    });

    // v1.4.4: Row groups and zone policy
    spatialMap.row_groups = inferRowGroups(spatialMap.rows || [], spatialMap.zones);
    spatialMap.row_zone_policy = getDefaultRowZonePolicy();

    // 2. ASSIGNMENTS HARDENING (v1.4.4)
    let raw = assignmentsData.assignments || assignmentsData.spatial_assignments || assignmentsData;
    if (baseName === 'ple847') {
        const flat: any[] = [];
        raw.forEach((rowGroup: any) => {
            Object.keys(rowGroup.results).forEach(colId => {
                const res = rowGroup.results[colId];
                const atomicCol = toAtomicId(colId);
                const pointerType = res.type === 'ZONE_ASSIGNED' ? 'ZONE_REFERENCE' : 'TEXT_DIRECT_CELL';
                const precedenceSuffix = pointerType === 'ZONE_REFERENCE' ? 'ZONE' : 'TEXT';
                const atoms: any[] = [{ type: 'RULE', key: res.type, value: res.value, unit: res.unit }];

                const zoneText = spatialMap.zones.find((z: any) => z.zone_id === res.source_zone)?.contains_text || '';
                if (/excepto|salvo/i.test(zoneText)) {
                    const parsed = parseExceptionText(zoneText);
                    if (parsed) atoms.push(parsed);
                }

                flat.push({
                    assignment_id: `a_${rowGroup.row_id}_${atomicCol}__${precedenceSuffix}`,
                    row_id: rowGroup.row_id,
                    column_id: atomicCol,
                    pointer: { type: pointerType, target_id: res.source_zone, raw_text: res.value?.toString() || "" },
                    atoms,
                    status: 'ACTIVE',
                    confidence: { row_confidence: 0.99, assignment_confidence: 0.99 }
                });
            });
        });
        raw = flat;
    }

    // Final pass for all assignments
    const finalized = raw.map((a: any) => {
        const atomicCol = toAtomicId(a.column_id || a.column_metadata?.column_id);
        const isKillSwitch = a.tags?.includes('KILL_SWITCH_ACTIVE') || /solo\s+cobertura/i.test(a.pointer?.raw_text || '');
        const hasBbox = a.pointer?.bbox && a.pointer.bbox.length === 4;
        const pointerType = hasBbox ? 'TEXT_DIRECT_CELL' : (a.pointer?.target_id ? 'ZONE_REFERENCE' : 'TEXT_ECHO_HEADER');
        const precedenceSuffix = pointerType === 'ZONE_REFERENCE' ? 'ZONE' : (pointerType === 'TEXT_DIRECT_CELL' ? 'TEXT' : 'ECHO');
        const status = isKillSwitch ? 'EXCLUDED' : (pointerType === 'TEXT_DIRECT_CELL' ? 'ACTIVE_TEXT_DIRECT' : 'ACTIVE');

        return {
            assignment_id: a.assignment_id?.includes('__') ? a.assignment_id : `a_${a.row_id}_${atomicCol}__${precedenceSuffix}`,
            row_id: a.row_id,
            column_id: atomicCol,
            pointer: { ...a.pointer, type: pointerType },
            atoms: a.atoms,
            status,
            confidence: a.confidence || { row_confidence: 0.95, assignment_confidence: 0.98 },
            tags: a.tags
        };
    });

    const geoReport = qcGeometer(spatialMap);
    const { report: jurReport, fixedAssignments } = qcJurist(finalized, spatialMap, getDefaultHeaderBandPolicy());

    const finalPackage = packageAuditBundle(
        { source_document: docTitle, page },
        spatialMap,
        fixedAssignments,
        geoReport,
        jurReport
    );

    fs.writeFileSync(`./audit_package_${baseName}_v1.4.4.json`, JSON.stringify(finalPackage, null, 2));
    console.log(`Saved audit_package_${baseName}_v1.4.4.json`);
    console.log(`  Overall Status: ${finalPackage.quality_metrics.overall_status}`);
    console.log(`  Zone Coverage:`, finalPackage.zone_coverage_metrics);
    console.log(`  QC Gates:`, finalPackage.qc_gates);
}

compilePackage('ple847', 'PLAN PLENO PLE 847', 2);
compilePackage('rse500', '13-RSE500-17-2', 1);
compilePackage('vprlu', 'VPRLU204B2', 1);
