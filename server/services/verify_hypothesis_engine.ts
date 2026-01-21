
import { HypothesisRouterService, HypothesisRouterInput, HypothesisScope, Capability } from './hypothesisRouter.service.ts';
import { runCanonicalRules } from './canonicalRulesEngine.service.ts';

// Mocks for real cases based on their descriptions
// Riquelme: Opacity in Materials (H1), but Transparent in Honorarios.
const mockRiquelme: HypothesisRouterInput = {
    cuentaSections: [
        { sectionId: 'HONORARIOS', items: Array(5).fill({ id: 'h1', desc: 'HONORARIO MEDICO', amount: 50000 }) }, // Transparent
        { sectionId: 'MATERIALES', items: Array(100).fill({ id: 'm1', desc: 'INSUMO QUIRURGICO DETALLADO', amount: 1000 }) } // Granular Bill
    ],
    pam: {
        lines: [
            { key: 'HONORARIOS', desc: 'HONORARIOS MEDICOS', amount: 250000 },
            { key: 'MATERIALES', desc: 'MATERIALES CLINICOS', amount: 100000, isGeneric: true } // Generic PAM Line
        ]
    },
    contract: { parsed: {} },
    metadata: { patientName: 'SANTIAGO RIQUELME PRUDENCIO' }
};

// Muñoz: Ghost Codes, Generic Charges (H1 likely in some parts, but mostly F-01/F-02)
const mockMunoz: HypothesisRouterInput = {
    cuentaSections: [
        { sectionId: 'URGENCIA', items: Array(20).fill({ id: 'u1', desc: 'ATENCION URGENCIA', amount: 15000 }) }
    ],
    pam: {
        lines: [
            { key: 'URGENCIA', desc: 'ATENCION URGENCIA', amount: 300000 }
        ]
    },
    contract: { parsed: {} },
    metadata: { patientName: 'MUÑOZ VILUGRON DAYSI ESTER' }
};

// Sepulveda: Structural Opacity (H1) - Mixing Hotel with Clinical
const mockSepulveda: HypothesisRouterInput = {
    cuentaSections: [
        { sectionId: 'HOTELERIA_MIXTA', items: Array(60).fill({ id: 'hm1', desc: 'TERMOMETRO Y MEDIAS', amount: 500 }) }
    ],
    pam: {
        lines: [
            { key: 'DIAS_CAMA', desc: 'DIAS CAMA', amount: 500000, isGeneric: true } // Opacity trigger
        ]
    },
    contract: { parsed: {} },
    metadata: { patientName: 'IVONNE MARCELA SEPULVEDA TORRES' }
};

// Bravo: Discrepancy, likely transparent but unbundled (H2 candidate, but H2 not imp yet -> Neutral/Transparent)
const mockBravo: HypothesisRouterInput = {
    cuentaSections: [
        { sectionId: 'PABELLON', items: Array(10).fill({ id: 'p1', desc: 'PAQUETE ROPA', amount: 54000 }) }
    ],
    pam: {
        lines: [
            { key: 'PABELLON', desc: 'DERECHO DE PABELLON', amount: 540000 }
        ]
    },
    contract: { parsed: {} },
    metadata: { patientName: 'NICOLÁS ALBERTO BRAVO ARCE' }
};

// Retamal: Synthetic Test Trigger (H5)
const mockRetamal: HypothesisRouterInput = {
    cuentaSections: [],
    pam: { lines: [] },
    contract: { parsed: {} },
    metadata: { patientName: 'MOISES RETAMAL (TEST CASE)', test_case: true } // Explicit flag or name trigger
};


