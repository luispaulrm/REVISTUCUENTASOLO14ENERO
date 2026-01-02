
import { Contract, ContractCobertura } from '../types';

export interface QualityIssue {
    severity: 'critical' | 'warning' | 'info';
    message: string;
}

export interface ContractQualityReport {
    score: number; // 0-100
    status: 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';
    issues: QualityIssue[];
    stats: {
        totalRows: number;
        criticalMissing: string[];
    }
}

// Palabras clave que SIEMPRE deberían aparecer en un contrato de salud decente
const CRITICAL_SECTIONS = [
    'DÍA CAMA',
    'PABELLÓN', // O DERECHO DE PABELLÓN
    'HONORARIOS', // O VISITA MÉDICA
    'CONSULTA',
    'IMAGENOLOGÍA', // O RAYOS
    'LABORATORIO', // O EXÁMENES
    'MEDICAMENTOS'
];

export function evaluateContractQuality(contract: Contract): ContractQualityReport {
    const issues: QualityIssue[] = [];
    let score = 100;

    if (!contract || !contract.coberturas || contract.coberturas.length === 0) {
        return {
            score: 0,
            status: 'CRITICAL',
            issues: [{ severity: 'critical', message: 'No se extrajeron coberturas. El contrato está vacío.' }],
            stats: { totalRows: 0, criticalMissing: CRITICAL_SECTIONS }
        };
    }

    const coberturas = contract.coberturas;
    const totalRows = coberturas.length;

    // 1. Verificación de Secciones Críticas
    const prestacionText = coberturas.map(c =>
        (c['PRESTACIÓN CLAVE'] || '').toUpperCase()
    ).join(' ');

    const missingSections = CRITICAL_SECTIONS.filter(keyword => !prestacionText.includes(keyword));

    if (missingSections.length > 0) {
        // Penalización fuerte por secciones vitales faltantes
        const penalty = missingSections.length * 10;
        score -= penalty;
        issues.push({
            severity: 'warning',
            message: `Posible ausencia de secciones clave: ${missingSections.join(', ')}`
        });
    }

    // 2. Verificación de Completitud de Datos
    let emptyBonif = 0;
    let emptyTope = 0;

    coberturas.forEach(c => {
        if (!c['% BONIFICACIÓN'] || c['% BONIFICACIÓN'] === '-') emptyBonif++;
        if (!c['TOPE LOCAL 2 (ANUAL/UF)'] || c['TOPE LOCAL 2 (ANUAL/UF)'] === '-') emptyTope++;
    });

    if (emptyBonif > (totalRows * 0.5)) {
        score -= 20;
        issues.push({ severity: 'warning', message: 'Más del 50% de las filas no tienen porcentaje de bonificación detectado.' });
    }

    // 3. Verificación de "Alucinación de Estructura" (Filas muy cortas o basura)
    const suspiciousRows = coberturas.filter(c =>
        (c['PRESTACIÓN CLAVE'] || '').length < 3
    ).length;

    if (suspiciousRows > 0) {
        score -= (suspiciousRows * 5);
        issues.push({ severity: 'info', message: `Se detectaron ${suspiciousRows} filas con descripciones sospechosamente cortas.` });
    }

    // Normalización del Score
    score = Math.max(0, Math.min(100, score));

    // Determinar Estado
    let status: ContractQualityReport['status'] = 'EXCELLENT';
    if (score < 40) status = 'CRITICAL';
    else if (score < 70) status = 'WARNING';
    else if (score < 90) status = 'GOOD';

    return {
        score,
        status,
        issues,
        stats: {
            totalRows,
            criticalMissing: missingSections
        }
    };
}
