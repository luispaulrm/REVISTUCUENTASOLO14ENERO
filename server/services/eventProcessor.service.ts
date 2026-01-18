/**
 * Event Pre-Processor Service
 * 
 * This service implements the deterministic layer of the hybrid architecture.
 * It constructs EventoHospitalario objects from raw PAM data BEFORE LLM analysis.
 * 
 * Key Responsibilities:
 * 1. Identify surgical vs medical events using catalog (not heuristic groups)
 * 2. Collapse fractional honoraries mathematically
 * 3. Detect event continuity
 * 4. Pre-tag probable error origins
 */

import { v4 as uuidv4 } from 'uuid';
import type {
    EventoHospitalario,
    TipoEvento,
    HonorarioConsolidado,
    ItemOrigen,
    Anclaje,
    OrigenProbable
} from '../../types.js';

// Surgical code catalog - expandable over time
const SURGICAL_CODE_PATTERNS = [
    /^1801/, // Surgical procedures
    /^1802/, // Complex surgeries
    /^1803/,
    /^1804/,
    /^1805/,
    /^1806/,
    /^1807/,
    /^1808/,
];

const PABELLON_INDICATORS = [
    '2001', // Derecho de Pabellón variants
    '2002',
    '3301', // Pabellón services
];

const ANESTHESIA_INDICATORS = [
    '2201', // Anestesia
    '2202',
];

const GENERIC_CODES = [
    '3101302', // Medicamentos genéricos
    '3101304', // Insumos genéricos
    '3201001', // Otros genéricos
];

interface PAMItem {
    codigo: string;
    descripcion: string;
    cantidad: number | string;
    valorTotal: number | string;
    bonificacion: number | string;
    copago: number | string;
    fecha?: string;
    folio?: string;
}

interface GroupedHonoraries {
    [key: string]: PAMItem[]; // key: codigo_prestador_fecha
}

/**
 * Determines if a code is surgical based on catalog
 */
function isSurgicalCode(codigo: string): boolean {
    if (!codigo) return false;
    return SURGICAL_CODE_PATTERNS.some(pattern => pattern.test(codigo));
}

/**
 * Checks if items contain pabellón indicators
 */
function hasPabellonIndicator(items: PAMItem[]): boolean {
    return items.some(item =>
        PABELLON_INDICATORS.some(ind => item.codigo?.includes(ind))
    );
}

/**
 * Checks if items contain anesthesia
 */
function hasAnesthesiaIndicator(items: PAMItem[]): boolean {
    return items.some(item =>
        ANESTHESIA_INDICATORS.some(ind => item.codigo?.includes(ind))
    );
}

/**
 * Determines event type based on surgical catalog + markers
 */
function determineEventType(items: PAMItem[]): TipoEvento {
    const hasSurgicalCodes = items.some(item => isSurgicalCode(item.codigo));
    const hasPabellon = hasPabellonIndicator(items);
    const hasAnesthesia = hasAnesthesiaIndicator(items);

    // Surgical: Has catalog match OR (pabellón + anesthesia)
    if (hasSurgicalCodes || (hasPabellon && hasAnesthesia)) {
        return 'QUIRURGICO';
    }

    // Medical: No surgery indicators
    if (!hasSurgicalCodes && !hasPabellon) {
        return 'MEDICO';
    }

    // Mixed: Has some indicators but not conclusive
    return 'MIXTO';
}

/**
 * Groups PAM items by codigo + prestador + fecha for honorary collapsing
 */
function groupHonorariesForCollapsing(items: PAMItem[], prestador: string): GroupedHonoraries {
    const grouped: GroupedHonoraries = {};

    items.forEach(item => {
        // Only group surgical codes
        if (!isSurgicalCode(item.codigo)) return;

        const fecha = item.fecha || 'UNKNOWN_DATE';
        const key = `${item.codigo}_${prestador}_${fecha}`;

        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(item);
    });

    return grouped;
}

/**
 * Parses amount fields that might be strings
 */
function parseAmount(value: number | string): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        return parseFloat(value.replace(/[^0-9.-]/g, '')) || 0;
    }
    return 0;
}

/**
 * Collapses grouped items into consolidated honoraries
 */
function collapseHonoraries(grouped: GroupedHonoraries): HonorarioConsolidado[] {
    const consolidated: HonorarioConsolidado[] = [];

    Object.entries(grouped).forEach(([key, items]) => {
        if (items.length === 0) return;

        const totalQuantity = items.reduce((sum, item) =>
            sum + parseAmount(item.cantidad), 0
        );

        const tolerance = 0.1;
        const isCloseToOne = Math.abs(totalQuantity - 1.0) <= tolerance;
        const isMultiple = totalQuantity > 1.2;

        // Create ItemOrigen array
        const items_origen: ItemOrigen[] = items.map(item => ({
            folio: item.folio,
            codigo: item.codigo,
            cantidad: parseAmount(item.cantidad),
            total: parseAmount(item.valorTotal),
            copago: parseAmount(item.copago),
            descripcion: item.descripcion
        }));

        consolidated.push({
            codigo: items[0].codigo,
            descripcion: items[0].descripcion,
            items_origen,
            es_fraccionamiento_valido: isCloseToOne && items.length > 1,
            heuristica: {
                sum_cantidades: totalQuantity,
                tolerancia: tolerance,
                razon: isCloseToOne ? 'EQUIPO_QUIRURGICO' :
                    isMultiple ? 'UNKNOWN' : 'UNKNOWN'
            }
        });
    });

    return consolidated;
}

