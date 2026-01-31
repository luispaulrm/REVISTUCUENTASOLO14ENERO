import { LineaPrestacion, Tope, ContractOutput, NfeBlock, ForensicOperator, PreferentePath } from "./execute_canonizer";

// --- MENTAL MODEL INTERFACES ---

export interface MentalModel {
    metadata: {
        source_contract: string;
        generated_at: string;
        engine_version: "1.0.0";
    };
    prestaciones: PrestacionMental[];
}

export interface PrestacionMental {
    slug: string; // "hmq", "consultas", "parto"
    titulo: string; // "Honorarios Médicos Quirúrgicos"
    esquema_mental: {
        cobertura_base: string; // "90% Preferente"
        tope_evento: string;    // "2.2 x AC2" or "Sin Tope"
        tope_anual: string;     // "60 UF" or "Illimitado"
    };
    modalidades: {
        preferente?: {
            activa: boolean;
            opciones: Array<{
                porcentaje: number;
                prestadores_resumen: string[];
                condiciones: string[];
            }>;
        };
        libre_eleccion: {
            activa: boolean;
            detalle_cobertura: string; // "80% tope 2.2 AC2"
        };
    };
    alertas_forenses: string[]; // ["Exclusión explícita detectada", "Tope anual bajo"]
    debug_trace: string[];      // ["L2_58", "L2_59"]
}

// --- ENGINE LOGIC ---

export function buildMentalModel(contract: ContractOutput): MentalModel {
    const mentalModel: MentalModel = {
        metadata: {
            source_contract: contract.contrato.metadata.fuente,
            generated_at: new Date().toISOString(),
            engine_version: "1.0.0"
        },
        prestaciones: []
    };

    // 0. Build Path Lookup
    const pathLookup = new Map<string, PreferentePath>();
    if (contract.contrato.tabla_prestaciones.oferta_preferente_paths) {
        contract.contrato.tabla_prestaciones.oferta_preferente_paths.forEach(p => {
            // Some paths might use 'id' instead of 'path_id' due to legacy issues, check both if unsure
            // But strict typing says path_id
            pathLookup.set(p.path_id, p);
        });
    }

    // 1. Group atomic lines by "Clean Name" to form Concepts
    const concepts = new Map<string, LineaPrestacion[]>();

    // Check if lineas exists (it should)
    const lineas = contract.contrato.tabla_prestaciones.lineas || [];
    for (const linea of lineas) {
        if (linea.tipo !== 'prestacion') continue;
        const normalized = normalizeName(linea.nombre);
        if (!concepts.has(normalized)) concepts.set(normalized, []);
        concepts.get(normalized)!.push(linea);
    }

    // 2. Transform Concepts into Mental Models
    for (const [key, lines] of concepts.entries()) {
        const primaryLine = lines[0]; // Usually the first definition is the anchor

        // Combine forensic operators from all related lines
        const forensics = lines.flatMap(l => l.operadores_forenses || []);
        const uniqueAlerts = new Set<string>();

        forensics.forEach(op => {
            if (op.tipo === "OP_LOCK_MODALIDAD") uniqueAlerts.add("🔒 Modalidad Bloqueada: Solo Libre Elección");
            if (op.tipo === "OP_VACIO_CONTRACTUAL") uniqueAlerts.add("⚠️ Vacío Contractual Detectado (Asumido 0)");
            if (op.tipo === "OP_RE_EXPANSION_NFE") uniqueAlerts.add("✨ Re-Expansión: Sin Tope Anual");
        });

        // Resolve Preferente State
        // Check if ANY line in this concept has an active preferente path
        const hasPreferente = lines.some(l => l.preferente.aplica && l.preferente.paths.length > 0);

        const prefPathIds = lines.flatMap(l => l.preferente.paths);
        const prefPathObjects = prefPathIds.map(id => pathLookup.get(id)).filter((p): p is PreferentePath => !!p);
        const uniqueProviders = Array.from(new Set(prefPathObjects.flatMap(p => p.prestadores))).sort();

        // Resolve LE State
        const lePct = primaryLine.libre_eleccion.porcentaje;
        const leTope = primaryLine.libre_eleccion.tope;
        const leDesc = formatTope(leTope);

        // NFE Resolution (Annual Cap)
        // Heuristic: Take the NFE from the primary line.
        const nfe = primaryLine.nfe;
        const nfeDesc = nfe.aplica ? (nfe.valor !== null ? `${nfe.valor} UF` : "Sin Tope Anual") : "No Aplica";

        // Determine Base Coverage String
        let baseCoverage = "Solo Libre Elección";
        if (hasPreferente && prefPathObjects.length > 0) {
            const firstPct = prefPathObjects[0].porcentaje;
            baseCoverage = `${firstPct}% Preferente`;
        }

        const model: PrestacionMental = {
            slug: key.toLowerCase().replace(/\s+/g, '-'),
            titulo: primaryLine.nombre,
            esquema_mental: {
                cobertura_base: baseCoverage,
                tope_evento: leDesc,
                tope_anual: nfeDesc
            },
            modalidades: {
                libre_eleccion: {
                    activa: primaryLine.libre_eleccion.aplica,
                    detalle_cobertura: `${lePct}% ${leDesc !== "Sin Tope" ? "tope " + leDesc : "sin tope evento"}`
                }
            },
            alertas_forenses: Array.from(uniqueAlerts),
            debug_trace: lines.map(l => l.linea_id)
        };

        if (hasPreferente) {
            // Group by Percentage and Conditions to avoid clutter, or show unique paths
            // For now, let's treat each unique PreferentePath as an "option"
            const uniquePaths = Array.from(new Set(prefPathIds)).map(id => pathLookup.get(id)).filter((p): p is PreferentePath => !!p);

            model.modalidades.preferente = {
                activa: true,
                opciones: uniquePaths.map(p => ({
                    porcentaje: p.porcentaje,
                    prestadores_resumen: p.prestadores.length > 5 ? [...p.prestadores.slice(0, 5), `y ${p.prestadores.length - 5} más`] : p.prestadores,
                    condiciones: p.condiciones || []
                }))
            };
        }

        mentalModel.prestaciones.push(model);
    }

    return mentalModel;
}

// --- HELPERS ---

function normalizeName(name: string): string {
    return name.toUpperCase()
        .replace(/\(\d+\)/g, '') // Remove (1), (2) footnotes
        .replace(/[^\wÀ-ÿ\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatTope(tope: Tope | string): string {
    if (!tope) return "Sin Tope";
    if (typeof tope === 'string') return tope; // Should not happen with new types but safety first
    if (tope.tipo === 'SIN_TOPE') return "Sin Tope";
    if (tope.tipo === 'UF') return `${tope.valor} UF`;
    if (tope.tipo === 'AC2') return `${tope.factor} x AC2`;
    if (tope.tipo === 'VARIABLE') return "Variable";
    return "Variable"; // Fallback
}
