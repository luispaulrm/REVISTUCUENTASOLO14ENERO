import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    try {
        console.log("--- LISTING ALL AVAILABLE MODELS ---");
        // @ts-ignore - The SDK might not have latest typings but the API supports it
        const models = await genAI.listModels();
        for (const model of models) {
            console.log(`Model: ${model.name} | Methods: ${model.supportedGenerationMethods}`);
        }
        console.log("--- END OF MODEL LIST ---");
    } catch (error: any) {
        console.error("Error listing models:", error.message);
    }
}

listModels();
