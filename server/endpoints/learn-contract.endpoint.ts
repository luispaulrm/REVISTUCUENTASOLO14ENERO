import { Request, Response } from 'express';
import { saveTrainingExample } from '../services/contractLearning.service.js';
import { ContractAnalysisResult } from '../services/contractTypes.js';

export const LearnContractEndpoint = async (req: Request, res: Response) => {
    try {
        const canonicalResult = req.body as ContractAnalysisResult;

        if (!canonicalResult || !canonicalResult.metadata) {
            return res.status(400).json({ success: false, message: "Invalid contract data" });
        }

        // Generate a fingerprint or ID
        const fingerprint = canonicalResult.fileHash || Date.now().toString();
        const tags = [
            canonicalResult.metadata.fuente || "UNKNOWN_SOURCE",
            canonicalResult.metadata.tipo_contrato || "UNKNOWN_TYPE"
        ];

        // We save the entire JSON as the "correction"
        // Ideally, we should also save the snippet, but the frontend doesn't send the snippet separately yet.
        // For now, we use a placeholder or extract text if available. 
        // In the future, the UI could allow highlighting specific errors.
        const snippet = "FULL_CONTRACT_CONTEXT_AUTOMATIC_LEARNING";

        await saveTrainingExample(
            fingerprint,
            tags,
            snippet,
            canonicalResult,
            "User initiated learning from UI"
        );

        return res.json({ success: true, message: "Knowledge integrated successfully." });

    } catch (error: any) {
        console.error('[LEARN] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