/**
 * Determines probable origin of error based on item characteristics
 */
function determineOrigenProbable(item: PAMItem): OrigenProbable {
    // Generic codes = PAM structure issue
    if (GENERIC_CODES.some(code => item.codigo?.includes(code))) {
        return 'PAM_ESTRUCTURA';
    }

    // Will be determined by LLM or further analysis
    return 'DESCONOCIDO';
}

/**
 * Detects if two events might be continuous
 */
function detectContinuity(fecha1: string, fecha2: string, prestador1: string, prestador2: string): boolean {
    if (prestador1 !== prestador2) return false;

    try {
        const date1 = new Date(fecha1);
        const date2 = new Date(fecha2);
        const diffHours = Math.abs(date2.getTime() - date1.getTime()) / (1000 * 60 * 60);

        return diffHours <= 48;
    } catch {
        return false;
    }
}

/**
 * Main pre-processing function
 * Constructs EventoHospitalario objects from PAM data
 */
export function preProcessEventos(pamJson: any): EventoHospitalario[] {
    const eventos: EventoHospitalario[] = [];

    if (!pamJson?.folios || !Array.isArray(pamJson.folios)) {
        return eventos;
    }

    // Process each folio
    pamJson.folios.forEach((folio: any) => {
        const prestador = folio.prestadorPrincipal || 'DESCONOCIDO';

        // Get all items from desglose
        const allItems: PAMItem[] = [];
        if (folio.desglosePorPrestador && Array.isArray(folio.desglosePorPrestador)) {
            folio.desglosePorPrestador.forEach((desglose: any) => {
                if (desglose.items && Array.isArray(desglose.items)) {
                    allItems.push(...desglose.items.map((item: any) => ({
                        ...item,
                        folio: folio.folioPAM,
                        fecha: folio.periodoCobro
                    })));
                }
            });
        }

        if (allItems.length === 0) return;

        // Determine event type
        const tipoEvento = determineEventType(allItems);

        // Find anchor
        let anclaje: Anclaje;
        const surgicalCode = allItems.find(item => isSurgicalCode(item.codigo));
        if (surgicalCode) {
            anclaje = {
                tipo: 'CODIGO_PRINCIPAL',
                valor: surgicalCode.codigo
            };
        } else {
            anclaje = {
                tipo: 'INGRESO',
                valor: folio.periodoCobro || 'FECHA_DESCONOCIDA'
            };
        }

        // Collapse honoraries (only for surgical)
        const consolidados = tipoEvento === 'QUIRURGICO'
            ? collapseHonoraries(groupHonorariesForCollapsing(allItems, prestador))
            : [];

        // Calculate totals
        const total_copago = allItems.reduce((sum, item) =>
            sum + parseAmount(item.copago), 0
        );
        const total_bonificacion = allItems.reduce((sum, item) =>
            sum + parseAmount(item.bonificacion), 0
        );

        // Determine probable origin
        const origenProbable = allItems.some(item =>
            GENERIC_CODES.some(code => item.codigo?.includes(code))
        ) ? 'PAM_ESTRUCTURA' : 'DESCONOCIDO';

        // Create event
        const evento: EventoHospitalario = {
            id_evento: uuidv4(),
            tipo_evento: tipoEvento,
            anclaje,
            prestador,
            fecha_inicio: folio.periodoCobro || '',
            fecha_fin: folio.periodoCobro || '',
            posible_continuidad: false, // Will be set after comparing all events
            subeventos: [], // Sub-events require explicit evidence
            honorarios_consolidados: consolidados,
            nivel_confianza: 'ALTA', // Default, LLM can adjust
            recomendacion_accion: 'ACEPTAR', // Default, LLM can adjust
            origen_probable: origenProbable,
            total_copago,
            total_bonificacion
        };

        eventos.push(evento);
    });

    // Detect continuity between events
    for (let i = 0; i < eventos.length; i++) {
        for (let j = i + 1; j < eventos.length; j++) {
            const continuity = detectContinuity(
                eventos[i].fecha_inicio,
                eventos[j].fecha_inicio,
                eventos[i].prestador,
                eventos[j].prestador
            );
            if (continuity) {
                eventos[i].posible_continuidad = true;
                eventos[j].posible_continuidad = true;
            }
        }
    }

    return eventos;
}
