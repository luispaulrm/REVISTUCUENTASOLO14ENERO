
// ============================================================================
// STANDALONE VERIFICATION SCRIPT FOR HYPOTHESIS ENGINE
// ============================================================================

// 1. TYPES & INTERFACES (Copied from hypothesisRouter.service.ts)
type HypothesisId = "H1_OPACIDAD" | "H2_UNBUNDLING" | "H3_HOTELERIA" | "H4_INCOHERENCIA_QX" | "H5_TEST_CASE";
type HypothesisScopeType = "GLOBAL" | "SECTION" | "PAM_LINE" | "ITEM_SET";

interface HypothesisScope {
    type: HypothesisScopeType;
    sectionId?: string;
    pamLineKey?: string;
    itemIds?: string[];
    categories?: string[];
}

interface Signal {
    id: string;
    description: string;
    evidence: { source: string; pointers?: string[]; sample?: any };
    score: number;
}

type Capability =
    | "TRANSPARENCIA_OPACIDAD"
    | "UNBUNDLING_IF319"
    | "CALCULO_TOPES_UF_VA_VAM"
    | "VALIDACION_PRECIOS_UNITARIOS"
    | "DETECCION_HOTELERIA"
    | "REGLAS_SINTETICAS_TEST";

interface ActiveHypothesis {
    id: HypothesisId;
    label: string;
    confidence: number;
    scope: HypothesisScope;
    signals: Signal[];
    enables: Capability[];
    blocks: Capability[];
    rationale: string;
}

interface CapabilityMatrix {
    enabled: Array<{ capability: Capability; scope: HypothesisScope; by: HypothesisId; confidence: number }>;
    blocked: Array<{ capability: Capability; scope: HypothesisScope; by: HypothesisId; confidence: number }>;
}

interface HypothesisRouterResult {
    hypotheses: ActiveHypothesis[];
    capabilityMatrix: CapabilityMatrix;
}

interface HypothesisRouterInput {
    cuentaSections: Array<{ sectionId: string; items: Array<{ id: string; desc: string; amount: number; category?: string }> }>;
    pam: { lines: Array<{ key: string; desc: string; amount: number; isGeneric?: boolean; itemCountHint?: number }> };
    contract: { parsed?: unknown };
    metadata?: { test_case?: boolean; patientName?: string; auditId?: string };
}

// 2. LOGIC IMPLEMENTATION (Copied from hypothesisRouter.service.ts)
class HypothesisRouterService {
    detect(input: HypothesisRouterInput): HypothesisRouterResult {
        const hyps: ActiveHypothesis[] = [];
        const h5 = this.detectH5_TestCase(input);
        if (h5) hyps.push(h5);
        const h1List = this.detectH1_OpacidadPorPamLine(input);
        hyps.push(...h1List);
        return this.buildResultWithConflictResolution(hyps);
    }

    private detectH5_TestCase(input: HypothesisRouterInput): ActiveHypothesis | null {
        const isTest = Boolean(input.metadata?.test_case) || /moises\s+retamal/i.test(input.metadata?.patientName ?? "");
        if (!isTest) return null;
        return {
            id: "H5_TEST_CASE",
            label: "Stress Test / Caso Sintético",
            confidence: 0.99,
            scope: { type: "GLOBAL" },
            signals: [],
            enables: ["REGLAS_SINTETICAS_TEST"],
            blocks: ["TRANSPARENCIA_OPACIDAD", "UNBUNDLING_IF319", "CALCULO_TOPES_UF_VA_VAM", "VALIDACION_PRECIOS_UNITARIOS", "DETECCION_HOTELERIA"],
            rationale: "Test mode active: production rules blocked."
        };
    }

    private detectH1_OpacidadPorPamLine(input: HypothesisRouterInput): ActiveHypothesis[] {
        const cuentaItemCount = input.cuentaSections.reduce((acc, s) => acc + s.items.length, 0);
        const out: ActiveHypothesis[] = [];
        for (const line of input.pam.lines) {
            const isGeneric = line.isGeneric ?? /material|insumo|medicamento|varios|sin bonific/i.test(line.desc.toLowerCase());
            const trigger = isGeneric && cuentaItemCount >= 50 && input.pam.lines.length <= 10;
            if (!trigger) continue;
            out.push({
                id: "H1_OPACIDAD",
                label: "Opacidad estructural en PAM",
                confidence: 0.85,
                scope: { type: "PAM_LINE", pamLineKey: line.key, categories: ["MATERIALES", "MEDICAMENTOS"] },
                signals: [],
                enables: ["TRANSPARENCIA_OPACIDAD"],
                blocks: ["UNBUNDLING_IF319", "VALIDACION_PRECIOS_UNITARIOS", "CALCULO_TOPES_UF_VA_VAM"],
                rationale: "Generic PAM line prevents traceability."
            });
        }
        return out;
    }

