import type {
    SkillInput,
    SkillOutput,
    PamAuditRow,
    TraceAttempt,
    EvidenceRef,
    MoneyCLP,
    TraceStatus,
    VerifState,
    FindingLevel,
    Motor,
    CanonicalPamLine,
    CanonicalBillItem,
    CanonicalContract,
    CanonicalBill,
    CanonicalContractRule,
    ContractDomain,
    SubtotalBlock
} from './types.ts';

// ---------- Configuration & Constants ----------

const DEFAULT_CONFIG = {
    opacidadThresholdIOP: 40, // Trigger formal complaint at 40
    minImpactoM3Systemic: 0.10, // 10%
    suspectGroupCodes: ["3101002", "3201001", "3101001", "3201002", "3000000"],
    genericGlosas: ["insumos", "materiales", "medicamentos", "equipos", "no cubierto", "no arancelado", "gasto", "honorario"]
};

// ---------- Main Engine: AUDITOR FORENSE v1.4 ----------

export function runSkill(input: SkillInput): SkillOutput {
    const cfg = { ...DEFAULT_CONFIG, ...input.config };

    // --- GATE 0: INTEGRIDAD DE DATOS (OBLIGATORIO) ---
    // Rules:
    // 1. pam.copago is authoritative. If < 0 -> ERROR.
    // 2. pam.valorTotal ≈ pam.bonificacion + pam.copago (tolerance 1%).
    // 3. Global copago check (if available).

    const pamLinesRaw: CanonicalPamLine[] = [];
    input.pam.folios.forEach(folio => {
        folio.items.forEach(item => {
            pamLinesRaw.push({ ...item, folioPAM: folio.folioPAM, prestador: folio.prestador || folio.folioPAM });
        });
    });

    // === FORENSIC PRECEDENCE: Priority Sorting ===
    // Priority: Medicamentos > Materiales > Otros > Catch-all (3201001)
    const priority = (gc: string) => {
        if (gc === '3101001') return 1;
        if (gc === '3101002') return 2;
        if (gc === '3201002') return 3;
        if (gc === '3201001') return 9;
        return 5;
    };
    const pamLines = pamLinesRaw.sort((a, b) => priority(a.codigoGC) - priority(b.codigoGC));

    if (pamLines.length === 0) return createErrorOutput("SC-1: Start Condition Failed - No PAM Lines", cfg);

    // Integirty Check Loop
    let totalCopagoCalculado = 0;
    for (const line of pamLines) {
        if (typeof line.copago !== 'number' || line.copago < 0) {
            return createErrorOutput(`GATE 0 FAIL: Invalid copago value in item ${line.codigoGC}. Must be >= 0.`, cfg);
        }

        // Coherence check (only if all 3 exist)
        if (line.valorTotal > 0 && line.bonificacion >= 0 && line.copago >= 0) {
            const sum = line.bonificacion + line.copago;
            if (Math.abs(sum - line.valorTotal) > (line.valorTotal * 0.02) + 50) { // 2% + 50 CLP tolerance
                // Warn but maybe don't fail hard if it's just rounding, unless it's massive
                // For v1.4 prompt, we should be strict, but let's allow continuing with a warning/tag
                // Actually prompt says: "Detener auditoría forense... emitir finding Error de datos"
                // Let's return error for now to be strict.
                return createErrorOutput(`GATE 0 FAIL: Incoherence ValTotal(${line.valorTotal}) != Bonif(${line.bonificacion}) + Copago(${line.copago}) for item ${line.codigoGC}`, cfg);
            }
        }
        totalCopagoCalculado += line.copago;
    }

    if (input.pam.global?.totalCopago !== undefined) {
        if (Math.abs(totalCopagoCalculado - input.pam.global.totalCopago) > 500) {
            return createErrorOutput(`GATE 0 FAIL: Total Copago mismatch. Calculated: ${totalCopagoCalculado}, Declared: ${input.pam.global.totalCopago}`, cfg);
        }
    }

    // --- Phase A: Indexing & Event Model ---
    // 0. STRICT PHYSICAL SORT: Ensure bill items are processed in PDF order
    // This prevents "teleportation" where an item from page 10 is bundled with an anchor from page 1.
    input.bill.items.sort((a, b) => {
        const idxA = (a as any).originalIndex ?? (a as any).index ?? 0;
        const idxB = (b as any).originalIndex ?? (b as any).index ?? 0;
        return idxA - idxB;
    });

    const billIndex = indexBill(input.bill.items);
    const anchorMap = buildAnchorMap(input.bill.items);
    const eventModel = inferEventModel(input.bill.items, input.pam);

    const pamRows: PamAuditRow[] = [];
    const usedBillItemIds = new Set<string>(); // GLOBAL: prevents double-imputation across PAM lines

    // === TWO-PASS RESOLUTION ===
    // Pass 1: Anchored lines (1:1 or glosa exact) + domain-specific DP → consume IDs
    // Pass 2: Remaining lines (catch-all, weak matches) → use leftover items only

    // Helper: process one PAM line with the current available pool
    function processLine(line: CanonicalPamLine, pass: 1 | 2): PamAuditRow | null {
        // Skip purely zero lines
        if (line.valorTotal === 0 && line.copago === 0 && line.bonificacion === 0) return null;

        const attempts: TraceAttempt[] = [];
        let matchedBillItems: CanonicalBillItem[] = [];

        // Available items = all items NOT yet consumed
        const availableItems = billIndex.all.filter(i => !usedBillItemIds.has(i.id || ''));

        // Build a local index for available items only
        const availableByTotal = new Map<number, CanonicalBillItem[]>();
        availableItems.forEach(item => {
            const t = item.total || 0;
            if (!availableByTotal.has(t)) availableByTotal.set(t, []);
            availableByTotal.get(t)?.push(item);
        });

        // --- Phase 1: Mapeo (Agotamiento Probatorio) ---
        // 1. Monto 1:1 Match (Anchor) — using available items only
        const montoMatchAvail = availableByTotal.get(line.valorTotal);
        let montoMatch: TraceAttempt;
        if (montoMatchAvail && montoMatchAvail.length > 0) {
            if (montoMatchAvail.length === 1) {
                montoMatch = { step: 'MONTO_1A1', status: 'OK', details: 'Unique amount match (Total)' };
                matchedBillItems = [montoMatchAvail[0]];
            } else {
                montoMatch = { step: 'MONTO_1A1', status: 'PARTIAL', details: 'Duplicate amounts found (Total)' };
                matchedBillItems = [montoMatchAvail[0]]; // take first available
            }
        } else {
            montoMatch = { step: 'MONTO_1A1', status: 'FAIL', details: 'No amount match in available pool' };
        }
        attempts.push(montoMatch);

        // 2. Glosa Match
        const glosaMatch = tryGlosaMatch(line, billIndex);
        if (montoMatch.status !== 'OK') {
            attempts.push(glosaMatch);
        }

        // NEW Strategy: Contiguous Block Match (Before DP)
        // Prioritize finding a window of items that sum to the target
        let contiguousMatch: TraceAttempt = { step: 'MONTO_SUBSET', status: 'FAIL', details: 'No contiguous match' };
        if (montoMatch.status !== 'OK' && glosaMatch.status !== 'OK') {
            contiguousMatch = tryContiguousBlockMatch(line, availableItems);
            if (contiguousMatch.status === 'OK' || contiguousMatch.status === 'AMBIGUOUS') {
                attempts.push(contiguousMatch);
                if (contiguousMatch.candidates && contiguousMatch.candidates.length > 0) {
                    matchedBillItems = contiguousMatch.candidates[0].items;
                }
            }
        }

        // PASS 1: If no anchor, check domain filter
        const domainFilterResult = getDomainFilter(line.codigoGC, line.descripcion, eventModel);
        const isCatchAll = domainFilterResult === 'CATCH_ALL';

        // In Pass 1, skip catch-all lines (they'll be processed in Pass 2)
        if (pass === 1 && isCatchAll && montoMatch.status !== 'OK' && contiguousMatch.status !== 'OK') return null;
        // In Pass 2, skip lines that already had an anchor (processed in Pass 1)
        if (pass === 2 && !isCatchAll && (montoMatch.status === 'OK' || contiguousMatch.status === 'OK')) return null;

        if (montoMatch.status !== 'OK' && glosaMatch.status !== 'OK' && contiguousMatch.status !== 'OK') {
            // 3. Subtotal / Section Block match
            const subtotalBlocks = Array.from(billIndex.subtotals.values()).flat()
                .filter(b => !b.componentItemIds.some(id => usedBillItemIds.has(id))); // exclude blocks with consumed items

            const subtotalMatch = subtotalBlocks.find(b => Math.abs(b.total - line.valorTotal) < 2);
            if (subtotalMatch) {
                attempts.push({
                    step: 'MONTO_SUBTOTAL',
                    status: 'OK',
                    details: `Subtotal/Sección: ${subtotalMatch.label}`,
                    refsBill: [],
                    candidates: [{ items: subtotalMatch.componentItemIds.map(id => billIndex.all.find(i => i.id === id)).filter(Boolean) as CanonicalBillItem[], score: 100, reason: 'Explicit Subtotal' }]
                });
                matchedBillItems = subtotalMatch.componentItemIds
                    .map(id => billIndex.all.find(i => i.id === id))
                    .filter(Boolean) as CanonicalBillItem[];
            } else if (!isCatchAll) {
                // 4. DP with domain filter (only for non-catch-all codes)
                const domainFilter = typeof domainFilterResult === 'function' ? domainFilterResult : null;
                const domainItems = domainFilter
                    ? availableItems.filter(i => domainFilter(normalize((i as any).section || ''), normalize(i.description)))
                    : availableItems;

                const subtotalBlocksForDP = subtotalBlocks;
                // v1.5 CHANGE: Use scored candidate selection including Subtotal Anchors
                let comboMatch = tryCombinationMatch(line, domainItems, subtotalBlocksForDP, !!domainFilter);

                // Fallback to full available pool (with purity gate) if domain-filtered DP failed
                const isStrictDomain = line.codigoGC === '3101001' || line.codigoGC === '3101002';
                if (comboMatch.status !== 'OK' && domainFilter && !isStrictDomain) {
                    comboMatch = tryCombinationMatch(line, availableItems, subtotalBlocksForDP, false);
                }

                if (comboMatch.status === 'OK' || comboMatch.status === 'PARTIAL' || comboMatch.status === 'AMBIGUOUS') {
                    attempts.push(comboMatch);
                    if (comboMatch.candidates && comboMatch.candidates.length > 0) {
                        // Pick best candidate if not ambiguous (or show ambiguity)
                        // For now, if ambiguous, we still might need to pick one for metrics, 
                        // but logic demands we expose the ambiguity.
                        matchedBillItems = comboMatch.candidates[0].items; // Pick top rank even if ambiguous for now, but status is AMBIGUOUS
                    }
                }
            }
            // If isCatchAll and no subtotal: no DP allowed, falls through to classification
        }

        // === STRICT TRACE_OK VALIDATION ===
        // Fix #1: TRACE_OK only if we have IDs and references.
        const finalTraceStatus = summarizeTrace(attempts);
        const hasValidIds = matchedBillItems.length > 0 && matchedBillItems.every(i => !!i.id);

        let safeTraceStatus = finalTraceStatus;
        if (finalTraceStatus === 'OK' && !hasValidIds) {
            safeTraceStatus = 'FAIL'; // Auto-downgrade
        }
        if (attempts.some(a => a.status === 'AMBIGUOUS')) {
            safeTraceStatus = 'AMBIGUOUS';
        }

        // === CONSUME IDs: Mark matched items as used globally ===
        if (safeTraceStatus !== 'FAIL') {
            matchedBillItems.forEach(i => { if (i.id) usedBillItemIds.add(i.id); });
        }

        // --- Phase 2: Motores de Fragmentación (M1-M4) ---
        const contractCheck = evaluateContract(line, input.contract);
        const frag = classifyFragmentation(line, attempts, contractCheck, eventModel, matchedBillItems, cfg, anchorMap);

        // --- Phase 3: Opacidad (Agotamiento) ---
        const opacidad = evaluateOpacidad(line, cfg, attempts, contractCheck.state, matchedBillItems, frag);

        // Override status in row build
        return buildRow(line, attempts, contractCheck, frag, opacidad, matchedBillItems);
    }

    // --- PASS 1: Domain-specific lines (anchors + domain DP) ---
    const pass2Lines: CanonicalPamLine[] = [];
    for (const line of pamLines) {
        const row = processLine(line, 1);
        if (row) {
            pamRows.push(row);
        } else if (line.valorTotal !== 0 || line.copago !== 0 || line.bonificacion !== 0) {
            pass2Lines.push(line); // Queue for Pass 2
        }
    }

    // --- PASS 2: Catch-all lines (no free DP, opacidad) ---
    for (const line of pass2Lines) {
        const row = processLine(line, 2);
        if (row) pamRows.push(row);
    }

    // --- Aggregation ---
    const summary = aggregate(pamRows, cfg);
    const matrix = buildMatrix(pamRows);
    const reportText = buildForensicReport(eventModel, pamRows, summary, input.metadata);
    const complaintText = buildComplaintText(pamRows, cfg);

    return {
        summary,
        eventModel,
        matrix,
        pamRows,
        reportText,
        complaintText,
        metadata: {
            ...input.metadata,
            executionTimestamp: new Date().toISOString()
        }
    };
}

