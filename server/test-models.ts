import * as dotenv from "dotenv";

dotenv.config();

async function listAvailableModels() {
    const key = process.env.GEMINI_API_KEY || "";
    if (!key) {
        console.error("❌ GEMINI_API_KEY not found in .env");
        return;
    }

    console.log("Using API Key starting with:", key.substring(0, 5) + "...");

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await response.json();

        if (data.error) {
            console.error("❌ API Error:", data.error.message);
            return;
        }

        console.log("=== MODELOS DISPONIBLES PARA TU CUENTA ===");
        if (data.models) {
            data.models.forEach((m: any) => {
                console.log(`- ${m.name} (${m.displayName})`);
            });
        } else {
            console.log("No se encontraron modelos.");
        }
    } catch (e: any) {
        console.error("Error al listar modelos:", e.message);
    }
}

listAvailableModels();
