import { Request, Response } from 'express';
import { performForensicAudit } from '../services/auditEngine.service.js';

export async function handleAuditAnalysis(req: Request, res: Response) {
    console.log('[AUDIT] New Forensic Audit Request Initiated');

    try {
        const { cuentaJson, pamJson, contratoJson } = req.body;

        if (!cuentaJson || !pamJson || !contratoJson) {
            return res.status(400).json({ error: 'Missing required JSONs (Cuenta, PAM or Contrato)' });
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (!apiKey) {
            return res.status(500).json({ error: 'API Key not configured' });
        }

        // Response stream for progress logs (optional, but consistent with other modules)
        // For now, let's keep it simple as a single JSON response or a fast stream
        const auditResult = await performForensicAudit(
            cuentaJson,
            pamJson,
            contratoJson,
            apiKey,
            (msg) => console.log(`[AUDIT] ${msg}`)
        );

        return res.json(auditResult);

    } catch (error: any) {
        console.error('[AUDIT] Forensic Audit Error:', error);
        return res.status(500).json({
            error: error.message || 'Internal Server Error during forensic audit'
        });
    }
}
