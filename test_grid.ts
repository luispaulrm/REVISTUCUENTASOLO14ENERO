import fs from 'fs';
import path from 'path';
import { analyzeSingleContract } from './server/services/contractEngine.service.js';

async function runTest() {
    const filePath = path.join(process.cwd(), 'agent', 'skills', 'canonizar-contrato-salud', 'pleno 847.pdf');
    console.log(`[TEST] Reading file: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const file = { buffer, mimetype: 'application/pdf', originalname: 'BSLU2109B4 (1) (3).pdf' } as any;

    console.log('[TEST] Calling analyzeSingleContract (Phase 1-3 only if it hangs)...');
    try {
        await analyzeSingleContract(file, process.env.GEMINI_API_KEY || 'dummy_key', (msg) => {
            console.log(msg);
        });
        console.log('[TEST] Finished successfully!');
    } catch (err) {
        console.error('[TEST] Error:', err);
    }
}

runTest();
