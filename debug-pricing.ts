
import { calculatePrice, AI_CONFIG } from './server/config/ai.config.ts';

console.log('--- DEBUG PRICING ---');
console.log('Active Model:', AI_CONFIG.ACTIVE_MODEL);
console.log('Pricing Table:', JSON.stringify(AI_CONFIG.PRICING, null, 2));

const input = 12578;
const output = 11115;
const result = calculatePrice(input, output);

console.log(`Input: ${input}, Output: ${output}`);
console.log('Result:', JSON.stringify(result, null, 2));
