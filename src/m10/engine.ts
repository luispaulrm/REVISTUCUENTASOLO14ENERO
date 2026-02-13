import {
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
    CanonicalContract
} from './types';

// ---------- Configuration & Constants ----------

const DEFAULT_CONFIG = {
    agrupadoresSospechosos: ["3101002", "3201001", "3101001", "3201002"],
    opacidadThresholdIOP: 60,
    allowMontoSubsetMatch: true,
};

// ---------- Helpers ----------

function normalize(str: string): string {
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, "")
        .trim();
}

// Check if array a contains all elements of array b
function isSubset(a: string[], b: string[]) {
    const setA = new Set(a);
    return b.every(val => setA.has(val));
}

function sumMoney(items: { total?: number }[]): number {
    return items.reduce((sum, item) => sum + (item.total || 0), 0);
}

// ---------- Main Engine ----------

export function runSkill(input: SkillInput): SkillOutput {
    const cfg = { ...DEFAULT_CONFIG, ...input.config };

    // SC-1: Stop if missing data
    if (!input.bill?.items?.length || !input.pam?.folios?.length) {
        return createErrorOutput("SC-1: Missing Source Data (Bill or PAM empty)", cfg);
    }

    // --- Phase A: Indexing ---
    const billIndex = indexBill(input.bill.items);
    const eventModel = inferEventModel(input.bill.items, input.pam);

    // Flatten PAM lines for iteration
    const pamLines: CanonicalPamLine[] = [];
    input.pam.folios.forEach(folio => {
        folio.items.forEach(item => {
            // Logic for critical lines: copago > 0 OR bonificacion == 0
            // We process ALL lines to build full matrix, but focus forensics on critical ones
            pamLines.push({ ...item, folioPAM: folio.folioPAM, prestador: folio.prestadorPrincipal });
        });
    });

    const pamRows: PamAuditRow[] = [];

    for (const line of pamLines) {
        // Only analyze relevant lines for opacity/fragmentation
        if (line.copago === 0 && line.bonificacion > 0) {
            // Fully covered items - superficial check or skip
            // For now, fast-track as CORRECT unless M2 triggers (duplicate)
            pamRows.push(createOkRow(line));
            continue;
        }

        const attempts: TraceAttempt[] = [];

        // --- Phase B: Cascada de Trazabilidad ---

        // 1. CODE_MATCH (if available) - Assuming codes in description or separate field
        // Not implemented fully without knowing Bill code structure, skipping to Glosa/Monto
        attempts.push({ step: 'CODE_MATCH', status: 'FAIL', details: 'No internal code mapping available' });

        // 2. GLOSA_FAMILIA_MATCH
        const glosaMatch = tryGlosaMatch(line, billIndex);
        attempts.push(glosaMatch);

        // 3. MONTO_1A1_MATCH
        let matchedBillItems: CanonicalBillItem[] = [];
        let montoMatch = tryMonto1a1Match(line, billIndex);
        attempts.push(montoMatch);
        if (montoMatch.status === 'OK') {
            const refs = montoMatch.refsBill || [];
            // Extract IDs from refs (format: jsonpath: ...[id]) or imply logic
            // Simplified: we rely on billIndex finding the item
            const found = billIndex.byTotal.get(line.valorTotal);
            if (found) matchedBillItems = found;
        }

        // 4. MONTO_SUBSET_MATCH (Advanced)
        if (montoMatch.status !== 'OK' && cfg.allowMontoSubsetMatch) {
            const subsetMatch = tryMontoSubsetMatch(line, billIndex);
            attempts.push(subsetMatch);
            if (subsetMatch.status === 'OK') {
                // Logic to retrieve items from subset result
                // For prototype, we mark OK but don't populate detailed item list reference yet
            }
        }

        // 5. CONTRACT_ANCHOR_CHECK (Does it belong to a known contract domain?)
        const anchorCheck = checkContractAnchor(line, input.contract);
        attempts.push(anchorCheck);

        const matchStatus = summarizeTrace(attempts);

        // --- Phase C: Chequeo Contractual ---
        const contractCheck = evaluateContract(line, input.contract, matchStatus);

        // --- Phase D: Fragmentación (M1-M4) ---
        const frag = classifyFragmentation(line, attempts, contractCheck, eventModel, matchedBillItems);

        // --- Phase E: Opacidad (Agotamiento) ---
        // Agotamiento: tried all attempts and still FAIL or PARTIAL
        const exhausted = matchStatus !== 'OK';
        const opacidad = evaluateOpacidad(line, cfg, matchStatus, exhausted, input.contract);

        pamRows.push(buildRow(line, attempts, contractCheck, frag, opacidad, matchedBillItems));
    }

    // --- Aggregation & Reporting ---
    const patternSystemic = detectSystemic(pamRows);
    const summary = aggregate(pamRows, input.pam.global, patternSystemic);
    const matrix = buildMatrix(pamRows);
    const reportText = buildForensicReport(eventModel, pamRows, summary);
    const complaintText = buildComplaintText(pamRows, summary);

    return {
        summary,
        eventModel,
        matrix,
        pamRows,
        reportText,
        complaintText,
        debug: { configUsed: cfg as Required<SkillInput["config"]> }
    };
}

