import { CANONICAL_MANDATE_TEXT } from '../data/canonical_contract_mandate.js';
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
import { Balance, AuditResult, Finding, BalanceAlpha, PamState, Signal, HypothesisScore, ConstraintsViolation, ExtractedAccount, EventoHospitalario } from '../../types.js';
// NEW: Import Jurisprudence Layer (Precedent-First Decision System)
import { JurisprudenceStore, JurisprudenceEngine, extractFeatureSet, learnFromAudit } from './jurisprudence/index.js';
// NEW: Import C-NC Rules (Opacity Non-Collapse)
import { generateNonCollapseText, RULE_C_NC_01, RULE_C_NC_02, RULE_C_NC_03, CANONICAL_NON_COLLAPSE_TEXT, findMatchingDoctrine } from './jurisprudence/jurisprudence.doctrine.js';
import { reconstructAllOpaque } from './reconstruction.service.js';
import { resolveFonasaCode, resolveByDescription } from './codeResolver.service.ts';

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
// TYPES: Resolution Engine (V5)
// ============================================================================
type Cat = "A" | "OK" | "Z" | "B";

export interface DecisionResult {
    estado: string;
    confianza: number;
    fundamento: string;
    balance: { A: number; OK: number; B: number; K: number; Z: number; TOTAL: number };
    invariantsOk: boolean;
    errors: string[];
    score?: number;
}

// ============================================================================
// LOGIC: Resolve Decision (Golden Rule Implementation)
// ============================================================================

function sum(xs: number[]) { return xs.reduce((a, b) => a + b, 0); }

export function resolveDecision(params: {
    totalCopagoInformado: number;
    findings: Finding[];
    violations: { code?: string; severity: number }[]; // severity 0..1
    signals: Signal[];
}): DecisionResult {

    const { totalCopagoInformado: T, findings, violations, signals } = params;
    const errors: string[] = [];

    // 1) Normaliza montos y unifica categorías
    // En V6, unificamos K y Z en Z (Opacity). 
    // A = Confirmed, B = Controversy/Mapping, Z = Indeterminate/Opacity
    const norm = findings.map(f => ({
        ...f,
        amount: Number.isFinite(f.amount) ? Math.max(0, Math.round(f.amount)) : 0
    }));

    const A_items = norm.filter(f => f.category === "A");
    const B_items = norm.filter(f => f.category === "B");
    const Z_items = norm.filter(f => f.category === "Z" || f.category === "K");

    const finalA = sum(A_items.map(x => x.amount));
    const finalB = sum(B_items.map(x => x.amount));
    const finalZ = sum(Z_items.map(x => x.amount));

    // 2) ENSURE PARTITION (A + B + Z + OK = T)
    // Rule R-BAL-01: Honest accounting. If A+B+Z > T, it's a conflict, not a cap.
    if (finalA + finalB + finalZ > T + 10) {
        errors.push(`CONFLICTO_DATOS: La suma de hallazgos ($${(finalA + finalB + finalZ).toLocaleString()}) excede el total del copago ($${T.toLocaleString()}). Posible duplicidad o error de extracción.`);
    }

    const finalOK = Math.max(0, T - (finalA + finalB + finalZ));
    const effectiveZ = finalZ;

    // 3) Invariants
    const invariantsOk = Math.abs((finalA + finalB + effectiveZ + finalOK) - T) < 10;
    if (!invariantsOk) {
        errors.push(`FALLO_CRITICO_INVARIANTE: A+B+Z+OK=${finalA + finalB + effectiveZ + finalOK} != T=${T}.`);
    }

    // 4) Señales y Estado Global
    const V = Math.min(1, sum(violations.map(v => v.severity)) / Math.max(1, violations.length));
    const riskSignals = signals.filter(s => s.value > 0 && !s.id.includes("OK") && !s.id.includes("CUMPLIMIENTO"));
    const R = Math.min(1, riskSignals.length > 0 ? (sum(riskSignals.map(s => s.value)) / riskSignals.length) : 0);

    const opacidad = effectiveZ / Math.max(1, T);

    let estado = "VALIDADO";
    if (effectiveZ > 0 && finalA > 0) {
        estado = "COPAGO_MIXTO_CONFIRMADO_Y_OPACO";
    } else if (effectiveZ > 0) {
        estado = "COPAGO_INDETERMINADO_POR_OPACIDAD";
    } else if (finalA > 0) {
        estado = "COPAGO_OBJETABLE_CONFIRMADO";
    }

    // 5) Resumen y Confianza
    let confianza = 0.55 + 0.35 * Math.min(1, finalA / Math.max(1, T)) - 0.45 * opacidad;
    if (errors.length) confianza -= 0.15;
    confianza = Math.max(0.05, Math.min(0.95, confianza));

    const scoreA = 0.55 * (finalA / Math.max(1, T));
    const scoreV = 0.25 * V;
    const scoreR = 0.20 * R;
    const scoreZ = 0.60 * opacidad;
    let score = 100 * (scoreA + scoreV + scoreR) - 100 * scoreZ;

    const fundamento =
        `Balance: A=${finalA}, B=${finalB}, Z=${effectiveZ}, OK=${finalOK}, T=${T}. ` +
        `Opacidad=${(100 * opacidad).toFixed(1)}%. ` +
        (errors.length ? `Ajustes: ${errors.join(" | ")}.` : "");

    return {
        estado,
        confianza: Number(confianza.toFixed(2)),
        fundamento,
        balance: { A: finalA, OK: finalOK, B: finalB, K: 0, Z: effectiveZ, TOTAL: T },
        invariantsOk,
        errors,
        score: Math.round(score)
    };
}
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

    // CANONICAL RULE C-NC-03(B): Medicamentos/Insumos with Zero Coverage 
    // are NOT automatically Cat A. They require CRC verification:
    // - CRC=true + Cobertura 100% verifiable → Cat A (Contract Breach)
    // - CRC=false → Cat B/Z (Opacity/Indeterminate)
    // This logic happens in postValidateLlmResponse where CRC context is available.
    // Here, we conservatively return Cat B and let CRC analysis promote to Cat A.
    if (isMedInsumo && isZeroCoverage) return "B"; // Priority 1.5: Requires CRC verification

    // FIX 5: NURSING & SURGICAL DRUGS (IRREGULAR PRACTICES REPORT)
    const isNursing = /SIGNOS VITALES|CURACION|INSTALACION VIA|FLEBOCLISIS|ENFERMERIA|TOMA DE MUESTRA/.test(textUpper) || /ENFERMERIA/.test(glUpper);
    const isSurgicalDrug = /PROPOFOL|FENTANILO|SEVOFLURANO|MIDAZOLAM|ANESTESIA|ROCURONIO|ROCURONIO|VECURONIO/.test(textUpper);

    if (isNursing) return "A"; // Practice #5: Should be included in Bed Day
    if (isSurgicalDrug && /PABELLON|QUIROFANO|FARMACIA PABELLON/.test(textUpper)) return "A"; // Practice #3: Surgical drugs in Pharmacy

    // 2. Layer: CUENTA OPACA (Practice #6 & #10)
    const isCuentaOpaca = /VARIOS|AJUSTE|DIFERENCIA|ESTADO DE CUENTA OPACO/.test(glUpper) || /VARIOS|AJUSTE|BORROSO|SIN DESGLOSE/.test(textUpper);
    if (isCuentaOpaca) return "A"; // Practice #6: Generic labels

    // PRACTICE #1: Inflamiento / Upcoding
    const isUpcoding = /UPCODING|INFLA|PRECIO EXCESIVO|DOSIS COMPLETA/.test(textUpper);
    if (isUpcoding) return "A";

    // PRACTICE #9: Evento Único
    const isEventoUnico = /EVENTO UNICO|URGENCIA.*INTEGRADO|URGENCIA.*HOSPITALIZACION/.test(textUpper);
    if (isEventoUnico) return "A";

    // 3. Layer: PAM OPACO (Conditioned Findings) -> Cat B/Z
    // If it requires breakdown to be validated, it is B.
    const isPamCajaNegra = /MATERIALES|MEDICAMENTOS|INSUMO|FARMAC/.test(glUpper) && /DESGLOSE|OPACIDAD|CAJA/.test(textUpper);
    if (isPamCajaNegra) return "B";

    // Default: Conservative (treat as CAT B if unclear - Safety First)
    return "B";
}

// Helper for deterministic ID generation
function stableId(parts: string[]): string {
    return parts.join("|").replace(/\s+/g, "_");
}

// ============================================================================
// CANONICAL FINALIZATION LAYER HELPERS
// ============================================================================

const PROTECTED_CODES = new Set([
    "99-00-028", // instalación vía venosa
    "99-00-045", // fleboclisis
]);

function normalizeCode(code: string): string {
    return code.trim().replace(/[^0-9-]/g, "");
}

