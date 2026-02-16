
import type { SkillInput, SkillOutput, ContractDomain } from './src/m10/types.ts';
import { runSkill } from './src/m10/engine.ts';
import * as fs from 'fs';

// 1. Mock Contract (Plan Pleno 847)
const contract = {
    rules: [
        { id: 'R1', domain: 'PABELLON' as ContractDomain, coberturaPct: 100, tope: { value: 16.0, kind: 'VAM' as const }, textLiteral: 'Derecho Pabellón 100% Tope 16.00 VAM' },
        { id: 'R2', domain: 'DIA_CAMA' as ContractDomain, coberturaPct: 100, tope: { value: 16.0, kind: 'UF' as const }, textLiteral: 'Día Cama 100% Tope 16.00 UF' },
        { id: 'R3', domain: 'HONORARIOS' as ContractDomain, coberturaPct: 100, tope: { value: 13.26, kind: 'VAM' as const }, textLiteral: 'Honorarios Médicos 100% Tope 13.26 VAM' },
        { id: 'R4', domain: 'MATERIALES_CLINICOS' as ContractDomain, coberturaPct: 100, tope: { value: 100.0, kind: 'UF' as const }, textLiteral: 'Materiales e Insumos 100% Tope 100.00 UF' }
    ]
};

// 2. Mock PAM (Payment) - Indisa Appendicitis
const pam = {
    folios: [{
        folioPAM: 'PAM-INDISA-APP-001',
        items: [
            { id: 'I1', codigoGC: '1701001', descripcion: 'APENDICECTOMIA (VIDEOLAPAROSCOPICA)', valorTotal: 650000, bonificacion: 650000, copago: 0 },
            { id: 'I2', codigoGC: '1101001', descripcion: 'DERECHO PABELLON QUIRURGICO', valorTotal: 400000, bonificacion: 400000, copago: 0 },
            { id: 'I3', codigoGC: '1201001', descripcion: 'DIA CAMA DE HOSPITALIZACION MEDIO', valorTotal: 250000, bonificacion: 250000, copago: 0 },
            // M1 Trap
            { id: 'I4', codigoGC: '1101004', descripcion: 'DERECHO DE SALA DE RECUPERACION', valorTotal: 180000, bonificacion: 0, copago: 180000 },
            // M2 Trap
            { id: 'I5', codigoGC: '1101011', descripcion: 'USO DE EQUIPO DE VIDEO LAPAROSCOPIA', valorTotal: 90000, bonificacion: 0, copago: 90000 },
            // M3 Trap
            { id: 'I6', codigoGC: '3101001', descripcion: 'INSUMOS CLINICOS GENERALES', valorTotal: 45000, bonificacion: 0, copago: 45000 }
        ]
    }]
};

// 3. Mock Bill (Charge)
const bill = {
    items: [
        { id: 'B1', description: 'HONORARIO MEDICO APENDICECTOMIA', total: 650000, unitPrice: 650000, qty: 1 },
        { id: 'B2', description: 'PABELLON CENTRAL', total: 400000, unitPrice: 400000, qty: 1 },
        { id: 'B3', description: 'HABITACION INDIVIDUAL', total: 250000, unitPrice: 125000, qty: 2 },
        { id: 'B4', description: 'SALA RECUPERACION', total: 180000, unitPrice: 180000, qty: 1 },
        { id: 'B5', description: 'EQUIPO LAPAROSCOPIA', total: 90000, unitPrice: 90000, qty: 1 },
        { id: 'B6', description: 'INSUMOS VARIOS PABELLON', total: 45000, unitPrice: 45000, qty: 1 }
    ]
};

console.log("=== EJECUTANDO SIMULACIÓN M10: CASO APENDICITIS INDISA ===");
const input: SkillInput = { contract, pam, bill };
const result: SkillOutput = runSkill(input);

console.log("\n--- RESULTADO DE LA AUDITORÍA ---");
console.log("Compliant Text:", result.complaintText);
console.log("Found Trap M1 (Sala Recuperacion):", result.complaintText.includes("SALA DE RECUPERACION") || result.complaintText.includes("1101004") ? "SÍ" : "NO");
console.log("Found Trap M2 (Equipo Video):", result.complaintText.includes("EQUIPO DE VIDEO") || result.complaintText.includes("1101011") ? "SÍ" : "NO");
console.log("Found Trap M3 (Insumos Generales):", result.complaintText.includes("INSUMOS") ? "SÍ" : "NO");

console.log("\n--- SAVING JSON OUTPUT ---");
fs.writeFileSync('m10_audit_result.json', JSON.stringify(result, null, 2));
console.log("JSON saved to m10_audit_result.json");
