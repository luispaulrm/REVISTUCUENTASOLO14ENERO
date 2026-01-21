// ============================================================================
// HYPOTHESIS-DRIVEN AUDIT ENGINE (V5 Architecture)
// ============================================================================
// Purpose: Detect fraud patterns dynamically and activate/block rules contextually.
// Key innovation: Scope-based isolation (GLOBAL/SECTION/PAM_LINE/ITEM_SET).

export type HypothesisId =
    | "H1_OPACIDAD"
    | "H2_UNBUNDLING"
    | "H3_HOTELERIA"
    | "H4_INCOHERENCIA_QX"
    | "H5_TEST_CASE";

export type HypothesisScopeType = "GLOBAL" | "SECTION" | "PAM_LINE" | "ITEM_SET";

export interface HypothesisScope {
    type: HypothesisScopeType;

    // Optional identifiers based on scope:
    sectionId?: string;      // e.g., "1112_HMED_2SUR"
    pamLineKey?: string;     // e.g., "MATERIALES_CLINICOS_QUIRURGICOS"
    itemIds?: string[];      // internal IDs of bill items
    categories?: string[];   // e.g., ["MATERIALES", "MEDICAMENTOS"]
}

export interface Signal {
    id: string;              // e.g., "S_PAM_AGRUPACION_MASIVA"
    description: string;
    evidence: {
        source: "PAM" | "CUENTA" | "CONTRATO" | "METADATA";
        pointers?: string[];   // JSON paths, page refs, keys
        sample?: unknown;      // limited sample (not massive)
    };
    score: number;           // 0..1
}

export type Capability =
    | "TRANSPARENCIA_OPACIDAD"
    | "UNBUNDLING_IF319"
    | "CALCULO_TOPES_UF_VA_VAM"
    | "VALIDACION_PRECIOS_UNITARIOS"
    | "DETECCION_HOTELERIA"
    | "REGLAS_SINTETICAS_TEST";

export interface ActiveHypothesis {
    id: HypothesisId;
    label: string;
    confidence: number;      // 0..1
    scope: HypothesisScope;
    signals: Signal[];

    // Defines what capabilities this hypothesis enables/blocks in its scope
    enables: Capability[];
    blocks: Capability[];

    // For deterministic debugging:
    rationale: string;
}

export interface CapabilityMatrix {
    // capability -> scopes where it's allowed/prohibited
    enabled: Array<{
        capability: Capability;
        scope: HypothesisScope;
        by: HypothesisId;
        confidence: number
    }>;
    blocked: Array<{
        capability: Capability;
        scope: HypothesisScope;
        by: HypothesisId;
        confidence: number
    }>;
}

export interface HypothesisRouterResult {
    hypotheses: ActiveHypothesis[];
    capabilityMatrix: CapabilityMatrix;
}

// ============================================================================
// Input contracts
// ============================================================================

export interface HypothesisRouterInput {
    cuentaSections: Array<{
        sectionId: string;
        items: Array<{
            id: string;
            desc: string;
            amount: number;
            category?: string
        }>
    }>;
    pam: {
        lines: Array<{
            key: string;
            desc: string;
            amount: number;
            isGeneric?: boolean;
            itemCountHint?: number
        }>
    };
    contract: {
        rawText?: string;
        parsed?: unknown
    };
    metadata?: {
        test_case?: boolean;
        patientName?: string;
        auditId?: string
    };
}

// ============================================================================
// Main Service
// ============================================================================

export class HypothesisRouterService {

    detect(input: HypothesisRouterInput): HypothesisRouterResult {
        const hyps: ActiveHypothesis[] = [];

        // H5 first: "kills" production if active
        const h5 = this.detectH5_TestCase(input);
        if (h5) hyps.push(h5);

        // H1: opacity (per PAM line)
        const h1List = this.detectH1_OpacidadPorPamLine(input);
        hyps.push(...h1List);

        const h2List = this.detectH2_Unbundling(input);
        hyps.push(...h2List);

        // H3: Hoteleria (per SECTION scope)
        const h3List = this.detectH3_Hoteleria(input);
        hyps.push(...h3List);

        // Resolve conflicts and build matrix
        return this.buildResultWithConflictResolution(hyps);
    }

