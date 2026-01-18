/**
 * Event Pre-Processor Service (V2 - Episodic & Financial)
 * 
 * Key Responsibilities:
 * 1. Construct "Episodes" (Provider + Time Window) instead of fragmented events.
 * 2. Classify Event Type using 'Signals' (Scoring) instead of strict Catalog.
 * 3. Integrate Deterministic Financial Validation (Unit Value & Topes).
 */

import { v4 as uuidv4 } from 'uuid';
import type {
    EventoHospitalario,
    TipoEvento,
    HonorarioConsolidado,
    ItemOrigen,
    Anclaje,
    AnalisisFinanciero
} from '../../types.js';
import { inferUnidadReferencia, validateTopeHonorarios, UnidadReferencia } from './financialValidator.service.js';

// --- SIGNALS FOR EVENT CLASSIFICATION ---
const SIGNALS = {
    PABELLON: ['2001', '2002', '3301', 'DERECHO DE PABELLON'],
    ANESTESIA: ['2201', '2202', 'ANESTESIA'],
    RECUPERACION: ['2003', 'RECUPERACION'],
    IMAGENOLOGIA: ['0401', '0402', '0403', '0404'],
    LABORATORIO: ['0301', '0302', '0303']
};

interface PAMItem {
    codigoGC: string;
    descripcion: string;
    cantidad: string; // PAM service uses strings
    valorTotal: string;
    bonificacion: string;
    copago: string;
    fecha?: string;
    folio?: string;
    prestador?: string;
}

interface EpisodeCandidate {
    id: string;
    prestador: string;
    startDate: Date;
    endDate: Date;
    items: PAMItem[];
    signals: Set<string>;
}

function parseMonto(val: string | number | undefined): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = val.replace(/\./g, '').replace(',', '.');
    return parseFloat(clean) || 0;
}

function parseFecha(fechaStr?: string): Date | null {
    if (!fechaStr) return null;
    // Assume DD/MM/YYYY or YYYY-MM-DD
    const parts = fechaStr.split('/');
    if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date(fechaStr); // Fallback
}

/**
 * Groups raw PAM items into "Episodes" based on Provider + Time Window (e.g. 48h clustering).
 */
function groupIntoEpisodes(items: PAMItem[]): EpisodeCandidate[] {
    const episodes: EpisodeCandidate[] = [];
    // Sort by date to facilitate linear grouping
    const sortedItems = [...items].sort((a, b) => {
        const dA = parseFecha(a.fecha)?.getTime() || 0;
        const dB = parseFecha(b.fecha)?.getTime() || 0;
        return dA - dB;
    });

    for (const item of sortedItems) {
        const itemDate = parseFecha(item.fecha);
        const itemPrestador = item.prestador || "UNKNOWN";

        // Find matching episode: Same Provider + Gap <= 48h
        let match = episodes.find(e => {
            if (e.prestador !== itemPrestador) return false;
            // If item has no date, maybe attach to last episode of same provider? 
            if (!itemDate) return true;

            // Check gap overlap
            const gapStart = Math.abs(itemDate.getTime() - e.startDate.getTime());
            const gapEnd = Math.abs(itemDate.getTime() - e.endDate.getTime());
            const hours48 = 48 * 60 * 60 * 1000;

            return gapStart <= hours48 || gapEnd <= hours48;
            // Also consider if date is strictly BETWEEN start and end? Implicitly handled if gaps are checked.
        });

        if (match) {
            match.items.push(item);
            if (itemDate) {
                if (itemDate < match.startDate) match.startDate = itemDate;
                if (itemDate > match.endDate) match.endDate = itemDate;
            }
        } else {
            episodes.push({
                id: uuidv4(),
                prestador: itemPrestador,
                startDate: itemDate || new Date(),
                endDate: itemDate || new Date(),
                items: [item],
                signals: new Set()
            });
        }
    }
    return episodes;
}

/**
 * Scores an episode to determine if it is SURGICAL, MEDICAL, or MIXED.
 */
function classifyEpisode(episode: EpisodeCandidate): TipoEvento {
    let scoreSurgical = 0;

    // Check Signals
    episode.items.forEach(item => {
        const desc = (item.descripcion || "").toUpperCase();
        const code = (item.codigoGC || "");

        if (SIGNALS.PABELLON.some(s => code.includes(s) || desc.includes(s))) {
            episode.signals.add("PABELLON");
            scoreSurgical += 5;
        }
        if (SIGNALS.ANESTESIA.some(s => code.includes(s) || desc.includes(s))) {
            episode.signals.add("ANESTESIA");
            scoreSurgical += 3;
        }
        if (code.startsWith("1802") || code.startsWith("1801")) {
            episode.signals.add("CIRUGIA_MAYOR");
            scoreSurgical += 5;
        }
    });

    if (scoreSurgical >= 5) return 'QUIRURGICO';
    if (scoreSurgical > 0) return 'MIXTO';
    return 'MEDICO';
}

/**
 * Deterministically collapses fractional honoraries
 */
