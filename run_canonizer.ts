import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the canonizer
const { executeCanonizer } = await import('./agent/skills/canonizar-contrato-salud/execute_canonizer.js');

// Load extraction result
const extractionPath = path.join(__dirname, 'extraction_result.json');
const extractionData = JSON.parse(fs.readFileSync(extractionPath, 'utf8'));

console.log('Executing canonizer...');
const result = executeCanonizer(extractionData);

// Save canonical contract
const outputPath = path.join(__dirname, 'canonical_contract.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

console.log('✓ Canonical contract generated:', outputPath);