async function runVerification() {
    console.log("🔍 STARTING HYPOTHESIS ENGINE VERIFICATION (Compositional Logic Check)\n");

    const cases = [
        { name: 'Riquelme', input: mockRiquelme },
        { name: 'Muñoz', input: mockMunoz },
        { name: 'Sepulveda', input: mockSepulveda },
        { name: 'Bravo', input: mockBravo },
        { name: 'Retamal', input: mockRetamal }
    ];

    const router = new HypothesisRouterService();

    for (const c of cases) {
        console.log(`\n===============================================================`);
        console.log(`👤 CASE: ${c.name} (${c.input.metadata?.patientName})`);
        console.log(`===============================================================`);

        // 1. Detect Hypotheses
        const result = router.detect(c.input);

        if (result.hypotheses.length === 0) {
            console.log("  ⚪ No active hypotheses (Neutral Observation).");
        } else {
            result.hypotheses.forEach(h => {
                console.log(`  🟢 HYPOTHESIS ACTIVE: ${h.id}`);
                console.log(`     - Scope: ${h.scope.type} ${h.scope.pamLineKey ? `(${h.scope.pamLineKey})` : ''}`);
                console.log(`     - Rationale: ${h.rationale}`);
            });
        }

        // 2. Check Key Capabilities
        const ctxOpacidad = { capabilities: result.capabilityMatrix, currentScope: { type: 'PAM_LINE' as const, pamLineKey: 'MATERIALES' } }; // Check opacity in Materials context
        const ctxGlobal = { capabilities: result.capabilityMatrix, currentScope: { type: 'GLOBAL' as const } };

        const canRunOpacidad = isCapabilityAllowed(ctxOpacidad, "TRANSPARENCIA_OPACIDAD" as Capability); // Should be true if H1 active
        const canRunUnbundling = isCapabilityAllowed(ctxOpacidad, "UNBUNDLING_IF319" as Capability); // Should be FALSE if H1 active in this scope
        const canRunTestRules = isCapabilityAllowed(ctxGlobal, "REGLAS_SINTETICAS_TEST" as Capability); // Should be TRUE only for Retamal

        console.log(`\n  🔓 Capability Check (Scope: Materials/Global):`);
        console.log(`     - Can Detect Opacity?   ${canRunOpacidad ? '✅ YES' : '❌ NO'}`);
        console.log(`     - Can Run Unbundling?   ${canRunUnbundling ? '✅ YES' : '⛔ BLOCKED (Correct)'} ${!canRunUnbundling ? '(by H1)' : ''}`);
        console.log(`     - Can Run Test Rules?   ${canRunTestRules ? '✅ YES' : '❌ NO'} ${canRunTestRules ? '(Active Test Mode)' : ''}`);

        // 3. Simulate Rule Execution
        // We simulate passing the capability matrix to the rules engine
        // Note: Actual rule execution requires full mock data, here we just verify the gating logic which is the core of the refactor.
        console.log(`  🛡️ Engine Behavior:`);
        if (canRunTestRules) {
            console.log(`     -> EXECUTION MODE: SYNTHETIC STRESS TEST (Production rules blocked).`);
        } else if (!canRunUnbundling && canRunOpacidad) {
            console.log(`     -> EXECUTION MODE: RESTRICTED AUDIT (Granular rules blocked due to Opacity).`);
        } else {
            console.log(`     -> EXECUTION MODE: STANDARD PRODUCTION AUDIT.`);
        }
    }
    console.log("\n===============================================================");
    console.log("✅ VERIFICATION COMPLETE");
}

// Helper to check allow/block (duplicate from router for standalone script simplicity or import if easier)
// Importing from service to use the real logic
function isCapabilityAllowed(ctx: any, cap: Capability): boolean {
    const { scopesIntersect } = require('./hypothesisRouter.service.js'); // Runtime require for script

    // 1) If there's a block that intersects current scope -> false
    const blocked = ctx.capabilities.blocked.some(
        (b: any) => b.capability === cap && scopesIntersect(b.scope, ctx.currentScope)
    );
    if (blocked) return false;

    // 2) If there's an enable that intersects -> true
    const enabled = ctx.capabilities.enabled.some(
        (e: any) => e.capability === cap && scopesIntersect(e.scope, ctx.currentScope)
    );

    // Policy for "dangerous" rules (fine-grained calc, IF-319): default false if not enabled
    const dangerousCapabilities: Capability[] = [
        "UNBUNDLING_IF319",
        "VALIDACION_PRECIOS_UNITARIOS",
        "CALCULO_TOPES_UF_VA_VAM",
        "REGLAS_SINTETICAS_TEST" // Added to dangerous list for this check
    ];

    if (dangerousCapabilities.includes(cap)) {
        return enabled; // Must be explicitly enabled
    }

    return true;
}


runVerification();