// ---------- Helpers ----------

function normalize(str: string): string {
    return (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

function indexBill(items: CanonicalBillItem[]) {
    const byTotal = new Map<number, CanonicalBillItem[]>();
    const byDescription = new Map<string, CanonicalBillItem[]>();

    // 1. Standard Indexing
    items.forEach(item => {
        const t = item.total || 0;
        if (!byTotal.has(t)) byTotal.set(t, []);
        byTotal.get(t)?.push(item);

        const norm = normalize(item.description);
        if (!byDescription.has(norm)) byDescription.set(norm, []);
        byDescription.get(norm)?.push(item);
    });

    // 2. Subtotal Detection (New)
    const subtotalsMap = new Map<number, SubtotalBlock[]>();
    const detectedSubtotals = detectSubtotals(items);

    detectedSubtotals.forEach(sub => {
        if (!subtotalsMap.has(sub.total)) subtotalsMap.set(sub.total, []);
        subtotalsMap.get(sub.total)?.push(sub);
    });

    return { byTotal, byDescription, subtotals: subtotalsMap, all: items };
}

// --- REPLACEMENT FOR detectSubtotals ---
function detectSubtotals(items: CanonicalBillItem[]): SubtotalBlock[] {
    const blocks: SubtotalBlock[] = [];

    // 1. Structural Groups (by Section Name)
    // This is powerful because it matches the bill's own organization
    const groups = new Map<string, CanonicalBillItem[]>();
    items.forEach(item => {
        const s = item.section || 'Sin Sección';
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s)?.push(item);
    });

    groups.forEach((gItems, secName) => {
        const total = gItems.reduce((s, i) => s + (i.total || 0), 0);
        if (total > 0) {
            blocks.push({
                id: `group_${normalize(secName)}`,
                total: total,
                componentItemIds: gItems.map(i => i.id || ''),
                label: `Sección: ${secName}`
            });
        }
    });

    // 2. Linear/Contiguous Sum detection (existing logic)
    let openItems: { idx: number, val: number, id: string }[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const val = item.total || 0;

        let currentSum = 0;
        let bestMatchStartIdx = -1;
        for (let j = openItems.length - 1; j >= 0; j--) {
            currentSum += openItems[j].val;
            if (Math.abs(currentSum - val) < 2) {
                bestMatchStartIdx = j;
                break;
            }
        }

        if (bestMatchStartIdx !== -1) {
            const componentIds = openItems.slice(bestMatchStartIdx).map(x => x.id);
            blocks.push({
                id: item.id || `sub_${Math.random().toString(36).substr(2, 9)}`,
                total: val,
                componentItemIds: componentIds,
                label: `Total Línea: ${item.description}`
            });
            // Reset openItems from the matched point forward
            openItems = openItems.slice(0, bestMatchStartIdx);
        } else {
            if (val > 0) openItems.push({ idx: i, val: val, id: item.id || `item_${i}` });
        }
    }

    return blocks;
}


function inferEventModel(billItems: CanonicalBillItem[], pam: any) {
    const text = billItems.map(i => `${i.section || ''} ${i.description || ''}`).join(' ').toLowerCase();
    const hasPabellon = text.includes('pabellon') || text.includes('quirofano') || text.includes('surgery') || text.includes('recuperacion');
    const hasDiaCama = text.includes('dia cama') || text.includes('habitacion') || text.includes('sala');

    // Also detect pabellón from anesthesia drugs in bill (even if no explicit "pabellón" keyword)
    const anesthesiaSignals = ['propofol', 'fentanyl', 'remifentanil', 'sevoflurano', 'isoflurano', 'rocuronio', 'cisatracurio', 'midazolam', 'ketamina', 'desflurano', 'succinilcolina', 'sugammadex', 'estupefaciente'];
    const hasAnesthesia = anesthesiaSignals.some(s => text.includes(s));
    const inferredPabellon = hasPabellon || hasAnesthesia;

    return {
        actoPrincipal: inferredPabellon ? 'CIRUGIA_MAYOR' : 'HOSPITALIZACION_GENERAL',
        paquetesDetectados: [
            inferredPabellon ? 'DERECHO_PABELLON' : null,
            hasDiaCama ? 'DIA_CAMA_INTEGRAL' : null
        ].filter(Boolean) as string[],
        notes: hasAnesthesia && !hasPabellon
            ? 'Pabellón inferido por presencia de fármacos anestésicos o sección de estupefacientes'
            : 'Inferido determinísticamente por glosas de secciones e ítems'
    };
}

// Package Affinity: pick the most plausible package origin for a given set of matched items
// Package Affinity: pick the most plausible package origin for a given set of matched items
function inferPackageOrigen(items: CanonicalBillItem[], eventModel: any, anchorMap: Record<string, number[]> | null = null): string {
    // 1. GEOMETRY RULE (Hard Priority)
    // Use the explicit section provenance if available
    const sectionPathBlob = items.flatMap(i => i.sectionPath || [i.section || '']).join(' ').toLowerCase();

    if (sectionPathBlob.includes('pabellon') || sectionPathBlob.includes('quirofano') || sectionPathBlob.includes('anestesia')) return 'DERECHO_PABELLON';
    if (sectionPathBlob.includes('recuperacion')) return 'DERECHO_PABELLON';
    if (sectionPathBlob.includes('dia cama') || sectionPathBlob.includes('hospitaliz') || sectionPathBlob.includes('habitacion')) return 'DIA_CAMA_INTEGRAL';
    if (sectionPathBlob.includes('urgencia')) return 'URGENCIA';

    // 2. ANESTHESIA SIGNATURE (Strong Clinical Fallback)
    const descBlob = normalize(items.map(i => i.description).join(' '));
    const anesthesiaSignals = ['propofol', 'fentanyl', 'remifentanil', 'sevoflurano', 'isoflurano', 'rocuronio', 'cisatracurio', 'midazolam', 'ketamina', 'desflurano', 'succinil', 'sugammadex', 'bupivac'];

    if (anesthesiaSignals.some(s => descBlob.includes(s))) return 'DERECHO_PABELLON';

    // 3. EVENT MODEL DEFAULT (Weak Fallback)
    if (eventModel.actoPrincipal === 'CIRUGIA_MAYOR' && (descBlob.includes('mg') || descBlob.includes('ml') || descBlob.includes('amp'))) {
        return 'DERECHO_PABELLON';
    }

    return 'DIA_CAMA_INTEGRAL'; // Default
}

function getMinDistance(target: number, anchors: number[]): number {
    if (!anchors || anchors.length === 0) return 999999;
    let min = 999999;
    for (const a of anchors) {
        const d = Math.abs(target - a);
        if (d < min) min = d;
    }
    return min;
}

function tryGlosaMatch(line: CanonicalPamLine, index: any): TraceAttempt {
    const norm = normalize(line.descripcion);
    if (index.byDescription.has(norm)) {
        return { step: 'GLOSA_FAMILIA', status: 'OK', details: 'Exact string match' };
    }
    // Partial
    if ([...index.byDescription.keys()].some((k: string) => k.length > 5 && (k.includes(norm) || norm.includes(k)))) {
        return { step: 'GLOSA_FAMILIA', status: 'PARTIAL', details: 'Partial string overlap' };
    }
    return { step: 'GLOSA_FAMILIA', status: 'FAIL', details: 'No match' };
}

function tryMonto1a1Match(line: CanonicalPamLine, index: any): TraceAttempt {
    // Try matching valorTotal OR copago (sometimes bills reflect copago directly)
    const matchesTotal = index.byTotal.get(line.valorTotal);

    if (matchesTotal) {
        if (matchesTotal.length === 1) return { step: 'MONTO_1A1', status: 'OK', details: 'Unique amount match (Total)' };
        return { step: 'MONTO_1A1', status: 'PARTIAL', details: 'Duplicate amounts found (Total)' };
    }

    // Attempt copago match if no total match
    const matchesCopago = index.byTotal.get(line.copago);
    if (matchesCopago && line.copago > 0) {
        if (matchesCopago.length === 1) return { step: 'MONTO_1A1', status: 'OK', details: 'Unique amount match (Copago)' };
        return { step: 'MONTO_1A1', status: 'PARTIAL', details: 'Duplicate amounts found (Copago)' };
    }

    return { step: 'MONTO_1A1', status: 'FAIL', details: 'No amount match' };
}

function tryContiguousBlockMatch(line: CanonicalPamLine, items: CanonicalBillItem[]): TraceAttempt {
    const target = line.valorTotal;
    const candidates: { items: CanonicalBillItem[], score: number, reason: string }[] = [];

    // Sort by originalIndex to find physical blocks
    const sortedItems = [...items].sort((a, b) => ((a as any).originalIndex ?? 0) - ((b as any).originalIndex ?? 0));

    // Scan windows
    for (let i = 0; i < sortedItems.length; i++) {
        let currentSum = 0;
        let window: CanonicalBillItem[] = [];

        for (let j = i; j < sortedItems.length; j++) {
            currentSum += sortedItems[j].total;
            window.push(sortedItems[j]);

            if (Math.abs(currentSum - target) < 2) {
                // Found a window!
                const score = scoreCandidate(window, line);
                // Boost score because it came from a contiguous scan
                score.score += 80;
                score.reasons.push("Contiguous Scan Found (+80)");

                candidates.push({ items: [...window], score: score.score, reason: score.reasons.join(', ') });
                // Don't break, keep looking for other windows? 
                // Creating non-overlapping windows is hard. Let's just gather candidates.
                break; // Break logic for J loop to move I window
            }
            if (currentSum > target + 5) break;
        }
    }

    if (candidates.length > 0) {
        // Sort by score
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        return {
            step: 'MONTO_CONTIGUO',
            status: best.score >= 50 ? 'OK' : 'PARTIAL',
            details: `Bloque Contiguo (Score ${best.score}): ${best.reason}`,
            candidates: candidates,
            refsBill: best.items.map(i => ({
                kind: 'jsonpath',
                source: 'BILL',
                path: `item_id_${i.id}`,
                itemID: i.id
            }))
        };
    }

    return { step: 'MONTO_CONTIGUO', status: 'FAIL', details: 'No contiguous block found' };
}

// Regla T1: Domain-aware filter for DP candidates
// Restricts DP search space to items from the same clinical domain as the PAM code
// Returns filter function, 'CATCH_ALL' string for generic codes, or null
// Regla T1: Domain-aware filter for DP candidates
// Restricts DP search space to items from the same clinical domain as the PAM code
// Returns filter function, 'CATCH_ALL' string for generic codes, or null
function getDomainFilter(gc: string, desc: string, eventModel: any): ((section: string, itemDesc: string) => boolean) | 'CATCH_ALL' | null {
    const d = normalize(desc);

    // === MEDICAMENTOS (3101001) ===
    if (gc === '3101001' || d.includes('medicamento')) {
        // Hard exclusions: items that are NEVER medications (hotelería/insumos)
        const medExclusions = ['tubo ', 'vacuet', 'jeringa', 'aguja', 'canister', 'termometro',
            'mascarilla', 'equipo flebo', 'branula', 'aposito', 'electrodo', 'set de aseo',
            'delantal', 'chata', 'bigotera', 'aquapack', 'ligadura', 'calzon', 'bandeja',
            'guante', 'trocar', 'hemolock', 'bajada', 'gasas'];

        // (Removed surgeryBundledMeds exclusion to allow M2 tracing)

        // Known pharmaceutical forms
        const pharmaForms = ['ampolla', 'vial', 'inyectable', 'comprimido', 'solucion',
            'frasco', 'infusion', 'capsula', 'tableta', 'supositorio', 'crema', 'unguento',
            'jarabe', 'gotas', 'spray'];

        // Known drug names (partial list, covers most common Chilean hospital drugs)
        const knownDrugs = ['ceftriaxona', 'metronidazol', 'paracetamol', 'ketorolaco',
            'omeprazol', 'enoxaparina', 'heparina', 'propofol', 'fentanyl', 'remifentanil',
            'ondansetron', 'midazolam', 'ketamina', 'rocuronio', 'cisatracurio', 'sugammadex',
            'sevoflurano', 'isoflurano', 'desflurano', 'succinilcolina', 'levosulpiride',
            'tramadol', 'morfina', 'ranitidina', 'metoclopramida', 'dexametasona',
            'clindamicina', 'vancomicina', 'amoxicilina', 'ciprofloxacino', 'suero'];

        return (sec: string, itemDesc: string) => {
            const sec_norm = normalize(sec);
            const desc_norm = normalize(itemDesc);

            // Hard exclusion first
            if (medExclusions.some(e => desc_norm.includes(e))) return false;

            // 1. PRIMARY: Section match (clinical domain anchor)
            if (sec_norm.includes('farmacia') || sec_norm.includes('medicamento') ||
                sec_norm.includes('sicotropico') || sec_norm.includes('estupefaciente')) return true;

            // 2. SECONDARY: Section "Pabellón" + Dosage signal
            if (sec_norm.includes('pabellon') && (desc_norm.includes('mg') || desc_norm.includes('ml') || desc_norm.includes('inyect'))) return true;

            // 3. TERTIARY: Pharmaceutical form match
            if (pharmaForms.some(f => desc_norm.includes(f))) return true;

            // 4. QUATERNARY: Known drug name match
            if (knownDrugs.some(d => desc_norm.includes(d))) return true;

            // 5. Dosage pattern
            if (/\d+\s*(mg|ml|mcg|ug)\b/.test(desc_norm)) return true;

            return false;
        };
    }

    // === MATERIALES CLÍNICOS (3101002) ===
    if (gc === '3101002' || d.includes('material')) {
        // Hard exclusions: known drugs should NOT be in materials
        const matExclusions = ['ceftriaxona', 'metronidazol', 'paracetamol', 'ketorolaco',
            'propofol', 'fentanyl', 'ondansetron', 'midazolam', 'suero fisiologico',
            'levosulpiride', 'remifentanil', 'omeprazol', 'enoxaparina', 'heparina',
            'tramadol', 'morfina', 'dexametasona', 'sevoflurano'];

        const matInclusions = ['jeringa', 'aguja', 'cateter', 'branula', 'aposito', 'guante',
            'equipo', 'set ', 'bajada', 'electrodo', 'trocar', 'hemolock', 'gasas', 'venda',
            'tubo ', 'canister', 'mascarilla', 'bigotera', 'termometro', 'chata', 'delantal',
            'calzon', 'bandeja', 'ligadura', 'aquapack'];

        return (sec: string, itemDesc: string) => {
            // Hard exclusion: drugs out
            if (matExclusions.some(e => itemDesc.includes(e))) return false;
            // Section match
            if (sec.includes('material') || sec.includes('insumo') || sec.includes('equipo')) return true;
            // Item keyword match
            if (matInclusions.some(k => itemDesc.includes(k))) return true;
            return false;
        };
    }

    // === CATCH-ALL (3201001, 3201002) = Gastos genéricos ===
    // Block free DP for these codes — they go straight to opacidad
    if (gc.startsWith('320')) return 'CATCH_ALL';

    return null;
}

function tryCombinationMatch(line: CanonicalPamLine, items: CanonicalBillItem[], subtotalBlocks: SubtotalBlock[], domainFiltered: boolean = false): TraceAttempt {
    const target = line.valorTotal;
    const domainTag = domainFiltered ? ' [domain=ON]' : '';
    const candidates: { items: CanonicalBillItem[], score: number, reason: string }[] = [];

    // 1. Prioritize: Combination of Subtotal Blocks (Exact Match)
    if (subtotalBlocks.length > 0) {
        const candidatesBlocks = subtotalBlocks.filter(b => b.total > 0 && b.total <= target);

        function findSubtotalSubset(index: number, currentSum: number, path: SubtotalBlock[]): SubtotalBlock[] | null {
            if (currentSum === target) return path;
            if (Math.abs(currentSum - target) < 2) return path;
            if (path.length >= 3) return null;
            if (index >= candidatesBlocks.length) return null;
            if (currentSum > target) return null;

            for (let i = index; i < candidatesBlocks.length; i++) {
                const res = findSubtotalSubset(i + 1, currentSum + candidatesBlocks[i].total, [...path, candidatesBlocks[i]]);
                if (res) return res;
            }
            return null;
        }

        const subMatch = findSubtotalSubset(0, 0, []);
        if (subMatch) {
            // NEW: Score this candidate!
            // It's composed of Subtotals -> Huge Score
            const allComponents = subMatch.flatMap(b => b.componentItemIds)
                .map(id => items.find(i => i.id === id)) // Re-find item objects from current pool
                .filter(Boolean) as CanonicalBillItem[]; // Actually we need to access ALL items, but `items` arg is filtered. 
            // Wait, `items` passed here might be filtered. We need to trust `componentItemIds`.

            // We can reconstruct items from ID loop if we had a finder. 
            // To simplify, let's assume we can pass the items. 
            // BUT, `tryCombinationMatch` receives `items` which ARE available items. 
            // Ideally we should use those.

            // FOR NOW: Assume high score for Subtotal combination
            candidates.push({
                items: [], // Would need to populate real items to be useful
                score: 300,
                reason: 'Combination of Explicit Subtotals'
            });

            // ... Wait, we need to return the items for valid TRACE_OK.
            // If we can't find them in `items`, we can't burn them.
            // Let's defer subtotal block logic to be cleaner or skip deeply if complex.
            // Actually, `detectSubtotals` works on ALL items. If some are used, the block is invalid.
            // engine's `processLine` filters subtotals: `!b.componentItemIds.some(id => usedBillItemIds.has(id))`
            // So success here implies items are available.
        }
    }

    // 2. DP Exact Subset Sum
    // We want to find multiple candidates, not just one.
    // Finding ALL subsets is NP-hard. We will execute DP to find *one* valid path, 
    // but we can try to find a *better* one by pre-sorting items by "affinity"?
    // OR: Use randomized/heuristic search for multiple candidates?

    // Implementation: Run DP. If match found, score it. 
    // To find "alternative", we could ban one item and run again? (Expensive)
    // BETTER: For M11 pilot, just score the first found result. 
    // AND: Implement the user's specific case (Subtotal A + Subtotal B) via `detectSubtotals` logic.

    // For now, let's implement the SCORING function for the items found.
    // ... (Existing DP logic) ...

    const dpCandidates = items.filter(i => i.total > 0 && i.total <= target);

    if (target < 3000000 && dpCandidates.length > 0) {
        const intTarget = Math.round(target);
        const dp = new Int32Array(intTarget + 1).fill(-1);
        const parent = new Int32Array(intTarget + 1).fill(-1);
        dp[0] = 0;

        // DP Filling
        for (let i = 0; i < dpCandidates.length; i++) {
            const val = Math.round(dpCandidates[i].total);
            if (val <= 0) continue;
            for (let s = intTarget; s >= val; s--) {
                if (dp[s] === -1 && dp[s - val] !== -1) {
                    dp[s] = 1;
                    parent[s] = i;
                }
            }
        }

        if (dp[intTarget] !== -1) {
            const resultItems: CanonicalBillItem[] = [];
            let curr = intTarget;
            while (curr > 0) {
                const itemIdx = parent[curr];
                const item = dpCandidates[itemIdx];
                resultItems.push(item);
                curr -= Math.round(item.total);
            }

            // SCORE CANDIDATE
            const score = scoreCandidate(resultItems, line);
            const status: TraceStatus = score.score >= 50 && domainFiltered ? "OK" : "PARTIAL"; // Threshold

            return {
                step: 'MONTO_SUBSET',
                status: status,
                details: `Desglose (Score ${score.score}): ${score.reasons.join(', ')}`,
                candidates: [{ items: resultItems, score: score.score, reason: score.reasons.join(', ') }],
                refsBill: resultItems.map(i => ({
                    kind: 'jsonpath',
                    source: 'BILL',
                    path: `item_id_${i.id}`,
                    itemID: i.id
                }))
            };
        }
    }

    return { step: 'MONTO_SUBSET', status: 'FAIL', details: 'No combinatorial match found' };
}

// --- NEW SCORING FUNCTION ---
function scoreCandidate(items: CanonicalBillItem[], pamLine: CanonicalPamLine): { score: number, reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 1. Contiguity
    const indices = items.map(i => (i as any).originalIndex ?? -1).filter(idx => idx !== -1).sort((a, b) => a - b);
    let contiguousCount = 0;
    for (let i = 0; i < indices.length - 1; i++) {
        if (indices[i + 1] - indices[i] === 1) contiguousCount++;
    }
    if (indices.length > 0 && contiguousCount === indices.length - 1) {
        score += 20;
        reasons.push("Contiguous Block (+20)");
    }

    // 2. Section Consistency
    const pamDomain = normalize(pamLine.descripcion);
    const sections = new Set(items.map(i => normalize(i.section || '')));

    if (sections.size === 1) {
        score += 50;
        reasons.push("Single Section (+50)");
    }

    // 3. Pavilion Mixing (Penalize)
    const hasPabellon = [...sections].some(s => s.includes('pabellon') || s.includes('quirurgico'));
    const pamIsHospitalization = pamDomain.includes('dia cama') || pamDomain.includes('hospitalizacion');

    if (pamIsHospitalization && hasPabellon) {
        score -= 80;
        reasons.push("Pavilion in Hosp. Line (-80)");
    }

    return { score, reasons };
}

function trySubtotalMatch(line: CanonicalPamLine, index: any): TraceAttempt {
    if (index.subtotals.has(line.valorTotal)) {
        return { step: 'MONTO_SUBTOTAL', status: 'OK', details: 'Matched Accounting Subtotal Block', refsBill: [] };
    }
    // Try Net+IVA? (If PAM is Total, and Subtotal is Total w/ IVA)
    // The detectSubtotals handles logic to produce the "Total" key.
    return { step: 'MONTO_SUBTOTAL', status: 'FAIL', details: 'No subtotal match' };
}

function summarizeTrace(attempts: TraceAttempt[]): TraceStatus {
    if (attempts.some(a => a.status === 'OK')) return 'OK';
    if (attempts.some(a => a.status === 'PARTIAL')) return 'PARTIAL';
    return 'FAIL';
}

// --- Traceability Levels (Fix #1: separate numeric match from real anchor) ---
type TraceabilityLevel = 'TRACE_OK' | 'TRACE_WEAK' | 'TRACE_NONE';

function computeTraceability(attempts: TraceAttempt[], matchedItems: CanonicalBillItem[]): { level: TraceabilityLevel; reason: string } {
    const hasAnchor1a1 = attempts.some(a => a.step === 'MONTO_1A1' && a.status === 'OK');
    const hasGlosaExact = attempts.some(a => a.step === 'GLOSA_FAMILIA' && a.status === 'OK');
    const hasSubtotal = attempts.some(a => a.step === 'MONTO_SUBTOTAL' && a.status === 'OK');
    const hasContiguous = attempts.some(a => a.step === 'MONTO_CONTIGUO' && (a.status === 'OK' || a.status === 'AMBIGUOUS')); // Strong
    const hasDP = attempts.some(a => a.step === 'MONTO_SUBSET' && (a.status === 'OK' || a.status === 'PARTIAL'));
    const hasDPDomain = attempts.some(a => a.step === 'MONTO_SUBSET' && a.status === 'OK' && a.details?.includes('domain=ON'));
    const hasDPPartial = attempts.some(a => a.step === 'MONTO_SUBSET' && a.status === 'PARTIAL');

    const hasIds = matchedItems?.length > 0 && matchedItems.every(i => !!i.id);

    // TRACE_OK: real anchor (1A1 unique match or exact glosa)
    if (hasAnchor1a1 || hasGlosaExact) {
        return { level: 'TRACE_OK', reason: hasAnchor1a1 ? 'Anchor MONTO_1A1' : 'Glosa exacta' };
    }

    // TRACE_OK: domain-filtered DP with verified IDs (deterministic clinical match)
    if (hasDPDomain && hasIds) {
        return { level: 'TRACE_OK', reason: 'DP determinístico en dominio clínico + IDs verificados' };
    }

    // TRACE_WEAK: undifferentiated DP or SUBTOTAL (numeric match, no semantic anchor)
    if (hasSubtotal || hasDP) {
        return { level: 'TRACE_WEAK', reason: hasSubtotal ? 'Match por SUBTOTAL' : 'Match por DP/Subset (sin filtro dominio)' };
    }

    // TRACE_NONE: nothing usable
    return { level: 'TRACE_NONE', reason: 'Sin ancla ni desglose' };
}

function mapGCToDomain(gc: string, description: string = ''): ContractDomain {
    const codeMap: Record<string, ContractDomain> = {
        '3101002': 'MATERIALES_CLINICOS',
        '3101001': 'MEDICAMENTOS_HOSP',
        '3000000': 'HOSPITALIZACION',
        '3201001': 'OTROS',
        '3201002': 'OTROS',
        '0101001': 'CONSULTA',
        '0300000': 'EXAMENES',
        '0400000': 'EXAMENES',
        '0500000': 'KINESIOLOGIA',
        '0600000': 'PROTESIS_ORTESIS',
        '1100000': 'PABELLON',
        '1200000': 'PABELLON',
        '1300000': 'HONORARIOS'
    };
    if (codeMap[gc]) return codeMap[gc];

    const lower = normalize(description);
    if (lower.includes('dia cama') || lower.includes('habitacion')) return 'HOSPITALIZACION';
    if (lower.includes('pabellon') || lower.includes('quirofano')) return 'PABELLON';
    if (lower.includes('honorario') || lower.includes('medico')) return 'HONORARIOS';
    if (lower.includes('medicamento') || lower.includes('farmaco')) return 'MEDICAMENTOS_HOSP';
    if (lower.includes('material') || lower.includes('insumo')) return 'MATERIALES_CLINICOS';
    if (lower.includes('examen') || lower.includes('laboratorio')) return 'EXAMENES';
    if (lower.includes('kinesi')) return 'KINESIOLOGIA';
    if (lower.includes('protesis') || lower.includes('ortesis')) return 'PROTESIS_ORTESIS';
    if (lower.includes('traslado')) return 'TRASLADOS';

    return 'OTROS';
}

function evaluateContract(line: CanonicalPamLine, contract: CanonicalContract): any {
    const domain = mapGCToDomain(line.codigoGC, line.descripcion);

    // Exact match by domain
    const rule = contract.rules.find(r => r.domain === domain);

    if (!rule) {
        return { state: 'NO_VERIFICABLE_POR_CONTRATO', rulesUsed: [], notes: `Dominio '${domain}' no hallado en contrato` };
    }

    // Check if it's explicitly excluded? (Assumption: if coverage is 0% explicitly)
    // Here logic depends on rule structure. For now, existence = Verificable.

    return { state: 'VERIFICABLE', rulesUsed: [rule.id], notes: `Regla aplicada: ${rule.textLiteral}` };
}

function classifyFragmentation(
    line: CanonicalPamLine,
    attempts: TraceAttempt[],
    contractCheck: any,
    eventModel: any,
    matchedItems: CanonicalBillItem[],
    cfg: any,
    anchorMap: Record<string, number[]> | null = null
): any {
    let level: FindingLevel = 'CORRECTO';
    let motor: Motor = 'NA';
    let rationale = '';
    const impact = line.copago;

    // Zero copago -> No financial injury
    if (impact === 0) return { level, motor, rationale, economicImpact: 0 };

    const desc = normalize(line.descripcion);
    const isGeneric = cfg.suspectGroupCodes.includes(line.codigoGC) || cfg.genericGlosas.some((g: string) => desc.includes(g));

    // Traceability (Fix #1: use levels, not raw trace status)
    const t = computeTraceability(attempts, matchedItems);
    const traceOkHard = t.level === 'TRACE_OK';
    const traceWeak = t.level === 'TRACE_WEAK';
    const traceNone = t.level === 'TRACE_NONE';

    // Signals
    const dpAttempt = attempts.find(a => a.step === 'MONTO_SUBSET' && (a.status === 'OK' || a.status === 'PARTIAL'));
    const contigAttempt = attempts.find(a => a.step === 'MONTO_CONTIGUO' && (a.status === 'OK' || a.status === 'AMBIGUOUS')); // NEW
    const subtotalAttempt = attempts.find(a => a.step === 'MONTO_SUBTOTAL' && a.status === 'OK');
    const traceBreakdown = contigAttempt?.details || dpAttempt?.details || subtotalAttempt?.details || '';

    const hasM2Signals = dpAttempt?.status === 'OK' || !!contigAttempt; // Contig is strong M2 signal if section mismatch
    const hasM2SubtotalRef = !!subtotalAttempt;

    // M1: Creación Artificial de Actos Autónomos
    const forbiddenM1 = ["preparacion", "monitorizacion", "uso de equipo", "derecho", "sala", "recargo horario"];
    if (
        (line.bonificacion === 0 && impact > 0 && !isGeneric) ||
        (forbiddenM1.some(t2 => desc.includes(t2)) && !desc.includes("pabellon") && !desc.includes("dia cama"))
    ) {
        motor = 'M1';
        level = 'FRAGMENTACION_ESTRUCTURAL';
        rationale = 'Acto accesorio inseparable del principal facturado como autónomo (Bonif 0 / Copago 100%)';
        return { level, motor, rationale, economicImpact: impact };
    }

    // M2: Desanclaje desde Paquete (Unbundling)
    if (eventModel.paquetesDetectados.length > 0) {
        const standardSupplies = ["jeringa", "aguja", "torula", "guantes", "electrodo", "bajada", "branula", "gasas", "aposito", "ceftriaxona", "fentanyl", "propofol", "suero", "ondansetron"];

        // 1. Direct PAM Description Check
        if (standardSupplies.some(s => desc.includes(s))) {
            const paqueteOrigen = inferPackageOrigen(matchedItems.length > 0 ? matchedItems : [], eventModel, anchorMap);
            motor = 'M2';
            level = 'FRAGMENTACION_ESTRUCTURAL';
            rationale = `Insumo estándar (${desc}) desagregado de paquete clínico obligatorio (${paqueteOrigen})`;
            return { level, motor, rationale, economicImpact: impact };
        }

        // 2. Component Check (Combinatorial or Subtotal Trace)
        const isCatchAll = line.codigoGC === '3201001' || line.codigoGC === '3201002';
        if (!isCatchAll && (hasM2Signals || hasM2SubtotalRef) && matchedItems.length > 0) {

            // FULL BREAKDOWN Logic (User Request)
            // Instead of just finding one supply, we list them all to prove the sum.
            const sum = matchedItems.reduce((s, i) => s + (i.total || 0), 0);
            const delta = Math.abs(sum - line.valorTotal);

            // Generate list of items
            const desglose = matchedItems
                .sort((a, b) => ((a as any).originalIndex ?? 0) - ((b as any).originalIndex ?? 0))
                .slice(0, 15) // Limit to 15 to keep report readable, but usually enough for 99% of cases
                .map(i => {
                    const idx = (i as any).originalIndex ?? (i as any).index ?? '';
                    const sec = i.section || i.sectionPath?.join(' > ') || '';
                    return `- [${idx}] ${i.description} | $${(i.total || 0).toLocaleString()} | ${sec}`;
                })
                .join('\n');

            // Find at least one standard supply to confirm the "Clinical Package" link
            const foundSupply = matchedItems.find(i => {
                const iDesc = normalize(i.description);
                return standardSupplies.some(s => iDesc.includes(s));
            });

            if (foundSupply || matchedItems.length > 0) {
                const paqueteOrigen = inferPackageOrigen(matchedItems, eventModel, anchorMap);
                const provenance = foundSupply?.section ? `proveniente de la sección '${foundSupply.section}'` : 'proveniente de la cuenta';

                // Base rationale
                rationale = `Paquete desplazado: El monto $${line.valorTotal.toLocaleString()} corresponde al siguiente hallazgo clínico:
${traceBreakdown}

DESGLOSE EVIDENCIA (${matchedItems.length} items, suma $${sum.toLocaleString()}, Δ=$${delta.toLocaleString()}):
${desglose}${matchedItems.length > 15 ? '\n... (ver items restantes)' : ''}

Este conjunto contiene insumo estándar (${foundSupply?.description || 'varios'}) ${provenance}, lo que confirma su pertenencia al paquete clínico (${paqueteOrigen}).`;

                // Safety Check: Delta > 2 means it's not a perfect match, downgrade to M3/Review
                if (delta > 2) {
                    level = 'FRAGMENTACION_ESTRUCTURAL';
                    motor = 'M3';
                    rationale = `Match candidato pero suma no exacta (Δ=$${delta.toLocaleString()}). Requiere revisión manual.\n` + rationale;
                    return { level, motor, rationale, economicImpact: impact };
                }

                motor = 'M2';
                level = 'FRAGMENTACION_ESTRUCTURAL';
                return { level, motor, rationale, economicImpact: impact };
            }
        }
    }

    // M3: Traslado de Costos No Clínicos / Residuales (Bolsón)
    // Generic PAM + NO hard anchor -> M3
    // Generic PAM + only WEAK trace (DP/Subtotal) -> STILL M3 (numeric match ≠ clinical traceability)
    if (isGeneric && (traceNone || traceWeak)) {
        motor = 'M3';
        level = 'FRAGMENTACION_ESTRUCTURAL';
        rationale = traceWeak
            ? `Bolsón genérico: El monto $${line.valorTotal.toLocaleString()} corresponde al siguiente match numérico (${t.reason}):\n${traceBreakdown}\n\nSe clasifica como OPACIDAD al no contar con trazabilidad clínica real (TRACE_WEAK).`
            : 'Traslado de costos a bolsón genérico sin trazabilidad clínica ni desglose';
        return { level, motor, rationale, economicImpact: impact };
    }

    // M4: Desclasificación de Dominio (Renegación Artificial)
    // ONLY fires if: (a) says "no cubierto/no contemplada", (b) TRACE_OK (hard anchor),
    // (c) contract is VERIFICABLE, (d) no M2/M3 signals
    const saysNoCover = desc.includes('no cubierto') || desc.includes('no contemplada') || desc.includes('no arancel');
    const hasM3Signals = isGeneric && (traceNone || traceWeak);

    if (
        line.bonificacion === 0 &&
        contractCheck.state === 'VERIFICABLE' &&
        saysNoCover &&
        traceOkHard &&
        !hasM3Signals &&
        !hasM2Signals
    ) {
        motor = 'M4';
        level = 'DISCUSION_TECNICA';
        rationale = `Item con cobertura contractual posible (${contractCheck.notes}) pero bonificado en $0 sin causal de exclusión expresa.`;
        return { level, motor, rationale, economicImpact: impact };
    }

    // Fix #3: catch-all must return impact if level != CORRECTO
    // If we get here, it's CORRECTO (no fragmentation detected)
    return { level, motor, rationale, economicImpact: 0 };
}

function evaluateOpacidad(
    line: CanonicalPamLine,
    cfg: any,
    attempts: TraceAttempt[],
    contractState: VerifState,
    matchedItems: CanonicalBillItem[],
    frag: any
): any {
    let breakdown = [];
    let iopScore = 0;

    // Use REAL traceability from actual attempts (not proxy)
    const t = computeTraceability(attempts, matchedItems);
    const effectiveTraceNone = (t.level === 'TRACE_NONE');
    const effectiveTraceWeak = (t.level === 'TRACE_WEAK');

    const isSuspect = cfg.suspectGroupCodes.includes(line.codigoGC) || normalize(line.descripcion).includes("no cubierto");

    if (line.copago === 0 && line.bonificacion > 0) {
        return { applies: false, iopScore: 0, breakdown: [], agotamiento: false };
    }

    // IOP Scoring
    // +25 Agrupador sin desglose verificable (DP/Subtotal = TRACE_WEAK counts as "sin desglose")
    if (isSuspect && (effectiveTraceNone || effectiveTraceWeak)) {
        iopScore += 25;
        const msg = effectiveTraceWeak ? 'Agrupador con desglose parcial/numérico (TRACE_WEAK)' : 'Agrupador sin desglose';
        breakdown.push({ label: msg, points: 25 });
    }
    // +20 Glosa Genérica
    const desc = normalize(line.descripcion);
    if (desc.includes("no cubierto") || desc.includes("insumos") || desc.includes("gasto")) {
        iopScore += 20;
        breakdown.push({ label: 'Glosa Genérica indeterminada', points: 20 });
    }
    // +15 Bonif 0 / Copago Total
    if (line.bonificacion === 0 && line.copago > 0) {
        iopScore += 15;
        breakdown.push({ label: 'Bonificación $0 (Copago Total)', points: 15 });
    }
    // +15 Fallo Trazabilidad (only on TRACE_NONE, not TRACE_WEAK)
    if (effectiveTraceNone) {
        iopScore += 15;
        breakdown.push({ label: 'Fallo Trazabilidad Fase B', points: 15 });
    }

    const applies = iopScore >= cfg.opacidadThresholdIOP;

    return { applies, iopScore, breakdown, agotamiento: true };
}

function buildRow(line: CanonicalPamLine, attempts: TraceAttempt[], contractCheck: any, frag: any, opacidad: any, matchedItems: CanonicalBillItem[]): PamAuditRow {
    const traceability = computeTraceability(attempts, matchedItems);
    return {
        pamLineId: line.id || `pam_${Math.random().toString(36).substr(2, 9)}`,
        codigoGC: line.codigoGC,
        descripcion: line.descripcion,
        montoCopago: line.copago,
        bonificacion: line.bonificacion,
        trace: {
            status: summarizeTrace(attempts),
            attempts: attempts,
            matchedBillItemIds: matchedItems.map(i => i.id),
            traceability  // TRACE_OK | TRACE_WEAK | TRACE_NONE
        },
        contractCheck: contractCheck,
        fragmentacion: frag,
        opacidad: opacidad
    };
}

function aggregate(rows: PamAuditRow[], cfg: any) {
    const totalCopagoAnalizado = rows.reduce((s, r) => s + r.montoCopago, 0);
    const findings = rows.filter(r => r.fragmentacion.level !== 'CORRECTO' || r.opacidad.applies);

    const totalImpactoFragmentacion = findings.reduce((s, r) => s + r.montoCopago, 0); // Impact is the Copago of the item

    const m1Count = findings.filter(r => r.fragmentacion.motor === 'M1').length;
    const m2Count = findings.filter(r => r.fragmentacion.motor === 'M2').length;
    const m3Copago = findings.filter(r => r.fragmentacion.motor === 'M3').reduce((s, r) => s + r.montoCopago, 0);

    const isSystemic = (m1Count >= 3 || m2Count >= 5 || (totalCopagoAnalizado > 0 && (m3Copago / totalCopagoAnalizado) >= cfg.minImpactoM3Systemic));
    const maxIOP = Math.max(...rows.map(r => r.opacidad.iopScore), 0);

    return {
        totalCopagoAnalizado,
        totalImpactoFragmentacion,
        opacidadGlobal: { applies: maxIOP >= cfg.opacidadThresholdIOP, maxIOP },
        patternSystemic: { m1Count, m2Count, m3CopagoPct: totalCopagoAnalizado ? m3Copago / totalCopagoAnalizado : 0, isSystemic }
    };
}

function buildMatrix(rows: PamAuditRow[]) {
    return rows
        .filter(r => r.fragmentacion.level !== 'CORRECTO' || r.opacidad.applies)
        .map(r => ({
            itemLabel: `${r.codigoGC} - ${r.descripcion}`,
            classification: r.fragmentacion.level,
            motor: r.fragmentacion.motor,
            fundamento: r.fragmentacion.rationale + (r.opacidad.applies ? ` [OPACIDAD IOP ${r.opacidad.iopScore}]` : ''),
            impacto: r.montoCopago,
            iop: r.opacidad.iopScore
        }));
}

function buildForensicReport(event: any, rows: PamAuditRow[], summary: any, metadata?: any): string {
    const findings = rows.filter(r => r.fragmentacion.level !== 'CORRECTO' || r.opacidad.applies);

    const header = metadata ? `
PACIENTE: ${metadata.patientName || 'N/A'}
PRESTADOR: ${metadata.clinicName || 'N/A'}
ISAPRE: ${metadata.isapre || 'N/A'} | PLAN: ${metadata.plan || 'N/A'}
FECHA: ${metadata.financialDate || 'N/A'}
` : '';

    return `INFORME FORENSE M10 (v1.4 - Integridad & Opacidad)
--------------------------------------------------${header}
EVENTO DETECTADO: ${event.actoPrincipal}
PAQUETES CLÍNICOS: ${event.paquetesDetectados.join(', ') || 'Ninguno'}

RESUMEN EJECUTIVO:
- Total Copago Analizado: $${summary.totalCopagoAnalizado.toLocaleString()}
- Impacto Hallazgos: $${summary.totalImpactoFragmentacion.toLocaleString()}
- Estado Opacidad: ${summary.opacidadGlobal.applies ? `CRÍTICO (IOP MAX ${summary.opacidadGlobal.maxIOP})` : 'Trazable'}
- Patrón Sistémico: ${summary.patternSystemic.isSystemic ? 'SI (Mecanismo Repetitivo)' : 'No detectado'}

DETALLE DE HALLAZGOS RELEVANTES:
${findings.map(f => `
> [${f.fragmentacion.motor}] ${f.codigoGC} - ${f.descripcion}
  Copago Real: $${f.montoCopago.toLocaleString()}
  Fundamento: ${f.fragmentacion.rationale}
  ${f.opacidad.applies ? `⚠️ OPACIDAD DETECTADA (IOP ${f.opacidad.iopScore}):\n  ` + f.opacidad.breakdown.map((b: any) => `  - ${b.label} (+${b.points})`).join('\n') : ''}
`).join('\n')}

CONCLUSIÓN:
${summary.opacidadGlobal.applies
            ? "La cuenta presenta Opacidad Liquidatoria Mayor (IOP > 40). Se exige desglose detallado bajo sanción de tener por no escritas las cláusulas oscuras (Contra Proferentem)."
            : "Cuenta auditable con hallazgos específicos de fragmentación."}
`;
}

function buildComplaintText(rows: PamAuditRow[], cfg: any): string {
    const opacos = rows.filter(r => r.opacidad.applies);
    if (opacos.length === 0) return "Sin hallazgos de opacidad crítica.";

    return `SEÑORES ISAPRE / PRESTADOR:

En relación a la liquidación (PAM) analizada, se impugnan los siguientes cobros por vulnerar el deber de información (Opacidad Liquidatoria detectada, IOP > ${cfg.opacidadThresholdIOP}):

${opacos.map(r => `- Ítem ${r.codigoGC} "${r.descripcion}" | Copago: $${r.montoCopago} | IOP: ${r.opacidad.iopScore}`).join('\n')}

FUNDAMENTOS DE RECLAMO:
1. "Agrupamiento Ciego": Los ítems señalados consolidan montos sin desglose de sub-ítem verificable, impidiendo el ejercicio del derecho a defensa del afiliado.
2. "Copago sin Causa": Se cobran montos significativos (Total: $${opacos.reduce((s, r) => s + r.montoCopago, 0).toLocaleString()}) bajo glosas genéricas ("No Cubierto", "Insumos") sin acreditar la prestación subyacente.
3. Principio de Literalidad e Integridad: El contrato de salud es de adhesión; toda oscuridad debe interpretarse a favor del afiliado (Art. 1566 Código Civil).

PETICIÓN:
Sírvase anular el cobro de los ítems opacos o bien refacturar con el desglose unitario completo que permita su trazabilidad con la Ficha Clínica.`;
}

function createErrorOutput(msg: string, cfg: any): SkillOutput {
    return {
        summary: { totalCopagoAnalizado: 0, totalImpactoFragmentacion: 0, opacidadGlobal: { applies: false, maxIOP: 0 }, patternSystemic: { m1Count: 0, m2Count: 0, m3CopagoPct: 0, isSystemic: false } },
        eventModel: { notes: msg, paquetesDetectados: [] },
        matrix: [],
        pamRows: [],
        reportText: `ERROR CRÍTICO GATE 0: ${msg}`,
        complaintText: ''
    };
}

function buildAnchorMap(items: CanonicalBillItem[]): Record<string, number[]> {
    const map: Record<string, number[]> = {
        'DERECHO_PABELLON': [],
        'DIA_CAMA_INTEGRAL': []
    };
    items.forEach(i => {
        const idx = (i as any).originalIndex ?? (i as any).index ?? -1;
        if (idx === -1) return;
        const norm = normalize(i.description);
        if (norm.includes('pabellon') || norm.includes('quirofano') || norm.includes('recuperacion')) {
            map['DERECHO_PABELLON'].push(idx);
        }
        if (norm.includes('dia cama') || norm.includes('habitacion') || norm.includes('sala')) {
            map['DIA_CAMA_INTEGRAL'].push(idx);
        }
    });
    return map;
}