    // ==========================================================================
    // H5: Synthetic Test Case (GLOBAL scope)
    // ==========================================================================
    private detectH5_TestCase(input: HypothesisRouterInput): ActiveHypothesis | null {
        const isTest = Boolean(input.metadata?.test_case)
            || /moises\s+retamal/i.test(input.metadata?.patientName ?? "");

        if (!isTest) return null;

        return {
            id: "H5_TEST_CASE",
            label: "Stress Test / Caso Sintético",
            confidence: 0.99,
            scope: { type: "GLOBAL" },
            signals: [{
                id: "S_TEST_METADATA",
                description: "Metadata or name triggers test mode",
                evidence: {
                    source: "METADATA",
                    pointers: ["metadata.test_case", "metadata.patientName"],
                    sample: input.metadata
                },
                score: 0.99
            }],
            enables: ["REGLAS_SINTETICAS_TEST"],
            blocks: [
                "TRANSPARENCIA_OPACIDAD",
                "UNBUNDLING_IF319",
                "CALCULO_TOPES_UF_VA_VAM",
                "VALIDACION_PRECIOS_UNITARIOS",
                "DETECCION_HOTELERIA"
            ],
            rationale: "Test mode active: production rules blocked to avoid cross-contamination."
        };
    }

    // ==========================================================================
    // H1: Structural Opacity (per PAM_LINE scope)
    // ==========================================================================
    private detectH1_OpacidadPorPamLine(input: HypothesisRouterInput): ActiveHypothesis[] {
        const cuentaItemCount = input.cuentaSections.reduce((acc, s) => acc + s.items.length, 0);
        const out: ActiveHypothesis[] = [];

        for (const line of input.pam.lines) {
            const isGeneric = line.isGeneric ??
                /material|insumo|medicamento|varios|sin bonific/i.test(line.desc.toLowerCase());

            // Trigger: generic PAM line + massive bill granularity + few PAM lines
            const trigger = isGeneric && cuentaItemCount >= 50 && input.pam.lines.length <= 10;

            if (!trigger) continue;

            out.push({
                id: "H1_OPACIDAD",
                label: "Opacidad estructural en PAM",
                confidence: 0.85,
                scope: {
                    type: "PAM_LINE",
                    pamLineKey: line.key,
                    categories: ["MATERIALES", "MEDICAMENTOS", "SIN_BONIFICACION"]
                },
                signals: [
                    {
                        id: "S_PAM_LINEA_GENERICA",
                        description: "Generic PAM line prevents traceability",
                        evidence: {
                            source: "PAM",
                            pointers: [`pam.lines[key=${line.key}]`],
                            sample: { desc: line.desc, amount: line.amount }
                        },
                        score: 0.9
                    },
                    {
                        id: "S_CUENTA_MASIVA",
                        description: "Bill has high granularity vs aggregated PAM",
                        evidence: {
                            source: "CUENTA",
                            pointers: ["cuentaSections[*].items.length"],
                            sample: { cuentaItemCount }
                        },
                        score: 0.8
                    }
                ],
                enables: ["TRANSPARENCIA_OPACIDAD"],
                blocks: [
                    "UNBUNDLING_IF319",
                    "VALIDACION_PRECIOS_UNITARIOS",
                    "CALCULO_TOPES_UF_VA_VAM"
                ],
                rationale: "Without PAM breakdown by item, fine-grained audit or unbundling detection is impossible for this line."
            });
        }

        return out;
    }

