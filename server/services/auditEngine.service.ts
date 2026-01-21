import { CANONICAL_MANDATE_TEXT } from '../data/canonical_contract_mandate';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import { AUDIT_PROMPT, FORENSIC_AUDIT_SCHEMA } from '../config/audit.prompts.js';
import { AI_MODELS, GENERATION_CONFIG } from '../config/ai.config.js';
import {
    extractCaseKeywords,
    getRelevantKnowledge,
    loadHoteleriaRules,
    getKnowledgeFilterInfo
} from './knowledgeFilter.service.js';
import { preProcessEventos } from './eventProcessor.service.js';
import { runCanonicalRules, generateExplainableOutput } from './canonicalRulesEngine.service.js';
// NEW: Import Hypothesis Router (V5 Architecture)
import { HypothesisRouterService, HypothesisRouterInput } from './hypothesisRouter.service.js';
// NEW: Import Balance Calculator (V5 Hypothesis-Aware)
import { computeBalanceWithHypotheses, PAMLineInput } from './balanceCalculator.service.js';
import { AlphaFoldService } from './alphaFold.service.js';
// NEW: Contract Reconstructibility Service (CRC)
import { ContractReconstructibilityService } from './contractReconstructibility.service.js';
import { Balance, AuditResult, Finding, BalanceAlpha, PamState, Signal, HypothesisScore, ConstraintsViolation } from '../../types.js';
// NEW: Import Jurisprudence Layer (Precedent-First Decision System)
import { JurisprudenceStore, JurisprudenceEngine, extractFeatureSet, learnFromAudit } from './jurisprudence/index.js';
// NEW: Import C-NC Rules (Opacity Non-Collapse)
import { generateNonCollapseText, RULE_C_NC_01, RULE_C_NC_02, RULE_C_NC_03, CANONICAL_NON_COLLAPSE_TEXT } from './jurisprudence/jurisprudence.doctrine.js';

// ============================================================================
// TYPES: Deterministic Classification Model
// ============================================================================
export type HallazgoCategoria = "A" | "B" | "Z"; // A=confirmado, B=controversia, Z=indeterminado
export type MatchQuality = "EXACT" | "PARTIAL" | "NONE";
export type Basis = "UNBUNDLING" | "OPACIDAD" | "SUB_BONIF" | "OTRO";

export interface HallazgoInternal {
    id?: string;
    titulo: string;
    glosa?: string;
    hallazgo: string;
    montoObjetado: number;
    categoria?: string; // Legacy field
    categoria_final?: HallazgoCategoria; // New frozen status
    match_quality?: MatchQuality;
    basis?: Basis;
    recomendacion_accion?: string;
    nivel_confianza?: string;
    tipo_monto?: "COBRO_IMPROCEDENTE" | "COPAGO_OPACO";
    anclajeJson?: string;
    normaFundamento?: string;
    estado_juridico?: string;
    [key: string]: any;
}

