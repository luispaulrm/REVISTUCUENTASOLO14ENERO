import { GoogleGenerativeAI } from "@google/generative-ai";
import { DOCUMENT_CLASSIFICATION_PROMPT } from "../prompts/validation.prompt.js";
import { AI_CONFIG } from "../config/ai.config.js";

interface ValidationResult {
    isValid: boolean;
    detectedType: string;
    reason: string;
}

export class ValidationService {
    private apiKeys: string[];
    private modelName: string;

    constructor(apiKeyOrKeys: string | string[]) {
        this.apiKeys = Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys];
        // Use Flash for speed and low cost validation
        this.modelName = AI_CONFIG.FALLBACK_MODEL || "gemini-3-flash-preview";
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

        let lastError: any;

        for (const key of this.apiKeys) {
            const mask = key.substring(0, 4) + '...';
            try {
                const client = new GoogleGenerativeAI(key);
                const model = client.getGenerativeModel({
                    model: this.modelName,
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.1,
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

                // Strict matching or Mixed document handling
                const isMixedValid = (detected === "CUENTA_PAM" && (expectedType === "CUENTA" || expectedType === "PAM"));

                if (detected === expectedType || isMixedValid) {
                    return { isValid: true, detectedType: detected, reason: reasoning };
                }

                return {
                    isValid: false,
                    detectedType: detected || "UNKNOWN",
                    reason: `Documento identificado como ${detected} pero se esperaba ${expectedType}. Razón: ${reasoning}`
                };
            } catch (error: any) {
                lastError = error;
                const errStr = (error?.toString() || "") + (error?.message || "");
                const isQuota = errStr.includes('429') || errStr.includes('503');

                if (isQuota) {
                    console.warn(`[VALIDATION] Quota error on key ${mask}. Rotating...`);
                    continue;
                }
                // For other errors, log and try next or break? Let's try next for robustness.
                console.error(`[VALIDATION] Error on key ${mask}:`, error.message);
            }
        }

        console.error("[VALIDATION] All keys failed:", lastError);
        return {
            isValid: false,
            detectedType: "ERROR",
            reason: `Validation service failed after trying ${this.apiKeys.length} keys: ${lastError?.message}`
        };
    }
}