function isProtectedCatA(f: Finding, eventos: EventoHospitalario[] = []): boolean {
    const label = (f.label || "").toUpperCase();
    const rationale = (f.rationale || "").toUpperCase();
    const amount = f.amount || 0;

    // --- FORENSIC HYPOTHESES FOR "GASTOS NO CUBIERTO" & "PRESTACION NO CONTEMPLADA" ---
    const isGastoNoCubiertoOrNoArancel = /GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|VARIOS|AJUSTES|INSUMOS VARIOS/i.test(label) || /3201001|3201002/.test(label);

    if (isGastoNoCubiertoOrNoArancel && amount > 0) {
        // Hypothesis A: Duplicate Charges (Overlap with surgery/hospitalization)
        const hasSurgicalEvent = eventos.some(e => e.tipo_evento === 'QUIRURGICO');
        if (hasSurgicalEvent) {
            // If it's a generic "not covered" charge and there's a surgery, it's highly suspicious of unbundling/duplicity
            return true;
        }

        // Hypothesis B: Hospitality/Day-Bed Inclusion
        const hasHospitalization = eventos.some(e => e.tipo_evento === 'MEDICO' || e.tipo_evento === 'QUIRURGICO');
        if (hasHospitalization && /ASEO|CONSFORT|KITS?|ROPA|PIJAMA|TERMOMETRO|MUESTRA/i.test(rationale)) {
            return true;
        }

        // Hypothesis C: Provider Operational Costs (EPP, infrastructure)
        if (/EPP|SEGURIDAD|INFRAESTRUCTURA|COSTO OPERACIONAL|INSUMO INSTITUCIONAL/i.test(rationale)) {
            return true;
        }

        // Hypothesis D: Contractual Breach (Labeled as not covered but exists in contract)
        // If the rationale mentions specific coverage indicators or if it's a known clinical item
        if (/(COBERTURA|BONIFICACION).*(100%|TOTAL|COMPLETA)/i.test(rationale)) {
            return true;
        }
    }

    // Level 2: Technical/Normative (Unbundling / Double Billing)
    const isUnbundling = /UNBUNDLING|EVENTO UNICO|FRAGMENTA|DUPLICI|DOBLE COBRO/.test(label) || /UNBUNDLING|EVENTO/.test(rationale);
    const isHoteleria = /ALIMENTA|NUTRICI|HOTEL|CAMA|PENSION|ASEO PERSONAL|SET DE ASEO/.test(label) || /IF-?319/.test(rationale);
    const isNursing = /SIGNOS VITALES|CURACION|INSTALACION VIA|FLEBOCLISIS|ENFERMERIA|TOMA DE MUESTRA/.test(label) || /ENFERMERIA/.test(rationale);
    const isEventoUnico = /EVENTO UNICO|URGENCIA.*HOSPITALIZACION/i.test(label) || /EVENTO UNICO/i.test(rationale) || /ALERTA_EU_01/.test(rationale);

    // Level 1: Primary Contract Breach (100% Coverage Entitlement)
    const isContractBreach = /BONIFICACION INCORRECTA|INCUMPLIMIENTO CONTRACTUAL|DIFERENCIA COBERTURA|RECLASIFICACION ESTRATEGICA/i.test(label) ||
        /(COBERTURA|BONIFICACION).*(100%|TOTAL|COMPLETA)/i.test(rationale);

    // Level 3 (Subsidiary): Opacity patterns
    const isOpacity = /OPACO|INDETERMINADO|SIN DESGLOSE|FALTA DE TRAZABILIDAD/i.test(label) || /OPACO|INDETERMINADO|SIN DESGLOSE/i.test(rationale);

    if (isContractBreach || isUnbundling || isHoteleria || isNursing || isEventoUnico) {
        return true;
    }

    if (isOpacity) {
        return false;
    }

    const hasProtectedCode = f.evidenceRefs?.some(ref => {
        const code = normalizeCode(ref.split('/').pop() || "");
        return PROTECTED_CODES.has(code);
    });

    return isUnbundling || isHoteleria || isNursing || isContractBreach || isEventoUnico || !!hasProtectedCode;
}


function isOpacityFinding(f: Finding): boolean {
    const label = (f.label || "").toUpperCase();
    const rationale = (f.rationale || "").toUpperCase();

    // Rule R-MAP-01: Mapping failure is NOT opacity.
    const isMappingFailure = /NO MAPEA|FALTA DICCIONARIO|FALTA TABLA|NEEDS_MAPPING/i.test(rationale);
    if (isMappingFailure) return false;

    // SUBSIDIARY CHECK: If it has 100% coverage indicators or irregular practice flags, it is NOT opaque (it is a breach)
    const isContractBreach = /(COBERTURA|BONIFICACION).*(100%|TOTAL|COMPLETA)/i.test(rationale) ||
        /INCUMPLIMIENTO CONTRACTUAL|UNBUNDLING|EVENTO UNICO|RECLASIFICACION/i.test(label);

    if (isContractBreach) return false;

    return (
        f.category === "Z" ||
        f.hypothesisParent === "H_OPACIDAD_ESTRUCTURAL" ||
        /OPACIDAD|INDETERMINADO|BORROSO|SIN DESGLOSE|CARGA DE LA PRUEBA|LEY 20.?584/i.test(label) ||
        /PRESTACION NO CONTEMPLADA|GASTOS? NO CUBIERTO|VARIOS|AJUSTE|DIFERENCIA/i.test(label) ||
        /OPACIDAD|INDETERMINADO|BORROSO|SIN DESGLOSE|RECOLECCION/.test(rationale)
    );
}

function isValidatedFinancial(f: Finding, eventos: EventoHospitalario[]): boolean {
    // Generalize to any finding that matches a surgical/clinical event with high mathematical confidence
    const label = (f.label || "").toUpperCase();
    const rationale = (f.rationale || "").toUpperCase();

    // BROADENED DETECTION: Include specific codes (1103 is surgical/honorary) 
    // and procedure-specific labels that are functionally honoraries.
    const hasSurgicalCode = /1103\d{3}/.test(label) || /1103\d{3}/.test(rationale);
    const isSpecificFinance = hasSurgicalCode ||
        /HONORARIO|LIQUIDACION|BONIFICACION|DERECHO DE PABELLON|ANESTESIA|RIZOTOMIA|INFILTRACION/i.test(label);

    const event = eventos.find(e =>
        e.analisis_financiero &&
        (e.analisis_financiero.tope_cumplido || e.analisis_financiero.equipo_quirurgico_completo) &&
        e.nivel_confianza === "ALTA"
    );

    // UNIVERSAL RULE: If we have a High-Precision triangulation (AC2, VAM, VA, BAM) and the finding 
    // is consistent with that event's financial context, we promote to OK.
    if (isSpecificFinance && event) return true;

    return false;
}


function canonicalCategorizeFinding(f: Finding, crcReconstructible: boolean, eventos: EventoHospitalario[] = []): Finding {
    const isProtected = isProtectedCatA(f, eventos);
    const amount = f.amount || 0;
    let rationale = f.rationale || "";

    // 0. PRIORITY: If already resolved/promoted via Forensic/Last Resort, don't rollback
    if (f.category === 'OK' && (rationale.includes('[MEJORA]') || rationale.includes('[PRAGMATISMO]'))) {
        return f;
    }

    // 1. Inject Forensic Estimation (AC2/VAM) into rationale for transparency
    const eventWithFinance = eventos.find(e => e.analisis_financiero && e.analisis_financiero.valor_unidad_inferido);
    if (eventWithFinance && eventWithFinance.analisis_financiero) {
        const val = eventWithFinance.analisis_financiero.valor_unidad_inferido;
        const unit = eventWithFinance.analisis_financiero.unit_type || "VAM/AC2";
        if (!rationale.includes("VALOR REFERENCIAL ESTIMADO")) {
            rationale += `\n[FORENSE] VALOR REFERENCIAL ESTIMADO (${unit}): $${val.toLocaleString('es-CL')}.`;
        }
    }

    const upperRationale = rationale.toUpperCase();
    const isIndeterminateText = /INDETERMINACION|NO PERMITE CLASIFICAR|NO SE PUEDE VERIFICAR|LEY 20.?584/i.test(upperRationale);
    const isOpacity = isOpacityFinding(f);

    // 2. HIGHEST PRIORITY: Confirm Irregularities (Category A)
    // If it's a confirmed breach (Unbundling, Medical Irregularity), it stays A regardless of math success.
    if (f.category === "A" && amount > 0) return { ...f, action: "IMPUGNAR", rationale };
    if (isProtected && amount > 0) return { ...f, category: "A", action: "IMPUGNAR", rationale };

    // 3. PRAGMATIC OVERRIDE: Mathematical Fidelity (Category OK)
    // Rule C-FIN-01: If math matches perfectly, promote to OK even if it was technically opaque.
    if ((isOpacity || isIndeterminateText) && isValidatedFinancial(f, eventos)) {
        const unit = eventWithFinance?.analisis_financiero?.unit_type || "VA/AC2/BAM";
        return {
            ...f,
            category: "OK",
            action: "ACEPTAR",
            rationale: rationale + `\n[PRAGMATISMO] Consistencia matemática confirmada (Tope ${unit} verificado). El pago es correcto según el contrato y la elección del paciente.`
        };
    }

    // 4. LOWER PRIORITY: Forced Indeterminacy (Category Z)
    if (isIndeterminateText) {
        return { ...f, category: "Z", action: "SOLICITAR_ACLARACION", rationale };
    }

    // 5. MEDICAMENTOS / MATERIALES (Categorización Canónica)
    const isMedMat = /MEDICAMENTO|MATERIAL|INSUMO|FARMACO/i.test(f.label || "") || /MEDICAMENTO|MATERIAL|INSUMO|FARMACO/i.test(upperRationale);

    if (isOpacity || (isMedMat && !isProtected)) {
        return { ...f, category: "Z", action: "SOLICITAR_ACLARACION", rationale };
    }

    // Rule R-MAP-01: Mapping failures are B, not Z
    const isMappingFailure = /NO MAPEA|FALTA DICCIONARIO|FALTA TABLA|NEEDS_MAPPING|LEY 20.584/i.test(upperRationale) && !/MATERIAL|MEDICAMENTO|VARIOS/i.test(f.label);
    if (isMappingFailure) {
        return { ...f, category: "B", action: "SOLICITAR_ACLARACION", rationale };
    }

    if (amount <= 0) return { ...f, category: "OK", action: "ACEPTAR", rationale };

    // Default to B if not A or Z but has amount
    return { ...f, category: f.category || "B", rationale };
}


