import { GoogleGenerativeAI } from "@google/generative-ai";
import { DOCUMENT_CLASSIFICATION_PROMPT } from "../prompts/validation.prompt.js";
import { AI_CONFIG } from "../config/ai.config.js";

interface ValidationResult {
    isValid: boolean;
    detectedType: string;
    reason: string;
}

export class ValidationService {
    private client: GoogleGenerativeAI;
    private modelName: string;

    constructor(apiKey: string) {
        this.client = new GoogleGenerativeAI(apiKey);
        // Use Flash for speed and low cost validation
        this.modelName = AI_CONFIG.FALLBACK_MODEL || "gemini-1.5-flash";
    }

    /**
     * Validates if the uploaded document matches the expected type.
     * @param imageBase64 The base64 image data of the first page.
     * @param mimeType The mime type of the image.
     * @param expectedType The expected high-level type ('CUENTA' | 'PAM' | 'CONTRATO').
     */
    async validateDocumentType(
        imageBase64: string,
        mimeType: string,
        expectedType: 'CUENTA' | 'PAM' | 'CONTRATO'
    ): Promise<ValidationResult> {

        console.log(`[VALIDATION] Checking if document is "${expectedType}"...`);

        // If the user uploads "CUENTA", we accept "CUENTA".
        // If they upload "CONTRATO", we accept "CONTRATO".
        // If they upload "PAM", we accept "PAM".
        // Mapping might be needed if UI types differ slightly from Prompt types, 
        // but currently they align: CUENTA, PAM, CONTRATO.

        try {
            const model = this.client.getGenerativeModel({
                model: this.modelName,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.1, // Strict determinism
                }
            });

            const result = await model.generateContent([
                { text: DOCUMENT_CLASSIFICATION_PROMPT },
                {
                    inlineData: {
                        data: imageBase64,
                        mimeType: mimeType
                    }
                }
            ]);

            const responseText = result.response.text();
            console.log(`[VALIDATION] Raw AI Response: ${responseText}`);

            const jsonResponse = JSON.parse(responseText);
            const detected = jsonResponse.classification?.toUpperCase();
            const reasoning = jsonResponse.reasoning;

            // Strict matching
            if (detected === expectedType) {
                return { isValid: true, detectedType: detected, reason: reasoning };
            }

            // Fallback for "UNKNOWN" or mismatches
            return {
                isValid: false,
                detectedType: detected || "UNKNOWN",
                reason: `Documento identificado como ${detected} pero se esperaba ${expectedType}. Razón: ${reasoning}`
            };

        } catch (error: any) {
            console.error("[VALIDATION] AI Error:", error);
            // On AI failure (rare), we default to ALLOW usually to avoid blocking valid users during outages,
            // OR we strict block? 
            // The user requested strict validation for "estupideces". 
            // If AI crashes, we probably should fail-safe to valid or throw.
            // Let's return invalid to be safe if strictly requested, but maybe too aggressive.
            // Let's try to assume it's valid if AI fails, to avoid "Server Error" blocks.
            // BUT for this task, the goal is strict filtering. Let's return false.
            return {
                isValid: false,
                detectedType: "ERROR",
                reason: "Validation service failed to classify document."
            };
        }
    }
}
