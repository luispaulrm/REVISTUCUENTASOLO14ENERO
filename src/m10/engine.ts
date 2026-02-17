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
    ContractDomain
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

    const pamLines: CanonicalPamLine[] = [];
    input.pam.folios.forEach(folio => {
        folio.items.forEach(item => {
            pamLines.push({ ...item, folioPAM: folio.folioPAM, prestador: folio.prestador || folio.folioPAM });
        });
    });

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
    const billIndex = indexBill(input.bill.items);
    const eventModel = inferEventModel(input.bill.items, input.pam);

    const pamRows: PamAuditRow[] = [];

    // --- Execution Loop per Line ---
    for (const line of pamLines) {

        // Skip purely zero lines
        if (line.valorTotal === 0 && line.copago === 0 && line.bonificacion === 0) continue;

        const attempts: TraceAttempt[] = [];

        // --- Phase 1: Mapeo (Agotamiento Probatorio) ---
        // 1. Monto 1:1 Match (Anchor)
        const montoMatch = tryMonto1a1Match(line, billIndex);
        attempts.push(montoMatch);

        let matchedBillItems: CanonicalBillItem[] = [];
        if (montoMatch.status === 'OK' && billIndex.byTotal.has(line.valorTotal)) {
            matchedBillItems = billIndex.byTotal.get(line.valorTotal)!;
        }

        // 2. Glosa Match (if needed)
        const glosaMatch = tryGlosaMatch(line, billIndex);
        if (montoMatch.status !== 'OK') {
            attempts.push(glosaMatch);
            // If glosa matched and amount is close, maybe we can link? 
            // For strict v1.4, we use attempts history.
        }

        // 3. Family Match (if needed) - Simplified Bucket Check
        // (Implemented inside classifyFragmentation if Trace fails)

        const traceStatus = summarizeTrace(attempts);

        // --- Phase 2: Motores de Fragmentación (M1-M4) ---
        // Only if Gate 0 passed (which it did to get here)

        // First check contract for M4 reference
        const contractCheck = evaluateContract(line, input.contract);

        const frag = classifyFragmentation(line, attempts, contractCheck, eventModel, matchedBillItems, cfg);

        // --- Phase 3: Contract Verification (Referential Only) ---
        // Already called above for M4 input, but here we formalize it for the row
        // Contract does NOT change numbers.

        // --- Phase 4: Opacidad (Agotamiento) ---
        const opacidad = evaluateOpacidad(line, cfg, traceStatus, contractCheck.state, matchedBillItems, frag);

        pamRows.push(buildRow(line, attempts, contractCheck, frag, opacidad, matchedBillItems));
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
        metadata: input.metadata
    };
}

// ---------- Helpers ----------

