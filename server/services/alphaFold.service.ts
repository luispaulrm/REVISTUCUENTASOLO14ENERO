import {
    Signal,
    PamState,
    HypothesisScore,
    HypothesisId,
    ConstraintsViolation
} from '../../src/types.js';

// Helper for fuzzy matching / scoring
const clamp = (val: number) => Math.min(1, Math.max(0, val));
const get = (signals: Signal[], id: string): number => signals.find(s => s.id === id)?.value || 0;
const findHypothesis = (scores: HypothesisScore[], id: HypothesisId) => scores.find(s => s.hypothesis === id);

interface AlphaFoldInput {
    pam: any;
    cuenta: any;
    contrato: any;
}

export class AlphaFoldService {

    // ========================================================================
    // 1. EXTRACT SIGNALS (Observación Neutra)
    // ========================================================================
    static extractSignals(input: AlphaFoldInput): Signal[] {
        const signals: Signal[] = [];

        // Helper to collect evidence references (simplified for now, returns IDs or mock refs)
        const refs = (...args: any[]) => [];

        // --- PAM SIGNALS ---
        const hasPam = !!input.pam && (Object.keys(input.pam).length > 0);
        signals.push({ id: "S_PAM_EXISTE", value: hasPam ? 1 : 0, evidenceRefs: ["pam"] });

        // Scoring Opacity features
        signals.push({
            id: "S_PAM_AGRUPADOR_MATERIALES",
            value: this.scoreGrouping(input.pam, "MATERIALES"),
            evidenceRefs: []
        });
        signals.push({
            id: "S_PAM_AGRUPADOR_MEDICAMENTOS",
            value: this.scoreGrouping(input.pam, "MEDICAMENTOS"),
            evidenceRefs: []
        });
        signals.push({
            id: "S_PAM_GLOSAS_GENERICAS",
            value: this.scoreGenericLabels(input.pam),
            evidenceRefs: []
        });

        // --- ACCOUNT/BILL SIGNALS (Unbundling) ---
        signals.push({
            id: "S_DIA_CAMA_PRESENTE",
            value: this.hasDayBed(input.cuenta) ? 1 : 0,
            evidenceRefs: []
        });
        signals.push({
            id: "S_HOTELERIA_ITEMS",
            value: this.scoreHoteleriaItems(input.cuenta),
            evidenceRefs: []
        });
        signals.push({
            id: "S_ALIMENTACION_ITEMS",
            value: this.scoreFoodItems(input.cuenta),
            evidenceRefs: []
        });

        // --- CONTRACT SIGNALS (Legacy & Canonical) ---
        const isCanonical = !!input.contrato?.metadata || (input.contrato?.coberturas && input.contrato?.coberturas.some((c: any) => Array.isArray(c.modalidades)));
        const coberturas = input.contrato?.coberturas || [];

        signals.push({
            id: "S_CONTRATO_COBERTURAS_VACIAS",
            value: coberturas.length === 0 ? 1 : 0,
            evidenceRefs: ["contrato"]
        });

        signals.push({
            id: "S_INCOHERENCIA_AMB_HOSP",
            value: this.scoreAmbHospMismatch(input.contrato, input.cuenta),
            evidenceRefs: []
        });

        // --- BEHAVIOR/PATTERN SIGNALS ---
        signals.push({
            id: "S_REPETICION_EXAMENES",
            value: this.scoreRepetition(input.cuenta),
            evidenceRefs: []
        });

        // --- VALIDATION SIGNALS (Topes/Categories) ---
        // Honorarios: Validated if PAM is detailed OR if we identified surgery and it matches contract patterns
        signals.push({
            id: "S_VAL_HONORARIOS",
            value: this.scoreCategoryValidation(input.pam, "HONORARIO"),
            evidenceRefs: []
        });
        // Pabellón: Validated if Derecho de Pabellón is found with standard codes
        signals.push({
            id: "S_VAL_PABELLON",
            value: this.scoreCategoryValidation(input.pam, "PABELLON"),
            evidenceRefs: []
        });
        // Medicamentos: Validated if not opaque and follows VAM/AC logic
        signals.push({
            id: "S_VAL_MEDICAMENTOS",
            value: 1 - this.scoreGrouping(input.pam, "MEDICAMENTOS"),
            evidenceRefs: []
        });
        // Materiales: Validated if not opaque
        signals.push({
            id: "S_VAL_MATERIALES",
            value: 1 - this.scoreGrouping(input.pam, "MATERIALES"),
            evidenceRefs: []
        });


        return signals;
    }

