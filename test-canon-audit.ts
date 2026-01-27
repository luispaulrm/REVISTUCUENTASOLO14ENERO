
import { performForensicAudit } from './server/services/auditEngine.service.ts';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function runTest() {
    console.log('🚀 Starting Canonizer-Auditor Integration Test...');

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not found');
        return;
    }

    // 1. Load the Canonized Contract (Layer 3)
    const canonPath = path.resolve('agent/skills/canonizar-contrato-salud/example_output.json');
    if (!fs.existsSync(canonPath)) {
        console.error('❌ example_output.json not found. Run the canonizer first.');
        return;
    }
    const contractJson = JSON.parse(fs.readFileSync(canonPath, 'utf8'));

    // 2. Mock Account (Bill)
    const cuentaJson = {
        clinicName: "Clínica Indisa",
        sections: [
            {
                category: "Honorarios",
                items: [
                    {
                        description: "RIZOTOMIA PERCUTANEA",
                        quantity: 1,
                        unitPrice: 500000,
                        total: 500000,
                        code: "1103057"
                    }
                ],
                sectionTotal: 500000
            }
        ],
        clinicStatedTotal: 500000
    };

    // 3. Mock PAM
    const pamJson = {
        folios: [
            {
                folioPAM: "12345678",
                prestadorPrincipal: "CLINICA INDISA",
                desglosePorPrestador: [
                    {
                        nombrePrestador: "CLINICA INDISA",
                        items: [
                            {
                                descripcion: "RIZOTOMIA PERCUTANEA",
                                codigo: "1103057",
                                copago: 150000,
                                bonificacion: 120000
                            }
                        ]
                    }
                ]
            }
        ],
        resumenTotal: {
            totalCopago: 150000
        }
    };

    try {
        const result = await performForensicAudit(
            cuentaJson,
            pamJson,
            contractJson,
            apiKey,
            (msg) => console.log(`[LOG] ${msg}`)
        );

        console.log('\n✅ Audit Results (Summary):');
        console.log(JSON.stringify(result.data?.resumenFinanciero || {}, null, 2));

        fs.writeFileSync('canon-audit-test-result.json', JSON.stringify(result, null, 2));
        console.log('\nFull result saved to canon-audit-test-result.json');

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

runTest();
