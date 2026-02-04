import { analyzeSingleContract } from './server/services/contractEngine.service.js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function verify() {
    const pdfPath = path.join(process.cwd(), 'agent', 'skills', 'canonizar-contrato-salud', 'PLAN PLENO PLE847.pdf');
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!apiKey) {
        console.error('❌ API Key not found in .env');
        process.exit(1);
    }

    console.log(`🚀 Starting Forensic Verification for: ${path.basename(pdfPath)}`);

    const file = {
        buffer: fs.readFileSync(pdfPath),
        mimetype: 'application/pdf',
        originalname: 'PLAN PLENO PLE847.pdf'
    };

    try {
        const result = await analyzeSingleContract(file, apiKey, (msg) => console.log(msg));

        const outputFile = 'verification_output.json';
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

        console.log(`\n🏁 Verification Complete. Result saved to: ${outputFile}`);

        // Quick Forensic Checks
        const hasFiller = JSON.stringify(result).includes('Sin restricciones adicionales especificadas');
        console.log(`\nForensic Check #1 (No Filler): ${!hasFiller ? '✅ PASS' : '❌ FAIL'}`);

        const undeterAmbitos = result.coberturas.filter(c => c.ambito === 'UNDETERMINED');
        console.log(`Forensic Check #2 (Ambito Invariant): ${undeterAmbitos.length > 0 ? '✅ Detected UNDETERMINED' : '⚠️ No UNDETERMINED found (Expected for fallbacks)'}`);

        const origins = new Set(result.coberturas.flatMap(c => c.modalidades.map(m => (m as any).origen_extraccion)));
        console.log(`Forensic Check #3 (Source Metadata): ${origins.has('VISUAL_MODULAR') ? '✅ Detected VISUAL_MODULAR' : '❌ No source metadata found'}`);

    } catch (error) {
        console.error('❌ Error during analysis:', error);
    }
}

verify();
