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
    CanonicalContract,
    CanonicalBill,
    CanonicalContractRule,
    ContractDomain
} from './types';

// ---------- Configuration & Constants ----------

const DEFAULT_CONFIG = {
    opacidadThresholdIOP: 60,
    minImpactoM3Systemic: 0.10, // 10%
    suspectGroupCodes: ["3101002", "3201001", "3101001", "3201002"]
};

// ---------- Main Engine: PROMPT MAESTRO v1.3 ----------

export function runSkill(input: SkillInput): SkillOutput {
    const cfg = { ...DEFAULT_CONFIG, ...input.config };

    // 1) Stop Conditions (SC-1)
    if (!input.bill?.items?.length || !input.pam?.folios?.length || !input.contract?.rules?.length) {
        return createErrorOutput("SC-1: Missing Source Data (Bill, PAM, or Contract)", cfg);
    }

    // --- Phase A: Indexing (Lectura Completa) ---
    const billIndex = indexBill(input.bill.items);
    const eventModel = inferEventModel(input.bill.items, input.pam);

    // Flatten PAM lines
    const pamLines: CanonicalPamLine[] = [];
    input.pam.folios.forEach(folio => {
        folio.items.forEach(item => {
            pamLines.push({ ...item, folioPAM: folio.folioPAM, prestador: folio.prestador || folio.folioPAM });
        });
    });

    const pamRows: PamAuditRow[] = [];

    for (const line of pamLines) {
        // Only analyze "Lineas Criticas" (Copago > 0 OR Bonificacion == 0)
        if (line.valorTotal === 0) continue; // Skip empty lines

        const attempts: TraceAttempt[] = [];

        // --- Phase B: Mapeo Determinista (Cascada) ---
        // 1. Code Match (Ideal but rare across systems)
        // 2. Glosa + Familia Match
        const glosaMatch = tryGlosaMatch(line, billIndex);
        attempts.push(glosaMatch);

        // 3. Monto 1:1 Match (Anchor)
        let matchedBillItems: CanonicalBillItem[] = [];
        const montoMatch = tryMonto1a1Match(line, billIndex);
        attempts.push(montoMatch);

        if (montoMatch.status === 'OK' && billIndex.byTotal.has(line.valorTotal)) {
            matchedBillItems = billIndex.byTotal.get(line.valorTotal)!;
        } else if (glosaMatch.status === 'OK') {
            // Hydrate matched items from glosa check if possible (simplified here)
        }

        const traceStatus = summarizeTrace(attempts);

        // --- Phase C: Validación Contractual ---
        const contractCheck = evaluateContract(line, input.contract, traceStatus);

        // --- Phase D: Motor Forense (M1-M3) ---
        const frag = classifyFragmentation(line, attempts, contractCheck, eventModel, matchedBillItems);

        // --- Phase E: Opacidad (Agotamiento) ---
        const opacidad = evaluateOpacidad(line, cfg, traceStatus, contractCheck.state, matchedBillItems, frag);

        pamRows.push(buildRow(line, attempts, contractCheck, frag, opacidad, matchedBillItems));
    }

    // --- Aggregation ---
    const summary = aggregate(pamRows, cfg);
    const matrix = buildMatrix(pamRows);
    const reportText = buildForensicReport(eventModel, pamRows, summary);
    const complaintText = buildComplaintText(pamRows);

    return {
        summary,
        eventModel,
        matrix,
        pamRows,
        reportText,
        complaintText
    };
}

// ---------- Logic Implementation ----------

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
    const hasPabellon = desc.includes('pabellon') || desc.includes('quirofano');
    const hasDiaCama = desc.includes('dia cama') || desc.includes('habitacion');

    return {
        actoPrincipal: hasPabellon ? 'CIRUGIA_MAYOR' : 'HOSPITALIZACION_GENERAL',
        paquetesDetectados: [
            hasPabellon ? 'DERECHO_PABELLON' : null,
            hasDiaCama ? 'DIA_CAMA_INTEGRAL' : null
        ].filter(Boolean) as string[],
        notes: 'Inferido por palabras clave en glosas'
    };
}