    // ==========================================================================
    // H2: Undue Unbundling (per SECTION scope)
    // ==========================================================================
    private detectH2_Unbundling(input: HypothesisRouterInput): ActiveHypothesis[] {
        const out: ActiveHypothesis[] = [];
        const surgicalKeywords = /pabellon|quirurg|intervencion|cirugia|honorario/i;

        for (const section of input.cuentaSections) {
            // Only analyze surgical/pabellon sections
            if (!surgicalKeywords.test(section.sectionId)) continue;

            // Heuristic 1: High density of low-cost items (e.g. > 10 items under 10000 CLP)
            const lowCostItems = section.items.filter(i => i.amount < 15000);
            const highDensity = lowCostItems.length > 8; // Threshold for unbundling suspicion

            // Heuristic 2: Specific unbundling keywords in item descriptions
            const unbundlingKeywords = /aposito|sutura|hoja|bisturi|guante|jeringa|aguj|cateter|sonda|compres|gasas/i;
            const suspiciousItems = section.items.filter(i => unbundlingKeywords.test(i.desc));
            const keywordTrigger = suspiciousItems.length > 3;

            if (highDensity || keywordTrigger) {
                out.push({
                    id: "H2_UNBUNDLING",
                    label: "Fraccionamiento Indebido (Unbundling)",
                    confidence: 0.8, // Start high
                    scope: {
                        type: "SECTION",
                        sectionId: section.sectionId,
                        categories: ["MATERIALES", "INSUMOS"]
                    },
                    signals: [
                        {
                            id: "S_DENSIDAD_BAJO_COSTO",
                            description: "High density of low-cost items in surgical section",
                            evidence: {
                                source: "CUENTA",
                                pointers: [`cuentaSections[${section.sectionId}]`],
                                sample: { count: lowCostItems.length, threshold: 8 }
                            },
                            score: 0.85
                        },
                        {
                            id: "S_KEYWORDS_INSUMOS_BASICOS",
                            description: "Explicit mention of basic supplies usually bundled",
                            evidence: {
                                source: "CUENTA",
                                pointers: [`cuentaSections[${section.sectionId}]`],
                                sample: { items: suspiciousItems.slice(0, 3).map(i => i.desc) }
                            },
                            score: 0.9
                        }
                    ],
                    enables: ["UNBUNDLING_IF319"],
                    blocks: [], // Doesn't block anything, just enables strict checks
                    rationale: "Presence of distinct low-cost clinical supplies triggers IF-319 integrity check."
                });
            }
        }
        return out;
    }

    // ==========================================================================
    // H3: Concealed Hotel Expenses (Hotelería)
    // ==========================================================================
    private detectH3_Hoteleria(input: HypothesisRouterInput): ActiveHypothesis[] {
        const out: ActiveHypothesis[] = [];
        const hotelKeywords = /hoteleria|habitacion|cama|hospitalizacion/i;
        const comfortKeywords = /calcetin|media|toalla|agua|botella|termometro|vaso|jabon|shampoo|kit|confort/i;

        for (const section of input.cuentaSections) {
            // Check if section contains comfort items
            const comfortItems = section.items.filter(i => comfortKeywords.test(i.desc));

            // Heuristic: If we see comfort items charged separately (especially if section is 'clinical' or even 'hotel' but should be included)
            if (comfortItems.length > 0) {
                out.push({
                    id: "H3_HOTELERIA",
                    label: "Hotelería Oculta / Cobro Separado Confort",
                    confidence: 0.9,
                    scope: {
                        type: "SECTION",
                        sectionId: section.sectionId,
                        categories: ["HOTELERIA", "INSUMOS"] // Target these for remediation
                    },
                    signals: [
                        {
                            id: "S_ITEMS_CONFORT",
                            description: "Items of personal comfort charged separately",
                            evidence: {
                                source: "CUENTA",
                                pointers: [`cuentaSections[${section.sectionId}]`],
                                sample: { items: comfortItems.slice(0, 3).map(i => i.desc) }
                            },
                            score: 0.95
                        }
                    ],
                    enables: ["DETECCION_HOTELERIA"],
                    blocks: [],
                    rationale: "Comfort items must be included in Bed Day fee (Dia Cama) per regulations."
                });
            }
        }
        return out;
    }