    // ========================================================================
    // 2. DETECT PAM STATE (ABSENT / OPACO / DETALLADO)
    // ========================================================================
    static detectPamState(signals: Signal[]): PamState {
        const exists = get(signals, "S_PAM_EXISTE") > 0.5;
        if (!exists) return "ABSENT";

        const opacityIndex =
            0.40 * get(signals, "S_PAM_GLOSAS_GENERICAS") +
            0.35 * get(signals, "S_PAM_AGRUPADOR_MATERIALES") +
            0.35 * get(signals, "S_PAM_AGRUPADOR_MEDICAMENTOS");

        return opacityIndex > 0.6 ? "OPACO" : "DETALLADO";
    }

    // ========================================================================
    // 3. SCORE HYPOTHESES (Plegamiento)
    // ========================================================================
    static scoreHypotheses(signals: Signal[], pamState: PamState): HypothesisScore[] {
        const scores: HypothesisScore[] = [];

        // H_OPACIDAD_ESTRUCTURAL
        {
            const violations: ConstraintsViolation[] = [];
            // Confidence boost if PAM is OPACO + Generic Labels
            const conf = pamState === "OPACO"
                ? 0.85 + 0.15 * get(signals, "S_PAM_GLOSAS_GENERICAS")
                : 0.2; // Base noise

            scores.push({
                hypothesis: "H_OPACIDAD_ESTRUCTURAL",
                confidence: clamp(conf),
                violations,
                explains: ["S_PAM_GLOSAS_GENERICAS", "S_PAM_AGRUPADOR_MATERIALES", "S_PAM_AGRUPADOR_MEDICAMENTOS"],
                requiresAssumptions: []
            });
        }

        // H_UNBUNDLING_IF319
        {
            const dayBed = get(signals, "S_DIA_CAMA_PRESENTE");
            const hotel = get(signals, "S_HOTELERIA_ITEMS");
            const food = get(signals, "S_ALIMENTACION_ITEMS");

            // High confidence if DayBed exists AND (Hotel OR Food) items are present
            const conf = clamp(0.2 + 0.4 * dayBed + 0.2 * hotel + 0.2 * food);

            scores.push({
                hypothesis: "H_UNBUNDLING_IF319",
                confidence: conf,
                violations: [],
                explains: ["S_DIA_CAMA_PRESENTE", "S_HOTELERIA_ITEMS", "S_ALIMENTACION_ITEMS"],
                requiresAssumptions: ["Se asume que ítems de hotelería no son extras solicitados por paciente"]
            });
        }

        // H_INCUMPLIMIENTO_CONTRACTUAL
        {
            const empty = get(signals, "S_CONTRATO_COBERTURAS_VACIAS");
            const mismatch = get(signals, "S_INCOHERENCIA_AMB_HOSP");
            const conf = clamp(0.2 + 0.5 * empty + 0.3 * mismatch);

            scores.push({
                hypothesis: "H_INCUMPLIMIENTO_CONTRACTUAL",
                confidence: conf,
                violations: [],
                explains: ["S_CONTRATO_COBERTURAS_VACIAS", "S_INCOHERENCIA_AMB_HOSP"],
                requiresAssumptions: []
            });
        }

        // H_PRACTICA_IRREGULAR
        // Cuando la estructura del cobro impide control sistemáticamente
        {
            const op = get(signals, "S_PAM_GLOSAS_GENERICAS");
            const rep = get(signals, "S_REPETICION_EXAMENES");
            // Pattern consistency
            const conf = clamp(0.15 + 0.5 * op + 0.2 * rep + 0.15 * get(signals, "S_HOTELERIA_ITEMS"));

            scores.push({
                hypothesis: "H_PRACTICA_IRREGULAR",
                confidence: conf,
                violations: [],
                explains: ["S_PAM_GLOSAS_GENERICAS", "S_REPETICION_EXAMENES", "S_HOTELERIA_ITEMS"],
                requiresAssumptions: []
            });
        }

        // H_FRAUDE_PROBABLE
        // Activation: High Irregular Practice + High Unbundling (Intentionality inference)
        // H_FRAUDE_PROBABLE
        // Activation: High Irregular Practice + High Unbundling (Intentionality inference)
        {
            const irregularScore = findHypothesis(scores, "H_PRACTICA_IRREGULAR")?.confidence || 0;
            const unbundlingScore = findHypothesis(scores, "H_UNBUNDLING_IF319")?.confidence || 0;

            // R2: Brake - subtract Structural Opacity to avoid circularity (Fraud must be MORE than just Opacity)
            const opScore = findHypothesis(scores, "H_OPACIDAD_ESTRUCTURAL")?.confidence || 0;

            const conf = clamp(
                0.05
                + 0.45 * irregularScore
                + 0.35 * unbundlingScore
                - 0.30 * opScore // <-- Freno estructural (R2)
            );

            scores.push({
                hypothesis: "H_FRAUDE_PROBABLE",
                confidence: conf,
                violations: [],
                explains: ["H_PRACTICA_IRREGULAR", "H_UNBUNDLING_IF319"],
                requiresAssumptions: [
                    "Se infiere intencionalidad por repetición de patrón o beneficio económico evidente."
                ]
            });
        }

        // H_OK_CUMPLIMIENTO
        // Drops if any other signal is active
        {
            const conf = clamp(
                0.9
                - 0.35 * get(signals, "S_PAM_GLOSAS_GENERICAS") // R3: Reduced from 0.6
                - 0.25 * get(signals, "S_HOTELERIA_ITEMS") // R3: Reduced from 0.3
                - 0.25 * get(signals, "S_CONTRATO_COBERTURAS_VACIAS") // R3: Reduced from 0.4
                // Reduce also if Fraud or Irregular is high
                - 0.2 * (findHypothesis(scores, "H_PRACTICA_IRREGULAR")?.confidence || 0)
            );

            scores.push({
                hypothesis: "H_OK_CUMPLIMIENTO",
                confidence: conf,
                violations: [],
                explains: [],
                requiresAssumptions: []
            });
        }

        // Sort by confidence descending
        const sortedScores = scores.sort((a, b) => b.confidence - a.confidence);

        // R6: Hypothesis Competition (Dominance/Inhibition)
        const opacityScore = findHypothesis(sortedScores, "H_OPACIDAD_ESTRUCTURAL")?.confidence || 0;
        if (opacityScore > 0.8) {
            // If Opacity is dominant, it explains the mess. Downgrade malicious intent hypotheses.
            const fraud = findHypothesis(sortedScores, "H_FRAUDE_PROBABLE");
            if (fraud) fraud.confidence *= 0.4; // Strong inhibition

            const unbundling = findHypothesis(sortedScores, "H_UNBUNDLING_IF319");
            if (unbundling) unbundling.confidence *= 0.5; // Partially obscured
        }

        return sortedScores.sort((a, b) => b.confidence - a.confidence); // Re-sort after penalties
    }