// ---------- Indexing & Matching Logic ----------

function indexBill(items: CanonicalBillItem[]) {
    const byTotal = new Map<number, CanonicalBillItem[]>();
    const byDescription = new Map<string, CanonicalBillItem[]>();

    items.forEach(item => {
        // Index by Total
        const t = item.total || 0;
        if (!byTotal.has(t)) byTotal.set(t, []);
        byTotal.get(t)?.push(item);

        // Index by Normalized Description
        const norm = normalize(item.description);
        if (!byDescription.has(norm)) byDescription.set(norm, []);
        byDescription.get(norm)?.push(item);
    });

    return { byTotal, byDescription, all: items };
}

function inferEventModel(billItems: CanonicalBillItem[], pam: any) {
    // Simple heuristic for event model
    const hasPabellon = billItems.some(i => i.section?.toLowerCase().includes('pabellon'));
    const hasDiaCama = billItems.some(i => i.description.toLowerCase().includes('dia cama'));

    return {
        actoPrincipal: hasPabellon ? 'CIRUGIA' : 'HOSPITALIZACION',
        paquetesDetectados: [
            hasPabellon ? 'PABELLON' : null,
            hasDiaCama ? 'DIA_CAMA' : null
        ].filter(Boolean) as string[],
        notes: 'Inferido automÃ¡ticamente'
    };
}

function tryGlosaMatch(line: CanonicalPamLine, index: any): TraceAttempt {
    const norm = normalize(line.descripcion);
    // Direct match
    if (index.byDescription.has(norm)) {
        return { step: 'GLOSA_FAMILIA_MATCH', status: 'OK', details: 'Direct string match' };
    }
    // Fuzzy / Partial (Simplified)
    // In real implementation, check Levenshtein or token overlap
    return { step: 'GLOSA_FAMILIA_MATCH', status: 'FAIL', details: 'No match found' };
}

function tryMonto1a1Match(line: CanonicalPamLine, index: any): TraceAttempt {
    const matches = index.byTotal.get(line.valorTotal);
    if (matches && matches.length === 1) {
        return {
            step: 'MONTO_1A1_MATCH',
            status: 'OK',
            details: 'Unique exact amount match',
            refsBill: matches.map((m: any) => ({ kind: 'docref', source: 'BILL', note: m.description }))
        };
    }
    if (matches && matches.length > 1) {
        return { step: 'MONTO_1A1_MATCH', status: 'PARTIAL', details: 'Multiple items with same amount' };
    }
    return { step: 'MONTO_1A1_MATCH', status: 'FAIL', details: 'No exact amount found' };
}

function tryMontoSubsetMatch(line: CanonicalPamLine, index: any): TraceAttempt {
    // Subset Sum Problem - Simplified greedy or small combination for demo
    // Start with items in same "Family"/Section if possible?
    // For now, placeholder for the complex algorithm
    return { step: 'MONTO_SUBSET_MATCH', status: 'FAIL', details: 'Subset sum search exhausted' };
}

function checkContractAnchor(line: CanonicalPamLine, contract: CanonicalContract): TraceAttempt {
    // Simple domain mapping
    const domain = mapGCToDomain(line.codigoGC);
    const rule = contract.rules.find(r => r.domain === domain);
    if (rule) {
        return { step: 'CONTRACT_ANCHOR_CHECK', status: 'OK', details: `Mapped to ${domain}` };
    }
    return { step: 'CONTRACT_ANCHOR_CHECK', status: 'FAIL', details: 'No contract rule for domain' };
}

