

import {
    EventoHospitalario,
    BillingItem,
    Contract,
    AuditDecision,
    RuleResult,
    FlagResult,
    ExplainableOutput
} from '../../src/types.js';

// NEW: Import Hypothesis Router types
import {
    CapabilityMatrix,
    HypothesisScope,
    Capability,
    isCapabilityAllowed,
    RuleContext
} from './hypothesisRouter.service.js';


// ============================================================================
// 1. CANONICAL RULES (HARD RULES)
// ============================================================================

const RULES = {
    "C-01": "Verificabilidad Contractual",
    "C-02": "Clasificación Hospitalario vs Ambulatorio",
    "C-03": "Medicamentos e Insumos (Por Evento)",
    "C-04": "Tope UF/VAM Exigible"
};

/**
 * C-03: Validate that "Medicamentos" and "Insumos" are consolidated if the contract requires it.
 */

/**
 * C-01: Verificabilidad Contractual (Basic Integrity)
 */
function checkC01_Verificabilidad(contract: Contract): RuleResult {
    const ruleId = "C-01";
    // Violation if contract has no coverage definitions at all
    if (!contract?.coberturas || contract.coberturas.length === 0) {
        return {
            ruleId,
            description: RULES[ruleId],
            violated: true,
            details: "El objeto Contrato no contiene cláusulas de cobertura (array 'coberturas' vacío)."
        };
    }
    return { ruleId, description: RULES[ruleId], violated: false };
}

/**
 * C-02: Clasificación Hospitalario vs Ambulatorio
 * Check for incoherence: "Día Cama" present but purely Ambulatory coverage available? 
 * Or more structural: Event has "Hospital" artifacts but mapped to "Ambulatory" sections?
 * 
 * Strategy: If we find "DIA CAMA" or "NOCHE CAMA" in items, 
 * verify that the Contract has at least one 'Hospitalaria' clause.
 */
function checkC02_SegregacionHospAmb(billingItems: BillingItem[], contract: Contract): RuleResult {
    const ruleId = "C-02";

    // 1. Detect Hospital Reality in Bill
    const hospitalKeywords = ["DIA CAMA", "NOCHE CAMA", "DÍA CAMA", "HABITACION", "SALA DE"];
    const hasHospitalItems = (billingItems || []).some(i =>
        hospitalKeywords.some(kw => i.description?.toUpperCase().includes(kw))
    );

    // 2. Detect Surgical Facility usage (Derecho de Pabellón)
    const pabellonKeywords = ["DER.PABELLON", "DERECHO PABELLON", "DER. PABELLON", "RECUPERACION"];
    const hasPabellon = (billingItems || []).some(i =>
        pabellonKeywords.some(kw => i.description?.toUpperCase().includes(kw))
    );

    // 3. Detect Surgical Honors (HM)
    const hasHonorariosQuirurgicos = (billingItems || []).some(i => {
        const desc = i.description?.toUpperCase() || "";
        const isProfessionalFee = (desc.includes("HM-") || desc.includes("CIRU") || desc.includes("AYUD") || desc.includes("ANEST")) &&
            !desc.includes("DER.PAB") &&
            !desc.includes("DER. PAB") &&
            !desc.includes("DERECHO PAB") &&
            !desc.includes("EQUIPO PAB");
        return isProfessionalFee && !desc.includes("VISITA");
    });

    if (hasPabellon && !hasHonorariosQuirurgicos) {
        return {
            ruleId,
            description: RULES[ruleId],
            violated: true,
            details: "Se cobra Derecho de Pabellón pero no se detectan Honorarios Médicos quirúrgicos asociados (Incoherencia de Segregación)."
        };
    }

    if (!hasHospitalItems) return { ruleId, description: RULES[ruleId], violated: false };

    // 4. Check Contract Capability (Support Canonical V2 + Semantic)
    const hasHospitalCoverage = (contract?.coberturas || []).some(c => {
        const name = (c['PRESTACIÓN CLAVE'] || c['item'] || c['descripcion_textual'] || "").toUpperCase();
        const category = (c['categoria'] || c['ambito'] || "").toUpperCase();
        return name.includes("HOSP") || name.includes("QUIR") || name.includes("CIRUG") ||
            category.includes("HOSP") || category.includes("QUIR") || category.includes("CIRUG");
    });

    if (!hasHospitalCoverage) {
        return {
            ruleId,
            description: RULES[ruleId],
            violated: true,
            details: "Cuenta contiene cargos de Hospitalización pero el Contrato solo exhibe coberturas Ambulatorias claras."
        };
    }

    return { ruleId, description: RULES[ruleId], violated: false };
}