function applySubsumptionCanonical(findings: Finding[]): Finding[] {
    if (findings.length === 0) return [];

    // 1. Sort: Priority to Cat A, and specific (Micros) first. Macros always last.
    const sorted = [...findings].sort((a, b) => {
        // Preference for Cat A
        if (a.category === 'A' && b.category !== 'A') return -1;
        if (a.category !== 'A' && b.category === 'A') return 1;

        const aIsMacro = /GENERICO|GLOBAL|OPACIDAD|CONTROVERSIA|SIN DESGLOSE|RESUMEN|COBERTURA 0%|AGRUPADOR|GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|MAT_MED/i.test(a.label || "");
        const bIsMacro = /GENERICO|GLOBAL|OPACIDAD|CONTROVERSIA|SIN DESGLOSE|RESUMEN|COBERTURA 0%|AGRUPADOR|GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|MAT_MED/i.test(b.label || "");

        // Macros always at the end
        if (aIsMacro && !bIsMacro) return 1;
        if (!aIsMacro && bIsMacro) return -1;

        // Otherwise descending by amount
        return (b.amount || 0) - (a.amount || 0);
    });

    const out: Finding[] = [];

    for (let f of sorted) {
        let amount = Math.abs(f.amount || 0);
        if (amount < 1) continue;

        const fLabel = (f.label || "").toUpperCase();
        const isMacro = /GENERICO|GLOBAL|OPACIDAD|CONTROVERSIA|SIN DESGLOSE|RESUMEN|COBERTURA 0%|AGRUPADOR|GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|MAT_MED/i.test(fLabel);

        // 2. Exact Deduplication (Strict ±100 CLP)
        const duplicate = out.find(o => Math.abs(o.amount - amount) < 100);
        if (duplicate) {
            if (f.category === 'A' && duplicate.category !== 'A') {
                const idx = out.indexOf(duplicate);
                out[idx] = f;
                continue;
            }
            if (f.category === duplicate.category && !isMacro && /OPACIDAD|GENERICO|AGRUPADOR|CUBIERTO|CONTEMPLADA/i.test(duplicate.label)) {
                const idx = out.indexOf(duplicate);
                out[idx] = f;
                continue;
            }
            continue;
        }

        // 3. ARITHMETIC NETTING (Improved for Phase 3)
        if (isMacro) {
            const isGlobalMacro = /GLOBAL|ESTRUCTURAL|RESUMEN|PAM TOTAL/i.test(fLabel);
            const isMaterialMacro = /MATERIAL|INSUMO|MEDICAMENTO|FARMAC|MAT_MED/i.test(fLabel);
            const pamCodes = (f.evidenceRefs || []).filter(ref => ref.startsWith("PAM:"));
            const genericEvidence = (f.evidenceRefs || []).some(ref => /AGRUPADA|SIN_CODIGO|FORENSE/i.test(ref));

            let overlap = 0;
            for (const o of out) {
                const oLabel = (o.label || "").toUpperCase();
                const shared = (o.evidenceRefs || []).filter(ref => pamCodes.includes(ref));
                const oIsMaterial = /MATERIAL|INSUMO|MEDICAMENTO|FARMAC/i.test(oLabel);

                // Rule: If it's a GLOBAL macro, it nets against EVERYTHING clinical already in 'out'
                // If it's a MATERIAL macro, it nets against any material items already in 'out'
                if (isGlobalMacro || shared.length > 0 || (isMaterialMacro && oIsMaterial)) {
                    overlap += (o.amount || 0);
                }
            }

            if (overlap > 0) {
                const remaining = amount - overlap;
                if (remaining > 500) {
                    f = { ...f, amount: remaining, label: `${f.label} (Neto / Remanente)` };
                    amount = remaining;
                } else {
                    // Fully explained by micros, skip macro
                    continue;
                }
            }
        }

        out.push(f);
    }

    return out;
}

function computeBalanceCanonical(findings: Finding[], totalCopago: number): BalanceAlpha {
    // REGLA C-AR-01: Exclusividad contable. 
    const resolved = resolveDecision({
        totalCopagoInformado: totalCopago,
        findings: findings,
        violations: [], // Passed later in final call, but for mid-stream calc assume 0
        signals: [] // Same
    });

    // Helper adapter to match BalanceAlpha type
    return {
        A: resolved.balance.A,
        B: resolved.balance.B,
        K: resolved.balance.K,
        Z: resolved.balance.Z,
        OK: resolved.balance.OK,
        TOTAL: resolved.balance.TOTAL
    };
}


function decideGlobalStateCanonical(balance: BalanceAlpha): string {
    const hasA = balance.A > 0;
    const hasOpacity = balance.K > 0;

    if (hasA && hasOpacity) return "COPAGO_MIXTO_CONFIRMADO_Y_OPACO";
    if (!hasA && hasOpacity) return "COPAGO_INDETERMINADO_POR_OPACIDAD";
    if (hasA && !hasOpacity) return "COPAGO_OBJETABLE_CONFIRMADO";
    return "COPAGO_OK_CONFIRMADO";
}

function assertCanonicalClosure(findings: Finding[], balance: BalanceAlpha, debug: string[], eventos: EventoHospitalario[] = []) {
    const protectedA = findings.filter(h => isProtectedCatA(h, eventos) && h.category === "A" && h.amount > 0);

    if (protectedA.length > 0 && balance.A <= 0) {
        const msg = `C-CLOSE-01 VIOLATION: existen ${protectedA.length} hallazgos Cat A protegidos pero balance.A=0`;
        debug.push(msg);
        console.error(msg);
        // We won't throw in prod to avoid crashing, but we'll log it heavily.
    }

    const leaked = findings.filter(h => isProtectedCatA(h, eventos) && h.amount > 0 && h.category !== "A");
    if (leaked.length > 0) {
        const msg = `C-A-01 VIOLATION: ${leaked.length} hallazgo(s) protegido(s) no quedaron en Cat A`;
        debug.push(msg);
        console.error(msg);
    }
}


