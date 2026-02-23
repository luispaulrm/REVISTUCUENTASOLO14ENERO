import { Request, Response } from 'express';
import { TaxonomyPhase1Service } from '../services/taxonomyPhase1.service.js';
import { AuditEngineRefactored } from '../services/auditEngineRefactored.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { RawCuentaItem } from '../types/taxonomy.types.js';

// --- SERVICE FACTORY ---
// --- SERVICE FACTORY ---
// In a real app, use DI.
const getTaxonomyService = () => new TaxonomyPhase1Service(new GeminiService(process.env.GEMINI_API_KEY || ""));
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
        const taxonomyService = getTaxonomyService();
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

// RESTORED: Full Forensic Audit Endpoint (Legacy/Main Flow)
import { performForensicAudit } from '../services/auditEngine.service.js';

export async function handleAuditAnalysis(req: Request, res: Response) {
    // 1. Setup headers for NDJSON streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const { cuentaJson, pamJson, contratoJson, htmlContext, isAgentMode } = req.body;
        const apiKey = process.env.GEMINI_API_KEY || "";

        if (!cuentaJson) {
            res.write(JSON.stringify({ type: 'error', message: 'Falta cuentaJson' }) + '\n');
            res.end();
            return;
        }

        console.log(`[POST /api/audit/analyze] Starting Full Forensic Audit (AgentMode: ${isAgentMode})...`);

        // 2. Call the Engine
        const result = await performForensicAudit(
            cuentaJson,
            pamJson,
            contratoJson,
            apiKey,
            (msg) => res.write(JSON.stringify({ type: 'log', message: msg }) + '\n'),
            htmlContext,
            "", // contractMarkdown (New param)
            (usage) => res.write(JSON.stringify({ type: 'usage', usage }) + '\n'),
            (progress) => res.write(JSON.stringify({ type: 'progress', progress }) + '\n'),
            isAgentMode
        );

        // 3. Send Final Result
        res.write(JSON.stringify({ type: 'final', data: result }) + '\n');
        res.end();

    } catch (error: any) {
        console.error("Error in handleAuditAnalysis:", error);
        res.write(JSON.stringify({ type: 'error', message: error.message || "Internal Server Error" }) + '\n');
        res.end();
    }
}