    // ========================================================================
    // SCORING HELPERS (Heuristics / Regex)
    // ========================================================================

    private static scoreGrouping(pam: any, keyword: string): number {
        // Look for lines in PAM that contain the keyword AND have "Total" > 0 but no "desglose" structure effectively used
        // Or if the content is just 1 or 2 lines for the whole category.

        let found = false;
        let isGrouped = false;
        let matchCount = 0;
        let totalCopago = 0;

        const checkItem = (item: any) => {
            const desc = (item.descripcion || "").toString();
            if (desc.toUpperCase().includes(keyword.toUpperCase())) {
                found = true;
                matchCount++;
                totalCopago += (typeof item.copago === 'number' ? item.copago : 0);

                // If it says "Agrupado" or "Consolidado" or just "Materiales" without specific detail
                if (/(agrup|consolid|generico|varios|total|clinicos|quirurgicos)/i.test(desc) || desc.trim().toUpperCase() === keyword.toUpperCase()) {
                    isGrouped = true;
                }
            }
        };

        // Traverse PAM
        if (pam.folios) {
            pam.folios.forEach((f: any) => {
                f.desglosePorPrestador?.forEach((p: any) => {
                    p.items?.forEach((i: any) => checkItem(i));
                });
                // Also check folio level items if any
                f.items?.forEach((i: any) => checkItem(i));
            });
        } else if (pam.items) {
            pam.items.forEach((i: any) => checkItem(i));
        }

        // Logic: 
        // 1. If explicit keyword found (e.g. "MATERIALES CLINICOS") or explicit 'Agrupado' -> 1.0
        if (found && isGrouped) return 1.0;

        // 2. If valid category found but very few items (e.g. <= 2 lines) AND total Copago is high -> High likelihood of grouping
        if (found && matchCount <= 2 && totalCopago > 10000) {
            return 0.9;
        }

        if (found) return 0.3; // Found but maybe detailed?
        return 0;
    }