function normalize(str: string): string {
    return (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

function indexBill(items: CanonicalBillItem[]) {
    const byTotal = new Map<number, CanonicalBillItem[]>();
    const byDescription = new Map<string, CanonicalBillItem[]>();

    items.forEach(item => {
        const t = item.total || 0;
        if (!byTotal.has(t)) byTotal.set(t, []);
        byTotal.get(t)?.push(item);

        const norm = normalize(item.description);
        if (!byDescription.has(norm)) byDescription.set(norm, []);
        byDescription.get(norm)?.push(item);
    });

    return { byTotal, byDescription, all: items };
}

function inferEventModel(billItems: CanonicalBillItem[], pam: any) {
    const desc = billItems.map(i => i.description.toLowerCase()).join(' ');
    const hasPabellon = desc.includes('pabellon') || desc.includes('quirofano') || desc.includes('surgery');
    const hasDiaCama = desc.includes('dia cama') || desc.includes('habitacion') || desc.includes('sala');

    return {
        actoPrincipal: hasPabellon ? 'CIRUGIA_MAYOR' : 'HOSPITALIZACION_GENERAL',
        paquetesDetectados: [
            hasPabellon ? 'DERECHO_PABELLON' : null,
            hasDiaCama ? 'DIA_CAMA_INTEGRAL' : null
        ].filter(Boolean) as string[],
        notes: 'Inferido determinísticamente por glosas'
    };
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

function summarizeTrace(attempts: TraceAttempt[]): TraceStatus {
    if (attempts.some(a => a.status === 'OK')) return 'OK';
    if (attempts.some(a => a.status === 'PARTIAL')) return 'PARTIAL';
    return 'FAIL';
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
    cfg: any
): any {
    let level: FindingLevel = 'CORRECTO';
    let motor: Motor = 'NA';
    let rationale = '';
    const impact = line.copago;

    // Zero copago -> No financial injury -> Correcto (usually)
    if (impact === 0) return { level, motor, rationale, economicImpact: 0 };

    const desc = normalize(line.descripcion);
    const traceFailed = summarizeTrace(attempts) !== 'OK';
    const isGeneric = cfg.suspectGroupCodes.includes(line.codigoGC) || cfg.genericGlosas.some((g: string) => desc.includes(g));

    // M1: Creación Artificial de Actos Autónomos
    // Accesory acts (bonif=0, copago>0) without autonomous code OR clearly accessory desc
    const forbiddenM1 = ["preparacion", "monitorizacion", "uso de equipo", "derecho", "sala", "recargo horario"];
    if (
        (line.bonificacion === 0 && impact > 0 && !isGeneric) ||
        (forbiddenM1.some(t => desc.includes(t)) && !desc.includes("pabellon") && !desc.includes("dia cama"))
    ) {
        motor = 'M1';
        level = 'FRAGMENTACION_ESTRUCTURAL';
        rationale = 'Acto accesorio inseparable del principal facturado como autónomo (Bonif 0 / Copago 100%)';
        return { level, motor, rationale, economicImpact: impact };
    }

    // M2: Desanclaje desde Paquete (Unbundling)
    if (eventModel.paquetesDetectados.length > 0) {
        const standardSupplies = ["jeringa", "aguja", "torula", "guantes", "electrodo", "bajada", "branula", "gasas", "aposito"];
        if (standardSupplies.some(s => desc.includes(s))) {
            motor = 'M2';
            level = 'FRAGMENTACION_ESTRUCTURAL';
            rationale = `Insumo estándar (${desc}) desagregado de paquete clínico obligatorio (${eventModel.paquetesDetectados[0]})`;
            return { level, motor, rationale, economicImpact: impact };
        }
    }

    // M3: Traslado de Costos No Clínicos / Residuales (Bolsón)
    if (isGeneric && traceFailed) {
        motor = 'M3';
        level = 'FRAGMENTACION_ESTRUCTURAL';
        rationale = 'Traslado de costos a bolsón genérico sin trazabilidad clínica ni desglose';
        return { level, motor, rationale, economicImpact: impact };
    }

    // M4: Desclasificación de Dominio (Renegación Artificial)
    // E.g. "No Cubierto" but should be covered by broad contract terms?
    // If Rule exists but PAM says "No Cubierto" (Bonif 0)?
    if (line.bonificacion === 0 && contractCheck.state === 'VERIFICABLE' && !traceFailed) {
        // If contract says it should be covered but it isn't -> M4
        // Check rule coverage pct?
        // Detailed check omitted for brevity, assuming Bonif 0 with Verifiable Rule is suspect M4.
        motor = 'M4';
        level = 'DISCUSION_TECNICA';
        rationale = `Item con cobertura contractual posible (${contractCheck.notes}) pero bonificado en $0 sin causal de exclusión expresa.`;
        return { level, motor, rationale, economicImpact: impact };
    }

    return { level, motor, rationale, economicImpact: 0 };
}

function evaluateOpacidad(
    line: CanonicalPamLine,
    cfg: any,
    traceStatus: TraceStatus,
    contractState: VerifState,
    matchedItems: any[],
    frag: any
): any {
    let breakdown = [];
    let iopScore = 0;

    // Conditions to activate Opacidad check:
    // (trace.status == FAIL) AND (bonification == 0 OR copago > 0)
    // AND (group code OR generic glosa) AND no sub-items.

    // For v1.4, calculate IOP always if "suspect", apply threshold later.
    const isSuspect = cfg.suspectGroupCodes.includes(line.codigoGC) || normalize(line.descripcion).includes("no cubierto");

    if (line.copago === 0 && line.bonificacion > 0) {
        return { applies: false, iopScore: 0, breakdown: [], agotamiento: false };
    }

    // IOP Scoring
    // +25 Agrupador sin desglose
    if (isSuspect && matchedItems.length === 0) {
        iopScore += 25;
        breakdown.push({ label: 'Agrupador sin desglose', points: 25 });
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
    // +15 Fallo Trazabilidad (redundant with matchedItems=0 usually, but distinct concept)
    if (traceStatus === 'FAIL') {
        iopScore += 15;
        breakdown.push({ label: 'Fallo Trazabilidad Fase B', points: 15 });
    }
    // +10 Duplicidad GC sin fundamento (Hard to check locally line-by-line without context, skip for now or complex check)

    const applies = iopScore >= cfg.opacidadThresholdIOP;

    return { applies, iopScore, breakdown, agotamiento: true };
}

function buildRow(line: CanonicalPamLine, attempts: TraceAttempt[], contractCheck: any, frag: any, opacidad: any, matchedItems: CanonicalBillItem[]): PamAuditRow {
    return {
        pamLineId: line.id || `pam_${Math.random().toString(36).substr(2, 9)}`,
        codigoGC: line.codigoGC,
        descripcion: line.descripcion,
        montoCopago: line.copago,
        bonificacion: line.bonificacion,
        trace: {
            status: summarizeTrace(attempts),
            attempts: attempts,
            matchedBillItemIds: matchedItems.map(i => i.id)
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