    // ==========================================================================
    // Conflict Resolution: Build Capability Matrix with Scope-based Dominance
    // ==========================================================================
    private buildResultWithConflictResolution(hypotheses: ActiveHypothesis[]): HypothesisRouterResult {

        // 1) Deterministic ordering by dominance + confidence
        const priority = (h: ActiveHypothesis) => {
            const base = h.id === "H5_TEST_CASE" ? 100 : h.id === "H1_OPACIDAD" ? 80 : 50;
            return base + h.confidence;
        };
        const sorted = [...hypotheses].sort((a, b) => priority(b) - priority(a));

        // 2) Build capability matrix
        const enabled: CapabilityMatrix["enabled"] = [];
        const blocked: CapabilityMatrix["blocked"] = [];

        for (const h of sorted) {
            for (const cap of h.enables) {
                enabled.push({ capability: cap, scope: h.scope, by: h.id, confidence: h.confidence });
            }
            for (const cap of h.blocks) {
                blocked.push({ capability: cap, scope: h.scope, by: h.id, confidence: h.confidence });
            }
        }

        // 3) Explicit GLOBAL override: if H5 is active globally, block all production
        const hasH5Global = sorted.some(
            h => h.id === "H5_TEST_CASE" && h.scope.type === "GLOBAL" && h.confidence >= 0.7
        );

        if (hasH5Global) {
            const globalScope: HypothesisScope = { type: "GLOBAL" };
            blocked.push(
                { capability: "TRANSPARENCIA_OPACIDAD", scope: globalScope, by: "H5_TEST_CASE", confidence: 1 },
                { capability: "UNBUNDLING_IF319", scope: globalScope, by: "H5_TEST_CASE", confidence: 1 },
                { capability: "DETECCION_HOTELERIA", scope: globalScope, by: "H5_TEST_CASE", confidence: 1 }
            );
            enabled.push(
                { capability: "REGLAS_SINTETICAS_TEST", scope: globalScope, by: "H5_TEST_CASE", confidence: 1 }
            );
        }

        return { hypotheses: sorted, capabilityMatrix: { enabled, blocked } };
    }
}

// ============================================================================
// Utility: Scope Intersection (for gates in rules engine)
// ============================================================================

export function scopesIntersect(a: HypothesisScope, b: HypothesisScope): boolean {
    // GLOBAL always intersects everything
    if (a.type === "GLOBAL" || b.type === "GLOBAL") return true;

    // PAM_LINE intersects if keys match or categories overlap
    if (a.type === "PAM_LINE" && b.type === "PAM_LINE") {
        if (a.pamLineKey === b.pamLineKey) return true;
        if (a.categories && b.categories) {
            return a.categories.some(cat => b.categories!.includes(cat));
        }
    }

    // SECTION intersects if sectionIds match
    if (a.type === "SECTION" && b.type === "SECTION") {
        return a.sectionId === b.sectionId;
    }

    // ITEM_SET intersects if any itemId matches
    if (a.type === "ITEM_SET" && b.type === "ITEM_SET") {
        if (a.itemIds && b.itemIds) {
            return a.itemIds.some(id => b.itemIds!.includes(id));
        }
    }

    // Cross-type: PAM_LINE can intersect ITEM_SET if categories match
    if ((a.type === "PAM_LINE" && b.type === "ITEM_SET") ||
        (a.type === "ITEM_SET" && b.type === "PAM_LINE")) {
        const pamScope = a.type === "PAM_LINE" ? a : b;
        // Assume items have categories; this would need real mapping
        // For now, conservative: assume intersection
        return true; // TODO: implement proper PAM↔Item category mapping
    }

    // Default: no intersection
    return false;
}

// ============================================================================
// Gate Function: Check if capability is allowed in current scope
// ============================================================================

export interface RuleContext {
    capabilities: CapabilityMatrix;
    currentScope: HypothesisScope; // scope of the item/line/section being evaluated
}

export function isCapabilityAllowed(ctx: RuleContext, cap: Capability): boolean {
    // 1) If there's a block that intersects current scope -> false
    const blocked = ctx.capabilities.blocked.some(
        b => b.capability === cap && scopesIntersect(b.scope, ctx.currentScope)
    );
    if (blocked) return false;

    // 2) If there's an enable that intersects -> true
    const enabled = ctx.capabilities.enabled.some(
        e => e.capability === cap && scopesIntersect(e.scope, ctx.currentScope)
    );

    // Policy for "dangerous" rules (fine-grained calc, IF-319): default false if not enabled
    const dangerousCapabilities: Capability[] = [
        "UNBUNDLING_IF319",
        "VALIDACION_PRECIOS_UNITARIOS",
        "CALCULO_TOPES_UF_VA_VAM"
    ];

    if (dangerousCapabilities.includes(cap)) {
        return enabled; // Must be explicitly enabled
    }

    // For "safe" rules (descriptive): default true
    return true;
}