    private static scoreGenericLabels(pam: any): number {
        // Count generic terms as per Forensic V6 doctrine
        const GENERIC_REGEX = /(GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|NO CUBIERTO|RECHAZO|AJUSTE|VARIO|INSUMO VARIO)/i;
        let totalItems = 0;
        let genericItems = 0;

        const countItem = (desc: string) => {
            totalItems++;
            if (GENERIC_REGEX.test(desc)) genericItems++;
        };

        if (pam.folios) {
            pam.folios.forEach((f: any) => {
                f.desglosePorPrestador?.forEach((p: any) => {
                    p.items?.forEach((i: any) => countItem(i.descripcion || ""));
                });
            });
        } else if (pam.desglosePorPrestador) {
            pam.desglosePorPrestador.forEach((p: any) => {
                p.items?.forEach((i: any) => countItem(i.descripcion || ""));
            });
        } else if (pam.items) {
            pam.items.forEach((i: any) => countItem(i.descripcion || ""));
        }

        if (totalItems === 0) return 0;
        // Return 1.0 if at least one hard generic glosa found (Forensic Trigger)
        return genericItems > 0 ? 1.0 : 0;
    }

    private static hasDayBed(cuenta: any): boolean {
        // Look for "DIA CAMA" or "DIAS CAMA" in account
        const REGEX_DAYBED = /DIA[\s_]*CAMA|HABITACION|SALA|PENSION/i;
        let found = false;

        const sections = cuenta.sections || [];
        sections.forEach((s: any) => {
            if (REGEX_DAYBED.test(s.category || "")) found = true;
            s.items?.forEach((i: any) => {
                if (REGEX_DAYBED.test(i.description || "")) found = true;
            });
        });

        return found;
    }

    private static scoreHoteleriaItems(cuenta: any): number {
        // Look for items typically included in Day Bed (Unbundling)
        // e.g., Toallas, Sabanas, TV, Wifi, Parking, Agua, etc.
        const REGEX_HOTEL = /(toalla|sabana|frazada|almohada|tv cable|wifi|estacionamiento|agrup. pabellon)/i;
        let matches = 0;
        let total = 0;

        const sections = cuenta.sections || [];
        sections.forEach((s: any) => {
            s.items?.forEach((i: any) => {
                total++;
                if (REGEX_HOTEL.test(i.description || "")) matches++;
            });
        });

        if (total === 0) return 0;
        // Normalize: if 3+ items found, we consider it high signal (1.0)
        return Math.min(1, matches / 3);
    }

