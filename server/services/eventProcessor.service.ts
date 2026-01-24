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

    episode.items.forEach(item => {
        const desc = (item.descripcion || "").toUpperCase();
        const code = item.codigoGC || "";

        // Surgical blocks (11-21 are mostly surgical/interventional)
        const isSurgicalCode = /^(11|12|13|14|15|16|17|18|19|20|21)/.test(code);
        const isSurgicalText = /PABELLON|ANESTESISTA|QUIRURGICO|CIRUJANO|ARSENALERA/.test(desc);

        if (isSurgicalCode || isSurgicalText) {
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
        const code = item.codigoGC || "";
        const desc = (item.descripcion || "").toUpperCase();

        // Broaden honorary detection: Groups 11-18 or explicit medical role suffixes
        const isHonoraryCode = /^(11|12|13|14|15|16|17|18|22)/.test(code);
        const isSurgicalRole = /CIRUJANO|ANESTESISTA|ARSENALERA|AYUDANTE/.test(desc) || /\(9[012]\)/.test(desc);

        if (!isHonoraryCode && !isSurgicalRole) return;

        const key = `${code}-${parseFecha(item.fecha)?.toISOString() || 'NODATE'}`;

        if (!map.has(key)) {
            map.set(key, {
                codigo: code,
                descripcion: item.descripcion,
                items_origen: [],
                es_fraccionamiento_valido: false,
                heuristica: { sum_cantidades: 0, tolerancia: 0, razon: "UNKNOWN" }
            });
        }

        const entry = map.get(key)!;
        const qty = parseMonto(item.cantidad);
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
        });

        entry.heuristica.sum_cantidades += qty;
    });

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
export async function preProcessEventos(pamJson: any, contratoJson: any = {}): Promise<EventoHospitalario[]> {
    // 1. Flatten PAM Items
    const rawItems: PAMItem[] = [];
    if (pamJson && pamJson.folios) {
        pamJson.folios.forEach((folio: any) => {
            folio.desglosePorPrestador?.forEach((desglose: any) => {
                desglose.items?.forEach((item: any) => {
                    rawItems.push({
                        ...item,
                        codigoGC: item.codigoGC || item.codigo || "", // Robust Alias
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
    // Use the first item's date as a reference or today if empty
    const referenceDate = rawItems.length > 0 ? (parseFecha(rawItems[0].fecha) || new Date()) : new Date();
    const isapreName = contratoJson?.diseno_ux?.nombre_isapre || "";
    const unidadReferencia = await inferUnidadReferencia(contratoJson, pamJson, isapreName, referenceDate);

    // 3. Group into Episodes
    const candidateEpisodes = groupIntoEpisodes(rawItems);

    // 4. Transform to EventoHospitalario
    const events = candidateEpisodes.map(ep => {
        const tipo = classifyEpisode(ep);
        const honorarios = collapseHonorarios(ep);

        // 5. Apply Financial Validation to Honorarios
        let topeCumplidoGlobal = false;
        let valorUnidadInferido = unidadReferencia.valor_pesos_estimado;

        // Detect Full Surgical Team (RFC-User-Context)
        const teamRoles = {
            surgeon: ep.items.some(i => /CIRUJANO|\(91\)/i.test(i.descripcion || "")),
            anesthetist: ep.items.some(i => /ANESTESISTA|\(90\)/i.test(i.descripcion || "")),
            nurse: ep.items.some(i => /ARSENALERA|AYUDANTE|PABELLONERA|8001001/i.test(i.descripcion || ""))
        };
        const equipoCompleto = teamRoles.surgeon && teamRoles.anesthetist && teamRoles.nurse;

        honorarios.forEach(h => {
            if (h.items_origen.length > 0) {
                const proxyItem = h.items_origen[0];

                // Need original bonificacion to validate.
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
                tipo: 'PRESTADOR_FECHA' as const,
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
                equipo_quirurgico_completo: equipoCompleto,
                valor_unidad_inferido: valorUnidadInferido,
                unit_type: unidadReferencia.tipo, // Added for dynamic reporting
                metodo_validacion: (unidadReferencia.confianza === 'ALTA' ? 'FACTOR_ESTANDAR' : 'MANUAL') as any,
                glosa_tope: unidadReferencia.evidencia[0] || "No determinado"
            },
            nivel_confianza: "ALTA" as const,
            recomendacion_accion: (topeCumplidoGlobal ? "ACEPTAR" : "SOLICITAR_ACLARACION") as any,
            origen_probable: "PAM_ESTRUCTURA" as const
        };
    });

    // --- PHASE 6: EVENTO ÚNICO POST-PROCESSING (RFC-04) ---
    // Rule RFC-04: If an urgency derivations directly into a hospitalization (24h), it's a single CLINICAL event.
    // This allows urgency exams to inherit hospital coverage.
    const sortedEvents = [...events].sort((a, b) => new Date(a.fecha_inicio).getTime() - new Date(b.fecha_inicio).getTime());

    for (let i = 0; i < sortedEvents.length; i++) {
        const current = sortedEvents[i];

        // Check if current is Urgency (detect via signals or description)
        const ep = candidateEpisodes.find(e => e.id === current.id_evento);
        const hasUrgencySignal = ep?.items.some(it =>
            /URGENCIA|EMERGENCIA/i.test(it.descripcion) || /URGENCIA/i.test(current.prestador || "")
        );

        if (hasUrgencySignal) {
            // Rule R-EU-01: Detect duplication of rights/base charges in urgency
            const baseChargeCodes = ['2001', '2002', '3101', '3301'];
            const rightsInEvent = ep?.items.filter(it =>
                baseChargeCodes.some(c => it.codigoGC.includes(c)) ||
                /DERECHO.*URGENCIA|DERECHO.*SALA/i.test(it.descripcion)
            ) || [];

            if (rightsInEvent.length > 1) {
                (current as any).metadata = {
                    ...(current as any).metadata,
                    alerta_eu_01: "EVENTO_UNICO_URGENCIA_SOSPECHA",
                    razon_eu_01: "Múltiples cargos de base/derechos detectados en evento de urgencia."
                };
                current.recomendacion_accion = "IMPUGNAR" as any;
            }

            // Find subsequent hospitalization (QUIRURGICO/MEDICO) within 24h
            const hospitalization = sortedEvents.slice(i + 1).find(next => {
                const diff = new Date(next.fecha_inicio).getTime() - new Date(current.fecha_fin).getTime();
                const hours24 = 24 * 60 * 60 * 1000;
                return diff >= 0 && diff <= hours24 &&
                    (next.tipo_evento === 'QUIRURGICO' || next.tipo_evento === 'MEDICO') &&
                    next.prestador === current.prestador;
            });

            if (hospitalization) {
                current.posible_continuidad = true;
                current.recomendacion_accion = "SOLICITAR_ACLARACION" as any;
                (current as any).metadata = {
                    ...(current as any).metadata,
                    evento_unico_v6_detected: true,
                    target_hosp_id: hospitalization.id_evento,
                    razon: "Derivación directa Urgencia -> Hospitalización detectada (RFC-04)"
                };
            }
        }
    }

    return sortedEvents;
}