    private buildResultWithConflictResolution(hypotheses: ActiveHypothesis[]): HypothesisRouterResult {
        const priority = (h: ActiveHypothesis) => (h.id === "H5_TEST_CASE" ? 100 : h.id === "H1_OPACIDAD" ? 80 : 50) + h.confidence;
        const sorted = [...hypotheses].sort((a, b) => priority(b) - priority(a));
        const enabled = [];
        const blocked = [];
        for (const h of sorted) {
            for (const cap of h.enables) enabled.push({ capability: cap, scope: h.scope, by: h.id, confidence: h.confidence });
            for (const cap of h.blocks) blocked.push({ capability: cap, scope: h.scope, by: h.id, confidence: h.confidence });
        }
        const hasH5Global = sorted.some(h => h.id === "H5_TEST_CASE" && h.scope.type === "GLOBAL");
        if (hasH5Global) {
            blocked.push({ capability: "TRANSPARENCIA_OPACIDAD" as Capability, scope: { type: "GLOBAL" }, by: "H5_TEST_CASE" as HypothesisId, confidence: 1 });
            blocked.push({ capability: "UNBUNDLING_IF319" as Capability, scope: { type: "GLOBAL" }, by: "H5_TEST_CASE" as HypothesisId, confidence: 1 });
        }
        return { hypotheses: sorted, capabilityMatrix: { enabled, blocked } };
    }
}

function scopesIntersect(a: HypothesisScope, b: HypothesisScope): boolean {
    if (a.type === "GLOBAL" || b.type === "GLOBAL") return true;
    if (a.type === "PAM_LINE" && b.type === "PAM_LINE") return a.pamLineKey === b.pamLineKey;
    // Simplified intersection logic for verification
    return false;
}

function isCapabilityAllowed(ctx: { capabilities: CapabilityMatrix, currentScope: HypothesisScope }, cap: Capability): boolean {
    const blocked = ctx.capabilities.blocked.some(b => b.capability === cap && scopesIntersect(b.scope, ctx.currentScope));
    if (blocked) return false;
    const enabled = ctx.capabilities.enabled.some(e => e.capability === cap && scopesIntersect(e.scope, ctx.currentScope));
    const dangerous = ["UNBUNDLING_IF319", "VALIDACION_PRECIOS_UNITARIOS", "CALCULO_TOPES_UF_VA_VAM", "REGLAS_SINTETICAS_TEST"];
    if (dangerous.includes(cap)) return enabled;
    return true;
}

// 3. TEST CASES (Mock Data)
const cases = [
    {
        name: 'Riquelme',
        input: {
            cuentaSections: [{ sectionId: 'MATS', items: Array(100).fill({}) }],
            pam: { lines: [{ key: 'MATERIALES', desc: 'MATERIALES CLINICOS', amount: 100000, isGeneric: true }, { key: 'HONORARIOS', desc: 'HONORARIOS', amount: 50000 }] },
            contract: {}, metadata: { patientName: 'SANTIAGO RIQUELME' }
        }
    },
    {
        name: 'Sepulveda',
        input: {
            cuentaSections: [{ sectionId: 'HOTEL', items: Array(60).fill({}) }],
            pam: { lines: [{ key: 'DIAS_CAMA', desc: 'DIAS CAMA', amount: 500000, isGeneric: true }] },
            contract: {}, metadata: { patientName: 'IVONNE SEPULVEDA' }
        }
    },
    {
        name: 'Bravo',
        input: {
            cuentaSections: [{ sectionId: 'PAB', items: Array(10).fill({}) }],
            pam: { lines: [{ key: 'PABELLON', desc: 'DERECHO PABELLON', amount: 500000 }] }, // Not generic
            contract: {}, metadata: { patientName: 'NICOLAS BRAVO' }
        }
    },
    {
        name: 'Retamal',
        input: {
            cuentaSections: [], pam: { lines: [] }, contract: {},
            metadata: { patientName: 'MOISES RETAMAL', test_case: true }
        }
    }
];

// 4. EXECUTION
console.log("🔍 COMPOSITIONAL ENGINE VERIFICATION\n");
const router = new HypothesisRouterService();

cases.forEach(c => {
    console.log(`👤 CASE: ${c.name}`);
    const res = router.detect(c.input as any);

    // Check Active Hypotheses
    if (res.hypotheses.length === 0) console.log("  ⚪ No Hypotheses (Neutral)");
    else res.hypotheses.forEach(h => console.log(`  🟢 ${h.id} [${h.scope.type}]`));

    // Check Capabilities
    // Scope: Materials/PAM Line for Riquelme/Sepulveda
    const scopeMat: HypothesisScope = { type: 'PAM_LINE', pamLineKey: c.name === 'Sepulveda' ? 'DIAS_CAMA' : 'MATERIALES' };
    const ctxMat = { capabilities: res.capabilityMatrix, currentScope: scopeMat };
    const ctxGlobal = { capabilities: res.capabilityMatrix, currentScope: { type: 'GLOBAL' as const } };

    const canOpacidad = isCapabilityAllowed(ctxMat, "TRANSPARENCIA_OPACIDAD");
    const canUnbundling = isCapabilityAllowed(ctxMat, "UNBUNDLING_IF319");
    const canTest = isCapabilityAllowed(ctxGlobal, "REGLAS_SINTETICAS_TEST");

    console.log(`  🔓 Unbundling Allowed? ${canUnbundling ? 'YES' : 'NO'}`);
    console.log(`  🔓 Test Rules Allowed? ${canTest ? 'YES' : 'NO'}`);
    console.log("--------------------------------------------------");
});