    private static scoreFoodItems(cuenta: any): number {
        const REGEX_FOOD = /(almuerzo|cena|desayuno|colacion|liquido|nutrici|alimenta)/i;
        let matches = 0;

        const sections = cuenta.sections || [];
        sections.forEach((s: any) => {
            s.items?.forEach((i: any) => {
                if (REGEX_FOOD.test(i.description || "")) matches++;
            });
        });

        return Math.min(1, matches / 2); // 2+ items = 1.0
    }

    private static scoreAmbHospMismatch(contrato: any, cuenta: any): number {
        // Heuristic: If contract has only "AMBULATORIO" coverage but account has "DIA CAMA", it's a mismatch

        // 1. Check account type
        const hasDayBed = this.hasDayBed(cuenta);
        const isHospital = hasDayBed; // Simple proxy

        // 2. Check contract coverages (Legacy vs Canonical)
        const isCanonical = !!contrato?.metadata || (contrato?.coberturas && contrato?.coberturas.some((c: any) => Array.isArray(c.modalidades)));
        const coberturas = contrato?.coberturas || [];

        let hasHospitalCoverage = false;
        let hasAmbulatoryCoverage = false;

        if (isCanonical) {
            hasHospitalCoverage = coberturas.some((c: any) =>
                /HOSPITALARIO|CAMA|PABELLON|UTI|UCI/i.test(c.categoria || "") ||
                /HOSPITALARIO/i.test(c.categoria_canonica || "") ||
                /HOSPITALARIO/i.test(c.ambito || "")
            );
            hasAmbulatoryCoverage = coberturas.some((c: any) =>
                /AMBULATORIO|CONSULTA|LABORATORIO|IMAGEN/i.test(c.categoria || "") ||
                /AMBULATORIO/i.test(c.categoria_canonica || "") ||
                /AMBULATORIO/i.test(c.ambito || "")
            );
        } else {
            hasHospitalCoverage = coberturas.some((c: any) =>
                /HOSPITAL|SALA|CAMA|DIARIA/i.test(c.modalidad || "") ||
                /HOSPITAL/i.test(c.categoria || "")
            );
            hasAmbulatoryCoverage = coberturas.some((c: any) =>
                /AMBULATORI|CONSULTA/i.test(c.modalidad || "")
            );
        }

        if (isHospital && !hasHospitalCoverage && hasAmbulatoryCoverage) {
            return 1.0; // Mismatch: Hospital Bill vs Ambulatory Contract
        }

        return 0;
    }

