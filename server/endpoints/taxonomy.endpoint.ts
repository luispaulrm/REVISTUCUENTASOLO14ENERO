
import { Request, Response } from 'express';
import { TaxonomyPhase1Service } from '../services/taxonomyPhase1.service.js';
import { SkeletonService } from '../services/skeleton.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { RawCuentaItem } from '../types/taxonomy.types.js';

// --- Singleton Service Instantiation ---
const geminiService = new GeminiService(process.env.GEMINI_API_KEY || "");
const taxonomyService = new TaxonomyPhase1Service(geminiService);
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

        const results = await taxonomyService.classifyItems(body.items);
        const skeleton = skeletonService.generateSkeleton(results);

        res.json({ results, skeleton });

    } catch (error: any) {
        console.error("Error in taxonomy endpoint:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
}