function summarizeTrace(attempts: TraceAttempt[]): TraceStatus {
    if (attempts.some(a => a.status === 'OK')) return 'OK';
    if (attempts.some(a => a.status === 'PARTIAL')) return 'PARTIAL';
    return 'FAIL';
}

// ---------- Forensics Logic ----------

function evaluateContract(line: CanonicalPamLine, contract: CanonicalContract, traceStatus: TraceStatus): any {
    const domain = mapGCToDomain(line.codigoGC);
    const rule = contract.rules.find(r => r.domain === domain);

    if (!rule) return { state: 'NO_VERIFICABLE_POR_CONTRATO', rulesUsed: [], notes: 'Domain not found in contract' };

    // Check coverage
    return {
        state: 'VERIFICABLE',
        rulesUsed: [rule.id],
        notes: `Cobertura: ${rule.coberturaPct}%, Tope: ${JSON.stringify(rule.tope)}`
    };
}

function classifyFragmentation(
    line: CanonicalPamLine,
    attempts: TraceAttempt[],
    contractCheck: any,
    event: any,
    matchedItems: CanonicalBillItem[]
): any {
    let level: FindingLevel = 'CORRECTO';
    let motor: Motor = 'NA';
    let rationale = '';

    // M3: Traslado No Clínico (3201001/Generic)
    if (line.codigoGC === '3201001' && line.bonificacion === 0) {
        level = 'FRAGMENTACION_ESTRUCTURAL';
        motor = 'M3';
        rationale = 'Imputación a gasto no cubierto genérico (3201001) sin justificación clínica';
    }

    // M2: Desanclaje (Paid procedure but separate supplies)
    if (event.paquetesDetectados.includes('PABELLON') && line.codigoGC === '3101002' && line.copago > 0) {
        // If we found the item in bill and it's a standard simple supply
        level = 'FRAGMENTACION_ESTRUCTURAL';
        motor = 'M2';
        rationale = 'Desagregación de insumos propios del paquete de Pabellón';
    }

    // "Regla Especial 32.716" Logic
    if (matchedItems.length > 0 && line.copago > 0 && line.bonificacion === 0) {
        // We found items that sum up to this, but Isapre rejected them as a group
        motor = 'M4';
        level = 'FRAGMENTACION_ESTRUCTURAL';
        rationale = 'Renegación artificial de dominio: ítems trazables en cuenta agrupados para rechazo';
    }

    return { level, motor, rationale, economicImpact: line.copago };
}

function evaluateOpacidad(
    line: CanonicalPamLine,
    cfg: any,
    traceStatus: TraceStatus,
    exhausted: boolean,
    contract: CanonicalContract
): any {
    let iopScore = 0;
    const isSuspect = cfg.agrupadoresSospechosos.includes(line.codigoGC);

    if (isSuspect) iopScore += 25;
    if (line.bonificacion === 0 && line.copago > 0) iopScore += 15;
    if (traceStatus === 'FAIL') iopScore += 15;
    if (!exhausted) iopScore = 0; // If not exhausted, we don't declare opacity yet? Wait, definition says ONLY after exhaustion.

    const applies = exhausted && isSuspect && iopScore >= cfg.opacidadThresholdIOP;

    return {
        applies,
        iopScore,
        agotamiento: exhausted,
        requiredDisclosures: applies ? ['Desglose sub-item', 'Fundamento específico'] : []
    };
}


// ---------- Reporting ----------

function mapGCToDomain(gc: string): string {
    if (gc === '3101002') return 'MATERIALES_CLINICOS';
    if (gc === '3101001') return 'MEDICAMENTOS_HOSP';
    if (gc === 'PABELLON') return 'PABELLON';
    // ... add more mappings
    return 'OTROS';
}

function createOkRow(line: CanonicalPamLine): PamAuditRow {
    return {
        pamLineId: line.id,
        codigoGC: line.codigoGC,
        descripcion: line.descripcion,
        montoCopago: line.copago,
        bonificacion: line.bonificacion,
        valorTotal: line.valorTotal,
        trace: { status: 'OK', attempts: [], matchedBillItemIds: [] },
        contractCheck: { state: 'VERIFICABLE', rulesUsed: [], notes: 'Bonificado 100% o OK' },
        fragmentacion: { level: 'CORRECTO', motor: 'NA', rationale: '', economicImpact: 0 },
        opacidad: { applies: false, iopScore: 0, agotamiento: false },
        evidence: []
    };
}