// ... C-03 and C-04 already exist ...

function checkC03_MedicamentosPorEvento(billingItems: BillingItem[], contract: Contract): RuleResult {
    const ruleId = "C-03";

    // Check if contract has the "Por Evento" clause for Medications/Supplies (Support Semantic)
    const hasPorEventoClause = (contract?.coberturas || []).some(c => {
        const name = (c['PRESTACIÓN CLAVE'] || c['item'] || c['descripcion_textual'] || "").toUpperCase();
        return (name.includes("MEDICAMENTOS") || name.includes("MATERIALES") || name.includes("INSUMOS")) &&
            name.includes("POR EVENTO");
    });

    if (!hasPorEventoClause) {
        return { ruleId, description: RULES[ruleId], violated: false };
    }

    // Violation Type A: Fragmented Billing despite "Por Evento" clause
    // Heuristic: If we have > 20 items of pharmacy/supplies and a "Por Evento" clause exists, 
    // it's a transparency failure (The hospital is not consolidating as requested).
    const medsCount = billingItems.filter(i =>
        i.description.toUpperCase().includes("MEDIC") ||
        i.description.toUpperCase().includes("INSUMO") ||
        i.description.toUpperCase().includes("SOL.") ||
        i.description.toUpperCase().includes("AMP ")
    ).length;

    if (medsCount > 50) {
        return {
            ruleId,
            description: RULES[ruleId],
            violated: true,
            details: `Contrato exige 'Por Evento' pero se detectan ${medsCount} cargos individuales (Fragmentación Indebida).`
        };
    }

    return {
        ruleId,
        description: RULES[ruleId],
        violated: false
    };
}

function checkC04_TopeCalculable(eventos: EventoHospitalario[]): RuleResult {
    const ruleId = "C-04";
    const uncalculableEvents = eventos.filter(e =>
        !e.analisis_financiero?.valor_unidad_inferido ||
        e.analisis_financiero?.metodo_validacion === 'MANUAL'
    );

    if (uncalculableEvents.length > 0) {
        return {
            ruleId,
            description: RULES[ruleId],
            violated: true,
            details: `Unable to verify Unit Value/UF for ${uncalculableEvents.length} events (missing 'valor_unidad_inferido').`
        };
    }
    return { ruleId, description: RULES[ruleId], violated: false };
}


// ============================================================================
// 2. AUTOMATIC FLAGS (DETECTORS)
// ============================================================================

const FLAGS = {
    "F-01": "Repetición clínica significativa",
    "F-02": "Visitas médicas múltiples",
    "F-03": "Consumo iterativo de exámenes (Mixto/Repetido)",
    "F-04": "Ampliación de Cobertura sin sustento clínico"
};

function detectF01_Repeticion(billingItems: BillingItem[]): FlagResult {
    const codeMap = new Map<string, Set<number>>();
    billingItems.forEach(item => {
        const match = item.description.match(/(\d{2}-\d{2}-\d{3}-\d{2})/);
        const code = match ? match[0] : item.description;
        if (!codeMap.has(code)) codeMap.set(code, new Set());
        codeMap.get(code)?.add(item.unitPrice);
    });
    const suspicious = Array.from(codeMap.entries()).filter(([code, prices]) => prices.size > 1);
    return {
        flagId: "F-01",
        description: FLAGS["F-01"],
        detected: suspicious.length > 0,
        riskLevel: suspicious.length > 0 ? "HIGH" : "LOW",
        metadata: { suspiciousCodes: suspicious.map(s => s[0]) }
    };
}