function tryGlosaMatch(line: CanonicalPamLine, index: any): TraceAttempt {
    const norm = normalize(line.descripcion);
    if (index.byDescription.has(norm)) {
        return { step: 'GLOSA_FAMILIA', status: 'OK', details: 'Exact string match' };
    }
    // Simple fuzzy check
    if ([...index.byDescription.keys()].some((k: string) => k.includes(norm) || norm.includes(k))) {
        return { step: 'GLOSA_FAMILIA', status: 'PARTIAL', details: 'Partial string overlap' };
    }
    return { step: 'GLOSA_FAMILIA', status: 'FAIL', details: 'No match' };
}

function tryMonto1a1Match(line: CanonicalPamLine, index: any): TraceAttempt {
    const matches = index.byTotal.get(line.valorTotal);
    if (matches && matches.length === 1) {
        return { step: 'MONTO_1A1', status: 'OK', details: 'Unique amount match' };
    }
    if (matches && matches.length > 1) {
        return { step: 'MONTO_1A1', status: 'PARTIAL', details: 'Duplicate amounts found' };
    }
    return { step: 'MONTO_1A1', status: 'FAIL', details: 'No amount match' };
}

function summarizeTrace(attempts: TraceAttempt[]): TraceStatus {
    if (attempts.some(a => a.status === 'OK')) return 'OK';
    if (attempts.some(a => a.status === 'PARTIAL')) return 'PARTIAL';
    return 'FAIL';
}

function mapGCToDomain(gc: string, description: string = ''): ContractDomain {
    // 1. Code-based mapping (Standard Fonasa/Isapre Group Codes)
    const codeMap: Record<string, ContractDomain> = {
        '3101002': 'MATERIALES_CLINICOS',
        '3101001': 'MEDICAMENTOS_HOSP',
        '3000000': 'HOSPITALIZACION', // Dia Cama usually
        '3201001': 'OTROS', // Insumos generales
        '3201002': 'OTROS',
        '0101001': 'CONSULTA',
        '0300000': 'EXAMENES', // Laboratorio
        '0400000': 'EXAMENES', // Imagenologia
        '0500000': 'KINESIOLOGIA',
        '0600000': 'PROTESIS_ORTESIS', // Or specific codes
        '1100000': 'PABELLON', // Derecho Pabellon
        '1200000': 'PABELLON', // Recargos
        '1300000': 'HONORARIOS' // Atencion profesional
    };

    if (codeMap[gc]) return codeMap[gc];

    // 2. Heuristic-based mapping (Fallback if code is unknown or generic)
    const lower = normalize(description);
    if (lower.includes('dia cama') || lower.includes('habitacion') || lower.includes('residencia')) return 'HOSPITALIZACION';
    if (lower.includes('pabellon') || lower.includes('quirofano') || lower.includes('arsenic') || lower.includes('mesa oper')) return 'PABELLON';
    if (lower.includes('honorario') || lower.includes('medico') || lower.includes('cirujano') || lower.includes('anestesi')) return 'HONORARIOS';
    if (lower.includes('medicamento') || lower.includes('farmaco') || lower.includes('droga')) return 'MEDICAMENTOS_HOSP';
    if (lower.includes('material') || lower.includes('insumo') || lower.includes('dispositivo')) return 'MATERIALES_CLINICOS';
    if (lower.includes('examen') || lower.includes('laboratorio') || lower.includes('perfil') || lower.includes('cultivo')) return 'EXAMENES';
    if (lower.includes('imagen') || lower.includes('rayos') || lower.includes('scanner') || lower.includes('resonancia')) return 'EXAMENES';
    if (lower.includes('kinesi') || lower.includes('fisioterapia')) return 'KINESIOLOGIA';
    if (lower.includes('protesis') || lower.includes('ortesis')) return 'PROTESIS_ORTESIS';
    if (lower.includes('traslado') || lower.includes('ambulancia')) return 'TRASLADOS';

    return 'OTROS';
}