    private static scoreRepetition(cuenta: any): number {
        // Detect suspicious repetition of same item codes/descriptions in short timeframe
        // Or simply high frequency of same code
        const codeCounts: { [key: string]: number } = {};
        let maxRep = 0;

        const sections = cuenta.sections || [];
        sections.forEach((s: any) => {
            s.items?.forEach((i: any) => {
                const k = (i.code || i.description || "").trim().toUpperCase();
                if (k.length > 3) { // Ignore short/junk
                    codeCounts[k] = (codeCounts[k] || 0) + 1;
                    if (codeCounts[k] > maxRep) maxRep = codeCounts[k];
                }
            });
        });

        // Heuristic: if same item appears > 10 times, it's repetitive (maybe justified, but a signal)
        if (maxRep > 20) return 1.0;
        if (maxRep > 10) return 0.7;
        if (maxRep > 5) return 0.3;
        return 0;
    }
    // ========================================================================
    // 4. ACTIVATE CONTEXTS (Gating / Sub-motor Isolation)
    // ========================================================================
    // Need input to check economic magnitude
    static activateContexts(ranking: HypothesisScore[], pamState: PamState, input?: AlphaFoldInput): HypothesisId[] {
        const active: HypothesisId[] = [];
        const score = (id: HypothesisId) => ranking.find(h => h.hypothesis === id)?.confidence || 0;

        // R1: Opacity Magnitude Check
        // Only trigger H_OPACIDAD_ESTRUCTURAL if it represents significant % of total copay (>15%)
        // Or if we don't have input (fallback to legacy behavior)
        if (pamState === "OPACO") {
            let isSignificant = true;
            if (input && input.pam) {
                const opAmount = this.calcOpaqueCopay(input.pam);
                const total = this.calcTotalCopay(input.pam);
                if (total > 0 && (opAmount / total) < 0.15) {
                    isSignificant = false;
                }
            }
            if (isSignificant) active.push("H_OPACIDAD_ESTRUCTURAL");
        }

        // Si unbundling con confianza suficiente
        if (score("H_UNBUNDLING_IF319") > 0.6) active.push("H_UNBUNDLING_IF319");

        // Si contrato incoherente
        if (score("H_INCUMPLIMIENTO_CONTRACTUAL") > 0.6) active.push("H_INCUMPLIMIENTO_CONTRACTUAL");

        // Prácticas irregulares si supera umbral
        if (score("H_PRACTICA_IRREGULAR") > 0.65) active.push("H_PRACTICA_IRREGULAR");

        // Fraude probable: umbral alto + condiciones (gating estricto)
        // Solo si: Fraud > 0.8 AND Irregular > 0.75 AND Unbundling > 0.65
        if (
            score("H_FRAUDE_PROBABLE") > 0.8 &&
            score("H_PRACTICA_IRREGULAR") > 0.75 &&
            score("H_UNBUNDLING_IF319") > 0.65
        ) {
            active.push("H_FRAUDE_PROBABLE");
        }

        // Add H_OK_CUMPLIMIENTO if very high and no critical active alerts? 
        // Or if it's the top 1.
        if (ranking[0].hypothesis === "H_OK_CUMPLIMIENTO" && active.length === 0) {
            active.push("H_OK_CUMPLIMIENTO");
        }

        return [...new Set(active)]; // Unique
    }

    // ========================================================================
    // 5. BUILD FINDINGS (Clasificación A/B/Z/OK)
    // ========================================================================
    static buildFindings(input: AlphaFoldInput, pamState: PamState, active: HypothesisId[]): any[] {
        const findings: any[] = []; // Using any[] temporarily effectively matching Finding[] structure

        // Opacidad => Cat Z parcial (solo scope opaco)
        if (pamState === "OPACO") {
            const amountOpaco = this.calcOpaqueCopay(input.pam); // suma materiales+medicamentos+glosas genéricas del PAM
            if (amountOpaco > 0) {
                findings.push({
                    id: "F_OPACIDAD_MAT_MED",
                    category: "B",
                    label: "MATERIALES/MEDICAMENTOS SIN APERTURA",
                    amount: amountOpaco,
                    action: "SOLICITAR_ACLARACION",
                    evidenceRefs: ["PAM: Líneas Agrupadas"],
                    rationale: "PAM agrupador impide validar topes/exclusiones; carga de claridad recae en prestador/Isapre.",
                    hypothesisParent: "H_OPACIDAD_ESTRUCTURAL"
                });
            }
        }

        // Unbundling IF-319 => Cat A si está probado 1:1, sino B
        if (active.includes("H_UNBUNDLING_IF319")) {
            const u = this.detectUnbundlingHotel(input.cuenta);
            if (u.amount > 0) {
                // Heuristic for Proven vs Possible:
                // If specific keywords (TOALLA, SABANA) -> A (Proven Unjustified)
                // If vague (SALA PROCEDIMIENTO) -> B
                const isProven = u.highConfidence;

                if (isProven) {
                    findings.push({
                        id: "F_UNBUNDLING_HOTELERIA",
                        category: "A",
                        label: "HOTELERÍA / ALIMENTACIÓN COBRADA APARTE (UNBUNDLING)",
                        amount: u.amount,
                        action: "IMPUGNAR",
                        evidenceRefs: u.itemRefs,
                        rationale: "Componentes inherentes al Día Cama no deben cobrarse separados.",
                        hypothesisParent: "H_UNBUNDLING_IF319"
                    });
                } else {
                    // R4: Prevent Double Counting (Opacity vs Unbundling)
                    // If Opacity is active structually, we shouldn't add vague unbundling findings 
                    // that might already be covered by the generic opacity bucket, unless we are sure.
                    const isOpacityActive = active.includes("H_OPACIDAD_ESTRUCTURAL");
                    if (!isOpacityActive) {
                        findings.push({
                            id: "F_UNBUNDLING_POSIBLE",
                            category: "B",
                            label: "POSIBLE HOTELERÍA/ALIMENTACIÓN (REQUIERE ACLARACIÓN)",
                            amount: u.amount,
                            action: "SOLICITAR_ACLARACION",
                            evidenceRefs: u.itemRefs,
                            rationale: "No se puede distinguir paciente vs acompañante / glosa insuficiente.",
                            hypothesisParent: "H_UNBUNDLING_IF319"
                        });
                    }
                }
            }
        }

        // Note: Default/OK items are not findings, they remain in the balance pool
        return findings;
    }