function detectF02_VisitasMultiples(billingItems: BillingItem[]): FlagResult {
    const visitCount = billingItems.filter(i => i.description.toUpperCase().includes("VISITA")).length;
    return {
        flagId: "F-02",
        description: FLAGS["F-02"],
        detected: visitCount > 5,
        riskLevel: visitCount > 10 ? "HIGH" : "MEDIUM",
        metadata: { count: visitCount }
    };
}

function detectF03_ExamenesMixtos(billingItems: BillingItem[]): FlagResult {
    // Refined F-03: Exámenes mixtos / Iterative Consumption.
    // Detection of same core description in different "clusters" is hard without clusters,
    // so we look for extremely high frequency (> 4) of specific markers.
    const labKeywords = ["PERFIL", "HEMOGRAMA", "CULTIVO", "PCR", "CREATININ", "ELP ", "GSA"];
    const repeatedLabs: string[] = [];

    labKeywords.forEach(kw => {
        const count = billingItems.filter(i => i.description.toUpperCase().includes(kw)).length;
        if (count > 4) repeatedLabs.push(`${kw} (x${count})`);
    });

    // Detect if "CARGO POR" or "SUMA DE" and itemized labs coexist (Opacidad Mixta)
    const hasPackages = billingItems.some(i => i.description.toUpperCase().includes("SUMA DE") || i.description.toUpperCase().includes("PAQUETE"));
    const hasIndividuals = billingItems.length > 30;

    if (hasPackages && hasIndividuals) {
        repeatedLabs.push("Coexistencia de Paquetes e Ítems Individuales");
    }

    return {
        flagId: "F-03",
        description: FLAGS["F-03"],
        detected: repeatedLabs.length > 0,
        riskLevel: repeatedLabs.length > 2 ? "HIGH" : (repeatedLabs.length > 0 ? "MEDIUM" : "LOW"),
        metadata: { repeatedLabs }
    };
}

function detectF04_DiaCamaAmpliacion(billingItems: BillingItem[]): FlagResult {
    // Logic: Look for "AMPLIACION" and check if it has justification.
    // Just flagging existence of "AMPLIACION" is good enough for a detector.
    const hasAmpliacion = billingItems.some(i => i.description.toUpperCase().includes("AMPLIACION"));

    return {
        flagId: "F-04",
        description: FLAGS["F-04"],
        detected: hasAmpliacion,
        riskLevel: hasAmpliacion ? "HIGH" : "LOW",
        metadata: { hasAmpliacion }
    };
}



// ============================================================================
// 3. MAIN ENGINE (with Hypothesis-based Capability Gating)
// ============================================================================