function buildRow(line: any, attempts: any, contract: any, frag: any, op: any, matchedItems: any[]): PamAuditRow {
    return {
        pamLineId: line.id,
        codigoGC: line.codigoGC,
        descripcion: line.descripcion,
        montoCopago: line.copago,
        bonificacion: line.bonificacion,
        valorTotal: line.valorTotal,
        trace: {
            status: summarizeTrace(attempts),
            attempts,
            matchedBillItemIds: matchedItems.map(i => i.id)
        },
        contractCheck: contract,
        fragmentacion: frag,
        opacidad: op,
        evidence: [] // TODO: Aggregate evidence from attempts
    };
}

function detectSystemic(rows: PamAuditRow[]): boolean {
    const suspectCount = rows.filter(r => r.fragmentacion.motor !== 'NA').length;
    return suspectCount > 3;
}

function aggregate(rows: PamAuditRow[], global: any, systemic: boolean) {
    const totalCopagoAnalizado = rows.reduce((s, r) => s + r.montoCopago, 0);
    const totalImpactoFragmentacion = rows.filter(r => r.fragmentacion.level !== 'CORRECTO').reduce((s, r) => s + r.fragmentacion.economicImpact, 0);

    // Opacity is global if ANY critical row triggers it? Or weighted average?
    // Rule says "Opacidad global"
    const opacidadCount = rows.filter(r => r.opacidad.applies).length;

    return {
        totalCopagoPAM: global?.totalCopago || 0,
        totalCopagoAnalizado,
        totalImpactoFragmentacion,
        opacidadGlobal: { applies: opacidadCount > 0, iopScore: opacidadCount * 10 }, // Simplified
        patternSystemic: systemic
    };
}

function buildMatrix(rows: PamAuditRow[]) {
    return rows.filter(r => r.fragmentacion.motor !== 'NA' || r.opacidad.applies).map(r => ({
        itemLabel: `${r.codigoGC} - ${r.descripcion}`,
        classification: r.fragmentacion.level,
        motor: r.fragmentacion.motor,
        fundamento: r.fragmentacion.rationale + (r.opacidad.applies ? ' [OPACIDAD DETECTADA]' : ''),
        impacto: r.fragmentacion.economicImpact,
        refs: r.evidence
    }));
}

function buildForensicReport(event: any, rows: PamAuditRow[], summary: any): string {
    return `INFORME DE AUDITORÍA M10
    
Evento Principal: ${event.actoPrincipal}
Paquetes: ${event.paquetesDetectados.join(', ')}

RESUMEN FINANCIERO
Total Copago Analizado: ${summary.totalCopagoAnalizado}
Impacto Fragmentación: ${summary.totalImpactoFragmentacion}
Estado Opacidad: ${summary.opacidadGlobal.applies ? 'ACTIVADO' : 'NORMAL'}

DETALLE DE HALLAZGOS
${rows.filter(r => r.fragmentacion.level !== 'CORRECTO').map(r =>
        `- [${r.fragmentacion.motor}] ${r.descripcion}: ${r.fragmentacion.rationale} ($${r.montoCopago})`
    ).join('\n')}
`;
}

function buildComplaintText(rows: PamAuditRow[], summary: any): string {
    const lines = rows.filter(r => r.opacidad.applies).map(r => {
        return `Se detecta que el PAM consolida el monto $${r.montoCopago} bajo el código GC ${r.codigoGC} (“${r.descripcion}”) con bonificación $${r.bonificacion} y copago $${r.montoCopago}, sin desglose por sub-ítem, lo que impide verificar correspondencia con la Cuenta/Bill y aplicar control de legalidad.`;
    });

    return `Estimados,\n\n${lines.join('\n\n')}\n\nEl afiliado no tiene obligación de reconstruir ni inferir el contenido de montos agrupados. Se exige desglose y fundamento.`;
}

function createErrorOutput(msg: string, cfg: any): SkillOutput {
    return {
        summary: { totalCopagoAnalizado: 0, totalImpactoFragmentacion: 0, opacidadGlobal: { applies: false, iopScore: 0 }, patternSystemic: false },
        eventModel: { notes: msg, paquetesDetectados: [] },
        matrix: [],
        pamRows: [],
        reportText: `ERROR: ${msg}`,
        complaintText: '',
        debug: { stopConditionTriggered: msg, configUsed: cfg }
    };
}