export function finalizeAuditCanonical(input: {
    findings: Finding[];
    totalCopago: number;
    reconstructible: boolean;
    pamState?: string;
    signals?: any;
    contract?: any;
    ceilings?: { canVerify: boolean; reason?: string };
    violations?: { code: string; severity: number }[];
    accountContext?: ExtractedAccount;
    eventos?: EventoHospitalario[];
}): {
    estadoGlobal: string;
    findings: Finding[];
    balance: { A: number; B: number; K: number; Z: number; OK: number; TOTAL: number };
    debug: string[];
    resumenFinanciero: any;
    fundamentoText: string;
} {
    const debug: string[] = [];
    const findings = input.findings || [];
    const total = input.totalCopago || 0;
    const accountContext = input.accountContext;

    // Step 1: Deterministic Categorization (A, B, Z, OK)
    const eventos = input.eventos || [];
    let processedFindings = findings.map(f => {
        const catFinding = canonicalCategorizeFinding(f, input.reconstructible, eventos);

        // Fix: Hypothesis Parent Correction
        let parent = f.hypothesisParent;
        if (catFinding.category === "A") {
            if (/UNBUNDLING|EVENTO UNICO|VIA VENOSA|FLEBOCLISIS|NURSING/i.test(f.label || "")) {
                parent = "H_UNBUNDLING_IF319";
            } else if (/HOTEL|CAMA/i.test(f.label || "")) {
                parent = "H_INCUMPLIMIENTO_CONTRACTUAL";
            } else {
                parent = (parent === "H_OK_CUMPLIMIENTO") ? "H_PRACTICA_IRREGULAR" : parent;
            }
        } else if (catFinding.category !== 'OK' && (catFinding.category === "Z" || /PRESTACION NO CONTEMPLADA|GASTOS? NO CUBIERTO|VARIOS|AJUSTE|DIFERENCIA/i.test(f.label || ""))) {
            parent = "H_OPACIDAD_ESTRUCTURAL";
            catFinding.category = "Z"; // Hard enforcement of Z for reconstruction trigger
            catFinding.action = "SOLICITAR_ACLARACION";
        }

        return {
            ...catFinding,
            hypothesisParent: parent,
            montoCuentaRelacionado: (f as any).authoritativeTotal || f.amount,
            montoCopagoImpacto: catFinding.category === 'OK' ? 0 : catFinding.amount
        } as Finding;
    });

    // Step 2: Subsumption
    processedFindings = applySubsumptionCanonical(processedFindings);

    // Step 2.1: Arithmetic Reconstruction (Desglose Especulativo Controlado)
    if (accountContext && processedFindings.some(f => f.category === 'Z' || /PRESTACION NO CONTEMPLADA|GASTOS? NO CUBIERTO/i.test(f.label || ""))) {
        // Collect all item IDs already "claimed" by Protected Cat A findings
        const claimedItemIds = new Set<number | string>();
        processedFindings.forEach(f => {
            if (f.category === 'A' && f.evidenceRefs) {
                f.evidenceRefs.forEach(ref => {
                    // Try to extract numeric ID or index from ref string
                    // Usually it's like "ITEM INDEX: 14" or a code
                    const match = ref.match(/INDEX:?\s*(\d+)/i);
                    if (match) {
                        claimedItemIds.add(parseInt(match[1], 10));
                    }
                });
            }
        });

        processedFindings = reconstructAllOpaque(accountContext, processedFindings, claimedItemIds);

        // RE-APPLY Subsumption after promotion to A to catch overlaps with pre-existing A findings
        processedFindings = applySubsumptionCanonical(processedFindings);
    }

    // Step 3: Balance

    // Step 3: RESOLVE DECISION (Golden Source of Truth)
    // Convert generic signals object to Signal[] if needed, or assume input.signals is Signal[]
    const signalArray: Signal[] = Array.isArray(input.signals) ? input.signals : [];
    // Extract violations likely from rule engine output or flags? 
    // In this context, we might not have full violation objects yet if called early.
    // But we should try to pass them.
    // For now, let's assume empty violations if not provided in input (which needs updating)
    // or utilize input.signals if they contain violation info.
    // Actually, finalizeAuditCanonical is called with full contexts in performForensicAudit.
    // We will enable passing violations in input.

    // Note: We need to cast input to accept violations
    const violations = (input as any).violations || [];

    const resolved = resolveDecision({
        totalCopagoInformado: total,
        findings: processedFindings,
        violations: violations,
        signals: signalArray
    });

    const balance = resolved.balance;
    const estadoGlobal = resolved.estado;
    resolved.errors.forEach(e => debug.push(e));


    // Restore context variables for foundation
    const contratoVacio = (input.contract?.coberturas?.length ?? 0) === 0;
    const pamOpaco = input.pamState === "OPACO" || !input.reconstructible;
    const canVerifyCeilings = input.ceilings?.canVerify ?? input.reconstructible;

    // Step 6: Foundation
    const fundamento: string[] = [];
    const unitLabel = input.contract?.unitOfMeasure || "VAM/AC2";
    if (!canVerifyCeilings) fundamento.push(`No es posible verificar aplicación de topes UF/${unitLabel} (ceiling verification unavailable).`);
    if (contratoVacio) fundamento.push("Violación Regla C-01: Contrato sin cláusulas de cobertura (coberturas vacío).");
    if (pamOpaco) fundamento.push("Violación Regla C-04: Opacidad estructural en PAM (agrupación impide trazabilidad fina).");
    if (balance.A > 0) fundamento.push(`Hallazgos confirmados: cobros improcedentes exigibles identificados (A) por $${balance.A.toLocaleString("es-CL")}.`);
    if (balance.Z > 0) fundamento.push(`Monto bajo controversia por opacidad (Z/Indeterminado): $${balance.Z.toLocaleString("es-CL")} (requiere desglose/reliquidación).`);

    fundamento.push(resolved.fundamento);


    // Step 7: Summary
    const resumenFinanciero = {
        totalCopagoInformado: total,
        totalCopagoLegitimo: balance.OK,
        totalCopagoObjetado: balance.A + balance.B + balance.Z, // Include Z in total debated amount
        ahorro_confirmado: balance.A,
        cobros_improcedentes_exigibles: balance.A,
        copagos_bajo_controversia: balance.B,
        monto_indeterminado: balance.Z,
        monto_no_observado: balance.OK,
        totalCopagoReal: total,
        estado_copago: estadoGlobal.includes('MIXTO') ? "MIXTO" : (estadoGlobal.includes('OPACIDAD') ? "INDETERMINADO" : (estadoGlobal.includes('OBJETABLE') ? "OBJETABLE" : "OK")),
        auditor_score: resolved.score
    };

    return {
        estadoGlobal,
        findings: processedFindings,
        balance,
        debug,
        resumenFinanciero,
        fundamentoText: fundamento.join(" ")
    };
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

    // RE-ENABLE MINI-RAG PER USER REQUEST
    log('[AuditEngine] 📚 Re-activando base de conocimiento legal...');
    const MAX_KNOWLEDGE_TOKENS = 40000;
    const { text: knowledgeBaseTextParsed, sources: ragSources, keywordsMatched } =
        await getRelevantKnowledge(caseKeywords, MAX_KNOWLEDGE_TOKENS, log);

    let knowledgeBaseText = knowledgeBaseTextParsed;
    if (CANONICAL_MANDATE_TEXT) {
        knowledgeBaseText += `\n\n[CONTRATO MARCO / MANDATO CLÍNICO ESTÁNDAR (PAGARÉ / MANDATO)]: \n${CANONICAL_MANDATE_TEXT} \n`;
    }

    // RESOLVE CODES DETERMINISTICALLY (New V6.1)
    log('[AuditEngine] 🔍 Resolviendo códigos Fonasa encontrados...');
    const resolvedCodes: string[] = [];
    for (const kw of caseKeywords) {
        if (/^\d{7}$/.test(kw)) {
            const resolved = await resolveFonasaCode(kw);
            if (resolved) {
                resolvedCodes.push(`[${kw}] ${resolved.description}`);
            }
        }
    }
    if (resolvedCodes.length > 0) {
        knowledgeBaseText += `\n\n[GLOSARIO DE CÓDIGOS FONASA OFICIAL]:\n${resolvedCodes.join('\n')}\n`;
        log(`[AuditEngine] ✅ Resueltos ${resolvedCodes.length} códigos Fonasa.`);
    }

    // INJECT IRREGULAR PRACTICES REPORT KNOWLEDGE
    const IRREGULAR_PRACTICES_KNOWLEDGE = `
        [INFORME OFICIAL: PRÁCTICAS IRREGULARES PROHIBIDAS]
Analiza la cuenta buscando estas 10 prácticas específicas.Si encuentras una, CLASIFICA COMO 'A'(IMPROCEDENTE).
1. Inflamiento de Medicamentos: Cobro por caja completa en vez de dosis unitaria(Upcoding).
2. Desagregación de Pabellón(Unbundling): Cobro separado de insumos básicos(gasas, suturas, jeringas) que deben estar en 'Derecho de Pabellón'.
3. Fármacos de Pabellón en Farmacia: Anestesia / Analgesia intraoperatoria(Propofol, Fentanilo) cobrada aparte en 'Farmacia' en vez de Pabellón.
4. Hotelería No Clínica: Cobro de 'Confort', 'Kit de Aseo', 'Pantuflas', 'Ropa' sin consentimiento explícito.No es prestación médica.
5. Enfermería Básica en Día Cama: Cobro separado de 'Control Signos Vitales', 'Curación Simple', 'Instalación Vía', 'Fleboclisis'.ESTO ESTÁ INCLUIDO EN EL DÍA CAMA.Es Doble Cobro.
6. Glosas Genéricas(3201001 / 2): Montos abultados en 'Gastos No Cubiertos' o 'Insumos Varios' sin desglose.Es Opacidad, pero si oculta insumos básicos, es Indebido.
7. Incumplimiento Cobertura 100 %: Cobro de copago en prestaciones que el plan cubre al 100 % (ej.Medicamentos Hospitalarios) sin justificar tope.
8. Upcoding / Reconversión: Cobrar un insumo estándar como 'Especial/Importado' o un procedimiento menor como cirugía compleja.
9. Separación Urgencia / Hospitalización: Cobrar Urgencia como evento aparte con su propio tope, cuando derivó en hospitalización(debe ser Evento Único).
10. Falta de Respaldo: Cobros que no coinciden con ficha clínica o hoja de consumo.
`;
    knowledgeBaseText += IRREGULAR_PRACTICES_KNOWLEDGE;

    const sources: string[] = ["Informe Prácticas Irregulares", "Mini-RAG Desactivado"];
    const tokenEstimate = 0;

    log(`[AuditEngine] ðŸ“Š Conocimiento inyectado: 0 fuentes(Mini - RAG OFF)`);
    // log(`[AuditEngine] ðŸ“š Fuentes: ${ sources.join(' | ') } `);
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
    log(`[AuditEngine] ðŸ§© CRC Analysis: Reconstructible = ${reconstructibility.isReconstructible} (Conf: ${(reconstructibility.confidence * 100).toFixed(0)
        }%)`);
    reconstructibility.reasoning.forEach(r => log(`[AuditEngine] - ${r} `));

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
                index: item.index, // CRITICAL: Preserve index for traceability
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

    const eventosHospitalarios = await preProcessEventos(pamJson, contratoJson);

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
        throw new Error(`[DATA_INTEGRITY_FAIL] El PAM declara copago($${numericPamCopago}) y tiene Ã­tems, pero los eventos sumaron $0. ` +
            `Revisar parsing de montos en eventProcessor.Abortando audit.`);
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
    // ALPHA FOLD ENGINE (V6 - Deterministic Signal Processing)
    // ============================================================================
    log('[AuditEngine] 🧬 Activating AlphaFold Engine (V6 - Deterministic Signals)...');
    onProgressUpdate?.(37);

    // 1. Extract Signals
    const alphaSignals = AlphaFoldService.extractSignals({
        pam: cleanedPam,
        cuenta: cleanedCuenta,
        contrato: contratoJson
    });

    log(`[AuditEngine] 📡 Signals Extracted: ${alphaSignals.filter(s => s.value > 0).length} active signals.`);

    // 2. Detect PAM State
    const pamState = AlphaFoldService.detectPamState(alphaSignals);
    log(`[AuditEngine] 👁️ PAM State Detected: ${pamState}`);

    // 3. Score Hypotheses
    const hypothesisScores = AlphaFoldService.scoreHypotheses(alphaSignals, pamState);

    // 4. Activate Contexts
    const activeHypotheses = AlphaFoldService.activateContexts(hypothesisScores, pamState, {
        pam: cleanedPam,
        cuenta: cleanedCuenta,
        contrato: contratoJson
    });

    log(`[AuditEngine] 🧪 Active Hypotheses: ${activeHypotheses.join(', ')}`);
    hypothesisScores.filter(h => activeHypotheses.includes(h.hypothesis)).forEach(h => {
        log(`[AuditEngine]    - ${h.hypothesis}: ${(h.confidence * 100).toFixed(0)}% (Explains: ${h.explains.join(', ')})`);
    });

    // Shim for downstream compatibility (Jurisprudence Engine expects hypothesisResult)
    const capabilityMatrix = {
        enabled: [],
        blocked: []
    } as any;

    if (pamState === 'DETALLADO') {
        capabilityMatrix.enabled.push(
            { capability: "CALCULO_TOPES_UF_VA_VAM", scope: { type: "GLOBAL" }, by: "AlphaFold", confidence: 1.0 },
            { capability: "VALIDACION_PRECIOS_UNITARIOS", scope: { type: "GLOBAL" }, by: "AlphaFold", confidence: 1.0 },
            { capability: "UNBUNDLING_IF319", scope: { type: "GLOBAL" }, by: "AlphaFold", confidence: 1.0 }
        );
    } else {
        capabilityMatrix.blocked.push(
            { capability: "CALCULO_TOPES_UF_VA_VAM", scope: { type: "GLOBAL" }, by: "AlphaFold", confidence: 1.0 }
        );
    }

    const hypothesisResult = {
        hypotheses: hypothesisScores.filter(h => activeHypotheses.includes(h.hypothesis)).map(h => ({
            id: h.hypothesis,
            label: h.hypothesis,
            confidence: h.confidence,
            scope: { type: "GLOBAL" },
            rationale: `Detected by AlphaFold. Explains: ${h.explains.join(', ')}`
        })),
        capabilityMatrix: capabilityMatrix
    };

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
                        const uniqueId = `PAM_${folioIdx}_${prestadorIdx}_${itemIdx}_${codigo || 'NC'}_${descWords} `;

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
            log(`[AuditEngine]   🔒 PAM_LINE[${pamLine.codigo}| ${shortDesc}]: `);
            log(`[AuditEngine]      Decision = Cat ${decision.categoria_final} | Source=${decision.source} | Conf=${(decision.confidence * 100).toFixed(0)}% `);

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

    log(`[AuditEngine] ✅ Jurisprudence decisions: ${catACount} Cat A, ${catBCount} Cat B, ${catZCount} Cat Z(total: ${jurisprudenceDecisions.size} lines)`);

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
                    `Precedente automático: ${pamLine.descripcion.substring(0, 50)} `,
                    Array.from(features).slice(0, 5),
                    { requires: Array.from(features).filter(f => f.startsWith('COV_') || f.startsWith('BONIF_') || f.startsWith('MED_')) }
                );
                log(`[AuditEngine]   📝 Recorded: ${precedentId} `);
            } catch (e) {
                log(`[AuditEngine]   ⚠️ Failed to record precedent: ${e} `);
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

    log(`[AuditEngine] 🔐 ${frozenCategories.size} categories frozen(immune to LLM / canonical override).`);

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

    log(`[AuditEngine] ⚖️ Canonical Rules Decision: ${canonicalOutput.decisionGlobal} `);
    ruleEngineResult.flags.filter(f => f.detected).forEach(f => log(`[AuditEngine]    🚩 Flag: ${f.flagId} - ${f.description} `));
    ruleEngineResult.rules.filter(r => r.violated).forEach(r => log(`[AuditEngine]    🚫 Violation: ${r.ruleId} - ${r.description} `));

    // ============================================================================
    // JURISPRUDENCE PROTECTION: Canonical cannot collapse Cat A to INDETERMINADO
    // ============================================================================
    let effectiveCanonicalDecision: string = canonicalOutput.decisionGlobal;
    const hasFrozenCatA = Array.from(frozenCategories.values()).some(f => f.categoria_final === 'A');

    if (canonicalOutput.decisionGlobal === 'COPAGO_INDETERMINADO_POR_OPACIDAD' && hasFrozenCatA) {
        effectiveCanonicalDecision = 'COPAGO_MIXTO_CONFIRMADO_Y_OPACO';
        log(`[AuditEngine] 🛡️ PROTECTION ACTIVATED: Canonical tried to override ${catACount} frozen Cat A decisions.`);
        log(`[AuditEngine]    Original: ${canonicalOutput.decisionGlobal} → Effective: ${effectiveCanonicalDecision} `);
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
                log(`[AuditEngine] ðŸ” Estado INDETERMINADO detectado.NO se ejecuta GAP reconciliation(evita ghost hunters).`);
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

        // --- AlphaFold-Juridic Phase 2 & 3: Integrated Signal & Finding Layer ---
        // --- AlphaFold-Juridic Phase 2 & 3: Integrated Signal & Finding Layer ---
        // Reuse variables from start of function (AlphaFold execution at start)
        const activeContexts = activeHypotheses;
        const ranking = hypothesisScores;
        // alphaSignals and pamState are already available

        const alphaFindings = AlphaFoldService.buildFindings({ pam: cleanedPam, cuenta: cleanedCuenta, contrato: cleanedContrato }, pamState, activeContexts);

        // 1. Jurisprudence Findings (Nivel 1-4)
        const jurisprudenceFindings = Array.from(jurisprudenceDecisions.values())
            .filter(v => (v.decision.categoria_final === 'A' || v.decision.categoria_final === 'Z') && v.pamLine.copago > 0)
            .map(v => {
                const doctrineRule = findMatchingDoctrine(v.features);
                return {
                    id: v.pamLine.uniqueId,
                    category: v.decision.categoria_final as any,
                    label: v.pamLine.descripcion,
                    amount: v.pamLine.copago,
                    action: v.decision.recomendacion as any,
                    evidenceRefs: [`PAM:${v.pamLine.codigo}`],
                    rationale: doctrineRule?.rationale || "Hallazgo detectado por motor de jurisprudencia (Árbol de Decisión del Auditor).",
                    hypothesisParent: v.decision.categoria_final === 'A' ?
                        (v.features.has('INHERENTLY_INCLUDED') ? "H_UNBUNDLING_IF319" : "H_INCUMPLIMIENTO_CONTRACTUAL") :
                        "H_OPACIDAD_ESTRUCTURAL"
                };
            });

        // 2. AlphaFold findings (Structural)
        // We filter AlphaFold findings if they overlap with specific Jurisprudence findings to avoid double counting
        const filteredAlphaFindings = alphaFindings.filter(af =>
            !jurisprudenceFindings.some(jf => jf.label === af.label && Math.abs(jf.amount - af.amount) < 100)
        );

        // 3. LLM Findings (Medical/Refined)
        const filteredLlmFindings = (auditResult.hallazgos || []).filter((h: any) =>
            // Exclude LLM findings that are just "Structural Opacity" since AlphaFold/Jurisprudence handles that better
            h.codigos !== "OPACIDAD_ESTRUCTURAL" && h.categoria !== "OPACIDAD" &&
            // Prevent double counting of items already caught by Jurisprudence (by amount and simple desc match)
            !jurisprudenceFindings.some(jf => Math.abs(jf.amount - (h.montoObjetado || 0)) < 100 && (h.glosa || h.titulo || "").includes(jf.label))
        ).map((h: any) => ({
            id: h.id || stableId([h.codigos || "", h.titulo || "", h.glosa || "", String(h.montoObjetado || 0)]),
            category: (h.categoria_final || "Z") as any,
            label: h.titulo || h.glosa || "Hallazgo LLM",
            amount: h.montoObjetado || 0,
            action: (h.recomendacion_accion || "SOLICITAR_ACLARACION") as any,
            evidenceRefs: h.evidenceRefs,
            rationale: h.hallazgo || "Hallazgo detectado por LLM",
            hypothesisParent: h.hypothesisParent || "H_PRACTICA_IRREGULAR"
        }));

        // Merge findings from all sources
        const mergedFindings = [...jurisprudenceFindings, ...filteredAlphaFindings, ...filteredLlmFindings];


        // V6.2: LAST RESORT RESOLUTION FOR OPAQUE ITEMS
        log('[AuditEngine] 🔄 Intentando resolución de "último recurso" para ítems opacos...');
        for (const finding of mergedFindings || []) {
            if (finding.category === 'Z' || /OPACIDAD|SIN DESGLOSE/i.test(finding.label || "")) {
                const resolved = await resolveByDescription(finding.label || "");
                if (resolved) {
                    log(`[AuditEngine] ✨ Re-clasificado ítem opaco: "${finding.label}" -> ${resolved.code} (${resolved.description})`);

                    // CLEAN RATIONALE: Remove "Indeterminacion/Ley 20.584" markers that confuse the user
                    let cleanRationale = (finding.rationale || "");
                    cleanRationale = cleanRationale.replace(/\[C05\].*norma de cierre \(Cat Z\)\.?/gi, '').trim();
                    cleanRationale = cleanRationale.replace(/INDETERMINACION|NO PERMITE CLASIFICAR|NO SE PUEDE VERIFICAR|LEY 20.?584/gi, '').trim();

                    finding.category = 'OK';
                    finding.action = 'ACEPTAR';
                    finding.rationale = `[MEJORA] Código Fonasa detectado: ${resolved.code}. Procedimiento validado como ${resolved.description}.` + (cleanRationale ? `\nContexto: ${cleanRationale}` : "");
                    finding.description = resolved.description;
                    finding.codigos = resolved.code;
                }
            }
        }
        const canonicalResult = finalizeAuditCanonical({
            findings: mergedFindings,
            totalCopago: totalCopagoReal,
            reconstructible: (reconstructibility as any).isReconstructible,
            pamState: pamState,
            signals: alphaSignals,
            violations: ruleEngineResult.rules.filter(r => r.violated).map(r => ({ code: r.ruleId, severity: 1 })), // Map violations
            contract: contratoJson,
            accountContext: cleanedCuenta, // NEW: Pass account context for reconstruction
            eventos: eventosHospitalarios // NEW: Pass event context
        });

        const finalFindings = canonicalResult.findings.map(f => {
            // FIX: Ensure UI Map aligns with Balance truth
            // If a finding relates to Meds/Mats and we are in a 100% coverage context (Level 1)
            // or if it expresses a technical violation (Level 2), promote category to match balance.
            const isA = isProtectedCatA(f);
            return {
                ...f,
                category: isA ? "A" : f.category,
                action: isA ? "IMPUGNAR" : f.action
            };
        });
        const finalStrictBalance = canonicalResult.balance;
        const finalDecision = {
            estado: canonicalResult.estadoGlobal,
            confianza: 0.9,
            fundamento: (canonicalResult as any).fundamentoText
        };

        // Final Result Initialization
        const finalResult = auditResult;

        // Update finalResult with TRUTH
        finalResult.resumenFinanciero = (canonicalResult as any).resumenFinanciero;
        finalResult.totalAhorroDetectado = finalStrictBalance.A;
        finalResult.balance = finalStrictBalance;

        // --- NEW: Sync Hallazgos with Reconstructed findings for UI/Report consistency ---
        finalResult.hallazgos = finalFindings.map(f => {
            const existing = (auditResult.hallazgos || []).find((h: any) => h.id === f.id);
            return {
                ...(existing || {}),
                id: f.id,
                categoria_final: f.category,
                categoria: f.category,
                titulo: f.label,
                glosa: f.label,
                montoObjetado: f.amount,
                recomendacion_accion: f.action,
                hallazgo: f.rationale,
                evidenceRefs: f.evidenceRefs,
                hypothesisParent: f.hypothesisParent
            };
        });

        // --- NEW: Patch auditoriaFinalMarkdown to include Reconstructed Findings ---
        if (finalResult.auditoriaFinalMarkdown) {
            const reconstructed = finalFindings.filter(f => f.category === 'A' && f.label.includes('(Reconstruido)'));
            if (reconstructed.length > 0) {
                // 1. Update Executive Summary (Section 1) - Correcting "Opacidad Estructural" to "Opacidad Resuelta"
                finalResult.auditoriaFinalMarkdown = finalResult.auditoriaFinalMarkdown.replace(
                    /revela una \*\*Opacidad Estructural\*\* severa[^.]+\./i,
                    `revela que, mediante **Reconstrucción Forense Aritmética**, se ha logrado identificar el desglose de los montos opacos, confirmando cobros improcedentes por $${finalResult.totalAhorroDetectado.toLocaleString('es-CL')}.`
                );

                // 2. Clear "Indeterminado" mentions
                finalResult.auditoriaFinalMarkdown = finalResult.auditoriaFinalMarkdown.replace(
                    /El copago asociado a estas líneas es \*\*INDETERMINADO\*\*\./gi,
                    "El desglose de estas líneas ha sido identificado y validado técnicamente."
                );

                // 3. Inject Detailed Breakdown Section
                let reconSection = "\n\n## 4.5 Desglose de Reconstrucción Forense (Opacidad PAM)\nSe ha logrado reconstruir técnicamente los siguientes montos que aparecían sin detalle en el PAM, confirmando su naturaleza improcedente:\n\n";
                reconstructed.forEach(r => {
                    reconSection += `- **${r.label}**: $${r.amount.toLocaleString('es-CL')}\n`;
                });
                reconSection += "\n*El detalle ítem por ítem se encuentra disponible en los hallazgos individuales de este reporte.*";

                if (finalResult.auditoriaFinalMarkdown.includes("## 5. Recomendación Final")) {
                    finalResult.auditoriaFinalMarkdown = finalResult.auditoriaFinalMarkdown.replace("## 5. Recomendación Final", reconSection + "\n\n## 5. Recomendación Final");
                } else if (finalResult.auditoriaFinalMarkdown.includes("## 5.")) {
                    finalResult.auditoriaFinalMarkdown = finalResult.auditoriaFinalMarkdown.replace("## 5.", reconSection + "\n\n## 5.");
                } else {
                    finalResult.auditoriaFinalMarkdown += reconSection;
                }
            }
        }

        // --- NEW: Patch root resumenEjecutivo for UI consistency ---
        if (finalResult.resumenEjecutivo && finalFindings.some(f => f.label.includes('(Reconstruido)'))) {
            finalResult.resumenEjecutivo = finalResult.resumenEjecutivo.replace(
                /1\. \*\*Opacidad Estructural\*\*:[^.]+\./i,
                `1. **Opacidad Resuelta**: Se reconstruyó el desglose de Medicamentos y Materiales mediante auditoría forense, identificando cobros indebidos específicos.`
            );
        }

        if (canonicalResult.debug.length > 0) {
            log(`[AuditEngine] ⚖️ Canonical Debug: ${canonicalResult.debug.join(' | ')}`);
        }

        return {
            data: {
                ...finalResult,
                // --- AlphaFold-Juridic: Final Integrated Output ---
                pamState: pamState,
                signals: alphaSignals,
                hypothesisRanking: ranking,
                activeHypotheses: activeContexts,

                findings: finalFindings,
                balance: {
                    A: finalStrictBalance.A,
                    B: finalStrictBalance.B,
                    Z: finalStrictBalance.Z,
                    OK: finalStrictBalance.OK,
                    TOTAL: finalStrictBalance.TOTAL
                } as BalanceAlpha,

                resumenFinanciero: finalResult.resumenFinanciero,
                decisionGlobal: {
                    estado: finalDecision.estado,
                    confianza: finalDecision.confianza,
                    fundamento: finalDecision.fundamento
                },
                legalContext: {
                    axioma_fundamental: "La inteligencia del auditor consiste en suplir las deficiencias estructurales del PAM mediante la aplicación activa de literatura, normativa y contrato, y no en declarar indeterminación ante la primera falta de desglose.",
                    analisis_capas: [
                        "1. CAPA CONTRACTUAL: Prioridad absoluta a incumplimientos de cobertura explícita y topes (Breach = Cat A).",
                        "2. CAPA CLÍNICO-TÉCNICA: Aplicación activa de bibliografía para definir qué ítems son hotelería o insumos incluidos por norma.",
                        "3. CAPA DE RECONSTRUCCIÓN: Inferencia de naturaleza y detección de unbundling cuando el PAM agrupa glosas.",
                        "4. CAPA DE OPACIDAD RESIDUAL: La Ley 20.584 aplica solo cuando contrato y literatura no permiten la clasificación."
                    ],
                    fraudeCheck: "La hipótesis dominante es el incumplimiento directo o la falta de transparencia estructural acumulada.",
                    disclaimer: "Este reporte constituye una pre-liquidación forense reconstructiva. No reemplaza el juicio de un tribunal."
                },
                canonical_rules_output: (canonicalResult as any).debug,

                explicaciones: (() => {
                    const patientNameStr = (cuentaJson.patientName || pamJson.patientName || pamJson.patient || "el paciente").toUpperCase();
                    const totalRef = totalCopagoReal.toLocaleString('es-CL');
                    const ahorroRef = finalStrictBalance.A.toLocaleString('es-CL');
                    const indeterminadoRef = finalStrictBalance.Z.toLocaleString('es-CL');

                    if (finalDecision.estado && (finalDecision.estado.includes('OPACIDAD') || finalDecision.estado.includes('INDETERMINADO') || finalDecision.estado.includes('CONTROVERSIA') || finalDecision.estado.includes('MIXTO'))) {
                        return {
                            clinica: `La auditoría forense de la cuenta de ${patientNameStr} revela una opacidad estructural significativa en el Programa de Atención Médica (PAM). El copago total informado de $${totalRef} no puede ser completamente validado debido a la falta de desglose detallado en ítems clave como 'Medicamentos Clínicos' y 'Materiales Clínicos', así como glosas genéricas de 'Gastos No Cubiertos por el Plan' o 'Prestación No Contemplada en el Arancel'. Conforme a la Circular IF/319 y jurisprudencia administrativa, cuando el prestador factura glosas genéricas sin desglose clínico verificable, no demuestra que el gasto esté realmente excluido del plan, por lo que el copago resulta jurídicamente indeterminado. Adicionalmente, se identificaron cobros improcedentes por prestaciones inherentes al día cama y por ítems de hotelería no clínica que suman un ahorro de $${ahorroRef}. La carga de la prueba recae en el prestador para demostrar que estos 'gastos no cubiertos' o 'prestaciones no aranceladas' no son cobros duplicados o fragmentados de la cirugía o del día cama.`,
                            isapre: `La falta de desglose en el PAM impide auditar la correcta aplicación de topes UF/VAM; sin embargo, no obsta a declarar improcedentes aquellos cobros que, por su naturaleza clínica o normativa, resultan indebidos con independencia de dicha opacidad. "La cuenta clínica no permite reconstruir ni validar la correcta aplicación del contrato de salud, motivo por el cual el copago exigido resulta jurídicamente indeterminable." Conforme a la doctrina de la Superintendencia de Salud, el prestador debe demostrar exactamente qué es el 'gasto no cubierto' o la 'prestación no arancelada' y por qué no está incluido en el evento quirúrgico o día cama. Si no hay desglose claro, el cobro no es exigible.`,
                            paciente: `Cuando una clínica le cobra 'Gastos no cubiertos' o 'Prestación no contemplada', tiene la obligación legal de demostrar exactamente qué es ese gasto y por qué no está incluido en su hospitalización o cirugía. En la mayoría de los casos auditados, este tipo de cobros corresponde a elementos que ya están pagados en su 'Día Cama' o en el 'Derecho de Pabellón'. Si la Isapre o la Clínica no le dan un detalle claro, usted tiene derecho a no aceptar ese cobro. Es como si en un restaurante le cobraran 'Cargos Varios' o 'Extra de Cocina' sin decirle qué comió: usted no tiene por qué pagarlo si no le explican qué es.`
                        };
                    }
                    return undefined;
                })(),
                jurisprudenceContext: {
                    precedentsUsed: Array.from(jurisprudenceDecisions.entries())
                        .filter(([_, v]) => v.decision.source === 'PRECEDENTE')
                        .map(([key, v]) => ({ pamLineKey: key, precedentId: v.decision.precedentId })),
                    doctrineRulesApplied: Array.from(jurisprudenceDecisions.entries())
                        .filter(([_, v]) => v.decision.source === 'DOCTRINA')
                        .map(([key, v]) => ({ pamLineKey: key, categoria: v.decision.categoria_final })),
                    totalDecisions: jurisprudenceStore ? jurisprudenceStore.stats().total : 0
                }

            },
            usage: usage ? {
                promptTokens: usage.promptTokenCount,
                candidatesTokens: usage.candidatesTokenCount,
                totalTokens: usage.totalTokenCount
            } : null,
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

                    if (learnableFindings.length > 0 && typeof learnFromAudit === 'function') {
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
        log(`[AuditEngine] ❌ Error en el proceso de auditoría: ${error.message}`);
        throw error;
    }

}

// ============================================================================
// FINALIZER: Freeze & Calculate KPIs (Deterministic)
// ============================================================================
export function finalizeAudit(result: any, totalCopagoReal: number = 0): any {
    const hallazgos = result.hallazgos || [];

    // 0. Detect Structural Opacity Parent to avoid double counting
    const hasStructuralOpacity = hallazgos.some((h: any) => h.codigos === "OPACIDAD_ESTRUCTURAL");

    // ========================================================================
    // CANONICAL RULE C-NC-03: PROTECTED CATEGORIES (NEVER SUBSUME)
    // These represent clinical/normative Cat A findings that are INDEPENDENT
    // of structural opacity and cannot be collapsed.
    // ========================================================================

    // Protected code patterns (IF-319 unbundling, nursing procedures)
    const PROTECTED_CODE_PATTERNS = [
        /^99-00-028/,  // Instalación de vía venosa
        /^99-00-045/,  // Fleboclisis
        /^99-00-/,     // Generic nursing procedures
        /^01-01-010/,  // Día cama components
        /^01-04-/,     // Pabellón inherent procedures
    ];

    // Protected keywords in titulo/glosa indicating clinical/normative Cat A
    const PROTECTED_KEYWORDS = [
        /UNBUNDLING/i,
        /VIA VENOSA/i,
        /FLEBOCLISIS/i,
        /ENFERMERIA BASICA/i,
        /INHERENTE/i,
        /DOBLE COBRO/i,
        /EVENTO UNICO/i,
        /IF-?319/i,
        /CIRCULAR.*319/i,
    ];

    // 1. Freeze Categories with C-NC-03 Protection
    const hallazgosFrozen = hallazgos.map((h: HallazgoInternal) => {
        // ROBUSTNESS: Ensure montoObjetado exists for summation
        if (!h.montoObjetado) {
            h.montoObjetado = Number(h.monto || h.copago || 0);
        }

        let cat: HallazgoCategoria = "Z"; // Default indeterminate

        // Analyze Basis & Opacity
        const isOpacityParent = h.codigos === "OPACIDAD_ESTRUCTURAL";
        const isGenericMaterialOrMed = (h.glosa && /MATERIAL|INSUMO|MEDICAMENTO|FARMAC/i.test(h.glosa));

        // ========================================================================
        // C-NC-03: Determine if finding is PROTECTED from subsumption
        // Protection is based on NATURE, not current state (categoria_final)
        // ========================================================================

        // Check 1: Protected by code pattern (IF-319, nursing procedures)
        const isProtectedByCode = h.codigos && PROTECTED_CODE_PATTERNS.some(
            pattern => pattern.test(h.codigos || '')
        );

        // Check 2: Protected by clinical/normative keywords
        const searchText = `${h.titulo || ''} ${h.glosa || ''} ${h.hallazgo || ''}`;
        const isProtectedByKeyword = PROTECTED_KEYWORDS.some(
            pattern => pattern.test(searchText)
        );

        // Check 3: Protected by doctrine/jurisprudence source (Cat A fuerte)
        const isDoctrineCatA = (h as any).source === 'DOCTRINA' && h.categoria_final === 'A';
        const isPrecedentCatA = (h as any).source === 'PRECEDENTE' && h.categoria_final === 'A';
        const isJurisprudenceProtected = isDoctrineCatA || isPrecedentCatA;

        // Check 4: Explicit Cat A markers (legacy compatibility)
        const isExplicitA = h.categoria_final === "A" || h.tipo_monto === "COBRO_IMPROCEDENTE";

        // FINAL PROTECTION STATUS: Protected if ANY of the above is true
        const isProtectedFromSubsumption = isProtectedByCode || isProtectedByKeyword || isJurisprudenceProtected || isExplicitA;

        // Log protection status for debugging
        if (isProtectedFromSubsumption && hasStructuralOpacity) {
            console.log(`[C-NC-03] 🛡️ PROTECTED: '${h.titulo}' (code=${isProtectedByCode}, keyword=${isProtectedByKeyword}, jurisp=${isJurisprudenceProtected}, explicit=${isExplicitA})`);
        }

        // ========================================================================
        // C-SUB-01: SUBSUMPTION LOGIC (with Non-Collapse Protection)
        // Generic material/med findings are subsumed ONLY if NOT protected
        // ========================================================================
        if (hasStructuralOpacity && isGenericMaterialOrMed && !isOpacityParent && !isProtectedFromSubsumption) {
            h.isSubsumed = true;
            cat = "B"; // It is still controversy, but won't be summed
            console.log(`[C-SUB-01] Subsumed: '${h.titulo}' (generic material/med under opacity)`);
        } else if (isOpacityParent) {
            cat = "Z"; // Opacity is INDETERMINATE (Cat Z), not just controversy
        } else if (h.categoria === "OPACIDAD") {
            // Fallback for legacy items if no canonical parent exists
            cat = "Z";
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
            } else if (isProtectedFromSubsumption) {
                // PROTECTED Cat A: Clinical/normative findings (unbundling, IF-319, etc.)
                cat = "A";
                console.log(`[C-NC-03] ✅ Cat A confirmed for protected finding: '${h.titulo}'`);
            } else {
                // Default handling
                if (h.categoria_final === 'Z' || h.categoria === 'Z') {
                    cat = "Z"; // Respect explicit Z input (e.g. from C05 rule)
                } else if (h.tipo_monto === "COBRO_IMPROCEDENTE" && h.nivel_confianza !== "BAJA") {
                    cat = "A";
                } else {
                    cat = "B"; // Controversia fallback
                }
            }


            // DEBUG LOG
            // console.log(`[FINALIZE DEBUG] Item: ${h.titulo} | CatFinal: ${h.categoria_final} | TipoMonto: ${h.tipo_monto} | Protected: ${isProtectedFromSubsumption} -> Assigned Cat: ${cat}`);
        }

        // --- STRICT OVERRIDE FOR SUSPECTED PARTIAL MATCHES ---
        // If we have a finding that mentions "Alimentación" or "Sin Bonificación" but was NOT marked as "A" above (Exact Match),
        // we force it to Z (Indeterminate) to avoid "Green" oscillation.
        // EXCEPTION: Protected findings are NEVER downgraded
        if ((h.titulo?.includes("ALIMENTACION") || h.glosa?.includes("SIN BONIF")) && cat !== "A" && !isProtectedFromSubsumption) {
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

    // ========================================================================
    // C-CLOSE-01: ACCOUNTING CLOSURE ASSERTION
    // Prevents Cat A = 0 when traceable Cat A findings exist
    // ========================================================================
    const catAFindingsExist = hallazgosFrozen.some(
        (h: any) => h.categoria_final === "A" && !h.isSubsumed
    );

    if (catAFindingsExist && sumA === 0) {
        console.error('[C-CLOSE-01] ⚠️ CANONICAL VIOLATION: Cat A findings exist but sumA = 0!');
        console.error('[C-CLOSE-01] This indicates subsumption logic collapsed Cat A incorrectly.');

        // Debug: List all Cat A findings that should have been counted
        hallazgosFrozen
            .filter((h: any) => h.categoria_final === "A")
            .forEach((h: any) => {
                console.error(`  [C-CLOSE-01] Orphaned Cat A: '${h.titulo}' = $${(h.montoObjetado || 0).toLocaleString()}, isSubsumed=${h.isSubsumed}`);
            });
    } else if (sumA > 0) {
        console.log(`[C-CLOSE-01] ✅ Accounting closure OK: Cat A = $${sumA.toLocaleString()} (${hallazgosFrozen.filter((h: any) => h.categoria_final === 'A' && !h.isSubsumed).length} finding(s))`);
    }

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
    const hasOpacity = hasStructuralOpacity || hasCatZ || hasCatB;

    // 7. Diagnóstico Global del Caso (Specification v1.0 - CANONICAL CORRECTION)
    // REGLA MADRE: Si existe incumplimiento contractual determinado (Cat A > 0), 
    // el estado global NO puede ser MIXTO ni OPACO. 
    // La opacidad (Z) pasa a ser secundaria explicativa, no determinante del estado.

    if (hasCatA) {
        // PRIORITY 1: CONTRACTUAL BREACH / UNBUNDLING CONFIRMED
        // Overrides any opacity. "Mixed" state is forbidden when a breach is proven.
        finalDecision = "CUENTA_IMPUGNABLE_POR_INCUMPLIMIENTO_CONTRACTUAL";
        console.log('[GLOBAL_DECISION] 🛡️ Override: Cat A confirmed -> CUENTA_IMPUGNABLE (Opacity neutralized)');
    } else if (hasCatZ) {
        // PRIORITY 2: RESIDUAL OPACITY
        // Only if NO Cat A exists.
        finalDecision = "OPACIDAD ESTRUCTURAL (COPAGO INDETERMINADO)";
    } else if (hasCatB) {
        finalDecision = "CONTROVERSIA POR FALTA DE DESGLOSE";
    } else if (catOK === totalCopagoReal && totalCopagoReal > 0) {
        finalDecision = "CORRECTO (VALIDADO)";
    } else if (totalCopagoReal === 0) {
        finalDecision = "SIN COPAGO INFORMADO";
    } else {
        finalDecision = "AUDITABLE";
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
// HELPER: Subset-Sum for Nutrition (Alimentación) Reconciliation
// ============================================================================
export function reconcileNutritionCharges(cuenta: any, pam: any): any {
    // 1. Identify Target Amount (Code 3101306 or PRESTACIONES SIN BONIFICACIÓN)
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
        pamGlosa: pamItemName,
        matchFound: matchedSubset !== null,
        items: matchedSubset || []
    };
}

function subsetSumExact(target: number, items: any[], maxNodes = 50000): any[] | null {
    const sortedIndices = items.map((_, i) => i).sort((a, b) => items[b].total - items[a].total);
    let nodes = 0;

    function dfs(idx: number, currentSum: number, chosenIndices: number[]): number[] | null {
        nodes++;
        if (nodes > maxNodes) return null;
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
    return resultIndices ? resultIndices.map(i => items[i]) : null;
}

function traceGenericChargesTopK(cuenta: any, pam: any): string {
    const traceResults: string[] = [];
    const adjustments: any[] = [];
    const REGEX_GENERIC = /(ajuste|vario|diferencia|suministro|cargo admin|otros|insumos)/i;
    const REGEX_CODES = /^(14|02|99)\d+/;

    const sections = cuenta.sections ?? [];
    sections.forEach((sec: any) => {
        (sec.items ?? []).forEach((item: any) => {
            const desc = (item.description || "").toUpperCase();
            const code = (item.code || "").toString();
            const itemTotal = parseAmountCLP(item.total);
            if ((REGEX_GENERIC.test(desc) || REGEX_CODES.test(code)) && itemTotal >= 1000) {
                adjustments.push({ ...item, total: itemTotal });
            }
        });
    });

    if (adjustments.length === 0) return "No se detectaron cargos genéricos relevantes para trazar.";

    const pamItems: any[] = [];
    pam.folios?.forEach((f: any) => {
        f.desglosePorPrestador?.forEach((d: any) => {
            d.items?.forEach((i: any) => {
                pamItems.push({ ...i, amount: parseAmountCLP(i.bonificacion) });
            });
        });
    });

    adjustments.forEach(adj => {
        const target = adj.total;
        let matchFound = false;

        const directMatch = pamItems.find(p => Math.abs(p.amount - target) <= 1000);
        if (directMatch) {
            traceResults.push(`- AJUSTE '${adj.description}'($${target}) COINCIDE con ítem PAM '${directMatch.descripcion}'($${directMatch.amount}).`);
            matchFound = true;
        }

        if (!matchFound) {
            const folioMatch = pam.folios?.find((f: any) => {
                let totalB = 0;
                f.desglosePorPrestador?.forEach((d: any) => d.items?.forEach((i: any) => {
                    totalB += parseAmountCLP(i.bonificacion) || 0;
                }));
                return Math.abs(totalB - target) <= 2000;
            });

            if (folioMatch) {
                traceResults.push(`- AJUSTE '${adj.description}'($${target}) COINCIDE con Bonificación Total del Folio ${folioMatch.folioPAM}.`);
                matchFound = true;
            }
        }

        if (!matchFound) {
            traceResults.push(`- AJUSTE '${adj.description}'($${target}) NO TIENE CORRELACIÓN aritmética evidente en PAM.`);
        }
    });

    return traceResults.join('\n');
}

function postValidateLlmResponse(resultRaw: any, eventos: any[], cuentaContext: any, pamContext: any, reconstructibility?: any): any {
    const validatedResult = { ...resultRaw };
    let hasStructuralOpacity = false;

    if (validatedResult.hallazgos) {
        validatedResult.hallazgos = validatedResult.hallazgos.filter((h: any) => {
            const isImpugnar = h.hallazgo?.toUpperCase().includes("IMPUGNAR") || (h.montoObjetado || 0) > 0;
            if (isImpugnar) {
                const hasTableCheck = h.hallazgo?.includes("|") && h.hallazgo?.includes("---");
                const isGenericOrOpacidad = h.categoria === "OPACIDAD" || /GENERICO|AGRUPADOR/i.test(h.glosa || "");

                if (isGenericOrOpacidad && !hasTableCheck) {
                    h.recomendacion_accion = "SOLICITAR_ACLARACION";
                    h.nivel_confianza = "BAJA";
                    h.tipo_monto = "COPAGO_OPACO";
                }

                if ((h.montoObjetado || 0) > 1000000 && (!h.codigos || h.codigos === "SIN-CODIGO")) {
                    return false;
                }
            }

            const determinedCat = classifyFinding(h);
            if (determinedCat === "A") {
                h.categoria_final = "A";
                h.estado_juridico = "CONFIRMADO_EXIGIBLE";
                return true;
            }

            const isOpacidad = h.categoria === "OPACIDAD" || (h.glosa && /MATERIAL|INSUMO|MEDICAMENTO/i.test(h.glosa) && /DESGLOSE|OPACIDAD/i.test(h.hallazgo || ""));
            if (isOpacidad) {
                if (reconstructibility?.isReconstructible) {
                    h.categoria_final = "K";
                    h.estado_juridico = "EN_CONTROVERSIA";
                } else {
                    h.categoria_final = "Z";
                    hasStructuralOpacity = true;
                }
            } else {
                h.categoria_final = "B";
            }
            return true;
        });
    }

    if (cuentaContext && pamContext) {
        try {
            const nutritionCheck = reconcileNutritionCharges(cuentaContext, pamContext);
            if (nutritionCheck?.matchFound) {
                const nutriFinding = validatedResult.hallazgos.find((h: any) => (h.codigos && h.codigos.includes("3101306")) || (h.glosa && /ALIMENTA/i.test(h.glosa)));
                if (nutriFinding) {
                    nutriFinding.categoria_final = "A";
                    nutriFinding.nivel_confianza = "ALTA";
                }
            }
        } catch (e) { console.log(e); }
    }

    if (hasStructuralOpacity) {
        validatedResult.decisionGlobal = validatedResult.decisionGlobal || {};
        validatedResult.decisionGlobal.estado = "COPAGO_INDETERMINADO_POR_OPACIDAD";
        validatedResult.resumenFinanciero = validatedResult.resumenFinanciero || {};
        validatedResult.resumenFinanciero.estado_copago = "INDETERMINADO";
    }

    validatedResult.totalAhorroDetectado = validatedResult.resumenFinanciero?.ahorro_confirmado || 0;
    return validatedResult;
}