    // ========================================================================
    // 6. BALANCE CORRECTO
    // ========================================================================
    static buildBalance(totalCopago: number, findings: any[]): any {
        const sum = (cat: string) => findings.filter(f => f.category === cat).reduce((s, f) => s + (f.amount || 0), 0);

        const A = sum("A");
        const B = sum("B");
        const Z = sum("Z");

        // OK = Total - (A+B+Z), clamped to 0
        const OK = Math.max(0, totalCopago - A - B - Z);

        return { A, B, Z, OK, TOTAL: totalCopago };
    }

    // ========================================================================
    // 7. DECISIÓN GLOBAL
    // ========================================================================
    static globalDecision(active: HypothesisId[], ranking: HypothesisScore[], balance: any): any {
        const op = active.includes("H_OPACIDAD_ESTRUCTURAL");
        const irr = active.includes("H_PRACTICA_IRREGULAR");
        const fraud = active.includes("H_FRAUDE_PROBABLE");

        // Estado global es un resumen, no sentencia penal
        // Estado global es un resumen, no sentencia penal
        let estado = "AUDITORIA_CONCLUIDA";

        // R7: Decision Economic Impact Check
        // Fraude solo si representa > 25% del total en Ahorro Confirmado (A)
        let isFraudEconomicallySignificant = false;
        if (fraud) {
            const ratioA = (balance.A || 0) / (balance.TOTAL || 1);
            if (ratioA > 0.25) isFraudEconomicallySignificant = true;
        }

        if (fraud && isFraudEconomicallySignificant) estado = "PATRON_COMPATIBLE_CON_FRAUDE_PROBABLE";
        else if (irr && op) estado = "PRACTICAS_IRREGULARES_CON_OPACIDAD_ESTRUCTURAL";
        else if (op) estado = "COPAGO_INDETERMINADO_PARCIAL_POR_OPACIDAD";

        const conf = ranking[0]?.confidence ?? 0.5;

        let fundamento = "No se detectan inconsistencias estructurales relevantes con la evidencia disponible.";
        if (fraud) fundamento = "La estructura observada es consistente con prácticas irregulares reiterables con beneficio económico; requiere verificación externa.";
        else if (irr) fundamento = "Se observan prácticas irregulares (opacidad/unbundling/repetición) que afectan exigibilidad y trazabilidad.";
        else if (op) fundamento = "Existe opacidad estructural en ítems específicos; exige desglose para validar topes/exclusiones.";

        return { estado, confianza: conf, fundamento };
    }

    // ========================================================================
    // HELPERS FOR FINDINGS
    // ========================================================================

    private static calcOpaqueCopay(pam: any): number {
        // Sum lines that match grouping criteria
        let sum = 0;
        const keywords = ["MATERIALES", "MEDICAMENTOS", "INSUMOS", "SUMINISTROS"];

        const processItem = (item: any) => {
            const desc = (item.descripcion || "").toUpperCase();
            // Check if matches generic/grouping
            const isTarget = keywords.some(k => desc.includes(k));
            const isGroupLabel = /(agrup|consolid|generico|varios|total)/i.test(desc);

            // If it matches grouping keywords OR it just is "MATERIALES CLINICOS" without detail
            // AND assumption: if we are in this function, we determined PAM is OPAQUE.
            // So we agressively sum generic-looking lines.
            if (isTarget || isGroupLabel) {
                sum += (typeof item.copago === 'number' ? item.copago : 0);
            }
        };

        if (pam.folios) {
            pam.folios.forEach((f: any) => {
                f.desglosePorPrestador?.forEach((p: any) => p.items?.forEach(processItem));
                f.items?.forEach(processItem);
            });
        } else if (pam.items) {
            pam.items.forEach(processItem);
        }
        return sum;
    }

