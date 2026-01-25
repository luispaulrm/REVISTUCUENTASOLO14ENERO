
import { ProjectionService } from './server/services/projection.service.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function testJsonProjection() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
        console.error("No API Key found");
        return;
    }

    const service = new ProjectionService(apiKey);

    // Using a real PDF from the repo
    const samplePdfPath = './server/knowledge/Cuenta Paciente - Detalle - D1305597_1 (1).pdf';

    let base64Image = "";
    if (fs.existsSync(samplePdfPath)) {
        base64Image = fs.readFileSync(samplePdfPath).toString('base64');
    } else {
        console.error("Sample PDF not found at", samplePdfPath);
        return;
    }

    console.log("Starting JSON projection test with real PDF...");

    try {
        const stream = service.projectPdfToHtml(
            base64Image,
            'application/pdf',
            undefined,
            'FULL',
            1,
            'json'
        );

        let fullOutput = "";
        for await (const chunk of stream) {
            if (chunk.type === 'chunk' && chunk.text) {
                fullOutput += chunk.text;
                process.stdout.write(chunk.text);
            } else if (chunk.type === 'log') {
                console.log(`\nLOG: ${chunk.text}`);
            } else if (chunk.type === 'error') {
                console.error(`\nERROR: ${chunk.error}`);
            }
        }

        console.log("\n--- Final Output ---");
        try {
            const json = JSON.parse(fullOutput);
            console.log("✅ Valid JSON received!");
            console.log(JSON.stringify(json, null, 2).substring(0, 1000) + "...");
        } catch (e) {
            console.error("❌ Invalid JSON or incomplete output");
            console.log("Raw output start:", fullOutput.substring(0, 500));
        }

    } catch (err) {
        console.error("Test failed:", err);
    }
}

testJsonProjection();
