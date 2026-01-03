import { performForensicAudit } from './server/services/auditEngine.service.js';
import { CONSALUD_EJEMPLO } from './mocks.js';
import dotenv from 'dotenv';

dotenv.config();

async function testAudit() {
    console.log('🚀 Starting Deep Forensic Audit Test...');

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not found in .env');
        return;
    }

    const cuentaJson = {
        clinicName: "Clínica Indisa",
        sections: [
            {
                category: "Farmacia",
                items: [
                    { description: "Sutura seda 3-0", quantity: 2, unitPrice: 5000, total: 10000, code: "3101304" },
                    { description: "Sevoflurano 250ml", quantity: 0.5, unitPrice: 200000, total: 100000, code: "3101302" }
                ],
                sectionTotal: 110000
            }
        ],
        clinicStatedTotal: 110000
    };

    const pamJson = {
        items: [
            { glosa: "MATERIALES CLINICOS QUIRURGICOS", cod: "3101304", copago: 10000, bonificacion: 0 },
            { glosa: "MEDICAMENTOS HOSPITALIZADOS", cod: "3101302", copago: 100000, bonificacion: 0 },
            { glosa: "ESTUDIO HISTOPATOLÓGICO", cod: "801004", copago: 50000, bonificacion: 34.3 }
        ]
    };

    const contratoJson = CONSALUD_EJEMPLO;

    try {
        const result = await performForensicAudit(
            cuentaJson,
            pamJson,
            contratoJson,
            apiKey,
            (msg) => console.log(msg)
        );

        console.log('\n✅ Audit Result Received:');
        const fs = await import('fs/promises');
        await fs.writeFile('audit-test-result.json', JSON.stringify(result, null, 2));
        console.log('Result saved to audit-test-result.json');

    } catch (error) {
        console.error('\n❌ Audit Test Failed:', error);
    }
}

testAudit();