function collapseHonorarios(episode: EpisodeCandidate): HonorarioConsolidado[] {
    const map = new Map<string, HonorarioConsolidado>();

    episode.items.forEach(item => {
        const code = item.codigoGC;
        // Check if honorary (starts with 1 or 2, heuristic)
        // Or better: Is it a "Professional Fee"? usually group 1 or 2 in PAM?
        // Let's assume all items in a Surgical episode *might* be honoraries if they match patterns.
        // Or explicit check: isSurgicalCode or similar.
        // For collapsing, we specifically target 180x codes usually.

        const isSurgical = code.startsWith("180") || code.startsWith("1101");
        if (!isSurgical) return;

        const key = `${code}-${parseFecha(item.fecha)?.toISOString() || 'NODATE'}`;

        if (!map.has(key)) {
            map.set(key, {
                codigo: code,
                descripcion: item.descripcion,
                items_origen: [],
                es_fraccionamiento_valido: false,
                heuristica: { sum_cantidades: 0, tolerancia: 0, razon: "UNKNOWN" },
                // copago_total_evento: 0 // Removed from type as per lint error
            });
        }

        const entry = map.get(key)!;
        const qty = parseMonto(item.cantidad); // Quantities are also strings in PAM
        const copago = parseMonto(item.copago);
        const bonif = parseMonto(item.bonificacion);
        const total = parseMonto(item.valorTotal);

        entry.items_origen.push({
            folio: item.folio || "SIN_FOLIO",
            codigo: code,
            cantidad: qty,
            total: total,
            copago: copago,
            descripcion: item.descripcion
            // bonificacion property removed from public type ItemOrigen, needed internally for math?
            // ItemOrigen definition in types.ts does not have bonificacion. 
            // This is a disconnect. We might need it for validation later.
            // But we reconstruct validation object anyway.
        });

        entry.heuristica.sum_cantidades += qty;
    });

    // Finalize logic
    return Array.from(map.values()).map(h => {
        const diff = Math.abs(h.heuristica.sum_cantidades - 1.0);
        if (diff <= 0.15) {
            h.es_fraccionamiento_valido = true;
            h.heuristica.razon = "EQUIPO_QUIRURGICO";
        }
        return h;
    });
}

/**
 * MAIN ENTRY POINT
 */
export function preProcessEventos(pamJson: any, contratoJson: any = {}): EventoHospitalario[] {
    // 1. Flatten PAM Items
    const rawItems: PAMItem[] = [];
    if (pamJson && pamJson.folios) {
        pamJson.folios.forEach((folio: any) => {
            folio.desglosePorPrestador?.forEach((desglose: any) => {
                desglose.items?.forEach((item: any) => {
                    rawItems.push({
                        ...item,
                        prestador: folio.prestadorPrincipal || desglose.nombrePrestador, // Ensure provider linkage
                        folio: folio.folioPAM, // Link folio
                        fecha: item.fecha || folio.fechaEmision // Fallback date, 
                    });
                });
            });
        });
    }

    // 2. Infer Unit Value Global Context (Root Cause Fix)
    // Dynamic triangulation using real contract data
    const unidadReferencia = inferUnidadReferencia(contratoJson, pamJson);

    // 3. Group into Episodes
    const candidateEpisodes = groupIntoEpisodes(rawItems);

    // 4. Transform to EventoHospitalario
    return candidateEpisodes.map(ep => {
        const tipo = classifyEpisode(ep);
        const honorarios = collapseHonorarios(ep);

        // 5. Apply Financial Validation to Honorarios
        let topeCumplidoGlobal = false;
        let valorUnidadInferido = unidadReferencia.valor_pesos_estimado;

        honorarios.forEach(h => {
            if (h.items_origen.length > 0) {
                const proxyItem = h.items_origen[0];

                // Need original bonificacion to validate.
                // We lost it in ItemOrigen mapping.
                // Solution: Find it in original episode items or pass it temporarily?
                // Let's find matches in ep.items
                const originalItem = ep.items.find(i =>
                    i.codigoGC === proxyItem.codigo &&
                    i.folio === proxyItem.folio
                );

                if (originalItem) {
                    const validation = validateTopeHonorarios({
                        codigoGC: originalItem.codigoGC,
                        bonificacion: parseMonto(originalItem.bonificacion),
                        copago: parseMonto(originalItem.copago)
                    } as any, unidadReferencia);

                    if (validation.tope_cumplido) {
                        topeCumplidoGlobal = true;
                    }
                }
            }
        });

        return {
            id_evento: ep.id,
            tipo_evento: tipo,
            anclaje: {
                tipo: 'PRESTADOR_FECHA',
                valor: `${ep.prestador} | ${ep.startDate.toISOString().split('T')[0]}`
            },
            prestador: ep.prestador,
            fecha_inicio: ep.startDate.toISOString(),
            fecha_fin: ep.endDate.toISOString(),
            // Calculate totals from ALL items in the episode
            total_copago: ep.items.reduce((sum, item) => sum + parseMonto(item.copago), 0),
            total_bonificacion: ep.items.reduce((sum, item) => sum + parseMonto(item.bonificacion), 0),
            posible_continuidad: false,
            subeventos: [], // Flat structure for now, required by type
            honorarios_consolidados: honorarios,
            analisis_financiero: {
                tope_cumplido: topeCumplidoGlobal,
                valor_unidad_inferido: valorUnidadInferido,
                metodo_validacion: unidadReferencia.confianza === 'ALTA' ? 'FACTOR_ESTANDAR' : 'MANUAL',
                glosa_tope: unidadReferencia.evidencia[0] || "No determinado"
            },
            nivel_confianza: "ALTA",
            recomendacion_accion: topeCumplidoGlobal ? "ACEPTAR" : "SOLICITAR_ACLARACION",
            origen_probable: "PAM_ESTRUCTURA"
        };
    });
}