    private static detectUnbundlingHotel(cuenta: any): { amount: number, highConfidence: boolean, itemRefs: string[] } {
        const REGEX_HOTEL = /(toalla|sabana|frazada|almohada|tv cable|wifi|estacionamiento|agrup. pabellon|alimenta|nutrici|colacion|almuerzo|cena|desayuno)/i;
        const REGEX_HIGH_CONFIDENCE = /(toalla|sabana|tv cable|wifi|estacionamiento)/i;

        let amount = 0;
        let highConfMatches = 0;
        const refs: string[] = [];

        const processItem = (i: any) => {
            const desc = (i.description || "").toString();
            if (REGEX_HOTEL.test(desc)) {
                // Prioritize copago for reconciliation accuracy
                const val = typeof i.copago === 'number' ? i.copago :
                    typeof i.total === 'number' ? i.total : 0;
                amount += val;
                refs.push(`${desc} ($${val})`);
                if (REGEX_HIGH_CONFIDENCE.test(desc)) highConfMatches++;
            }
        };

        const sections = cuenta.sections || [];
        sections.forEach((s: any) => s.items?.forEach(processItem));

        return {
            amount,
            highConfidence: highConfMatches > 0, // specific hotel items are dead giveaways
            itemRefs: refs
        };
    }
    private static calcTotalCopay(pam: any): number {
        let sum = 0;
        const processItem = (item: any) => {
            const val = typeof item.copago === 'number' ? item.copago :
                typeof item.copago === 'string' ? parseInt(item.copago.replace(/\./g, '')) : 0;
            if (!isNaN(val)) sum += val;
        };

        if (pam.folios) {
            pam.folios.forEach((f: any) => {
                f.desglosePorPrestador?.forEach((p: any) => p.items?.forEach(processItem));
                f.items?.forEach(processItem);
            });
        } else if (pam.items) {
            pam.items.forEach(processItem);
        }
        return sum;
    }

    private static scoreCategoryValidation(pam: any, category: string): number {
        // Simple heuristic: if we find clear codes (not 8002001/9001001 generic ones) 
        // for the category, it's considered "validated" or at least "analyzable"
        const GENERIC_CODES = ["8002001", "9001001", "9201001", "201407", "9201003"];
        let count = 0;
        let genericCount = 0;

        const check = (i: any) => {
            const desc = (i.descripcion || "").toUpperCase();
            // Fix: Broader detection for Honorarios (Roles, not just literal "HONORARIO")
            const isHonorario = category === "HONORARIO" &&
                (desc.includes("HONORARIO") || desc.includes("CIRUJANO") || desc.includes("ANESTESISTA") || desc.includes("MEDICO") || desc.includes("VISITA") || desc.includes("INTERCONSULTA"));

            if (desc.includes(category.toUpperCase()) || isHonorario) {
                count++;
                if (GENERIC_CODES.includes(i.codigoGC)) genericCount++;
                // Additional check: if copago is present but bonificacion is 0 
                // and it's not a known excluded item, it might be a tope hit
            }
        };

        if (pam.folios) {
            pam.folios.forEach((f: any) => {
                f.desglosePorPrestador?.forEach((p: any) => p.items?.forEach(check));
                f.items?.forEach(check);
            });
        } else if (pam.items) {
            pam.items.forEach(check);
        }

        if (count === 0) return 0;
        // If > 70% of items are generic/grouped, validation is low (0)
        return (genericCount / count) > 0.7 ? 0 : 1;
    }

}
