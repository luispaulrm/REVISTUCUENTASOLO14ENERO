
import { Contract, ContractCobertura } from '../types';

export interface QualityIssue {
    severity: 'critical' | 'warning' | 'info';
    message: string;
    deduction?: number;
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
            stats: { totalRows: 0, criticalMissing: [] }
        };
    }

    const coberturas = contract.coberturas;
    const totalRows = coberturas.length;

    // Mapeo de sinónimos para secciones críticas
    const SECTION_ALIASES: Record<string, string[]> = {
        'DÍA CAMA': ['DIA CAMA', 'HOSPITALIZACION', 'SALA'],
        'PABELLÓN': ['PABELLON', 'QUIRURGIC', 'CIRUGIA', 'DERECHO DE SALA'],
        'HONORARIOS': ['HONORARIOS', 'MEDICOS', 'CIRUJANOS'],
        'CONSULTA': ['CONSULTA', 'VISITA', 'TELEMEDICINA'],
        'IMAGENOLOGÍA': ['IMAGENOLOGIA', 'IMAGEN', 'RADIOGRAFIA', 'TOMOGRAFIA', 'SCANNER', 'ECOGRAFIA'],
        'LABORATORIO': ['LABORATORIO', 'EXAMENES', 'HEMOGRAMA', 'PERFIL', 'BIOQUIMICO'],
        'MEDICAMENTOS': ['MEDICAMENTOS', 'FARMACOS', 'INSUMOS', 'MATERIALES']
    };

    // 1. Verificación de Secciones Críticas (Inteligente)
    const normalizeText = (text: string) => text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Helper para obtener valor insensible a mayúsculas/acentos en las keys
    const getValue = (obj: any, candidates: string[]) => {
        if (!obj) return '';
        // 1. Direct match
        for (const key of candidates) {
            if (obj[key]) return obj[key];
        }
        // 2. Fuzzy match keys
        const objKeys = Object.keys(obj);
        for (const key of candidates) {
            const normalizedTarget = normalizeText(key);
            const foundKey = objKeys.find(k => normalizeText(k) === normalizedTarget);
            if (foundKey && obj[foundKey]) return obj[foundKey];
        }
        return '';
    };

    // Unir todo el texto de prestaciones para búsqueda global
    const allPrestacionText = normalizeText(coberturas.map(c =>
        getValue(c, ['PRESTACIÓN CLAVE', 'PRESTACION CLAVE', 'PRESTACION', 'GLOSA', 'NOMBRE']).toString()
    ).join(' '));

    const missingSections: string[] = [];

    Object.entries(SECTION_ALIASES).forEach(([sectionName, aliases]) => {
        const isPresent = aliases.some(alias => allPrestacionText.includes(alias));
        if (!isPresent) {
            missingSections.push(sectionName);
        }
    });

    if (missingSections.length > 0) {
        const penalty = missingSections.length * 10;
        score -= penalty;
        issues.push({
            severity: 'warning',
            message: `Faltan secciones clave: ${missingSections.join(', ')}. Estructura incompleta.`,
            deduction: penalty
        });
    }

    // 2. Verificación de Completitud de Datos (Scan Global de Bonificación)
    let emptyBonif = 0;

    coberturas.forEach(c => {
        // Convertir toda la fila a string para buscar el % en cualquier lado (Tope, Bonificación, Texto)
        const rowString = JSON.stringify(c).toUpperCase();
        const hasPercentage = rowString.match(/\d+(\.|,)?\d* ?%/); // Match "100%", "90 %", "3.5%"

        // Keywords que indican presencia de datos válidos (Bonificación, Copago, Moneda, Tope)
        const hasBonifKeyword = rowString.includes('BONIFICACION') ||
            rowString.includes('CUBIERTO') ||
            rowString.includes('COPAGO') ||
            rowString.includes('SIN TOPE') ||
            rowString.includes('UF') ||
            rowString.includes('V.A.') ||
            rowString.includes('VAM') ||
            rowString.includes('AC3') ||
            rowString.includes('$');

        if (!hasPercentage && !hasBonifKeyword) {
            emptyBonif++;
        }
    });

    if (emptyBonif > (totalRows * 0.5)) {
        score -= 20;
        issues.push({
            severity: 'warning',
            message: 'No se detectó información de cobertura válida (%, UF, Topes) en >50% de las filas.',
            deduction: 20
        });
    }

    // 3. Verificación de "Alucinación de Estructura" (Filas muy cortas o basura)
    const suspiciousRows = coberturas.filter(c =>
        (getValue(c, ['PRESTACIÓN CLAVE', 'PRESTACION CLAVE', 'PRESTACION', 'GLOSA', 'NOMBRE']) || '').length < 3
    ).length;

    if (suspiciousRows > 0) {
        const penalty = suspiciousRows * 5;
        score -= penalty;
        issues.push({
            severity: 'info',
            message: `Se detectaron ${suspiciousRows} filas con descripciones sospechosamente cortas (posible basura).`,
            deduction: penalty
        });
    }

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
