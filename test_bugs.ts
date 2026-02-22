import fs from 'fs';
import { transformToCanonical } from './server/services/canonicalTransform.service.js';

const filePath = 'C:\\Users\\drlui\\Downloads\\canonical_BSLU2109B4 (1) (3) (2).json';

try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // transformToCanonical takes the raw extraction result (which usually had coberturas array inside it)
    // Looking at the user JSON, it is probably the final canonical output. Wait, transformToCanonical takes the raw LLM output.
    // Let me check if the downloaded file is the raw LLM output or the canonical one.
    // I'll just run it on the raw data if it has `coberturas`.
    if (data.coberturas && Array.isArray(data.coberturas) && !data.metadata) {
        // This is raw
        const canonical = transformToCanonical(data);
        fs.writeFileSync('C:\\Users\\drlui\\Downloads\\test_canonical_fixed.json', JSON.stringify(canonical, null, 2));
        console.log('✅ Canonical transformation applied. Saved to test_canonical_fixed.json');

        const diaCama = canonical.topes.filter(t => t.fuente_textual && t.fuente_textual.toLowerCase().includes('cama'));
        console.log('Día Cama Topes:', diaCama);
    } else {
        console.log('The file already looks like a canonical JSON or does not match expected raw input.');
    }
} catch (e) {
    console.error('Error reading file:', e);
}