// ============================================================================
// UTILITY: Canonical Amount Parser (CLP - Chilean Peso)
// ============================================================================
function parseAmountCLP(val: any): number {
    if (val == null) return 0;
    if (typeof val === "number") return Math.round(val);
    if (typeof val === "string") {
        const n = parseInt(val.replace(/[^0-9-]/g, ""), 10);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

// ============================================================================
// UTILITY: Deterministic Finding Classifier (CAT A vs CAT B)
// ============================================================================
function classifyFinding(h: any): "A" | "B" {
    const gl = (h.glosa || "").toUpperCase();
    const text = (h.hallazgo || "").toUpperCase();
    const glUpper = gl; // Already upper
    const textUpper = text; // Already upper

    // 1. Layer: NATURALEZA CLINICA / NORMATIVA (Eventos Unicos, Unbundling, Doble Cobro) -> Cat A (= RULE_OPACIDAD_NO_COLAPSA)
    const isUnbundling = /UNBUNDLING|EVENTO|FRAGMENTA|DUPLICI|DOBLE COBRO/.test(textUpper) || /UNBUNDLING|EVENTO/.test(glUpper);
    const isHoteleria = /ALIMENTA|NUTRICI|HOTEL|CAMA|PENSION/.test(glUpper) || /IF-319/.test(textUpper);

    // FIX 4: DIRECT CONTRACT BREACH (MEDICAMENTOS $0)
    // If it is Medicamento/Insumo and says "Sin Bonificacion" or "Cobertura 0" -> Cat A (Breach of 100% Coverage)
    const isMedInsumo = /MEDICAMENTO|INSUMO|MATERIAL|FARMACO/.test(glUpper);
    const isZeroCoverage = /SIN BONIFI|COBERTURA 0|BONIFICACION \$0|NO CUBIERTO/.test(textUpper) || /SIN BONIFI/.test(glUpper);

    if (isUnbundling) return "A"; // Priority 1: Unbundling is always Improcedente
    if (isHoteleria && /DUPLICI|DOBLE|INCLU/.test(textUpper)) return "A"; // Hoteleria duplicated is A
    if (isMedInsumo && isZeroCoverage) return "A"; // Priority 1.5: Breach of Contract (100% Clause)

    // FIX 5: NURSING & SURGICAL DRUGS (IRREGULAR PRACTICES REPORT)
    const isNursing = /SIGNOS VITALES|CURACION|INSTALACION VIA|FLEBOCLISIS|ENFERMERIA|TOMA DE MUESTRA/.test(textUpper) || /ENFERMERIA/.test(glUpper);
    const isSurgicalDrug = /PROPOFOL|FENTANILO|SEVOFLURANO|MIDAZOLAM|ANESTESIA/.test(textUpper);

    if (isNursing) return "A"; // Practice #5: Should be included in Bed Day
    if (isSurgicalDrug && /PABELLON|QUIROFANO/.test(textUpper)) return "A"; // Practice #3: Surgical drugs in Pharmacy

    // 2. Layer: CUENTA OPACA (Improcedente por falta de soporte minimo)
    const isCuentaOpaca = /VARIOS|AJUSTE|DIFERENCIA/.test(glUpper) || /VARIOS|AJUSTE/.test(textUpper) || /SIN BONIFI/.test(textUpper) || /SIN BONIFI/.test(glUpper);
    if (isCuentaOpaca) return "A"; // Also A

    // 3. Layer: PAM OPACO (Conditioned Findings) -> Cat B/Z
    // If it requires breakdown to be validated, it is B.
    const isPamCajaNegra = /MATERIALES|MEDICAMENTOS|INSUMO|FARMAC/.test(glUpper) && /DESGLOSE|OPACIDAD|CAJA/.test(textUpper);
    if (isPamCajaNegra) return "B";

    // Default: Conservative (treat as CAT B if unclear - Safety First)
    return "B";
}

// Helper for deterministic ID generation
function stableId(parts: string[]): string {
    const s = parts.join("|");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "F_" + h.toString(16);
}

export async function performForensicAudit(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any,
    apiKey: string,
    log: (msg: string) => void,
    htmlContext: string = '',
    onUsageUpdate?: (usage: any) => void,
    onProgressUpdate?: (progress: number) => void
) {
    // AUDIT-SPECIFIC: Reasoner First (Pro), then Flash 3, then Fallback (2.5)
    const modelsToTry = [AI_MODELS.reasoner, AI_MODELS.primary, AI_MODELS.fallback];
    let result;
    let lastError;
    let accumulatedTokens = 0;
    const ESTIMATED_TOTAL_TOKENS = 4000; // Estimate for progress bar

    // =========================================================================
    // MINI-RAG: BIBLIOTECARIO INTELIGENTE
    // Carga dinÃ¡mica de conocimiento legal relevante para este caso especÃ­fico
    // =========================================================================
    log('[AuditEngine] ðŸ“š Activando Bibliotecario Inteligente (Mini-RAG)...');
    onProgressUpdate?.(10);
    log(`[AuditEngine] â„¹ï¸ ${getKnowledgeFilterInfo()} `);

    // Paso 1: Extraer keywords del caso (cuenta, PAM, contrato)
    const caseKeywords = extractCaseKeywords(cuentaJson, pamJson, contratoJson, htmlContext);
    log(`[AuditEngine] ðŸ”‘ Keywords extraÃ­das: ${caseKeywords.length} tÃ©rminos`);
    log(`[AuditEngine] ðŸ”‘ Muestra: ${caseKeywords.slice(0, 8).join(', ')}...`);

    // Paso 2: Filtrar y cargar solo conocimiento relevante (mÃ¡x 30K tokens)
    /*
    const MAX_KNOWLEDGE_TOKENS = 40000;  // Reduced to 40k for better prompt stability
    const { text: knowledgeBaseText, sources, tokenEstimate, keywordsMatched } =
        await getRelevantKnowledge(caseKeywords, MAX_KNOWLEDGE_TOKENS, log);
    */

    // DISABLE MINI-RAG PER USER REQUEST
    let knowledgeBaseText = "(Base de conocimiento legal omitida en esta iteración para optimización de rendimiento).";
    if (CANONICAL_MANDATE_TEXT) {
        knowledgeBaseText += `\n\n[CONTRATO MARCO / MANDATO CLÍNICO ESTÁNDAR (PAGARÉ / MANDATO)]:\n${CANONICAL_MANDATE_TEXT}\n`;
    }

    // INJECT IRREGULAR PRACTICES REPORT KNOWLEDGE
    const IRREGULAR_PRACTICES_KNOWLEDGE = `
[INFORME OFICIAL: PRÁCTICAS IRREGULARES PROHIBIDAS]
Analiza la cuenta buscando estas 10 prácticas específicas. Si encuentras una, CLASIFICA COMO 'A' (IMPROCEDENTE).
1. Inflamiento de Medicamentos: Cobro por caja completa en vez de dosis unitaria (Upcoding).
2. Desagregación de Pabellón (Unbundling): Cobro separado de insumos básicos (gasas, suturas, jeringas) que deben estar en 'Derecho de Pabellón'.
3. Fármacos de Pabellón en Farmacia: Anestesia/Analgesia intraoperatoria (Propofol, Fentanilo) cobrada aparte en 'Farmacia' en vez de Pabellón.
4. Hotelería No Clínica: Cobro de 'Confort', 'Kit de Aseo', 'Pantuflas', 'Ropa' sin consentimiento explícito. No es prestación médica.
5. Enfermería Básica en Día Cama: Cobro separado de 'Control Signos Vitales', 'Curación Simple', 'Instalación Vía', 'Fleboclisis'. ESTO ESTÁ INCLUIDO EN EL DÍA CAMA. Es Doble Cobro.
6. Glosas Genéricas (3201001/2): Montos abultados en 'Gastos No Cubiertos' o 'Insumos Varios' sin desglose. Es Opacidad, pero si oculta insumos básicos, es Indebido.
7. Incumplimiento Cobertura 100%: Cobro de copago en prestaciones que el plan cubre al 100% (ej. Medicamentos Hospitalarios) sin justificar tope.
8. Upcoding/Reconversión: Cobrar un insumo estándar como 'Especial/Importado' o un procedimiento menor como cirugía compleja.
9. Separación Urgencia/Hospitalización: Cobrar Urgencia como evento aparte con su propio tope, cuando derivó en hospitalización (debe ser Evento Único).
10. Falta de Respaldo: Cobros que no coinciden con ficha clínica o hoja de consumo.
`;
    knowledgeBaseText += IRREGULAR_PRACTICES_KNOWLEDGE;

    const sources: string[] = ["Informe Prácticas Irregulares", "Mini-RAG Desactivado"];
    const tokenEstimate = 0;

    log(`[AuditEngine] ðŸ“Š Conocimiento inyectado: 0 fuentes (Mini-RAG OFF)`);
    // log(`[AuditEngine] ðŸ“š Fuentes: ${sources.join(' | ')} `);
    onProgressUpdate?.(20);

    // Paso 3: Cargar reglas de hotelerÃ­a (siempre, es pequeÃ±o)
    const hoteleriaRules = await loadHoteleriaRules();
    if (hoteleriaRules) {
        log('[AuditEngine] ðŸ¨ Cargadas reglas de hotelerÃ­a (IF-319)');
    }

    // ============================================================================
    // CRC: CONTRACT RECONSTRUCTIBILITY CLASSIFIER (NEW)
    // ============================================================================
    const reconstructibility = ContractReconstructibilityService.assess(contratoJson, cuentaJson);
    log(`[AuditEngine] ðŸ§© CRC Analysis: Reconstructible=${reconstructibility.isReconstructible} (Conf: ${(reconstructibility.confidence * 100).toFixed(0)}%)`);
    reconstructibility.reasoning.forEach(r => log(`[AuditEngine]    - ${r}`));

    log('[AuditEngine] ðŸ§  Sincronizando datos y analizando hallazgos con Super-Contexto...');
    onProgressUpdate?.(30);

    // ============================================================================
    // TOKEN OPTIMIZATION: Reduce input costs by 30-40%
    // ============================================================================

    // 1. Clean Cuenta JSON - Remove non-essential fields (Handle empty cuenta)
    const hasStructuredCuenta = cuentaJson && Object.keys(cuentaJson).length > 0 && (cuentaJson.sections || cuentaJson.items);

    const cleanedCuenta = hasStructuredCuenta ? {
        ...cuentaJson,
        sections: cuentaJson.sections?.map((section: any) => ({
            category: section.category || section.name,
            sectionTotal: section.sectionTotal,
            items: section.items?.map((item: any) => ({
                code: item.code,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                // NEW: Expose Billing Model to LLM
                model: item.billingModel,
                authTotal: item.authoritativeTotal,
                calcError: item.hasCalculationError
            }))
        }))
    } : { ...cuentaJson, info: "No structured bill provided. Use HTML context if available." };

    // 2. Clean PAM JSON - Preserve the structure but minimize items
    const cleanedPam = {
        ...pamJson, // This preserves resumenTotal, patient info, etc.
        folios: pamJson.folios?.map((folio: any) => ({
            ...folio,
            desglosePorPrestador: folio.desglosePorPrestador?.map((prestador: any) => ({
                ...prestador,
                items: prestador.items
                    ?.filter((item: any) => item.bonificacion > 0 || item.copago > 0)
                    ?.map((item: any) => ({
                        codigo: item.codigo,
                        descripcion: item.descripcion,
                        bonificacion: item.bonificacion,
                        copago: item.copago
                    }))
            }))
        }))
    };

    // 3. Clean Contrato JSON - Keep only essential coverage data
    const cleanedContrato = {
        coberturas: contratoJson.coberturas?.map((cob: any) => ({
            categoria: cob.categoria,
            item: cob.item,
            modalidad: cob.modalidad,
            cobertura: cob.cobertura,
            tope: cob.tope,
            nota_restriccion: cob.nota_restriccion,
            CODIGO_DISPARADOR_FONASA: cob.CODIGO_DISPARADOR_FONASA
            // Removed: LOGICA_DE_CALCULO, NIVEL_PRIORIDAD, copago, categoria_canonica
        })),
        reglas: contratoJson.reglas?.map((regla: any) => ({
            'CÃ“DIGO/SECCIÃ“N': regla['CÃ“DIGO/SECCIÃ“N'],
            'VALOR EXTRACTO LITERAL DETALLADO': regla['VALOR EXTRACTO LITERAL DETALLADO'],
            'SUBCATEGORÃA': regla['SUBCATEGORÃA']
            // Removed: PÃGINA ORIGEN, LOGICA_DE_CALCULO, categoria_canonica
        }))
    };

    //  4. Minify JSONs (remove whitespace) - saves ~20% tokens
    let finalCuentaContext = JSON.stringify(cleanedCuenta);
    let finalPamContext = JSON.stringify(cleanedPam);
    let finalContratoContext = JSON.stringify(cleanedContrato);

    // ============================================================================
    // EVENT PRE-PROCESSING (DETERMINISTIC LAYER - V3 ARCHITECTURE)
    // ============================================================================
    log('[AuditEngine] ðŸ¥ Pre-procesando Eventos Hospitalarios (Arquitectura V3)...');
    onProgressUpdate?.(35);

    const eventosHospitalarios = preProcessEventos(pamJson, contratoJson);

    // --- LOG V.A DEDUCTION EVIDENCE ---
    let vaDeductionSummary = "âš ï¸ No se pudo deducir el V.A/VAM automÃ¡ticamente por falta de Ã­tems ancla conocidos.";
    if (eventosHospitalarios.length > 0 && eventosHospitalarios[0].analisis_financiero) {
        const fin = eventosHospitalarios[0].analisis_financiero;
        if (fin.valor_unidad_inferido) {
            vaDeductionSummary = `ðŸ’Ž DEDUCCIÃ“N V.A / VAM: $${fin.valor_unidad_inferido?.toLocaleString('es-CL')} | EVIDENCIA: ${fin.glosa_tope} `;
            log(`[AuditEngine] ${vaDeductionSummary} `);
        }
    }
    log(`[AuditEngine] ðŸ“‹ Eventos detectados: ${eventosHospitalarios.length} `);

    // --- INTEGRITY CHECK (FAIL FAST - NO MONEY NO HONEY) ---
    // If PAM has money but Events show $0, abort to prevent hallucinations.
    const pamTotalCopago = pamJson?.global?.totalCopagoDeclarado || pamJson?.resumenTotal?.totalCopago || 0;
    const numericPamCopago = typeof pamTotalCopago === 'string' ? parseInt(pamTotalCopago.replace(/[^0-9]/g, '')) : pamTotalCopago;

    // Sum from events (using the newly added total_copago field)
    const eventsTotalCopago = eventosHospitalarios.reduce((sum, e) => sum + (e.total_copago || 0), 0);

    // Allow small tolerance? Or strict? User said "FAIL FAST".
    // If PAM > 0 and Events == 0 -> CRITICAL ERROR.
    // Fix 3.1: More Robust Fail Fast
    // Only fail if PAM *really* has copays (checked deep) AND events are empty/zero.
    const hasPamItemsWithCopay = (cleanedPam.folios || []).some((f: any) =>
        (f.desglosePorPrestador || []).some((p: any) => (p.items || []).some((i: any) => (i.copago || 0) > 0))
    ) || (cleanedPam.items || []).some((i: any) => (i.copago || 0) > 0);

    if (numericPamCopago > 0 && eventsTotalCopago === 0 && eventosHospitalarios.length > 0 && hasPamItemsWithCopay) {
        throw new Error(`[DATA_INTEGRITY_FAIL] El PAM declara copago ($${numericPamCopago}) y tiene Ã­tems, pero los eventos sumaron $0. ` +
            `Revisar parsing de montos en eventProcessor. Abortando audit.`);
    }

    eventosHospitalarios.forEach((evento, idx) => {
        log(`[AuditEngine]   ${idx + 1}.Tipo: ${evento.tipo_evento}, Prestador: ${evento.prestador}, Copago: $${evento.total_copago?.toLocaleString('es-CL') || 0} `);
        if (evento.honorarios_consolidados && evento.honorarios_consolidados.length > 0) {
            const validFractions = evento.honorarios_consolidados.filter(h => h.es_fraccionamiento_valido);
            if (validFractions.length > 0) {
                log(`[AuditEngine]      â””â”€ Fraccionamientos vÃ¡lidos detectados: ${validFractions.length} (NO son duplicidad)`);
            }
        }
    });

    const eventosContext = JSON.stringify(eventosHospitalarios);
    log(`[AuditEngine] âœ… Eventos serializados(~${(eventosContext.length / 1024).toFixed(2)} KB)`);

    // CONDITIONAL HTML: Only use HTML if structured JSON is incomplete
    const hasStructuredPam = cleanedPam && Object.keys(cleanedPam).length > 2;
    const useHtmlContext = !hasStructuredCuenta || !hasStructuredPam; // Fix 7: Prevent auto-trigger if JSON is structured

    if (useHtmlContext && htmlContext) {
        log('[AuditEngine] ðŸ’Ž Usando HTML Context (JSON incompleto o MÃ³dulo 8 detectado).');
    } else if (!useHtmlContext) {
        log('[AuditEngine] âš¡ HTML Context omitido (JSON estructurado completo, ahorro ~40k tokens).');
    }

    // ============================================================================
    // TRACEABILITY CHECK (DETERMINISTIC LAYER - V3)
    // ============================================================================
    const traceAnalysis = traceGenericChargesTopK(cleanedCuenta, cleanedPam);
    log('[AuditEngine] ðŸ” Trazabilidad de Ajustes:');
    traceAnalysis.split('\n').forEach(line => log(`[AuditEngine]   ${line} `));

    // ============================================================================
    // HYPOTHESIS ROUTER (V5 ARCHITECTURE - Pattern Detection)
    // ============================================================================
    log('[AuditEngine] ðŸ”¬ Activating Hypothesis Router (V5 - Pattern-Based Detection)...');
    onProgressUpdate?.(37);

    const router = new HypothesisRouterService();

    // Build router input from available data
    const routerInput: HypothesisRouterInput = {
        cuentaSections: cleanedCuenta.sections?.map((s: any, idx: number) => ({
            sectionId: `${idx}_${s.category}`,
            items: (s.items || []).map((item: any, itemIdx: number) => ({
                id: `${idx}_${itemIdx}`,
                desc: item.description || '',
                amount: item.total || 0,
                category: s.category
            }))
        })) || [],
        pam: {
            lines: cleanedPam.folios?.flatMap((folio: any) =>
                folio.desglosePorPrestador?.flatMap((prest: any) =>
                    (prest.items || []).map((item: any) => ({
                        key: item.codigo || 'UNKNOWN',
                        desc: item.descripcion || '',
                        amount: parseAmountCLP(item.copago), // Fix 6: Parse CLP
                        isGeneric: /material|insumo|medicamento|varios|sin bonific/i.test(item.descripcion || '')
                    }))
                ) || []
            ) || []
        },
        contract: {
            parsed: contratoJson
        },
        metadata: {
            patientName: cuentaJson.patientName || pamJson.patient || '',
            auditId: `audit_${Date.now()}`
            // test_case: false (auto-detected by router from patientName)
        }
    };

    const hypothesisResult = router.detect(routerInput);
    log(`[AuditEngine] ðŸ“Š Hypotheses Detected: ${hypothesisResult.hypotheses.length}`);
    hypothesisResult.hypotheses.forEach(h => {
        log(`[AuditEngine]   - ${h.id}: ${h.label} (confidence: ${(h.confidence * 100).toFixed(0)}%, scope: ${h.scope.type})`);
        log(`[AuditEngine]     Rationale: ${h.rationale}`);
    });

    // ============================================================================
    // JURISPRUDENCE ENGINE (Precedent-First Decision System)
    // ============================================================================
    log('[AuditEngine] ⚖️ Activating Jurisprudence Engine (Precedent → Doctrine → Heuristic)...');
    const jurisprudenceStore = new JurisprudenceStore();
    const jurisprudenceEngine = new JurisprudenceEngine(jurisprudenceStore);

    const jurisprudenceStats = jurisprudenceEngine.getStats();
    log(`[AuditEngine] 📚 Jurisprudence loaded: ${jurisprudenceStats.precedentCount} precedents, ${jurisprudenceStats.doctrineRuleCount} doctrine rules`);

    // ============================================================================
    // STEP 1: Extract ALL PAM lines with proper identification
    // ============================================================================
    interface PAMLineExtracted {
        uniqueId: string;        // Unique identifier for this line
        codigo: string;          // GC code or similar
        descripcion: string;     // Description/glosa
        bonificacion: number;    // Bonificación amount
        copago: number;          // Copago amount
        folioIdx: number;        // Position in folios
        prestadorIdx: number;    // Position in prestador
        itemIdx: number;         // Position in items
        isGeneric: boolean;      // Is this a generic/opaque line?
    }

    const extractedPamLines: PAMLineExtracted[] = [];

    // Deep extraction from cleanedPam with full context
    if (cleanedPam?.folios && Array.isArray(cleanedPam.folios)) {
        cleanedPam.folios.forEach((folio: any, folioIdx: number) => {
            const desglose = folio.desglosePorPrestador || [];
            if (Array.isArray(desglose)) {
                desglose.forEach((prest: any, prestadorIdx: number) => {
                    const items = prest.items || [];
                    items.forEach((item: any, itemIdx: number) => {
                        const codigo = item.codigo || item.codigoGC || item.gc || '';
                        const descripcion = item.descripcion || item.glosa || item.bi_glosa || '';
                        const bonificacion = parseAmountCLP(item.bonificacion ?? item.bonif ?? 0);
                        const copago = parseAmountCLP(item.copago ?? item.monto_copago ?? 0);

                        // Build unique ID: folio_prestador_item_code_firstwords
                        const descWords = descripcion.split(/\s+/).slice(0, 3).join('_').substring(0, 20);
                        const uniqueId = `PAM_${folioIdx}_${prestadorIdx}_${itemIdx}_${codigo || 'NC'}_${descWords}`;

                        extractedPamLines.push({
                            uniqueId,
                            codigo: codigo || 'SIN_CODIGO',
                            descripcion,
                            bonificacion,
                            copago,
                            folioIdx,
                            prestadorIdx,
                            itemIdx,
                            isGeneric: /material|insumo|medicamento|varios|sin bonific|farmac/i.test(descripcion)
                        });
                    });
                });
            }
        });
    }

    log(`[AuditEngine] 📋 Extracted ${extractedPamLines.length} PAM lines for jurisprudence processing.`);

    // ============================================================================
    // STEP 2: Run jurisprudence engine on EACH PAM line (one decision per line)
    // ============================================================================
    const jurisprudenceDecisions: Map<string, {
        decision: any;
        features: Set<string>;
        pamLine: PAMLineExtracted;
    }> = new Map();

    let catACount = 0, catBCount = 0, catZCount = 0;
    const newPrecedentsToRecord: { pamLine: PAMLineExtracted; decision: any; features: Set<string> }[] = [];

    for (const pamLine of extractedPamLines) {
        const features = extractFeatureSet(
            { codigo: pamLine.codigo, descripcion: pamLine.descripcion, bonificacion: pamLine.bonificacion, copago: pamLine.copago },
            contratoJson,
            hypothesisResult
        );

        const decision = jurisprudenceEngine.decide({
            contratoJson,
            pamLine: {
                codigo: pamLine.codigo,
                descripcion: pamLine.descripcion,
                bonificacion: pamLine.bonificacion,
                copago: pamLine.copago
            },
            features
        });

        jurisprudenceDecisions.set(pamLine.uniqueId, { decision, features, pamLine });

        // Structured logging for precedent/doctrine decisions
        if (decision.source === 'PRECEDENTE' || decision.source === 'DOCTRINA') {
            const shortDesc = pamLine.descripcion.substring(0, 40);
            log(`[AuditEngine]   🔒 PAM_LINE[${pamLine.codigo}|${shortDesc}]:`);
            log(`[AuditEngine]      Decision=Cat ${decision.categoria_final} | Source=${decision.source} | Conf=${(decision.confidence * 100).toFixed(0)}%`);

            // IMMEDIATE PRECEDENT RECORDING for Cat A with high confidence
            if (decision.categoria_final === 'A' && decision.confidence >= 0.85 && decision.source === 'DOCTRINA') {
                newPrecedentsToRecord.push({ pamLine, decision, features });
            }
        }

        // Count categories
        if (decision.categoria_final === 'A') catACount++;
        else if (decision.categoria_final === 'B') catBCount++;
        else catZCount++;
    }

    log(`[AuditEngine] ✅ Jurisprudence decisions: ${catACount} Cat A, ${catBCount} Cat B, ${catZCount} Cat Z (total: ${jurisprudenceDecisions.size} lines)`);

    // ============================================================================
    // STEP 3: Persist Cat A precedents IMMEDIATELY (before LLM)
    // ============================================================================
    if (newPrecedentsToRecord.length > 0) {
        log(`[AuditEngine] 💾 Recording ${newPrecedentsToRecord.length} new precedent(s)...`);
        for (const { pamLine, decision, features } of newPrecedentsToRecord) {
            try {
                const { recordPrecedent } = await import('./jurisprudence/jurisprudence.recorder.js');
                const precedentId = recordPrecedent(
                    jurisprudenceStore,
                    contratoJson,
                    { codigo: pamLine.codigo, descripcion: pamLine.descripcion, bonificacion: pamLine.bonificacion, copago: pamLine.copago },
                    {
                        categoria_final: decision.categoria_final,
                        tipo_monto: decision.tipo_monto,
                        recomendacion: decision.recomendacion,
                        confidence: decision.confidence
                    },
                    `Precedente automático: ${pamLine.descripcion.substring(0, 50)}`,
                    Array.from(features).slice(0, 5),
                    { requires: Array.from(features).filter(f => f.startsWith('COV_') || f.startsWith('BONIF_') || f.startsWith('MED_')) }
                );
                log(`[AuditEngine]   📝 Recorded: ${precedentId}`);
            } catch (e) {
                log(`[AuditEngine]   ⚠️ Failed to record precedent: ${e}`);
            }
        }
    }

    // ============================================================================
    // STEP 4: Build FROZEN categories map (prevents LLM/canonical override)
    // ============================================================================
    const frozenCategories: Map<string, { categoria_final: 'A' | 'B' | 'Z'; source: string; confidence: number }> = new Map();

    for (const [uniqueId, { decision }] of jurisprudenceDecisions) {
        // Only freeze decisions from PRECEDENTE or DOCTRINA (not heuristic)
        if (decision.source === 'PRECEDENTE' || decision.source === 'DOCTRINA') {
            frozenCategories.set(uniqueId, {
                categoria_final: decision.categoria_final,
                source: decision.source,
                confidence: decision.confidence
            });
        }
    }

    log(`[AuditEngine] 🔐 ${frozenCategories.size} categories frozen (immune to LLM/canonical override).`);

    // ============================================================================
    // CANONICAL RULES ENGINE (SUBORDINATE to Jurisprudence)
    // ============================================================================
    // NOTE: Canonical Rules can only affect lines NOT frozen by Jurisprudence
    let billItemsForRules: any[] = [];
    if (cleanedCuenta.sections) {
        billItemsForRules = cleanedCuenta.sections.flatMap((s: any) => s.items || []);
    }

    // Pass capability matrix to rules engine
    const ruleEngineResult = runCanonicalRules(
        billItemsForRules,
        eventosHospitalarios,
        contratoJson,
        hypothesisResult.capabilityMatrix  // NEW: Hypothesis context
    );

    const canonicalOutput = generateExplainableOutput(
        ruleEngineResult.decision,
        ruleEngineResult.rules,
        ruleEngineResult.flags
    );

    log(`[AuditEngine] ⚖️ Canonical Rules Decision: ${canonicalOutput.decisionGlobal}`);
    ruleEngineResult.flags.filter(f => f.detected).forEach(f => log(`[AuditEngine]    🚩 Flag: ${f.flagId} - ${f.description}`));
    ruleEngineResult.rules.filter(r => r.violated).forEach(r => log(`[AuditEngine]    🚫 Violation: ${r.ruleId} - ${r.description}`));

    // ============================================================================
    // JURISPRUDENCE PROTECTION: Canonical cannot collapse Cat A to INDETERMINADO
    // ============================================================================
    let effectiveCanonicalDecision: string = canonicalOutput.decisionGlobal;
    const hasFrozenCatA = Array.from(frozenCategories.values()).some(f => f.categoria_final === 'A');

    if (canonicalOutput.decisionGlobal === 'COPAGO_INDETERMINADO_POR_OPACIDAD' && hasFrozenCatA) {
        effectiveCanonicalDecision = 'COPAGO_MIXTO_CONFIRMADO_Y_OPACO';
        log(`[AuditEngine] 🛡️ PROTECTION ACTIVATED: Canonical tried to override ${catACount} frozen Cat A decisions.`);
        log(`[AuditEngine]    Original: ${canonicalOutput.decisionGlobal} → Effective: ${effectiveCanonicalDecision}`);
        log(`[AuditEngine]    Reason: Jurisprudencia local tiene prioridad sobre estado global.`);
    }

    const rulesContext = `
==========================================================================
⚖️ RESULTADO MOTOR DE REGLAS CANÓNICAS (SUBORDINADO A JURISPRUDENCIA)
==========================================================================
ESTADO DETERMINÍSTICO: ${effectiveCanonicalDecision}
DECISIONES JURISPRUDENCIALES CONGELADAS: ${frozenCategories.size} (${catACount} Cat A, ${catBCount} Cat B)
PRINCIPIO LEGAL: ${canonicalOutput.principioAplicado}

REGLA NUCLEAR:
- La jurisprudencia local tiene PRIORIDAD sobre el estado global.
- Cat A decididos por DOCTRINA/PRECEDENTE son INMUTABLES.
- Opacidad global NO invalida hallazgos locales confirmados.

FUNDAMENTOS TÉCNICOS DETECTADOS:
${canonicalOutput.fundamento.map(f => `- ${f}`).join('\n')}

⚠️ INSTRUCCIONES OBLIGATORIAS DE RAZONAMIENTO:
1. Hallazgos Cat A (DOCTRINA/PRECEDENTE) son COBRO IMPROCEDENTE final.
2. NO reinterpretar ni diluir decisiones congeladas.
3. Opacidad aplica SOLO a líneas NO decididas por jurisprudencia.
==========================================================================
`;

    const prompt = AUDIT_PROMPT
        .replace('{jurisprudencia_text}', '')
        .replace('{normas_administrativas_text}', '')
        .replace('{evento_unico_jurisprudencia_text}', '')
        .replace('{knowledge_base_text}', knowledgeBaseText)
        .replace('{hoteleria_json}', hoteleriaRules || '')
        .replace('{cuenta_json}', finalCuentaContext)
        .replace('{pam_json}', finalPamContext)
        .replace('{contrato_json}', finalContratoContext)
        .replace('{eventos_hospitalarios}', eventosContext)
        .replace('{contexto_trazabilidad}', traceAnalysis)
        .replace('{va_deduction_context}', vaDeductionSummary + '\n' + rulesContext)
        .replace('{html_context}', useHtmlContext ? (htmlContext || '') : '(Omitido: JSON completo)');

    // Log prompt size for debugging
    const promptSize = prompt.length;
    const promptSizeKB = (promptSize / 1024).toFixed(2);
    log(`[AuditEngine] ðŸ“ TamaÃ±o del prompt: ${promptSizeKB} KB(${promptSize} caracteres)`);
    // -----------------------------------------------------

    // Initialize GeminiService with multiple API keys for rotation
    const apiKeys = [
        apiKey,
        process.env.GEMINI_API_KEY_SECONDARY,
        process.env.GEMINI_API_KEY_TERTIARY,
        process.env.GEMINI_API_KEY_QUATERNARY
    ].filter(k => k && k.length > 5);

    const geminiService = new GeminiService(apiKeys);
    log(`[AuditEngine] ðŸ”‘ GeminiService initialized with ${apiKeys.length} API key(s)`);

    for (const modelName of modelsToTry) {
        if (!modelName) continue;

        for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
            const currentKey = apiKeys[keyIdx];
            const keyMask = currentKey.substring(0, 4) + '...';

            try {
                log(`[AuditEngine] ðŸ›¡ï¸ Strategy: Intentando con modelo ${modelName} (Key ${keyIdx + 1}/${apiKeys.length}: ${keyMask})...`);
                onProgressUpdate?.(40);

                const timeoutMs = 120000;
                let fullText = '';
                let usage: any = null;

                const genAI = new GoogleGenerativeAI(currentKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: FORENSIC_AUDIT_SCHEMA as any,
                        maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                        temperature: GENERATION_CONFIG.temperature,
                        topP: GENERATION_CONFIG.topP,
                        topK: GENERATION_CONFIG.topK
                    }
                });

                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Timeout: La API no respondiÃ³ en ${timeoutMs / 1000} segundos`)), timeoutMs);
                });

                log('[AuditEngine] ðŸ“¡ Enviando consulta a Gemini (Streaming)...');
                const streamResult = await Promise.race([
                    model.generateContentStream(prompt),
                    timeoutPromise
                ]) as any;

                log('[AuditEngine] ðŸ“¥ Recibiendo respuesta en tiempo real...');
                for await (const chunk of streamResult.stream) {
                    const chunkText = chunk.text();
                    fullText += chunkText;

                    if (chunk.usageMetadata) {
                        usage = chunk.usageMetadata;
                        onUsageUpdate?.(usage);
                    }

                    if (fullText.length % 500 < chunkText.length) {
                        const kbReceived = Math.floor(fullText.length / 1024);
                        log(`[AuditEngine] ðŸ“Š Procesando... ${kbReceived}KB recibidos`);
                        // Fix 1.5: Simulated Progress Heuristic (Chars / 4 = Tokens approx)
                        const estimatedTokens = fullText.length / 4;
                        const simulatedProgress = Math.min(90, 40 + (estimatedTokens / ESTIMATED_TOTAL_TOKENS) * 50);
                        onProgressUpdate?.(simulatedProgress);
                    }
                }

                result = {
                    response: {
                        text: () => fullText,
                        usageMetadata: usage
                    }
                };

                log(`[AuditEngine] âœ… Ã‰xito con modelo ${modelName} y Key ${keyIdx + 1}`);
                break; // Exit key loop on success

            } catch (error: any) {
                lastError = error;
                const errStr = (error?.toString() || "") + (error?.message || "");
                const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || error?.status === 429 || error?.status === 503;
                const isTimeout = errStr.includes('Timeout');

                if (isTimeout) {
                    log(`[AuditEngine] â±ï¸ Timeout en ${modelName} con Key ${keyIdx + 1}.`);
                    // Try next key
                    continue;
                } else if (isQuota) {
                    log(`[AuditEngine] âš ï¸ Fallo en ${modelName} con Key ${keyIdx + 1} por Quota/Server. Probando siguiente clave...`);
                    // Small backoff
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                } else {
                    log(`[AuditEngine] âŒ Error no recuperable en ${modelName} / Key ${keyIdx + 1}: ${error.message}`);
                    // Depending on error, we might want to try next key or bail
                    // If it's 400 (Bad Request), trying next key won't help.
                    // But for robustness, let's try at least one more key or switch model.
                    if (errStr.includes('400')) throw error;
                    continue;
                }
            }
        }
        if (result) break; // Exit model loop on success
    }

    if (!result) {
        log(`[AuditEngine] âŒ Todos los modelos fallaron.`);
        throw lastError || new Error("Forensic Audit failed on all models.");
    }

    // --- ROBUST JSON PARSING ---
    try {
        let responseText = result.response.text();

        // 1. Remove Markdown fences (Robust Fix 1.3)
        responseText = responseText
            .replace(/^\s*```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();

        // 2. Escape bad control characters (newlines/tabs inside strings)
        // Fix 1.4: "ReparaciÃ³n JSON" peligrosa disabled. Control chars are risky to strip blindly.
        // This regex looks for control chars that are NOT properly escaped
        // However, a simpler approach for AI JSON is often just to clean common issues

        // Attempt parse
        let auditResult;
        try {
            auditResult = JSON.parse(responseText);

            // Fix 1: Variable Normalization (Immediately after parse)
            if (auditResult.resumen_financiero && !auditResult.resumenFinanciero) {
                auditResult.resumenFinanciero = auditResult.resumen_financiero;
            }
            // Ensure camelCase structure
            if (!auditResult.resumenFinanciero) auditResult.resumenFinanciero = {};
        } catch (parseError) {
            log(`[AuditEngine] âš ï¸ JSON.parse fallÃ³ inicialmente: ${parseError.message}. Intentando reparaciÃ³n bÃ¡sica...`);

            // Repair: sometimes AI returns newlines inside strings which breaks JSON
            // Fix 1.4: Safer repair or just raw fallback. For now, we attempt very conservative repair or none.
            // User requested: "Don't try magic".
            // We'll skip the dangerous regex replace(/[\u0000-\u001F]+/g, ...).

            try {
                // Try to find valid JSON subset? No, too complex. 
                // Just log and fallback.
                throw new Error("JSON repair disabled per V5 guidelines.");
                // auditResult = JSON.parse(cleanedText); 
                // log('[AuditEngine] âœ… ReparaciÃ³n de JSON exitosa.');
            } catch (repairError) {
                log(`[AuditEngine] âŒ ReparaciÃ³n fallÃ³.Devolviendo raw text para depuraciÃ³n.`);
                // Fallback: return structure with raw content
                auditResult = {
                    metadata: { type: 'ERROR_FALLBACK' },
                    resumen_financiero: { total_reclamado: 0, total_cobertura: 0, copago_final: 0 },
                    hallazgos: [{
                        titulo: "Error de Formato JSON",
                        descripcion: "La IA generÃ³ una respuesta vÃ¡lida pero con formato JSON corrupto. Ver 'observaciones' para el texto crudo.",
                        impacto_financiero: 0,
                        categoria: "SISTEMA",
                        estado: "REVISION_MANUAL",
                        recomendacion: "Revisar texto crudo."
                    }],
                    observaciones_generales: responseText
                };
            }
        }

        const usage = result.response.usageMetadata;

        // --- POST-PROCESSING: SAFETY BELT (DOWNGRADE RULES) ---
        // Downgrade findings that lack valid Table VIII or contradict financial truth
        // NOW INCLUDES CRC LOGIC (reconstructibility)
        auditResult = postValidateLlmResponse(
            auditResult,
            eventosHospitalarios,
            cleanedCuenta,
            cleanedPam,
            reconstructibility // Pass CRC result
        );
        log('[AuditEngine] ðŸ›¡ï¸ Validaciones de seguridad aplicadas (Safety Belt & CRC).');

        // --- POST-PROCESSING: DETERMINISTIC GAP RECONCILIATION ---
        try {
            const pamTotalCopago = pamJson?.global?.totalCopagoDeclarado || pamJson?.resumenTotal?.totalCopago || 0;

            const numericTotalCopago = parseAmountCLP(pamTotalCopago);
            const sumFindings = auditResult.hallazgos.reduce((sum: number, h: any) => sum + (h.montoObjetado || 0), 0);

            // NEW LOGIC: Use AI's financial summary if available to deduce Legitimate Copay
            const financialSummary = auditResult.resumenFinanciero || {};
            const legitimadoPorIA = parseAmountCLP(financialSummary.totalCopagoLegitimo || 0);
            const estadoCopago = financialSummary.estado_copago || 'VALIDADO';

            // True Gap = TotalCopago - (Legitimate + Objected)
            // If AI says $1.4M is legitimate (30% copay) and $395k is objected, and Total is $1.8M
            // Gap = 1.8M - (1.4M + 0.395M) = ~0.

            // ðŸš¨ REGLA NUCLEAR: Si el estado es INDETERMINADO, NO generamos GAP/orphans
            if (estadoCopago === 'INDETERMINADO_POR_OPACIDAD') {
                log(`[AuditEngine] ðŸ” Estado INDETERMINADO detectado.NO se ejecuta GAP reconciliation(evita ghost hunters).`);
                // Early return: skip all gap/orphan logic
            } else {

                // Verify consistency:
                // If AI didn't provide breakdown, we default to the old "Gap = Total - Findings" logic BUT
                // ONLY if the gap is massive.

                let gap = 0;
                if (legitimadoPorIA > 0) {
                    gap = numericTotalCopago - (legitimadoPorIA + sumFindings);
                } else {
                    // If AI was lazy and didn't fill legitimado, we can't assume everything is a Gap.
                    // We trust the AI's "hallazgos". If AI says "No findings", then Copay matches Contract.
                    // So Gap should be 0 unless we forced it.
                    // BUT, to catch "Ghost Codes", we can check if there are 00-00 codes that are NOT in findings.
                    // For now, let's be conservative: If no explicit legitimization, assume AI did its job.
                    // Only creating Gap finding if explicit "resumenFinanciero" indicates a mismatch.
                    gap = 0;
                    if (financialSummary.analisisGap && financialSummary.analisisGap.toLowerCase().includes('diferencia')) {
                        // Try to parse number from text or default to simple arithmetic
                        gap = numericTotalCopago - sumFindings; // Fallback to simple math only if AI admits a gap
                    }
                }

                // Threshold: $5000 CLP
                if (gap > 5000) {
                    log(`[AuditEngine] ðŸš¨ GAP REAL DETECTADO: $${gap} (Total: $${numericTotalCopago} - Validado: $${legitimadoPorIA} - Hallazgos: $${sumFindings})`);

                    // 1. SCAN FOR ORPHANED ITEMS (The "Ghost Code Hunter")
                    const orphanedItems: any[] = [];
                    let remainingGap = gap;

                    if (pamJson && pamJson.folios) {
                        for (const folio of pamJson.folios) {
                            if (folio.desglosePorPrestador) {
                                for (const prestador of folio.desglosePorPrestador) {
                                    if (prestador.items) {
                                        for (const item of prestador.items) {
                                            const itemCopago = parseAmountCLP(item.copago);
                                            // Heuristic: If item has copay > 0 AND fits within the gap AND is likely a "Ghost Code" (00-00-000-00 or 99-XX)
                                            // We prioritize these as the culprits.
                                            if (itemCopago > 0 && itemCopago <= (remainingGap + 500)) {
                                                const isCode0 = item.codigo?.includes('00-00-000') || item.codigo?.startsWith('0') || item.codigo?.startsWith('99-');
                                                const description = (item.descripcion || '').toUpperCase();
                                                const isGeneric = description.includes('INSUMO') || description.includes('MATERIAL') || description.includes('VARIO');

                                                // Check if this item was already "caught" (approximate match by amount/code)
                                                const alreadyCaught = auditResult.hallazgos.some((h: any) =>
                                                    (h.montoObjetado === itemCopago) ||
                                                    (h.codigos && h.codigos.includes(item.codigo))
                                                );

                                                if (!alreadyCaught && (isCode0 || isGeneric)) {
                                                    orphanedItems.push(item);
                                                    remainingGap -= itemCopago;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 2. ASSIGN GAP TO ORPHANS (Traceability)
                    if (orphanedItems.length > 0) {
                        log(`[AuditEngine] ðŸ•µï¸â€â™‚ï¸ Ãtems HuÃ©rfanos encontrados: ${orphanedItems.length} `);

                        orphanedItems.forEach(item => {
                            const monto = parseAmountCLP(item.copago);
                            auditResult.hallazgos.push({
                                codigos: item.codigo || "SIN-CODIGO",
                                glosa: item.descripcion || "ÃTEM SIN DESCRIPCION",
                                scope: { type: 'PAM_LINE', pamLineKey: item.codigo || 'UNKNOWN' }, // Explicit Scope
                                hallazgo: `
    ** I.IdentificaciÃ³n del Ã­tem cuestionado **
        Se cuestiona el cobro de ** $${monto.toLocaleString('es-CL')}** asociado a la prestaciÃ³n codificada como "${item.codigo}".

** II.Contexto clÃ­nico y administrativo **
    Este Ã­tem aparece con copago positivo en el PAM pero no cuenta con bonificaciÃ³n adecuada ni cÃ³digo arancelario estÃ¡ndar(CÃ³digo Fantasma / 0), generando una "fuga de cobertura" silenciosa.

** III.Norma contractual aplicable **
    SegÃºn Circular IF / NÂ°176 y Art. 33 Ley 18.933, los errores de codificaciÃ³n o el uso de cÃ³digos internos(no homologados) por parte del prestador NO pueden traducirse en copagos para el afiliado.La Isapre debe cubrir la prestaciÃ³n al 100 % (Plan Pleno) asimilÃ¡ndola al cÃ³digo Fonasa mÃ¡s cercano(ej: VÃ­a Venosa, Insumos de PabellÃ³n).

** IV.Forma en que se materializa la controversia **
    Se configura un ** Error de CodificaciÃ³n Imputable al Prestador **.La clÃ­nica utilizÃ³ un cÃ³digo interno(99 - XX o 00-00) que la Isapre rechazÃ³ o bonificÃ³ parcialmente como "No Arancelado", cuando en realidad corresponde a insumos / procedimientos cubiertos.

** VI.Efecto econÃ³mico concreto **
    El afiliado paga $${monto.toLocaleString('es-CL')} indebidamente por un error administrativo de catalogaciÃ³n.

** VII.ConclusiÃ³n de la impugnaciÃ³n **
    Se solicita la re - liquidaciÃ³n total de este Ã­tem bajo el principio de homologaciÃ³n y cobertura integral.

** VIII.Trazabilidad y Origen del Cobro **
    Anclaje exacto en PAM: Ãtem "${item.descripcion}"(Copago: $${monto}).
                             `,
                                montoObjetado: monto,
                                tipo_monto: "COBRO_IMPROCEDENTE", // GAP: Orphan items are exigible
                                normaFundamento: "Circular IF/176 (Errores de CodificaciÃ³n) y Ley 18.933",
                                anclajeJson: `PAM_AUTO_DETECT: ${item.codigo} `
                            });
                            // DO NOT add to totalAhorroDetectado here - Safety Belt will calculate
                        });

                        // If there is still a residual gap, create a smaller generic finding
                        if (remainingGap > 5000) {
                            // ... (Add generic finding logic for remainingGap if needed, or ignore if small)
                            log(`[AuditEngine] âš ï¸ AÃºn queda un gap residual de $${remainingGap} no asignable a Ã­tems especÃ­ficos.`);
                        }

                    } else {
                        // 3. FALLBACK TO GENERIC GAP (If no orphans found)
                        auditResult.hallazgos.push({
                            codigos: "GAP_RECONCILIATION",
                            glosa: "DIFERENCIA NO EXPLICADA (DÃ‰FICIT DE COBERTURA)",
                            hallazgo: `
    ** I.IdentificaciÃ³n del Ã­tem cuestionado **
        Se detecta un monto residual de ** $${gap.toLocaleString('es-CL')}** que no fue cubierto por la Isapre y NO corresponde al copago contractual legÃ­timo.

** II.Contexto clÃ­nico y administrativo **
    Diferencia aritmÃ©tica entre Copago Total y la suma de(Copago LegÃ­timo + Hallazgos).

** III.Norma contractual aplicable **
    El plan(cobertura preferente) no deberÃ­a generar copagos residuales salvo Topes Contractuales alcanzados o Exclusiones legÃ­timas.

** IV.Forma en que se materializa la controversia **
    Existe un ** DÃ©ficit de Cobertura Global **.Si este monto de $${gap.toLocaleString('es-CL')} corresponde a prestaciones no aranceladas, debe ser acreditado.De lo contrario, se presume cobro en exceso por falta de bonificaciÃ³n integral.

** VI.Efecto econÃ³mico concreto **
    Costo adicional de $${gap.toLocaleString('es-CL')} sin justificaciÃ³n contractual.

** VII.ConclusiÃ³n de la impugnaciÃ³n **
    Se objeta este remanente por falta de transparencia.

** VIII.Trazabilidad y Origen del Cobro **
| Concepto | Monto |
| : --- | : --- |
| Copago Total PAM | $${numericTotalCopago.toLocaleString('es-CL')} |
| (-) Copago LegÃ­timo(Contrato) | -$${legitimadoPorIA.toLocaleString('es-CL')} |
| (-) Suma Hallazgos | -$${sumFindings.toLocaleString('es-CL')} |
| **= GAP(DIFERENCIA) ** | ** $${gap.toLocaleString('es-CL')}** |
    `,
                            montoObjetado: gap,
                            tipo_monto: "COBRO_IMPROCEDENTE", // GAP: Generic coverage deficit is exigible
                            anclajeJson: "CÃLCULO_AUTOMÃTICO_SISTEMA",
                            categoria: "Z", // Fix 4: Force Z
                            categoria_final: "Z",
                            scope: { type: 'GLOBAL' } // GAP is Global
                        });
                        // DO NOT add to totalAhorroDetectado here - Safety Belt will calculate
                        log('[AuditEngine] âœ… GAP GENÃ‰RICO inyectado (Cat Z).');
                    }
                }
            } // End of else block for !INDETERMINADO
        } catch (gapError: any) {
            const errMsg = gapError?.message || String(gapError);
            log(`[AuditEngine] âš ï¸ Error en cÃ¡lculo de Gap: ${errMsg} `);
        }
        log('[AuditEngine] âœ… AuditorÃ­a forense completada.');

        // --- FINALIZATION (DETERMINISTIC CATEGORIZATION) ---
        // Calculate Canonical Total from PAM Source of Truth if available
        const pamGlobal = pamJson?.global;
        let totalCopagoReal = 0;

        if (pamGlobal) {
            const val = pamGlobal.totalValor || 0;
            const bon = pamGlobal.totalBonif || 0;
            // Canonical Formula: COPAGO_TOTAL = Î£(Valor ISA) âˆ’ Î£(BonificaciÃ³n)
            totalCopagoReal = val - bon;

            // Fallback if 0 (sometimes totalValor is not populated but totalCopago is)
            if (totalCopagoReal === 0 && pamGlobal.totalCopago > 0) {
                totalCopagoReal = pamGlobal.totalCopago;
            }
        } else {
            // Deep fallback
            const pamTotalCopago = pamJson?.resumenTotal?.totalCopago || 0;
            totalCopagoReal = parseAmountCLP(pamTotalCopago);
        }

        // ============================================================================
        // HYPOTHESIS-AWARE BALANCE CALCULATION (V5)
        // ============================================================================
        log('[AuditEngine] ðŸ’° Computing Balance with Hypothesis Awareness...');

        // Extract PAM lines with copago for balance calculation
        let pamLines: PAMLineInput[] = routerInput.pam.lines.map(line => ({
            key: line.key,
            desc: line.desc,
            copago: line.amount
        }));

        log(`[AuditEngine] DEBUG: routerInput.pam.lines.length = ${routerInput.pam.lines.length}`);

        // --- ROBUST FALLBACK FOR PAM EXTRACTION ---
        if (pamLines.length === 0 && cleanedPam) {
            log('[AuditEngine] âš ï¸ Attempting deep PAM extraction (Fallback Mode)...');

            let rawItems: any[] = [];

            // Case 1: Direct items or lineas (Legacy/Flat)
            if (cleanedPam.items && Array.isArray(cleanedPam.items)) rawItems = cleanedPam.items;
            else if (cleanedPam.lineas && Array.isArray(cleanedPam.lineas)) rawItems = cleanedPam.lineas;

            // Case 2: Folios structure (Standard V2)
            else if (cleanedPam.folios && Array.isArray(cleanedPam.folios)) {
                rawItems = cleanedPam.folios.flatMap((folio: any) => {
                    const desglose = folio.desglosePorPrestador || [];
                    if (Array.isArray(desglose)) {
                        return desglose.flatMap((p: any) => p.items || []);
                    }
                    return folio.items || [];
                });
            }

            log(`[AuditEngine] Fallback found ${rawItems.length} raw items.`);

            if (rawItems.length > 0) {
                pamLines = rawItems.map((item: any) => ({
                    key: item.codigo || item.codigoGC || 'UNKNOWN',
                    desc: item.descripcion || item.bi_glosa || '',
                    copago: (typeof item.copago === 'number' ? item.copago :
                        (typeof item.monto_copago === 'number' ? item.monto_copago : 0))
                }));
                log(`[AuditEngine] âœ… Fallback successfully extracted ${pamLines.length} PAM lines.`);
            } else {
                log(`[AuditEngine] âš ï¸âš ï¸ PAM still empty after deep search! Keys: ${Object.keys(cleanedPam || {}).join(", ")}`);
                try {
                    const structure = Object.entries(cleanedPam || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? `Array(${v.length})` : typeof v}`);
                    log(`[AuditEngine] Structure Dump: ${structure.join(", ")}`);
                } catch (e) { /* ignore */ }
            }
        }


        const balance: Balance = computeBalanceWithHypotheses(
            auditResult.hallazgos || [],
            totalCopagoReal,
            hypothesisResult.capabilityMatrix,
            pamLines
        );

        log(`[AuditEngine] ðŸ“Š Balance Computed:`);
        log(`[AuditEngine]   Cat A (Improcedente): $${balance.categories.A.toLocaleString()}`);
        log(`[AuditEngine]   Cat B (Controversia): $${balance.categories.B.toLocaleString()}`);
        log(`[AuditEngine]   Cat OK (No Observado): $${balance.categories.OK.toLocaleString()}`);
        log(`[AuditEngine]   Cat Z (Indeterminado): $${balance.categories.Z.toLocaleString()}`);

        // Update result with balance data (single source of truth)
        if (!auditResult.resumenFinanciero) auditResult.resumenFinanciero = {};
        auditResult.resumenFinanciero.ahorro_confirmado = balance.categories.A;
        auditResult.resumenFinanciero.cobros_improcedentes_exigibles = balance.categories.A;
        auditResult.resumenFinanciero.copagos_bajo_controversia = balance.categories.B;
        auditResult.resumenFinanciero.monto_indeterminado = balance.categories.Z;
        auditResult.resumenFinanciero.monto_no_observado = balance.categories.OK;
        auditResult.resumenFinanciero.totalCopagoReal = totalCopagoReal;
        auditResult.resumenFinanciero.totalCopagoObjetado = balance.categories.A + balance.categories.B + balance.categories.Z;

        // Legacy support
        auditResult.totalAhorroDetectado = balance.categories.A;

        // Generate canonical text
        const locale = 'es-CL';
        const txtTotal = totalCopagoReal.toLocaleString(locale);
        const txtA = balance.categories.A.toLocaleString(locale);
        const txtB = balance.categories.B.toLocaleString(locale);
        const txtOK = balance.categories.OK.toLocaleString(locale);
        const txtZ = balance.categories.Z.toLocaleString(locale);

        let canonicalText = `El copago total informado corresponde a $${txtTotal}.\nDe este monto:\n\n`;
        if (balance.categories.A > 0) canonicalText += `$${txtA} corresponden a cobros improcedentes.\n\n`;
        if (balance.categories.B > 0) canonicalText += `$${txtB} se encuentran en controversia por falta de desglose.\n\n`;
        if (balance.categories.OK > 0) canonicalText += `$${txtOK} no presentan observaciones con la informaciÃ³n disponible.\n\n`;
        if (balance.categories.Z > 0) canonicalText += `$${txtZ} corresponden a montos indeterminados (sin informaciÃ³n suficiente).\n\n`;
        canonicalText += `La suma de todas las categorÃ­as coincide exactamente con el copago total.`;

        if (!auditResult.decisionGlobal) auditResult.decisionGlobal = {};
        auditResult.decisionGlobal.fundamento = canonicalText;

        const finalResult = auditResult;

        // --- LEGACY OVERRIDE DISABLED (V5 - Hypothesis Engine handles this now) ---
        // The balance is now computed scope-by-scope by computeBalanceWithHypotheses()
        // which already respects H1 (Opacity) at the PAM_LINE level.
        // This global override is no longer needed and causes contradictions.
        /*
        if (ruleEngineResult.decision === "COPAGO_INDETERMINADO_POR_OPACIDAD") {
            log(`[AuditEngine] ðŸ”’ SUPER-OVERRIDE: Forzando estado INDETERMINADO por reglas canÃ³nicas.`);
            // ... old logic that wiped findings and reset balance to global Cat Z ...
        }
        */

        log(`[AuditEngine] ðŸ AuditorÃ­a finalizada. Ahorro: $${finalResult.resumenFinanciero.ahorro_confirmado} | Controversia: $${finalResult.resumenFinanciero.copagos_bajo_controversia}`);

        // --- AlphaFold-Juridic Phase 2 & 3 Implementation ---
        const alphaSignals = AlphaFoldService.extractSignals({ pam: cleanedPam, cuenta: cleanedCuenta, contrato: contratoJson });
        const pamState = AlphaFoldService.detectPamState(alphaSignals);
        const ranking = AlphaFoldService.scoreHypotheses(alphaSignals, pamState);
        const activeContexts = AlphaFoldService.activateContexts(ranking, pamState);

        // Generate Findings via AlphaFold (Logic Phase 3)
        // Combine with Legacy Findings? For now, we prefer AlphaFold's structural findings for Opacity/Unbundling
        // But we might want to keep specific medical text findings from the LLM if they are detailed.
        // Hybrid Approach: Use AlphaFold generated findings for Structural issues (Cat Z/A),
        // and append LLM findings if they don't contradict.

        const alphaFindings = AlphaFoldService.buildFindings({ pam: cleanedPam, cuenta: cleanedCuenta, contrato: contratoJson }, pamState, activeContexts);

        // For this phase, let's Append AlphaFindings to list.
        // NOTE: We should probably dedup if LLM also found them. 
        // But AlphaFold's are more deterministic.

        // Let's MERGE for a complete picture, assuming LLM findings are specific medical objections.
        // We filter out LLM findings that overlap with Structural Opacity to avoid double counting.
        const mergedFindings = [...alphaFindings, ...(finalResult.hallazgos || []).filter((h: any) =>
            // Exclude LLM findings that are just "Structural Opacity" since AlphaFold handles that better
            h.codigos !== "OPACIDAD_ESTRUCTURAL" && h.categoria !== "OPACIDAD"
        ).map((h: any) => ({
            id: h.id || stableId([h.codigos || "", h.titulo || "", h.glosa || "", String(h.montoObjetado || 0)]), // Fix 8: Deterministic ID
            category: (h.categoria_final || "Z") as any,
            label: h.titulo || h.glosa || "Hallazgo LLM",
            amount: h.montoObjetado || 0,
            action: (h.recomendacion_accion || "SOLICITAR_ACLARACION") as any,
            evidenceRefs: h.evidenceRefs || [],
            rationale: h.hallazgo || "Hallazgo detectado por LLM",
            hypothesisParent: "H_OK_CUMPLIMIENTO" // Default for legacy
        }))];

        const alphaBalance = AlphaFoldService.buildBalance(totalCopagoReal, mergedFindings);
        const decision = AlphaFoldService.globalDecision(activeContexts, ranking, alphaBalance);

        // Fix 9: Single Source of Truth
        // Re-run strict balance on the FINAL merged findings
        const finalStrictBalance = computeBalanceWithHypotheses(
            mergedFindings,
            totalCopagoReal,
            hypothesisResult.capabilityMatrix,
            pamLines
        );

        // Update finalResult with TRUTH
        if (!finalResult.resumenFinanciero) finalResult.resumenFinanciero = {};
        finalResult.resumenFinanciero.ahorro_confirmado = finalStrictBalance.categories.A;
        finalResult.resumenFinanciero.cobros_improcedentes_exigibles = finalStrictBalance.categories.A;
        finalResult.resumenFinanciero.copagos_bajo_controversia = finalStrictBalance.categories.B;
        finalResult.resumenFinanciero.monto_indeterminado = finalStrictBalance.categories.Z;
        finalResult.resumenFinanciero.monto_no_observado = finalStrictBalance.categories.OK;
        finalResult.resumenFinanciero.totalCopagoObjetado = finalStrictBalance.categories.A + finalStrictBalance.categories.B + finalStrictBalance.categories.Z;

        return {
            data: {
                ...finalResult,
                // --- AlphaFold-Juridic: Final Integrated Output ---
                pamState: pamState,
                signals: alphaSignals,
                hypothesisRanking: ranking,
                activeHypotheses: activeContexts,

                findings: mergedFindings,
                balance: {
                    A: finalStrictBalance.categories.A,
                    B: finalStrictBalance.categories.B,
                    Z: finalStrictBalance.categories.Z,
                    OK: finalStrictBalance.categories.OK,
                    TOTAL: finalStrictBalance.totalCopago
                } as BalanceAlpha,

                // Legacy Overrides (to update UI)
                // Fix 9: Single Source of Truth (Recalculate Balance using the Authority function)
                // We use mergedFindings (LLM + AlphaFold) but process them through the strict BalanceCalculator
                /*
                // OLD: AlphaFold Balance overwrite (Removed to prevent contradiction)
                resumenFinanciero: {
                    ...finalResult.resumenFinanciero,
                    ahorro_confirmado: alphaBalance.A,
                    copagos_bajo_controversia: alphaBalance.B,
                    monto_indeterminado: alphaBalance.Z,
                    monto_no_observado: alphaBalance.OK,
                    totalCopagoObjetado: alphaBalance.A + alphaBalance.B + alphaBalance.Z
                },
                */
                // NEW: Use computeBalanceWithHypotheses as the Single Source of Truth
                resumenFinanciero: finalResult.resumenFinanciero,
                decisionGlobal: {
                    estado: decision.estado,
                    confianza: decision.confianza,
                    fundamento: decision.fundamento
                },
                // Phase 10: Juridic & Epistemological Precision
                legalContext: {
                    axioma: "Un Estado Global de Opacidad NO invalida la existencia de hallazgos locales; solo limita su exigibilidad inmediata. Cat Z global  'todo está mal'.",
                    alcance: [
                        "El sistema NO imputa intencionalidad penal.",
                        "El sistema NO calcula topes UF/VAM cuando la información lo impide.",
                        "El sistema NO afirma que los montos sean improcedentes, sino que no son verificables.",
                        "El sistema SÍ concluye que el cobro no es jurídicamente exigible en su estado actual."
                    ],
                    fraudeCheck: "No se configura, a esta etapa, un patrón suficiente para calificar como fraude; la hipótesis dominante es opacidad estructural.",
                    disclaimer: "Este reporte constituye una pre-liquidación forense basada en la estabilidad de la información proporcionada. No reemplaza el juicio de un tribunal."
                },
                scopeBreakdown: finalStrictBalance.scopeBreakdown, // Explicit Scope Breakdown for Table
                canonical_rules_output: canonicalOutput,
                // Phase 11 & 12: Tailored Explanations
                explicaciones: (() => {
                    // Scenario A: Structural Opacity / Indeterminacy (The "Limit" Case)
                    if (decision.estado && (decision.estado.includes('OPACIDAD') || decision.estado.includes('INDETERMINADO') || decision.estado.includes('CONTROVERSIA'))) {
                        return {
                            clinica: "Motivo de la observación: imposibilidad de trazabilidad contable-contractual + Cobros Improcedentes detectados.\n\nLa cuenta clínica presenta un nivel de agregación en el PAM que impide la verificación técnica de todos los ítems; sin embargo, se han detectado cobros unitarios que resultan improcedentes por su propia naturaleza (Eventos Únicos, Unbundling).\n\nRespecto a la Opacidad: Si bien la cuenta interna del prestador contiene detalle, el PAM consolida materiales y medicamentos sin apertura espejo, impidiendo validar topes UF.\n\nRespecto a la Improcedencia: Existen prestaciones cobradas por separado que deben entenderse incluidas en el día cama o pabellón (doble cobro).\n\nConclusión: Se requieren dos acciones: 1) Eiminar los cobros improcedentes detectados (Cat A) y 2) Reliquidar el resto con desglose detallado para auditar topes (Cat B/Z).",
                            isapre: "La falta de desglose en el PAM impide auditar parte del copago; sin embargo, no obsta a declarar improcedentes aquellos cobros que, por su naturaleza clínica o normativa, resultan indebidos con independencia de dicha opacidad, tales como el cobro fragmentado de prestaciones inherentes a la hospitalización y la aplicación del Principio de Evento Único.\n\nEn derecho chileno: La falta de desglose no anula derechos que surgen por unidad clínica, naturaleza de la prestación o cobertura explícita.",
                            paciente: "Hay dos tipos de problemas en tu cuenta:\n\n1. Cobros que definitivamente NO corresponden (Cat A): Cosas que ya están pagadas dentro del 'Día Cama' o 'Pabellón' y te las están cobrando de nuevo. Esto se debe borrar.\n\n2. Cobros 'borrosos' (Opacidad): Gastos grandes de materiales/medicamentos que no explican bien. No sabemos si están bien o mal calculados porque faltan datos. Aquí aplica la protección de tu contrato: si no se explica, no se paga a ciegas.\n\nNo estás pidiendo un favor, estás exigiendo que te cobren lo justo y transparente.",
                            defensa_mandato: "El mandato es solo una autorización de tramitación; no puede interpretarse como renuncia al derecho a información ni como aceptación de cobros no trazables.\n\nSi el PAM no desglosa materiales/medicamentos, el copago es indeterminable y la carga de aclarar recae en prestador e Isapre.\n\nCláusula 2 (Mandato): Autoriza gestiones de cobro, NO autoriza opacidad.\nCláusula 3 (Consentimiento): Autoriza revelar datos médicos para obtener pago. Si la clínica oculta el detalle (opacidad), está incumpliendo su propio mandato de usar la información para justificar el cobro."
                        };
                    }
                    // Scenario B: Specific Findings (Traceable but Wrong) - Future Expansion
                    // ...
                    return undefined;
                })(),
                // NEW: Jurisprudence decisions for transparency
                jurisprudenceContext: {
                    precedentsUsed: Array.from(jurisprudenceDecisions.entries())
                        .filter(([_, v]) => v.decision.source === 'PRECEDENTE')
                        .map(([key, v]) => ({ pamLineKey: key, precedentId: v.decision.precedentId })),
                    doctrineRulesApplied: Array.from(jurisprudenceDecisions.entries())
                        .filter(([_, v]) => v.decision.source === 'DOCTRINA')
                        .map(([key, v]) => ({ pamLineKey: key, categoria: v.decision.categoria_final })),
                    totalDecisions: jurisprudenceDecisions.size
                }
            },
            usage: usage ? {
                promptTokens: usage.promptTokenCount,
                candidatesTokens: usage.candidatesTokenCount,
                totalTokens: usage.totalTokenCount
            } : null,
            // NEW: Trigger learning for future audits (async, non-blocking)
            learnedPrecedents: (() => {
                try {
                    const learnableFindings = mergedFindings
                        .filter(f => f.category === 'A' && (f.confidence || 0.85) >= 0.85)
                        .map(f => ({
                            codigo: f.evidenceRefs?.[0]?.path?.split('/')?.pop() || 'UNKNOWN',
                            descripcion: f.label,
                            bonificacion: 0,
                            copago: f.amount,
                            categoria_final: f.category,
                            tipo_monto: f.action === 'IMPUGNAR' ? 'COBRO_IMPROCEDENTE' as const : 'COPAGO_OPACO' as const,
                            recomendacion: f.action,
                            confidence: f.confidence || 0.85,
                            rationale: f.rationale,
                            tags: [f.hypothesisParent || 'LEARNED']
                        }));

                    if (learnableFindings.length > 0) {
                        const recordedIds = learnFromAudit(jurisprudenceStore, contratoJson, learnableFindings, 0.85);
                        log(`[AuditEngine] 🧠 Jurisprudence learned ${recordedIds.length} new precedent(s).`);
                        return recordedIds;
                    }
                    return [];
                } catch (e) {
                    log(`[AuditEngine] ⚠️ Jurisprudence learning failed: ${e}`);
                    return [];
                }
            })()
        };
    } catch (error: any) {
        log(`[AuditEngine] âŒ Error en el proceso de auditorÃ­a: ${error.message} `);
        throw error;
    }
}

// ============================================================================
// FINALIZER: Freeze & Calculate KPIs (Deterministic)
// ============================================================================
export function finalizeAudit(result: any, totalCopagoReal: number = 0): any {
    const hallazgos = result.hallazgos || [];

    // 0. Detect Structural Opacity Parent to avoid double counting
    const hasCanonicalOpacity = hallazgos.some((h: any) => h.codigos === "OPACIDAD_ESTRUCTURAL");

    // 1. Freeze Categories
    const hallazgosFrozen = hallazgos.map((h: HallazgoInternal) => {
        let cat: HallazgoCategoria = "Z"; // Default indeterminate

        // Analyze Basis & Opacity
        const isOpacityParent = h.codigos === "OPACIDAD_ESTRUCTURAL";
        const isGenericMaterialOrMed = (h.glosa && /MATERIAL|INSUMO|MEDICAMENTO|FARMAC/i.test(h.glosa));

        // Logic: If we have the Canonical Parent, then any other generic material/med finding is a "Child" 
        // that is technically subsumed by the structural opacity. We mark it so we don't double sum.
        // BUT: If the finding is explicitly CAT A (e.g. "Sin BonificaciÃ³n" or "Varios"), we DO NOT subsume it.
        const isExplicitA = h.categoria_final === "A" || h.tipo_monto === "COBRO_IMPROCEDENTE";

        if (hasCanonicalOpacity && isGenericMaterialOrMed && !isOpacityParent && !isExplicitA) {
            h.isSubsumed = true;
            cat = "B"; // It is still controversy, but won't be summed
        } else if (isOpacityParent) {
            cat = "B";
        } else if (h.categoria === "OPACIDAD") {
            // Fallback for legacy items if no canonical parent exists
            cat = "B";
        } else {
            // NUTRITION & OTHERS
            const isNutrition = h.codigos?.includes("3101306") || /ALIMENTA|NUTRICI/i.test(h.glosa || "");
            const isGap = h.codigos === "GAP_RECONCILIATION";

            if (isNutrition) {
                // Nutrition is A only if marked as MATCH_EXACTO
                if (h.anclajeJson?.includes("MATCH_EXACTO")) {
                    cat = "A";
                } else {
                    cat = "Z"; // Partial/No match -> Indeterminate
                }
            } else if (isGap) {
                cat = "Z"; // Gap is always Indeterminate until proven
            } else {
                // Default "Cobro Improcedente" (e.g. Pabellon, Dias Cama) -> A
                // Check if explicitly "COBRO_IMPROCEDENTE" and high confidence
                if (h.tipo_monto === "COBRO_IMPROCEDENTE" && h.nivel_confianza !== "BAJA") {
                    cat = "A";
                } else {
                    cat = "B";
                }
            }
        }

        // --- STRICT OVERRIDE FOR SUSPECTED PARTIAL MATCHES ---
        // If we have a finding that mentions "AlimentaciÃ³n" or "Sin BonificaciÃ³n" but was NOT marked as "A" above (Exact Match),
        // we force it to Z (Indeterminate) to avoid "Green" oscillation.
        if ((h.titulo?.includes("ALIMENTACION") || h.glosa?.includes("SIN BONIF")) && cat !== "A") {
            cat = "Z";
        }

        // Apply to object
        h.categoria_final = cat;

        // Update Legacy Labels for UI compatibility (until UI full rewrite)
        if (cat === "A") {
            h.tipo_monto = "COBRO_IMPROCEDENTE";
            h.estado_juridico = "CONFIRMADO_EXIGIBLE";
        } else if (cat === "B") {
            h.tipo_monto = "COPAGO_OPACO";
            h.estado_juridico = "EN_CONTROVERSIA";
        } else {
            h.tipo_monto = "COPAGO_OPACO"; // Grey area
            h.estado_juridico = "INDETERMINADO";
        }

        return h;
    });

    // 2. Compute KPI Totals (STRICT SINGLE SOURCE OF TRUTH)
    // Only sum what is in hallazgosFrozen. NO other inputs.
    const sumA = hallazgosFrozen
        .filter((h: any) => h.categoria_final === "A" && !h.isSubsumed)
        .reduce((acc: number, h: any) => acc + (h.montoObjetado || 0), 0);

    const sumB = hallazgosFrozen
        .filter((h: any) => h.categoria_final === "B" && !h.isSubsumed)
        .reduce((acc: number, h: any) => acc + (h.montoObjetado || 0), 0);

    const sumZ = hallazgosFrozen
        .filter((h: any) => h.categoria_final === "Z" && !h.isSubsumed)
        .reduce((acc: number, h: any) => acc + (h.montoObjetado || 0), 0);

    // 3. Update Result
    result.hallazgos = hallazgosFrozen;

    if (!result.resumenFinanciero) result.resumenFinanciero = {};

    const totalObjetado = sumA + sumB + sumZ;

    // Calculate Category OK (No Observado)
    // Formula: Cat OK = Copago Total - (Cat A + Cat B + Cat Z)
    let catOK = 0;
    if (totalCopagoReal > 0) {
        catOK = totalCopagoReal - totalObjetado;
        // Float safety (though we use integers for CLP usually)
        if (catOK < 0) catOK = 0; // Should not happen if logic is sound, but strict guard
    }

    // OVERWRITE KPIs
    result.resumenFinanciero.ahorro_confirmado = sumA; // Green Card (Cat A)
    result.resumenFinanciero.cobros_improcedentes_exigibles = sumA; // Sync

    result.resumenFinanciero.copagos_bajo_controversia = sumB; // Amber Card (Cat B)
    result.resumenFinanciero.monto_indeterminado = sumZ; // Grey Card (Cat Z)

    result.resumenFinanciero.monto_no_observado = catOK; // Blue/White Card (Cat OK)

    result.resumenFinanciero.totalCopagoObjetado = totalObjetado;
    result.resumenFinanciero.totalCopagoReal = totalCopagoReal; // The Canonical Total

    // Legacy support
    result.totalAhorroDetectado = sumA;

    // 6. Canonical Text Generation
    const locale = 'es-CL';
    const txtTotal = totalCopagoReal.toLocaleString(locale);
    const txtA = sumA.toLocaleString(locale);
    const txtB = sumB.toLocaleString(locale);
    const txtOK = catOK.toLocaleString(locale);
    const txtZ = sumZ.toLocaleString(locale);

    let canonicalText = `El copago total informado corresponde a $${txtTotal}.\nDe este monto:\n\n`;

    if (sumA > 0) canonicalText += `$${txtA} corresponden a cobros improcedentes.\n\n`;
    if (sumB > 0) canonicalText += `$${txtB} se encuentran en controversia por falta de desglose.\n\n`;
    if (catOK > 0) canonicalText += `$${txtOK} no presentan observaciones con la informaciÃ³n disponible.\n\n`;
    if (sumZ > 0) canonicalText += `$${txtZ} corresponden a montos indeterminados (sin informaciÃ³n suficiente).\n\n`;

    canonicalText += `La suma de todas las categorÃ­as coincide exactamente con el copago total.`;

    // --- UPDATED ARGUMENTATIVE LOGIC (FIX 7: Hybrid State & Non-Collapse Principle) ---
    // RULE_OPACIDAD_NO_COLAPSA: Opacity does not invalidate verified findings.

    let finalDecision = "AUDITABLE"; // Default

    // Logic for State Determination (Layered)
    const hasCatA = sumA > 0;
    const hasCatB = sumB > 0; // Controversy
    const hasCatZ = sumZ > 0; // Indeterminate
    const hasOpacity = hasCanonicalOpacity || hasCatZ || hasCatB;

    if (hasCatA && hasOpacity) {
        // MIXED STATE (The crucial missing state)
        if (hasCanonicalOpacity) {
            finalDecision = "DISCREPANCIA CON COBROS IMPROCEDENTES + OPACIDAD PARCIAL";
        } else {
            finalDecision = "DISCREPANCIA MIXTA (IMPROCEDENCIA + CONTROVERSIA)";
        }
    } else if (hasCatA) {
        finalDecision = "DISCREPANCIA POR COBROS IMPROCEDENTES";
    } else if (hasCanonicalOpacity || sumZ > (totalCopagoReal * 0.5)) {
        // Only Pure Opacity if NO Cat A
        finalDecision = "OPACIDAD ESTRUCTURAL (COPAGO INDETERMINADO)";
    } else if (sumB > 0) {
        finalDecision = "CONTROVERSIA POR FALTA DE DESGLOSE";
    } else if (catOK === totalCopagoReal && totalCopagoReal > 0) {
        finalDecision = "CORRECTO (VALIDADO)";
    } else if (totalCopagoReal === 0) {
        finalDecision = "SIN COPAGO INFORMADO";
    }

    if (!result.decisionGlobal) result.decisionGlobal = {};
    result.decisionGlobal.estado = finalDecision; // FORCE OVERRIDE
    result.decisionGlobal.fundamento = canonicalText;

    // --- MANDATORY LEGAL TEXT INJECTION (Point 8) ---
    // This overrides the 'legalContext' or 'explicaciones' to ensure the phrase is present.
    const MANDATORY_PHRASE = "La auditoría identifica partidas cuya procedencia o improcedencia puede determinarse con independencia de la opacidad documental existente, así como otras que requieren aclaración adicional. En consecuencia, la opacidad detectada es parcial y no invalida los hallazgos clínicos y normativos acreditados.";

    if (result.explicaciones) {
        // We append it to the 'conclusión' section of 'isapre' or 'clinica'
        if (result.explicaciones.isapre) {
            result.explicaciones.isapre += "\n\n" + MANDATORY_PHRASE;
        }
    }

    return result;
}

// ============================================================================
// HELPER: Subset-Sum for Nutrition (AlimentaciÃ³n) Reconciliation
// ============================================================================
export function reconcileNutritionCharges(cuenta: any, pam: any): any {
    // 1. Identify Target Amount (Code 3101306 or PRESTACIONES SIN BONIFICACIÃ“N)
    let targetAmount = 0;
    let pamItemName = "";

    if (pam && pam.folios) {
        for (const folio of pam.folios) {
            if (folio.desglosePorPrestador) {
                for (const prestador of folio.desglosePorPrestador) {
                    if (prestador.items) {
                        for (const item of prestador.items) {
                            const code = (item.codigo || "").toString();
                            const desc = (item.descripcion || "").toUpperCase();
                            const bonif = parseAmountCLP(item.bonificacion);

                            // Criteria: Code 3101306 OR (Bonif=0 AND Desc includes 'SIN BONI')
                            if (code.includes("3101306") || (bonif === 0 && desc.includes("SIN BONIFI"))) {
                                const val = parseAmountCLP(item.copago) || parseAmountCLP(item.valorTotal);
                                if (val > targetAmount) { // Take the largest/last just in case
                                    targetAmount = val;
                                    pamItemName = item.descripcion || "3101306 PRESTACIONES SIN BONIFICACION";
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (targetAmount === 0) return null; // No nutrition charge found in PAM

    // 2. Identify Candidates in Account (Greedy Filter)
    const candidates: any[] = [];
    const NUTRITION_KEYWORDS = ["ALMUERZO", "CENA", "DESAYUNO", "REGIMEN", "BANDEJA", "COLACTI", "COLACION", "LIQUIDO", "ONCE", "TRAMO"];

    if (cuenta && cuenta.sections) {
        cuenta.sections.forEach((sec: any) => {
            (sec.items ?? []).forEach((item: any) => {
                const desc = (item.description || "").toUpperCase();
                // Filter by keyword
                if (NUTRITION_KEYWORDS.some(k => desc.includes(k))) {
                    candidates.push({
                        description: item.description,
                        total: parseAmountCLP(item.total),
                        original: item
                    });
                }
            });
        });
    }

    // 3. Subset Sum Exact (Deterministic)
    const matchedSubset = subsetSumExact(targetAmount, candidates);

    return {
        targetFound: true,
        targetAmount,
        pamItemName,
        pamGlosa: pamItemName, // Fix 1.2: Alias for compatibility
        matchFound: matchedSubset !== null,
        items: matchedSubset || []
    };
}

function subsetSumExact(target: number, items: any[], maxNodes = 50000): any[] | null {
    const values = items.map(i => i.total);
    const sortedIndices = items.map((_, i) => i).sort((a, b) => items[b].total - items[a].total); // Sort indices by value desc

    let nodes = 0;

    function dfs(idx: number, currentSum: number, chosenIndices: number[]): number[] | null {
        nodes++;
        if (nodes > maxNodes) return null; // Time/Depth limit

        if (currentSum === target) return chosenIndices;
        if (currentSum > target) return null;
        if (idx >= sortedIndices.length) return null;

        const originalIdx = sortedIndices[idx];
        const val = items[originalIdx].total;

        // Option 1: Include item
        const withItem = dfs(idx + 1, currentSum + val, [...chosenIndices, originalIdx]);
        if (withItem) return withItem;

        // Option 2: Exclude item
        return dfs(idx + 1, currentSum, chosenIndices);
    }

    const resultIndices = dfs(0, 0, []);

    if (resultIndices) {
        return resultIndices.map(i => items[i]);
    }
    return null;
}

function traceGenericChargesTopK(cuenta: any, pam: any): string {
    const traceResults: string[] = [];

    // 1. Identify "Generic/Adjustments" in Account
    // Strategy: Look for specific codes or keywords in Description (Regex Robustness)
    const adjustments: any[] = [];
    const REGEX_GENERIC = /(ajuste|vario|diferencia|suministro|cargo admin|otros|insumos)/i;
    const REGEX_CODES = /^(14|02|99)\d+/;

    const sections = cuenta.sections ?? [];
    if (sections.length === 0) {
        return "No se detectaron secciones en cuenta para trazar (Cuenta vacÃ­a o no estructurada).";
    }

    sections.forEach((sec: any) => {
        (sec.items ?? []).forEach((item: any) => {
            const desc = (item.description || "").toUpperCase();
            const code = (item.code || "").toString();

            const isKeyword = REGEX_GENERIC.test(desc);
            const isInternalCode = REGEX_CODES.test(code);
            const isSectionGeneric = /(varios|ajustes|exento|diferencias)/i.test(sec.category || "");

            const itemTotal = parseAmountCLP(item.total);
            const MIN_TRACE_AMOUNT = 1000;

            if ((isKeyword || isInternalCode || isSectionGeneric) && itemTotal >= MIN_TRACE_AMOUNT) {
                adjustments.push({ ...item, total: itemTotal });
            }
        });
    });

    if (adjustments.length === 0) return "No se detectaron cargos genÃ©ricos relevantes para trazar (Clean Bill).";

    // 2. Identify Candidates in PAM (Bonified Items)
    // We look for any PAM item that might explain the adjustment.
    const pamItems: any[] = [];
    pam.folios?.forEach((f: any) => {
        f.desglosePorPrestador?.forEach((d: any) => {
            d.items?.forEach((i: any) => {
                pamItems.push({
                    ...i,
                    amount: parseAmountCLP(i.bonificacion)
                });
            });
        });
    });

    // 3. Top-K Matching Logic
    adjustments.forEach(adj => {
        const target = adj.total;
        let matchFound = false;

        // A. Direct Match (Target == PAM_Item Â± Tolerance)
        const directMatch = pamItems.find(p => Math.abs(p.amount - target) <= 1000);
        if (directMatch) {
            traceResults.push(`- AJUSTE '${adj.description}'($${target}) COINCIDE con Ã­tem PAM '${directMatch.descripcion}'($${directMatch.amount}).ESTATUS: TRACEADO(No oculto).`);
            matchFound = true;
        }

        // B. Component Sum (Target == Sum(Subset of PAM) Â± Tolerance)
        // Heuristic: Try to sum top 5 largest PAM items that are smaller than target
        if (!matchFound) {
            // Simple greedy approach for demo (User asked for Top-K or pragmatism)
            // Real subset sum is hard, let's check if it matches the sum of a specific group?
            // Or check if the adjustment equals TotalBonification of a Folio?
            // That's a common pattern: Adjustment = Total Bonified of Folio X.

            // Check against Folio Totals
            const folioMatch = pam.folios?.find((f: any) => {
                // Calculate folio total bonification
                let totalB = 0;
                f.desglosePorPrestador?.forEach((d: any) => d.items?.forEach((i: any) => {
                    totalB += parseAmountCLP(i.bonificacion) || 0;
                }));
                return Math.abs(totalB - target) <= 2000;
            });

            if (folioMatch) {
                traceResults.push(`- AJUSTE '${adj.description}'($${target}) COINCIDE con BonificaciÃ³n Total del Folio ${folioMatch.folioPAM}.ESTATUS: TRACEADO(Agrupado).`);
                matchFound = true;
            }
        }

        if (!matchFound) {
            traceResults.push(`- AJUSTE '${adj.description}'($${target}) NO TIENE CORRELACIÃ“N aritmÃ©tica evidente en PAM.ESTATUS: NO_TRAZABLE(requiere aclaraciÃ³n: Â¿fuera del PAM o absorbido en agrupadores ?).`);
        }
    });

    return traceResults.join('\n');
}

// ============================================================================
// HELPER: Post-Validate LLM Response (The "Safety Belt")
// ============================================================================
// ============================================================================
// HELPER: Post-Validate LLM Response (The "Safety Belt" - Cross-Validation v9)
// ============================================================================
function postValidateLlmResponse(resultRaw: any, eventos: any[], cuentaContext: any, pamContext: any, reconstructibility?: any): any {
    const validatedResult = { ...resultRaw };
    let hasStructuralOpacity = false;


    // 1. Table VIII Enforcement & Hallmark Check (Cross-Validation v9)
    if (validatedResult.hallazgos) {
        validatedResult.hallazgos = validatedResult.hallazgos.filter((h: any) => {
            // Skip logic for "ACEPTAR" findings
            const isImpugnar = h.hallazgo?.toUpperCase().includes("IMPUGNAR") || (h.montoObjetado || 0) > 0;

            if (isImpugnar) {
                // Check for Table VIII presence (Strict)
                const hasTableCheck = h.hallazgo?.includes("|") && h.hallazgo?.includes("---");

                // CRITICAL BLOQUEO v9: Si es genÃ©rico/opacidad Y no tiene tabla de traza -> BLOQUEAR (ELIMINAR)
                const isGenericOrOpacidad = h.categoria === "OPACIDAD" || /GENERICO|GEN[EÃ‰]RICO|AGRUPADOR/i.test(h.glosa || "");

                if (isGenericOrOpacidad && !hasTableCheck) {
                    console.log(`[Cross - Validation v9] ðŸ›¡ï¸ DEGRADANDO hallazgo: ${h.titulo} (Falta Tabla VIII)`);
                    h.recomendacion_accion = "SOLICITAR_ACLARACION";
                    h.nivel_confianza = "BAJA";
                    h.motivo_degradacion = "SIN_TRAZABILIDAD";
                    h.tipo_monto = "COPAGO_OPACO";
                    // Keep the finding but mark it as degraded
                }

                // Check for "Hallucinated" High Value Objections
                // If finding > $1M and no specific code provided -> BLOCK
                if ((h.montoObjetado || 0) > 1000000 && (!h.codigos || h.codigos === "SIN-CODIGO")) {
                    console.log(`[Cross - Validation v9] ðŸ›¡ï¸ BLOQUEADO hallazgo de alto valor sin cÃ³digo: ${h.titulo} `);
                    return false;
                }
            }

            // DETECTOR DE OPACIDAD ESTRUCTURAL (Detect Global Z, but respect Local A)
            // Use the authoritative classifier first
            const determinedCat = classifyFinding(h);

            // If the classifier says "A", we respect it absolutely (Non-Collapse Rule)
            if (determinedCat === "A") {
                h.categoria_final = "A";
                h.tipo_monto = "COBRO_IMPROCEDENTE";
                h.estado_juridico = "CONFIRMADO_EXIGIBLE";
                if (!h.recomendacion_accion) h.recomendacion_accion = "IMPUGNAR";
                console.log(`[Safety Belt] Finding '${h.titulo}' classified as A (Improcedente).`);
                return true; // Keep it
            }

            // If not A, checked for B/Z
            const isOpacidad = h.categoria === "OPACIDAD" ||
                (h.glosa && /MATERIAL|INSUMO|MEDICAMENTO|FARMACO|VARIOS/i.test(h.glosa) && /DESGLOSE|OPACIDAD/i.test(h.hallazgo || ""));

            if (isOpacidad) {
                // CRC LOGIC: Check Reconstructibility
                if (reconstructibility?.isReconstructible) {
                    h.categoria_final = "B"; // Downgrade to B (Controversy)
                    h.estado_juridico = "EN_CONTROVERSIA";
                    h.recomendacion_accion = "SOLICITAR_ACLARACION";

                    // ARGUMENTATIVE REWRITE (CONTRACT BREACH)
                    h.titulo = "INCUMPLIMIENTO CONTRACTUAL (COBERTURA 100% DESCONOCIDA)";
                    h.glosa = "RECHAZO DE COBERTURA SIN CAUSA LEGAL";

                    const reason = reconstructibility.reasoning?.[0] || "Contrato con cobertura integral.";

                    h.hallazgo = `**I. Incumplimiento Contractual Detectado**
El contrato de salud vigente establece una cobertura del 100% (o PAD/Integral) para los ítems de hospitalización, medicamentos y materiales.

**II. Hecho Constitutivo de Infracción**
La Isapre ha aplicado una bonificación de $0 (o parcial) a ítems de 'Materiales/Medicamentos' ($${h.montoObjetado?.toLocaleString('es-CL')}) sin acreditar el agotamiento del tope ni la exclusión contractual específica.

**III. Vicio de Legalidad**
Esta conducta no es una mera 'falta de información' (Opacidad), sino una ejecución contractual incorrecta. Al existir un mandato de cobertura integral, la carga de la prueba para no cubrir recae en la aseguradora. Cobrar este monto al afiliado vulnera el principio de literalidad del contrato.

**IV. Solicitud Específica**
Se exige la cobertura inmediata del 100% pactado o la exhibición de la cláusula de exclusión específica para estos insumos exactos.`;

                    // Do NOT set hasStructuralOpacity=true, to prevent Global Z Escalation
                    console.log(`[CRC] Finding '${h.titulo}' rewritten to Breach of Contract.`);
                } else {
                    h.categoria_final = "Z"; // Opacidad always Z if not reconstructible
                    h.estado_juridico = "INDETERMINADO";
                    hasStructuralOpacity = true; // Escalates to Global Z
                }
            } else {
                h.categoria_final = "B"; // Default
            }

            if (isOpacidad && !reconstructibility?.isReconstructible) {
                hasStructuralOpacity = true;
            }

            return true;
        });
    }

    // --- ARQUITECTURA DE DECISIÃ“N: RECALCULO DE TOTALES (Anti-Sumas Fantasmas) ---
    if (validatedResult.hallazgos) {
        let sumA = 0; // COBRO_IMPROCEDENTE
        let sumB = 0; // COPAGO_OPACO

        validatedResult.hallazgos.forEach((h: any) => {
            const monto = Number(h.montoObjetado || 0);

            // Use deterministic classifier
            const category = classifyFinding(h);

            // ðŸš¨ NUCLEAR RULE: If OPACIDAD exists, GAP cannot be ahorro (it's indeterminate)
            const isGapInOpacityContext = hasStructuralOpacity &&
                (h.codigos === "GAP_RECONCILIATION" || h.anclajeJson?.includes("PAM_AUTO_DETECT"));

            if (category === "B" || isGapInOpacityContext) {
                h.tipo_monto = "COPAGO_OPACO";
                // Action Rule for Cat B
                if (h.recomendacion_accion !== "SOLICITAR_ACLARACION") {
                    h.recomendacion_accion = "SOLICITAR_ACLARACION";
                }
                sumB += monto;
            } else {
                h.tipo_monto = "COBRO_IMPROCEDENTE";
                // Action Rule for Cat A
                if (h.nivel_confianza !== "BAJA") {
                    h.recomendacion_accion = "IMPUGNAR";
                }
                sumA += monto;
            }
        });

        // Fix 2.2: REMOVED Sum Recalculation here. 
        // "Single Source of Truth" principle -> handled by computeBalanceWithHypotheses/AlphaFold only.
        /*
        if (validatedResult.resumenFinanciero) {
            validatedResult.resumenFinanciero.cobros_improcedentes_exigibles = sumA;
            validatedResult.resumenFinanciero.copagos_bajo_controversia = sumB;
            validatedResult.resumenFinanciero.ahorro_confirmado = sumA;
            validatedResult.resumenFinanciero.totalCopagoObjetado = sumA + sumB;
        }
        */
    }


    // --- NUTRITION RECONCILIATION (ALIMENTACIÃ“N CHECK) ---
    // Runs before final output to verify 3101306 findings
    try {
        if (cuentaContext && pamContext) {
            const nutritionCheck = reconcileNutritionCharges(cuentaContext, pamContext);

            if (nutritionCheck && nutritionCheck.targetFound) {
                // Check if there is an existing "AlimentaciÃ³n" finding
                const nutriFindingIndex = validatedResult.hallazgos.findIndex((h: any) =>
                    (h.codigos && h.codigos.includes("3101306")) ||
                    (h.glosa && /ALIMENTA|NUTRICI/i.test(h.glosa))
                );

                if (nutritionCheck.matchFound) {
                    // EXACT MATCH LOGIC

                    // We need to check if the targetAmount found in PAM is EXACTLY matching the Finding Amount.
                    // Often the LLM creates a finding for the whole "PRESTACIONES SIN BONIFICACION" line ($66.752).
                    // But nutrition match is only $51.356. 
                    // Case A: Perfect Match ($51.356 vs $51.356) -> Cat A.
                    // Case B: Partial ($66.752 vs $51.356) -> Cat Z (Conservative).

                    // Logic: Search for the finding that matches the PAM Line
                    // 2) Patch: "SIN BONIFICACION" context-aware
                    const textToCheck = (nutritionCheck.pamItemName || "") + " " + (nutritionCheck.pamGlosa || "");
                    const isSinBonif = /SIN BONIFI/.test(textToCheck);

                    const isHoteleria = /ALMUERZO|CENA|DESAYUNO|PAÃ‘O|TOALLA|KIT|ASEO|HOTELERIA|ALIMENTA/i.test(textToCheck);

                    // Defaults for classification if matched

                    const targetFindingIndex = validatedResult.hallazgos.findIndex((h: any) =>
                        (h.montoObjetado === nutritionCheck.targetAmount) ||
                        (h.glosa && h.glosa.includes("SIN BONIF") && Math.abs(h.montoObjetado - nutritionCheck.targetAmount) < 20000)
                    );

                    if (targetFindingIndex >= 0) {
                        const existingFinding = validatedResult.hallazgos[targetFindingIndex];
                        const diff = Math.abs(existingFinding.montoObjetado - nutritionCheck.targetAmount);

                        if (diff < 20) {
                            // EXACT MATCH CONFIRMED
                            console.log(`[AuditEngine] ðŸŽ ALIMENTACION: Match Exacto Confirmado. Elevando a Cat A.`);
                            existingFinding.categoria_final = "A"; // Pre-seed for finalizeAudit
                            existingFinding.anclajeJson = "MATCH_EXACTO_SUBSET_SUM";
                            existingFinding.nivel_confianza = "ALTA";
                            existingFinding.hallazgo = `**I. Trazabilidad Exacta (Confirmada)**\nSe ha verificado matemÃ¡ticamente que el cobro de $${existingFinding.montoObjetado.toLocaleString('es-CL')} corresponde exactamente a la suma de Ã­tems de alimentaciÃ³n (Almuerzos, Colaciones, etc.) presentes en la cuenta clÃ­nica.\n\nEste cobro duplica la cobertura de hotelerÃ­a incluida en el DÃ­a Cama.`;
                        } else {
                            // PARTIAL / MISMATCH -> CONSERVATIVE Z
                            console.log(`[AuditEngine] ðŸŽ ALIMENTACION: Match Parcial (${nutritionCheck.targetAmount} vs ${existingFinding.montoObjetado}). Dejando en Cat Z.`);
                            existingFinding.categoria_final = "Z";
                            existingFinding.anclajeJson = "MATCH_PARCIAL_SOLO_ALIMENTACION";
                            existingFinding.nivel_confianza = "MEDIA";
                            existingFinding.hallazgo = `**I. IndeterminaciÃ³n de Trazabilidad**\nEl monto cobrado ($${existingFinding.montoObjetado.toLocaleString('es-CL')}) NO CALZA exactamente con la suma de alimentaciÃ³n ($${nutritionCheck.targetAmount.toLocaleString('es-CL')}).\n\nExiste un diferencial no explicado que impide confirmar la naturaleza total del cobro. Se requiere desglose.`;
                        }
                    }
                } else {
                    // NO MATCH: Downgrade logic
                    console.log(`[AuditEngine] ðŸŽ ALIMENTACION: NO cuadra (Target $${nutritionCheck.targetAmount}). Downgrading...`);

                    if (nutriFindingIndex >= 0) {
                        const h = validatedResult.hallazgos[nutriFindingIndex];
                        h.tipo_monto = "COPAGO_OPACO";
                        h.recomendacion_accion = "SOLICITAR_ACLARACION";
                        h.nivel_confianza = "MEDIA";
                        h.hallazgo = `** IndeterminaciÃ³n de Trazabilidad **\nSi bien existe el cargo '${nutritionCheck.pamItemName}' ($${nutritionCheck.targetAmount}) en el PAM, la suma de los Ã­tems de alimentaciÃ³n en la cuenta NO CALZA con este monto.\n\nSe requiere desglose exacto para confirmar si corresponde a alimentaciÃ³n del paciente (duplicidad) o a otro concepto.`;
                        h.estado_juridico = "EN_CONTROVERSIA";
                    }
                    // If no finding existed, we do nothing (we don't create false alarms for stuff not found)
                }
            }
        }
    } catch (e) {
        console.log(`[AuditEngine] âš ï¸ Error en reconciliaciÃ³n nutricional: ${e}`);
    }


    // --- CANONICAL OPACITY OVERRIDE (HARD RULE) ---
    if (hasStructuralOpacity) {
        console.log('[AuditEngine] ðŸ›¡ï¸ DETECTADA OPACIDAD ESTRUCTURAL. Aplicando Regla CanÃ³nica de IndeterminaciÃ³n.');

        // ðŸš¨ INJECT FIXED HALLAZGO: Canonical "OPACIDAD_ESTRUCTURAL"
        validatedResult.hallazgos = validatedResult.hallazgos ?? [];
        const existsOpacidadHallazgo = validatedResult.hallazgos.some((h: any) => h.codigos === "OPACIDAD_ESTRUCTURAL");
        if (!existsOpacidadHallazgo) {
            // Fix 5: Calculate Opacity Amount from Source (PAM Items), not unreliable KPI
            let montoOpacoReal = 0;
            if (pamContext && pamContext.folios) {
                pamContext.folios.forEach((f: any) => f.desglosePorPrestador?.forEach((p: any) => p.items?.forEach((i: any) => {
                    const desc = (i.descripcion || "").toUpperCase();
                    const code = (i.codigo || "").toString();
                    if (/310130.?(1|2|3|4)|3101104|3101002/.test(code) || (/MATERIAL|MEDICAMENTO|INSUMO/.test(desc) && !/DETALLE/.test(desc))) {
                        montoOpacoReal += parseAmountCLP(i.copago);
                    }
                })));
            }
            // Fallback if extraction fails
            if (montoOpacoReal === 0) montoOpacoReal = validatedResult.resumenFinanciero?.copagos_bajo_controversia || 0;

            validatedResult.hallazgos.unshift({
                codigos: "OPACIDAD_ESTRUCTURAL",
                titulo: "OPACIDAD EN DOCUMENTO DE COBRO (PAM) â€“ COPAGO NO VERIFICABLE",
                glosa: "MATERIALES/MEDICAMENTOS SIN APERTURA",
                categoria: "OPACIDAD",
                tipo_monto: "COPAGO_OPACO",
                montoObjetado: montoOpacoReal,
                recomendacion_accion: "SOLICITAR_ACLARACION",
                nivel_confianza: "ALTA",
                hallazgo: `**I. IdentificaciÃ³n del problema**
En el PAM del evento quirÃºrgico se presentan las siguientes lÃ­neas consolidadas, sin apertura de componentes:

- MATERIALES CLÃNICOS QUIRÃšRGICOS (GC 3101304)
- MEDICAMENTOS HOSPITALIZADOS (GC 3101302)

    Total copago asociado a lÃ­neas no desglosadas: **$${montoOpacoReal.toLocaleString('es-CL')}**.

**II. Contexto clÃ­nico y administrativo**
El evento corresponde a una hospitalizaciÃ³n quirÃºrgica de alta complejidad. Si bien la cuenta clÃ­nica interna del prestador contiene mÃºltiples Ã­tems detallados, el documento de cobro y liquidaciÃ³n (PAM) â€”que es el instrumento que determina el copago exigido al afiliadoâ€” agrupa dichos conceptos en glosas genÃ©ricas, impidiendo su auditorÃ­a directa.

**III. Norma aplicable**
- **Ley 20.584**, derecho del paciente a recibir informaciÃ³n clara, comprensible y detallada sobre las prestaciones y sus cobros.
- Principios de transparencia y trazabilidad exigidos por la Superintendencia de Salud en procesos de liquidaciÃ³n.

**IV. Forma en que se configura la controversia**
La ausencia de desglose en el PAM impide verificar, desde el propio documento de pago:
1. La correcta aplicaciÃ³n de topes contractuales.
2. La exclusiÃ³n de Ã­tems no clÃ­nicos (hotelerÃ­a, confort).
3. La no duplicidad con prestaciones integrales ya bonificadas (dÃ­a cama, derecho de pabellÃ³n).

**V. AnÃ¡lisis tÃ©cnico-contractual**
Desde un punto de vista de auditorÃ­a, el copago asociado a estas lÃ­neas no es verificable en el PAM, por lo que no puede considerarse plenamente exigible mientras no se entregue un desglose verificable y trazable en el documento de liquidaciÃ³n o en un anexo formal validado por la aseguradora.

**VI. Efecto econÃ³mico**
El afiliado asume un copago de **$${montoOpacoReal.toLocaleString('es-CL')}** cuya composición no puede ser auditada desde el PAM.

**VII. ConclusiÃ³n**
Se solicita aclaraciÃ³n formal y reliquidaciÃ³n, mediante entrega de desglose completo de materiales y medicamentos en el PAM o documento equivalente, que permita validar cobertura, exclusiones y topes contractuales.`,
                anclajeJson: "PAM/CUENTA: LINEAS AGRUPADAS",
                estado_juridico: "EN_CONTROVERSIA",
                scope: { type: 'GLOBAL' } // Opacity infects everything unless we identify specific lines (TODO: pass specific lines)
            });
            console.log(`[AuditEngine] ðŸ”§ Hallazgo canÃ³nico "OPACIDAD_ESTRUCTURAL" inyectado (${montoOpacoReal} CLP).`);
        }

        // ðŸš¨ CRITICAL FIX: DO NOT BLINDLY SUBSUME EVERYTHING
        // Some items are NOT subsumed by Opacity (e.g. explicitly unjustified charges, double billing).
        // We must ensure they remain visible in their own category if they are strong.

        // 1. Force Global Status
        if (!validatedResult.decisionGlobal) validatedResult.decisionGlobal = {};
        validatedResult.decisionGlobal.estado = "COPAGO_INDETERMINADO_POR_OPACIDAD";
        validatedResult.decisionGlobal.fundamento = "La auditorÃ­a no puede validar el copago debido a una opacidad estructural en Ã­tems genÃ©ricos (Materiales/Medicamentos) sin desglose que vulnera la Ley 20.584.";

        // 2. Force Financial Summary
        if (!validatedResult.resumenFinanciero) validatedResult.resumenFinanciero = {};
        validatedResult.resumenFinanciero.estado_copago = "INDETERMINADO_POR_OPACIDAD";
        validatedResult.resumenFinanciero.totalCopagoLegitimo = 0; // Cannot act as legitimizer
        validatedResult.resumenFinanciero.analisisGap = "No aplicable por indeterminaciÃ³n del copago.";

        // 3. Mark findings as controversial BUT RESPECT CAT A
        if (validatedResult.hallazgos) {
            validatedResult.hallazgos.forEach((h: any) => {
                // If the finding was marked as "COBRO_IMPROCEDENTE" (Cat A) by the classifier or LLM, 
                // and it is NOT the structural opacity itself, we KEEP IT as Confirmed if it has High Confidence.
                const isCatA = h.tipo_monto === "COBRO_IMPROCEDENTE" || h.categoria === "A";
                const isHighConfidence = h.nivel_confianza === "ALTA";
                const isTheOpacityFinding = h.codigos === "OPACIDAD_ESTRUCTURAL";

                // Fix 2.3: Traceability Check for Cat A in Opacity
                // Must have strong anchor or evidence refs
                const hasTraceability = (h.anclajeJson && h.anclajeJson.length > 5) || (h.evidenceRefs && h.evidenceRefs.length > 0);

                if (isCatA && isHighConfidence && !isTheOpacityFinding && hasTraceability) {
                    // KEEP AS CAT A (Do not downgrade to Controversy)
                    h.estado_juridico = "CONFIRMADO_EXIGIBLE";
                    console.log(`[AuditEngine] ðŸ›¡ï¸ Hallazgo Cat A PRESERVADO pese a Opacidad (Trazable): ${h.titulo}`);
                } else if (h.tipo_monto === 'COPAGO_OPACO') {
                    h.estado_juridico = "EN_CONTROVERSIA";
                }
            });
        }
    }

    // Ensure totalAhorroDetectado for UI compatibility matches ahorro_confirmado
    validatedResult.totalAhorroDetectado = validatedResult.resumenFinanciero?.ahorro_confirmado || 0;

    return validatedResult;
}