function evaluateContract(line: CanonicalPamLine, contract: CanonicalContract, traceStatus: TraceStatus): any {
    const domain = mapGCToDomain(line.codigoGC, line.descripcion);
    const rule = contract.rules.find(r => r.domain === domain);

    if (!rule) {
        return { state: 'NO_VERIFICABLE_POR_CONTRATO', rulesUsed: [], notes: `Dominio '${domain}' no hallado en contrato` };
    }
    return { state: 'VERIFICABLE', rulesUsed: [rule.id], notes: `Regla aplicada: ${rule.textLiteral}` };
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

    const isGeneric = ["3101002", "3201001", "3201002", "3000000"].includes(line.codigoGC);
    const traceFailed = summarizeTrace(attempts) !== 'OK';

    // M1: Actos Artificiales (Accesorios obligatorios facturados como autónomos)
    if (line.bonificacion === 0 && line.copago > 0 && !isGeneric) {
        const desc = normalize(line.descripcion);
        const forbiddenTerms = ["preparacion", "monitorizacion", "uso de equipo", "derecho", "sala"];
        if (forbiddenTerms.some(t => desc.includes(t))) {
            motor = 'M1';
            level = 'FRAGMENTACION_ESTRUCTURAL';
            rationale = 'Acto accesorio inseparable del principal facturado como autónomo';
            return { level, motor, rationale, economicImpact: line.copago };
        }
    }

    // M2: Desanclaje desde Paquete (Unbundling)
    if (event.paquetesDetectados.length > 0 && line.copago > 0) {
        const desc = normalize(line.descripcion);
        const standardSupplies = ["jeringa", "agujahipodermica", "torula", "guantes", "electrodo", "bajada suero", "branula"];

        if (standardSupplies.some(s => desc.includes(s))) {
            motor = 'M2';
            level = 'FRAGMENTACION_ESTRUCTURAL';
            rationale = `Insumo estándar (${desc}) desagregado de paquete clínico (${event.paquetesDetectados[0]})`;
            return { level, motor, rationale, economicImpact: line.copago };
        }
    }

    // M3: Traslado No Clínico / Residuales (Bolsón)
    if (isGeneric && line.bonificacion === 0 && line.copago > 0 && traceFailed) {
        motor = 'M3';
        level = 'FRAGMENTACION_ESTRUCTURAL';
        rationale = 'Traslado de costos a bolsón genérico sin trazabilidad clínica';
        return { level, motor, rationale, economicImpact: line.copago };
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

    if (line.copago === 0 && line.bonificacion > 0) {
        return { applies: false, iopScore: 0, breakdown: [], agotamiento: false };
    }

    // +25 Agrupador sin desglose sub-ítem
    const isSuspect = cfg.suspectGroupCodes.includes(line.codigoGC);
    const hasSubItem = matchedItems.length > 0;
    if (isSuspect && !hasSubItem) {
        iopScore += 25;
        breakdown.push({ label: 'Agrupador sin desglose', points: 25 });
    }

    // +15 Bonif 0 con Copago Total
    if (line.bonificacion === 0 && line.copago > 0) {
        iopScore += 15;
        breakdown.push({ label: 'Bonificación 0 / Copago Total', points: 15 });
    }

    // +10 Glosa genérica
    if (normalize(line.descripcion).includes("no cubierto") || normalize(line.descripcion).includes("insumos")) {
        iopScore += 10;
        breakdown.push({ label: 'Glosa Genérica', points: 10 });
    }

    // +15 No mapeable tras Fase B
    if (traceStatus === 'FAIL') {
        iopScore += 15;
        breakdown.push({ label: 'Fallo Trazabilidad Fase B', points: 15 });
    }

    // +10 Opacidad impide aplicar contrato
    if (contractState !== 'VERIFICABLE' && isSuspect) {
        iopScore += 10;
        breakdown.push({ label: 'Contrato Inaplicable por Opacidad', points: 10 });
    }

    const applies = iopScore >= cfg.opacidadThresholdIOP;

    return { applies, iopScore, breakdown, agotamiento: true };
}

function buildRow(
    line: CanonicalPamLine,
    attempts: TraceAttempt[],
    contractCheck: any,
    frag: any,
    opacidad: any,
    matchedItems: CanonicalBillItem[]
): PamAuditRow {
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

// ---------- Aggregation ----------

function aggregate(rows: PamAuditRow[], cfg: any) {
    const totalCopagoAnalizado = rows.reduce((s, r) => s + r.montoCopago, 0);
    const totalImpactoFragmentacion = rows.filter(r => r.fragmentacion.level !== 'CORRECTO').reduce((s, r) => s + r.fragmentacion.economicImpact, 0);

    const m1Count = rows.filter(r => r.fragmentacion.motor === 'M1').length;
    const m2Count = rows.filter(r => r.fragmentacion.motor === 'M2').length;
    const m3Copago = rows.filter(r => r.fragmentacion.motor === 'M3').reduce((s, r) => s + r.montoCopago, 0);

    const isSystemic =
        m1Count >= 3 ||
        m2Count >= 5 ||
        (totalCopagoAnalizado > 0 && (m3Copago / totalCopagoAnalizado) >= cfg.minImpactoM3Systemic);

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
            impacto: r.fragmentacion.economicImpact,
            iop: r.opacidad.iopScore
        }));
}