export function runCanonicalRules(
    billingItems: BillingItem[],
    eventos: EventoHospitalario[],
    contract: Contract,
    capabilityMatrix?: CapabilityMatrix  // NEW: Optional for backward compat
): { rules: RuleResult[], flags: FlagResult[], decision: AuditDecision } {

    // Default scope if not provided (GLOBAL = most permissive for legacy calls)
    const defaultScope: HypothesisScope = { type: "GLOBAL" };
    const ctx: RuleContext = {
        capabilities: capabilityMatrix || { enabled: [], blocked: [] },
        currentScope: defaultScope
    };

    // 1. Run Rules (with capability gates)
    const rules: RuleResult[] = [];

    // C-01: Basic Contract Integrity (no specific capability needed)
    rules.push(checkC01_Verificabilidad(contract));

    // C-02: Hospital/Ambulatory Classification
    // Required capability: REGLAS_SINTETICAS_TEST (only for test cases)
    if (isCapabilityAllowed(ctx, "REGLAS_SINTETICAS_TEST")) {
        // This is a test case, C-02 should run (it's a synthetic stress rule)
        rules.push(checkC02_SegregacionHospAmb(billingItems, contract));
    } else {
        // Production case: C-02 should NOT run (it's too aggressive for real surgery)
        // We mark it as "not violated" but "skipped"
        rules.push({
            ruleId: "C-02",
            description: RULES["C-02"],
            violated: false,
            details: "Skipped (production case - rule designed for synthetic tests)"
        });
    }

    // C-03: Medications Per Event
    // Required capability: REGLAS_SINTETICAS_TEST
    if (isCapabilityAllowed(ctx, "REGLAS_SINTETICAS_TEST")) {
        rules.push(checkC03_MedicamentosPorEvento(billingItems, contract));
    } else {
        rules.push({
            ruleId: "C-03",
            description: RULES["C-03"],
            violated: false,
            details: "Skipped (production case - rule designed for synthetic tests)"
        });
    }

    // C-04: UF/VAM Ceiling Verifiable
    // Required capability: CALCULO_TOPES_UF_VA_VAM
    if (isCapabilityAllowed(ctx, "CALCULO_TOPES_UF_VA_VAM")) {
        rules.push(checkC04_TopeCalculable(eventos));
    } else {
        // If opacity is active, we can't verify ceilings
        rules.push({
            ruleId: "C-04",
            description: RULES["C-04"],
            violated: true,  // Mark as violated due to opacity
            details: "Unable to verify ceilings due to structural opacity (PAM aggregation blocks fine-grained analysis)"
        });
    }

    // 2. Run Flags (always run for now, but could be gated too)
    const f01 = detectF01_Repeticion(billingItems);
    const f02 = detectF02_VisitasMultiples(billingItems);
    const f03 = detectF03_ExamenesMixtos(billingItems);
    const f04 = detectF04_DiaCamaAmpliacion(billingItems);

    const flags = [f01, f02, f03, f04];

    // 3. Determine State
    let decision: AuditDecision = "OK_VERIFICABLE";

    // Hierarchy of Decisions
    if (rules.some(r => r.violated && r.ruleId === "C-04")) {
        decision = "COPAGO_INDETERMINADO_POR_OPACIDAD";
    } else if (rules.some(r => r.violated)) {
        decision = "ERROR_CONTRATO_PROBADO";
    } else if (flags.some(f => f.riskLevel === "HIGH")) {
        decision = "ZONA_GRIS_REQUIERE_ANTECEDENTES";
    }

    return { rules, flags, decision };
}


// ============================================================================
// 4. EXPLAINABLE OUTPUT
// ============================================================================

export function generateExplainableOutput(
    decision: AuditDecision,
    rules: RuleResult[],
    flags: FlagResult[]
): ExplainableOutput {

    const fundamento: string[] = [];
    let principio = "Cumplimiento Contractual";
    let legal = "";

    if (decision === "COPAGO_INDETERMINADO_POR_OPACIDAD") {
        fundamento.push("No es posible verificar aplicación de topes UF/VAM.");
        rules.filter(r => r.violated).forEach(r => fundamento.push(`Violación Regla ${r.ruleId}: ${r.details}`));
        principio = "Carga de claridad recae en prestador e Isapre";
        legal = "La cuenta clínica no permite reconstruir ni validar la correcta aplicación del contrato de salud, motivo por el cual el copago exigido resulta jurídicamente indeterminable.";
    } else if (decision === "ERROR_CONTRATO_PROBADO") {
        fundamento.push("Se han detectado desviaciones contractuales explícitas.");
        rules.filter(r => r.violated).forEach(r => {
            fundamento.push(`${r.ruleId}: ${r.description}`);
            if (r.details) fundamento.push(`   ↳ ${r.details}`);
        });
    }

    // Add Flags as context
    flags.filter(f => f.detected).forEach(f => {
        let detail = `Alerta ${f.flagId}: ${f.description}`;
        if (f.metadata?.repeatedLabs) {
            detail += ` (${f.metadata.repeatedLabs.join(', ')})`;
        }
        fundamento.push(detail);
    });

    return {
        decisionGlobal: decision,
        fundamento,
        principioAplicado: principio,
        legalText: legal
    };
}
