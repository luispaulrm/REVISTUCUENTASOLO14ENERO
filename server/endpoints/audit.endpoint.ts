import { Request, Response } from 'express';
import { TaxonomyPhase1Service } from '../services/taxonomyPhase1.service.js';
import { AuditEngineRefactored } from '../services/auditEngineRefactored.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { RawCuentaItem } from '../types/taxonomy.types.js';

// --- SERVICE FACTORY ---
// In a real app, use DI.
const geminiService = new GeminiService(process.env.GEMINI_API_KEY || "");
const taxonomyService = new TaxonomyPhase1Service(geminiService);
const auditEngine = new AuditEngineRefactored();

export async function handleAuditOrchestration(req: Request, res: Response) {
    try {
        const body = req.body as { items: RawCuentaItem[] };

        if (!body.items || !Array.isArray(body.items)) {
            res.status(400).json({ error: "Invalid input. 'items' array required." });
            return;
        }

        console.log(`[POST /api/audit/run] Orchestrating Audit for ${body.items.length} items...`);

        // 1. Phase 1: Classification (The "Account Module")
        // "Traduce la cuenta a la verdad canónica"
        const taxonomyResults = await taxonomyService.classifyItems(body.items);

        // 2. Phase 2: Audit (The "Judge")
        // "Aplica leyes sobre la verdad canónica"
        const auditResult = auditEngine.performAudit(taxonomyResults);

        // 3. Return Combined Result
        res.json({
            taxonomy: taxonomyResults,
            audit: auditResult
        });

    } catch (error: any) {
        console.error("Error in audit orchestration:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
}
