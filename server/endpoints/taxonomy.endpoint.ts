
import { Request, Response } from 'express';
import { TaxonomyPhase1Service } from '../services/taxonomyPhase1.service.js';
import { SkeletonService } from '../services/skeleton.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { RawCuentaItem, TaxonomyContextAnchors } from '../types/taxonomy.types.js'; // Ensure TaxonomyContextAnchors is imported if needed
import { TaxonomyPhase1_5Service } from '../services/taxonomyPhase1_5.service.js';

// --- Singleton Service Instantiation ---
const geminiService = new GeminiService(process.env.GEMINI_API_KEY || "");
const taxonomyService = new TaxonomyPhase1Service(geminiService);
const taxonomyEtiologyService = new TaxonomyPhase1_5Service(geminiService, { enableLLM: true, cache: new Map() });
const skeletonService = new SkeletonService();

export async function handleTaxonomyPhase1(req: Request, res: Response) {
    try {
        const body = req.body as { items: RawCuentaItem[] };

        if (!body.items || !Array.isArray(body.items)) {
            res.status(400).json({ error: "Invalid input. 'items' array required." });
            return;
        }

        if (body.items.length === 0) {
            res.json({ results: [], skeleton: null });
            return;
        }

        console.log(`[POST /api/cuenta/taxonomy-phase1] Processing ${body.items.length} items...`);

        // Phase 1: taxonomy pura
        let results = await taxonomyService.classifyItems(body.items);

        // Phase 1.5: Etiología (Opt-in)
        const enableEtiology = req.query.etiology === "1";
        let anchors: TaxonomyContextAnchors | undefined;

        if (enableEtiology) {
            console.log(`[POST /api/cuenta/taxonomy-phase1] Etiology Phase 1.5 ENABLED`);
            // Construct anchors from the raw items or section structure if available
            // For now, we infer anchors from the raw items text if sections aren't passed explicitly in a 'sections' array
            // But the user code 'buildAnchorsFromCuenta' expects { sections: { category: string }[] }
            // We can try to infer from 'group' if results exist, or if the BODY has sections.
            // Assumption: The body might include 'sections' or we infer from results.

            // Let's look for 'sections' in body first, typical for a full bill upload
            const rawSections = (req.body as any).sections || [];
            anchors = buildAnchorsFromCuenta({ sections: rawSections });

            // Run Phase 1.5
            results = await taxonomyEtiologyService.run(results, anchors);
        }

        const skeleton = skeletonService.generateSkeleton(results);

        res.json({ results, skeleton, anchors, phase: enableEtiology ? "1.5" : "1.0" });

    } catch (error: any) {
        console.error("Error in taxonomy endpoint:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
}

function buildAnchorsFromCuenta(cuenta: { sections: { category: string }[] }): TaxonomyContextAnchors {
    const names = (cuenta.sections ?? []).map(s => s.category);

    const hasPabellon =
        names.some(n => /(^|\b)pabell/i.test(n)) ||
        names.some(n => /farmacia.*pabell/i.test(n));

    const hasDayBed =
        names.some(n => /d[ií]as?\s*cama/i.test(n));

    const hasUrgencia =
        names.some(n => /urgenc/i.test(n)) ||
        names.some(n => /consulta.*urgenc/i.test(n));

    return {
        hasPabellon,
        hasDayBed,
        hasUrgencia,
        hasEventoUnicoHint: false,
        sectionNames: names
    };
}
