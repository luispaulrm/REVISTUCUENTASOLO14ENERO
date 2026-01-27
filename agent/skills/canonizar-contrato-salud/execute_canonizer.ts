import fs from 'fs';
import path from 'path';

// --- INPUT/OUTPUT PATHS ---
const EXTRACTION_PATH = path.join(process.cwd(), 'extraction_result.json');
const EXPANSION_PATH = path.join(process.cwd(), 'expansion_result.json');
const OUTPUT_PATH = path.join(process.cwd(), 'canonical_contract.json');

// --- INTERFACES ---
interface Assignment {
    pagina: number;
    indice_linea: number;
    prestacion_textual: string;
    modalidad: "preferente" | "libre_eleccion" | "institucional";
    bloque_id: string;
}

interface Block {
    bloque_id: string;
    pagina_inicio: number;
    linea_inicio: number;
    modalidad: "preferente" | "libre_eleccion";
    tipo_bloque: string;
    porcentaje: number | null;
    reglas?: Array<{
        porcentaje: number | null;
        tope: string | null;
        prestadores: string[];
        codigo_modalidad?: string;
        condicion?: string;
    }>;
    excluye?: string;
}

interface ExtractionLine {
    pagina: number;
    indice_linea: number;
    tipo: string;
    texto_plano?: string;
    celdas?: Array<{ texto: string; indice_columna: number }>;
}

interface ExpansionData {
    metadata: any;
    bloques: Block[];
    asignaciones: Assignment[];
}

interface Tope {
    tipo: "SIN_TOPE" | "UF" | "AC2" | "VECES_ARANCEL" | "VARIABLE" | "REGLA_FINANCIERA" | null;
    valor?: number | null;
    factor?: number;           // For AC2: the multiplier (0.8, 2.0, etc.)
    sigla?: string;
    origen?: string;
    sin_tope_adicional?: boolean;  // True when AC2 is the only limit (no UF cap)
}

interface Prestador {
    nombre: string;
    modalidad?: string;
    porcentaje: number | null;
    tope: Tope;
    condiciones?: string[];
}

interface Contexto {
    modalidad_base: "oferta_preferente" | "libre_eleccion";
    tiene_libre_eleccion: boolean;
    porcentaje_le: number | null;
    heredada_desde?: string;
    texto_origen?: string;
    origen_herencia: "explicit" | "inherited";
}

interface LineaPrestacion {
    linea_id: string;
    tipo: "prestacion";
    nombre: string;
    contexto: Contexto;
    prestadores: Prestador[];
    libre_eleccion: {
        aplica: boolean;
        porcentaje: number | null;
        tope: Tope;
        heredado: boolean;
        razon_excluido?: string;
    };
    fuente_visual: {
        pagina: number;
        fila: number;
    };
}

interface LineaEncabezado {
    linea_id: string;
    tipo: "encabezado" | "fase_logica";
    texto: string;
    efecto?: {
        tipo: "cambio_modalidad" | "definicion_regimen";
        nueva_modalidad?: "libre_eleccion" | "oferta_preferente";
        porcentaje?: number;
    };
    fuente_visual: {
        pagina: number;
        fila: number;
    };
}

type Linea = LineaPrestacion | LineaEncabezado;

// --- UTILS ---
function cleanProviderName(name: string): string | null {
    if (!name) return null;
    // Common table noise in these contracts
    const noisePatterns = [
        /\bHONORARIOS\b/gi,
        /\bHOSPITALARIOS\b/gi,
        /\bAMBULATORIOS\b/gi,
        /\bQUIRÚRGICOS\b/gi,
        /\bHOSPITALARIO\b/gi,
        /\bAMBULATORIO\b/gi,
        /\bMÉDICOS\b/gi
    ];

    let clean = name;
    for (const pattern of noisePatterns) {
        clean = clean.replace(pattern, '').trim();
    }

    // Final polish
    clean = clean.replace(/\s+/g, ' ').trim();

    if (!clean || clean.length < 3) return null;

    // Check if what remains is just noise words
    const upper = clean.toUpperCase();
    if (["SIN TOPE", "UF"].some(n => upper.includes(n))) return null;

    return clean;
}

