import dotenv from 'dotenv';
dotenv.config();

import { GeminiService } from './gemini.service.js';
import { ContractLayoutExtractorA } from './contractLayoutExtractorA.service.js';
import { ContractAuditorB } from './contractAuditorB.service.js';
import fs from 'fs';
import path from 'path';

async function testPipeline() {
    console.log('--- TEST: CONTRACT EXTRACTION PIPELINE (A & B) ---');

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
        console.error('❌ Missing Gemini API Key');
        process.exit(1);
    }

    const gemini = new GeminiService(apiKey);
    const extractorA = new ContractLayoutExtractorA(gemini);
    const auditorB = new ContractAuditorB(gemini);

    // Mock PDF page image (This should be a real base64 image in a real test)
    // For this demonstration, we'll assume we have a sample image.
    const sampleImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // 1x1 base64 pixel
    const mimeType = "image/png";

    try {
        console.log('[STEP 1] Running Module A: Layout Extraction...');
        const layoutDoc = await extractorA.extractDocLayout(
            [{ image: sampleImageBase64, mimeType }],
            "TEST_DOC_001",
            "sample_contract.pdf"
        );

        console.log('[STEP 1 SUCCESS] Layout extracted. Page count:', layoutDoc.doc.pages.length);
        if (layoutDoc.doc.pages[0].spatialIndex) {
            console.log('✅ Spatial Index detected for page 1');
            // console.log(JSON.stringify(layoutDoc.doc.pages[0].spatialIndex, null, 2));
        } else {
            console.error('❌ Spatial Index MISSING in layoutDoc');
        }

        console.log('[STEP 2] Running Module B: Semantic Auditing...');
        const sematicResult = await auditorB.auditLayout(layoutDoc, ["OFERTA PREFERENTE", "LIBRE ELECCIÓN"]);

        console.log('[STEP 2 SUCCESS] Semantic interpretation complete.');
        console.log('Detected Schema Columns:', sematicResult.detectedSchema);
        console.log('Items Extracted:', sematicResult.items.length);

        if (sematicResult.items.length > 0) {
            console.log('Sample Item:', JSON.stringify(sematicResult.items[0], null, 2));
        }

        sematicResult.warnings.forEach(w => {
            console.warn(`⚠️ [${w.type}] ${w.detail}`);
        });

        console.log('\n✅ PIPELINE TEST FINISHED');
    } catch (err) {
        console.error('❌ Pipeline Test Failed:', err);
    }
}

testPipeline();