function buildForensicReport(event: any, rows: PamAuditRow[], summary: any): string {
    const findings = rows.filter(r => r.fragmentacion.level !== 'CORRECTO' || r.opacidad.applies);

    return `INFORME FORENSE M10 (Skill v1.3)
--------------------------------------------------
EVENTO DETECTADO: ${event.actoPrincipal}
PAQUETES CLÍNICOS: ${event.paquetesDetectados.join(', ') || 'Ninguno'}

RESUMEN EJECUTIVO:
- Total Copago Analizado: $${summary.totalCopagoAnalizado.toLocaleString()}
- Impacto Fragmentación: $${summary.totalImpactoFragmentacion.toLocaleString()}
- Estado Opacidad: ${summary.opacidadGlobal.applies ? 'CRÍTICO (Bloqueo Financiero)' : 'Trazable'}
- Patrón Sistémico: ${summary.patternSystemic.isSystemic ? 'SI (Mecanismo Repetitivo)' : 'No detectado'}

DETALLE DE HALLAZGOS RELEVANTES:
${findings.map(f => `
> [${f.fragmentacion.motor}] ${f.codigoGC} - ${f.descripcion}
  Impacto: $${f.montoCopago.toLocaleString()}
  Fundamento: ${f.fragmentacion.rationale}
  ${f.opacidad.applies ? `⚠️ OPACIDAD DETECTADA (IOP ${f.opacidad.iopScore}):\n  ` + f.opacidad.breakdown.map((b: any) => `  - ${b.label} (+${b.points})`).join('\n') : ''}
`).join('\n')}

CONCLUSIÓN:
${summary.opacidadGlobal.applies
            ? "La cuenta presenta Opacidad Liquidatoria que impide verificar la corrección financiera según contrato. Se requiere desglose."
            : "La cuenta es auditable. Se detectaron fragmentaciones específicas detalladas arriba."}
`;
}

function buildComplaintText(rows: PamAuditRow[]): string {
    const opacos = rows.filter(r => r.opacidad.applies);
    if (opacos.length === 0) return "No hay hallazgos de opacidad que requieran reclamo estándar.";

    return `SEÑORES ISAPRE / PRESTADOR:

En relación a la liquidación (PAM) analizada, se detectan los siguientes cobros que vulneran el deber de información y trazabilidad (Opacidad Liquidatoria):

${opacos.map(r => `- Ítem ${r.codigoGC} "${r.descripcion}" por $${r.montoCopago} (Bonif: $${r.bonificacion})`).join('\n')}

FUNDAMENTOS:
1. Estos ítems consolidan montos sin desglose de sub-ítem (código interno, glosa específica, valor unitario).
2. Existe imposibilidad de verificar la prestación ancla o la correspondencia contractual (IOP Score crítico).
3. No se acredita que correspondan a prestaciones autónomas y no a insumos absorbidos por el paquete principal.

SOLICITUD:
Se requiere la refacturación con desglose detallado línea a línea o la cobertura inmediata bajo el principio de interpretación pro-afiliado ante cláusulas oscuras.`;
}

function createErrorOutput(msg: string, cfg: any): SkillOutput {
    return {
        summary: { totalCopagoAnalizado: 0, totalImpactoFragmentacion: 0, opacidadGlobal: { applies: false, maxIOP: 0 }, patternSystemic: { m1Count: 0, m2Count: 0, m3CopagoPct: 0, isSystemic: false } },
        eventModel: { notes: msg, paquetesDetectados: [] },
        matrix: [],
        pamRows: [],
        reportText: `ERROR CRÍTICO: ${msg}`,
        complaintText: ''
    };
}