function parseVecesAC2(text: string): number | null {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*veces\s*AC2/i);
    if (!match) return null;
    return Number(match[1].replace(",", "."));
}


// --- MAIN FUNCTION ---
async function runCanonizer() {
    if (!fs.existsSync(EXTRACTION_PATH) || !fs.existsSync(EXPANSION_PATH)) {
        console.error("❌ Error: Input files missing");
        process.exit(1);
    }

    const extractionData = JSON.parse(fs.readFileSync(EXTRACTION_PATH, 'utf-8'));
    const expansionData: ExpansionData = JSON.parse(fs.readFileSync(EXPANSION_PATH, 'utf-8'));

    const output = {
        contrato: {
            metadata: {
                fuente: extractionData.metadata?.fuente || "unknown",
                tipo: "salud_isapre",
                fecha_procesamiento: new Date().toISOString()
            },
            tabla_prestaciones: {
                ambito: "Hospitalarias y Cirugía Mayor Ambulatoria",
                herencia_vertical: true,
                lineas: [] as Linea[]
            }
        }
    };

    const asigByLine = new Map<string, Assignment[]>();
    for (const asig of expansionData.asignaciones) {
        const key = `${asig.pagina}_${asig.indice_linea}`;
        if (!asigByLine.has(key)) asigByLine.set(key, []);
        asigByLine.get(key)!.push(asig);
    }

    // State for inheritance tracing
    let lastHeaderId: string = "ROOT";
    let lastHeaderText: string = "INICIO CONTRATO";

    let state = {
        modalidad_base: "oferta_preferente" as "oferta_preferente" | "libre_eleccion",
        tiene_libre_eleccion: true,
        // DESIGN DECISION: porcentaje_le is hardcoded to 90% for this contract.
        // In future contracts, this should be extracted from LE headers or expansion blocks.
        porcentaje_le: 90,
        regla_financiera_le: null as null | {
            tipo: "AC2" | "UF";
            factor: number;
            origen_linea: string;
        },
        prestadores: [] as Prestador[]
    };

    for (const rawLine of (extractionData.lineas as ExtractionLine[])) {
        const key = `${rawLine.pagina}_${rawLine.indice_linea}`;
        const asigs = asigByLine.get(key) || [];
        const textoLimpio = rawLine.texto_plano?.trim() || "";
        const lineId = `L${rawLine.pagina}_${rawLine.indice_linea}`;

        // 1. PHASE DETECTION (Headers)
        const isExclusionPhrase = textoLimpio.match(/Solo cobertura libre elección/i);
        const isLEHeading = textoLimpio.match(/LIBRE ELECCIÓN/i) && !textoLimpio.match(/OFERTA PREFERENTE/i);

        if (isExclusionPhrase || isLEHeading) {
            state.modalidad_base = "libre_eleccion";
            lastHeaderId = lineId;
            lastHeaderText = textoLimpio;

            // Parse AC2 factor from header (e.g., "2,0 veces AC2")
            const factorAC2 = parseVecesAC2(textoLimpio);
            if (factorAC2 !== null) {
                state.regla_financiera_le = { tipo: "AC2", factor: factorAC2, origen_linea: lineId };
            }

            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId,
                tipo: "fase_logica",
                texto: textoLimpio,
                efecto: { tipo: "cambio_modalidad", nueva_modalidad: "libre_eleccion", porcentaje: 90 },
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
            continue;
        }

        if (textoLimpio.match(/OFERTA PREFERENTE|¿QUÉ ES UN PLAN PREFERENTE?/i) && !asigs.length) {
            state.modalidad_base = "oferta_preferente";
            state.regla_financiera_le = null; // Reset financial rule on OP header
            lastHeaderId = lineId;
            lastHeaderText = textoLimpio;
            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId,
                tipo: "encabezado",
                texto: textoLimpio,
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
            continue;
        }

        // 2. FINANCIAL RULE DETECTION (Update context, don't create lines)
        const possibleRule = asigs.length > 0 ? asigs[0].prestacion_textual : textoLimpio;
        const factorAC2 = parseVecesAC2(possibleRule);
        if (factorAC2 !== null) {
            // Financial rule: update state context, don't create a line
            state.regla_financiera_le = {
                tipo: "AC2",
                factor: factorAC2,
                origen_linea: lineId
            };
            continue;
        }

        // 3. PRESTACIÓN PROCESSING
        if (asigs.length > 0) {
            const prestacionName = asigs[0].prestacion_textual;
            const prefAsigs = asigs.filter(a => a.modalidad === 'preferente');
            const leAsigs = asigs.filter(a => a.modalidad === 'libre_eleccion');

            // Exclusion check for Preferente
            const isExcluded = prefAsigs.some(a => expansionData.bloques.find(b => b.bloque_id === a.bloque_id)?.tipo_bloque === 'exclusion_modalidad');

            if (isExcluded) {
                lastHeaderId = lineId;
                lastHeaderText = `EXCLUSIÓN PREFERENTE: ${asigs[0].prestacion_textual}`;
                output.contrato.tabla_prestaciones.lineas.push({
                    linea_id: lineId,
                    tipo: "fase_logica",
                    texto: lastHeaderText,
                    efecto: { tipo: "cambio_modalidad", nueva_modalidad: "libre_eleccion" },
                    fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
                });
                state.modalidad_base = "libre_eleccion";
                state.prestadores = [];
                state.regla_financiera_le = null; // Reset financial rule on exclusion
                continue;
            }

            let explicitPrestadores: Prestador[] = [];
            let isExplicit = false;

            for (const asig of prefAsigs) {
                const block = expansionData.bloques.find(b => b.bloque_id === asig.bloque_id);
                if (!block || !block.reglas) continue;
                isExplicit = true;
                for (const rule of block.reglas) {
                    for (const pName of rule.prestadores) {
                        const cleanedName = cleanProviderName(pName);
                        if (!cleanedName) continue;

                        explicitPrestadores.push({
                            nombre: cleanedName,
                            porcentaje: rule.porcentaje,
                            modalidad: rule.codigo_modalidad,
                            tope: rule.tope === "SIN_TOPE" ? { tipo: "SIN_TOPE" } : { tipo: "VARIABLE" },
                            condiciones: rule.condicion ? [rule.condicion] : []
                        });
                    }
                }
            }

            // Final prestadores for this line (Explicit or Inherited)
            // DESIGN DECISION: We do NOT update state.prestadores here.
            // Inheritance propagates only from headers/phase changes, NOT from table rows.
            // This ensures forensic strictness: each row's coverage must be explicitly stated
            // or inherited from a contract section header, not from a previous table row.
            // If you need table-row-to-row inheritance in the future, add:
            // if (isExplicit) { state.prestadores = explicitPrestadores; }
            const finalPrestadores = isExplicit ? explicitPrestadores : [...state.prestadores];

            // LE logic: If it exists in context, it's available for the row
            const hasLE = state.tiene_libre_eleccion || leAsigs.length > 0;
            const finalPorcentajeLE = hasLE ? state.porcentaje_le : null;

            const linea: LineaPrestacion = {
                linea_id: lineId,
                tipo: "prestacion", // Financial rules are no longer a line type
                nombre: asigs[0].prestacion_textual,
                contexto: {
                    modalidad_base: state.modalidad_base,
                    tiene_libre_eleccion: hasLE,
                    porcentaje_le: state.porcentaje_le,
                    heredada_desde: lastHeaderId,
                    texto_origen: lastHeaderText,
                    origen_herencia: isExplicit ? "explicit" : "inherited"
                },
                prestadores: state.modalidad_base === "libre_eleccion" ? [] : finalPrestadores,
                libre_eleccion: {
                    aplica: hasLE,
                    porcentaje: finalPorcentajeLE,
                    tope: state.regla_financiera_le
                        ? {
                            tipo: "AC2",
                            factor: state.regla_financiera_le.factor,
                            origen: state.regla_financiera_le.origen_linea,
                            sin_tope_adicional: true  // AC2 es el único límite
                        }
                        : { tipo: "VARIABLE" },
                    heredado: true
                },
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            };

            output.contrato.tabla_prestaciones.lineas.push(linea);
        }
        else if (rawLine.tipo === 'cabecera_tabla' || (textoLimpio.length > 3 && textoLimpio.length < 100)) {
            // Passive headers that don't change state but provide landmarks
            output.contrato.tabla_prestaciones.lineas.push({
                linea_id: lineId,
                tipo: "encabezado",
                texto: textoLimpio,
                fuente_visual: { pagina: rawLine.pagina, fila: rawLine.indice_linea }
            });
        }
    }

    // ====================================================
    // CAPA 2: CONSOLIDACIÓN PARA AUDITORÍA
    // ====================================================
    interface Regimen {
        modalidad: "oferta_preferente" | "libre_eleccion";
        subtipo?: string;
        prestadores: string[] | "red_abierta";
        porcentaje: number | null;
        tope: Tope | string;
        fuente: string[];
    }

    interface PrestacionConsolidada {
        nombre: string;
        ambito: string;
        regimenes: Regimen[];
    }

    function normalizeName(name: string): string {
        return name
            .toUpperCase()
            .replace(/[^\wÀ-ÿ\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const consolidationMap = new Map<string, PrestacionConsolidada>();

    for (const linea of output.contrato.tabla_prestaciones.lineas) {
        if (linea.tipo !== 'prestacion') continue;

        const prestLinea = linea as LineaPrestacion;
        const normalizedName = normalizeName(prestLinea.nombre);

        if (!consolidationMap.has(normalizedName)) {
            consolidationMap.set(normalizedName, {
                nombre: prestLinea.nombre,
                ambito: "hospitalario",
                regimenes: []
            });
        }

        const consolidated = consolidationMap.get(normalizedName)!;

        // Add Oferta Preferente regime if it has prestadores
        if (prestLinea.contexto.modalidad_base === "oferta_preferente" && prestLinea.prestadores.length > 0) {
            const prestadorNames = prestLinea.prestadores
                .map(p => p.nombre)
                .map(n => n.toUpperCase().trim())
                .sort();
            const porcentaje = prestLinea.prestadores[0]?.porcentaje || null;
            const subtipo = prestLinea.prestadores[0]?.modalidad || "institucional";
            const tope = prestLinea.prestadores[0]?.tope?.tipo || "SIN_TOPE";

            // Check if this regime already exists (compare by modalidad + subtipo + porcentaje + prestadores)
            const existingRegimen = consolidated.regimenes.find(r =>
                r.modalidad === "oferta_preferente" &&
                r.subtipo === subtipo &&
                r.porcentaje === porcentaje &&
                JSON.stringify(r.prestadores) === JSON.stringify(prestadorNames)
            );

            if (existingRegimen) {
                if (!existingRegimen.fuente.includes(prestLinea.linea_id)) {
                    existingRegimen.fuente.push(prestLinea.linea_id);
                }
            } else {
                consolidated.regimenes.push({
                    modalidad: "oferta_preferente",
                    subtipo: subtipo,
                    prestadores: prestadorNames,
                    porcentaje: porcentaje,
                    tope: tope,
                    fuente: [prestLinea.linea_id]
                });
            }
        }

        // Add Libre Elección regime if applicable
        // DESIGN DECISION: LE collapses to a single regime (no subtipo distinction).
        // This is correct for contracts where LE = red_abierta with uniform percentage/tope.
        // If future contracts have multiple LE sub-regimes, apply the same logic as oferta_preferente
        // (compare by modalidad + subtipo + porcentaje + conditions).
        if (prestLinea.libre_eleccion.aplica && prestLinea.libre_eleccion.porcentaje) {
            // Use the tope from the linear layer directly (no hardcoding)
            const leTope: Tope = prestLinea.libre_eleccion.tope || { tipo: "VARIABLE" };

            const existingLE = consolidated.regimenes.find(r => r.modalidad === "libre_eleccion");

            if (existingLE) {
                if (!existingLE.fuente.includes(prestLinea.linea_id)) {
                    existingLE.fuente.push(prestLinea.linea_id);
                }
            } else {
                consolidated.regimenes.push({
                    modalidad: "libre_eleccion",
                    prestadores: "red_abierta",
                    porcentaje: prestLinea.libre_eleccion.porcentaje,
                    tope: leTope,
                    fuente: [prestLinea.linea_id]
                });
            }
        }
    }

    // Add consolidated layer to output
    const outputWithConsolidation = {
        ...output,
        prestaciones_consolidadas: Array.from(consolidationMap.values()).filter(p => p.regimenes.length > 0)
    };

    // ====================================================
    // CAPA 3: SCHEMA DE AUDITORÍA (RESOLUCIÓN FINAL)
    // ====================================================

    interface TopeResuelto {
        tipo: "AC2" | "UF" | "SIN_TOPE" | "CONDICIONAL" | "VARIABLE";
        factor?: number;
        valor?: number;
        origen?: string;
        ambito?: "por_evento" | "anual";
        reglas?: any[];
    }

    interface AgrupacionClinica {
        nombre_canonico: string;
        variantes: string[];
    }

    interface AuditoriaPrestacion {
        nombre_norm: string;
        ambito: "hospitalario" | "ambulatorio";
        agrupacion?: string;
        reglas_financieras: any[];
    }

    const auditSchema = {
        agrupaciones_clinicas: [] as AgrupacionClinica[],
        definiciones: [] as AuditoriaPrestacion[]
    };

    // 1. Agrupación Clínica (Heurística simple para Demo)
    const urgenciaVariants: string[] = [];
    const consultaVariants: string[] = [];

    // 2. Procesamiento de Prestaciones Consolidadas
    for (const prest of outputWithConsolidation.prestaciones_consolidadas) {

        // Scope Detection
        let ambito: "hospitalario" | "ambulatorio" = "hospitalario"; // default per contract header
        const upperName = prest.nombre.toUpperCase();

        if (upperName.includes("AMBULATORIO") ||
            upperName.includes("CONSULTA") ||
            upperName.includes("VISITA")) {
            ambito = "ambulatorio";
        }

        // Grouping Logic
        if (upperName.includes("URGENCIA")) {
            urgenciaVariants.push(prest.nombre);
        }
        if (upperName.includes("CONSULTA")) {
            consultaVariants.push(prest.nombre);
        }

        // Financial Rule Parsing (Deferred Resolution map)
        const reglasFinancieras = [];

        // Check for AC2 in regimes
        for (const reg of prest.regimenes) {
            if (reg.modalidad === 'libre_eleccion' && typeof reg.tope === 'object' && 'tipo' in reg.tope && reg.tope.tipo === 'AC2') {
                reglasFinancieras.push({
                    tipo: "TOPE_ARANCELARIO",
                    factor: reg.tope.factor,
                    unidad: "AC2",
                    modalidad: "libre_eleccion",
                    origen: reg.tope.origen ? [reg.tope.origen] : reg.fuente,
                    sin_tope_adicional: reg.tope.sin_tope_adicional
                });
            }
        }

        // Push to definitions
        auditSchema.definiciones.push({
            nombre_norm: prest.nombre,
            ambito: ambito,
            agrupacion: upperName.includes("URGENCIA") ? "ATENCIÓN DE URGENCIA" : undefined,
            reglas_financieras: reglasFinancieras
        });
    }

    // Add explicit groupings
    if (urgenciaVariants.length > 0) {
        auditSchema.agrupaciones_clinicas.push({
            nombre_canonico: "ATENCIÓN DE URGENCIA",
            variantes: [...new Set(urgenciaVariants)]
        });
    }

    // Final Output Structure
    const finalOutput = {
        ...outputWithConsolidation,
        auditoria_schema: auditSchema
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalOutput, null, 2), 'utf-8');

    const totalPrestaciones = outputWithConsolidation.prestaciones_consolidadas.length;
    const totalRegimenes = outputWithConsolidation.prestaciones_consolidadas.reduce((acc, p) => acc + p.regimenes.length, 0);

    console.log(`✅ Canonización forense completa:`);
    console.log(`   📄 Capa 1 (Lineal): ${output.contrato.tabla_prestaciones.lineas.length} líneas`);
    console.log(`   🔍 Capa 2 (Consolidada): ${totalPrestaciones} prestaciones, ${totalRegimenes} regímenes`);
    console.log(`   ⚖️ Capa 3 (Auditoría): ${auditSchema.definiciones.length} definiciones normalizadas`);
}

runCanonizer().catch(console.error);
