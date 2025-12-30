import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    try {
        const modelsToTry = [
            "gemini-3-flash",
            "models/gemini-3-flash",
            "gemini-3-pro",
            "models/gemini-3-pro",
            "gemini-2.0-flash-exp",
            "gemini-2.0-pro-exp"
        ];

        console.log("--- STARTING TARGETED MODEL CHECK ---");
        for (const name of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: name });
                const result = await model.generateContent("Say 'ready'");
                console.log(`✅ ${name}: SUCCESS -> ${result.response.text()}`);
            } catch (e: any) {
                console.log(`❌ ${name}: FAILED -> ${e.message}`);
            }
        }
        console.log("--- END OF TARGETED MODEL CHECK ---");
    } catch (error: any) {
        console.error("Error during check:", error.message);
    }
}

listModels();
