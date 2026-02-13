// ============================================================================
// OPACITY DETECTOR SERVICE — Deterministic PAM Opacity Analysis
// ============================================================================
// Scans PAM lines for aggregator codes with missing sub-item breakdown,
// generating formal opacity declarations with legal foundations.
// This runs BEFORE the LLM audit, producing deterministic findings.
// ============================================================================

// --- Types ---

export type OpacityType =
    | "AGRUPADOR_SIN_DESGLOSE"       // Tipo 1: Aggregator code with bonificacion=0
    | "GASTOS_NO_CUBIERTOS_GENERICOS" // Tipo 2: Generic "not covered" without specifics
    | "FRAGMENTACION_INTERNA";        // Tipo 3: Same code split into bonif + no-bonif

export interface OpacityDeclaration {
    tipo: OpacityType;
    tipoNumero: 1 | 2 | 3;
    codigoGC: string;
    descripcion: string;
    montoAfectado: number;
    bonificacion: number;
    copago: number;
    declaracionFormal: string;
    fundamentosJuridicos: string[];
    requerimientosDesglose: string[];
    bandera: "OPACIDAD_LIQUIDATORIA";
    pamLineId: string;
}

export interface PAMLineForOpacity {
    uniqueId: string;
    codigo: string;
    descripcion: string;
    bonificacion: number;
    copago: number;
    valorTotal?: number;
}

// --- Constants ---

/** Codes known to be aggregators (consolidate multiple items into one line) */
const CODIGOS_AGRUPADORES = new Set([
    "3101001",  // Medicamentos Clínicos en Hospitalización
    "3101002",  // Materiales Clínicos en Hospitalización
    "3101302",  // Medicamentos Clínicos Quirúrgicos
    "3101304",  // Materiales Clínicos Quirúrgicos
    "3101104",  // Medicamentos Clínicos (variante)
    "3201001",  // Gastos No Cubiertos por el Plan
    "3201002",  // Prestación No Contemplada en el Arancel
]);

/** Codes that represent generic "not covered" charges */
const CODIGOS_GASTOS_GENERICOS = new Set([
    "3201001",  // Gastos No Cubiertos por el Plan
    "3201002",  // Prestación No Contemplada en el Arancel
]);

/** Legal foundations for opacity declarations */
const FUNDAMENTOS_JURIDICOS = [
    "Principio de fundamentación suficiente",
    "Principio de transparencia liquidatoria",
    "Prohibición de indefensión técnica del afiliado",
    "Derecho a información clara y verificable (Ley 20.584)",
];

const REQUERIMIENTOS_DESGLOSE = [
    "Identificación individual de cada ítem rechazado",
    "Código interno y glosa de cada sub-ítem",
    "Fundamento normativo específico del rechazo",
    "Indicación expresa de si fue: absorbido en otra prestación (indicar cuál), rechazado por falta de código arancelario, clasificado como no médico directo, o considerado no contemplado en el arancel",
];

// --- Core Detection Logic ---

function normalizeCode(code: string): string {
    return code.replace(/[\.\-\s]/g, '').trim();
}

function buildDeclaracionFormal(tipo: OpacityType, codigoGC: string, monto: number, descripcion: string): string {
    const montoFmt = monto.toLocaleString('es-CL');

    switch (tipo) {
        case "AGRUPADOR_SIN_DESGLOSE":
            return `🔎 DECLARACIÓN DE OPACIDAD TIPO 1 — AGRUPADOR SIN DESGLOSE\n\n` +
                `Se detecta que el PAM consolida el monto de $${montoFmt} bajo el código GC ${codigoGC} ("${descripcion}") ` +
                `sin desglose sub-ítem, imposibilitando verificar la correspondencia entre la cuenta clínica y la liquidación.\n\n` +
                `El paciente no tiene obligación de reconstruir el contenido de montos agrupados ni inferir qué insumos fueron rechazados.\n\n` +
                `Se requiere:\n` +
                `• Identificación individual de cada insumo rechazado.\n` +
                `• Código interno y glosa.\n` +
                `• Fundamento normativo específico del rechazo.\n` +
                `• Indicación expresa de si fue absorbido en otra prestación (y en cuál).`;

        case "GASTOS_NO_CUBIERTOS_GENERICOS":
            return `🔎 DECLARACIÓN DE OPACIDAD TIPO 2 — GASTOS NO CUBIERTOS GENÉRICOS\n\n` +
                `Se detecta que el PAM presenta un cobro de $${montoFmt} bajo la glosa genérica "${descripcion}" ` +
                `(código ${codigoGC}) sin explicar qué gastos específicos componen este monto.\n\n` +
                `Esta glosa genérica impide el control de legalidad y vulnera el principio de fundamentación suficiente.\n\n` +
                `El paciente no puede verificar si los ítems rechazados corresponden efectivamente a exclusiones contractuales ` +
                `o si incluyen prestaciones que debieron ser bonificadas.`;

        case "FRAGMENTACION_INTERNA":
            return `🔎 DECLARACIÓN DE OPACIDAD TIPO 3 — FRAGMENTACIÓN INTERNA\n\n` +
                `Se detecta que el código ${codigoGC} ("${descripcion}") aparece duplicado en el PAM: ` +
                `una línea con bonificación y otra sin bonificación por $${montoFmt}.\n\n` +
                `Esta fragmentación interna carece de fundamento expreso. No se indica qué sub-ítems fueron absorbidos ` +
                `y cuáles fueron rechazados, impidiendo la verificación de correspondencia con la cuenta clínica.`;
    }
}

/**
 * MAIN ENTRY POINT: Detect all opacity conditions in PAM lines.
 * 
 * @param pamLines - Extracted PAM lines from STEP 1 of the audit engine
 * @returns Array of OpacityDeclaration objects
 */
export function detectOpacity(pamLines: PAMLineForOpacity[]): OpacityDeclaration[] {
    const declarations: OpacityDeclaration[] = [];

    // Index: group PAM lines by normalized code for Tipo 3 detection
    const linesByCode = new Map<string, PAMLineForOpacity[]>();
    for (const line of pamLines) {
        const normCode = normalizeCode(line.codigo);
        if (!linesByCode.has(normCode)) {
            linesByCode.set(normCode, []);
        }
        linesByCode.get(normCode)!.push(line);
    }

    for (const line of pamLines) {
        const normCode = normalizeCode(line.codigo);

        // Skip lines with no copago (nothing opaque if fully bonified)
        if (line.copago <= 0) continue;

        // =====================================================================
        // TIPO 1: AGRUPADOR SIN DESGLOSE
        // Code is in aggregator set + bonificacion === 0 + copago > 0
        // =====================================================================
        if (CODIGOS_AGRUPADORES.has(normCode) && line.bonificacion === 0) {
            // Check it's not already caught as Tipo 2 (we'll add Tipo 2 separately)
            if (!CODIGOS_GASTOS_GENERICOS.has(normCode)) {
                declarations.push({
                    tipo: "AGRUPADOR_SIN_DESGLOSE",
                    tipoNumero: 1,
                    codigoGC: line.codigo,
                    descripcion: line.descripcion,
                    montoAfectado: line.copago,
                    bonificacion: line.bonificacion,
                    copago: line.copago,
                    declaracionFormal: buildDeclaracionFormal("AGRUPADOR_SIN_DESGLOSE", line.codigo, line.copago, line.descripcion),
                    fundamentosJuridicos: [...FUNDAMENTOS_JURIDICOS],
                    requerimientosDesglose: [...REQUERIMIENTOS_DESGLOSE],
                    bandera: "OPACIDAD_LIQUIDATORIA",
                    pamLineId: line.uniqueId,
                });
            }
        }

        // =====================================================================
        // TIPO 2: GASTOS NO CUBIERTOS GENÉRICOS
        // Code in generic "not covered" set
        // =====================================================================
        if (CODIGOS_GASTOS_GENERICOS.has(normCode) && line.copago > 0) {
            declarations.push({
                tipo: "GASTOS_NO_CUBIERTOS_GENERICOS",
                tipoNumero: 2,
                codigoGC: line.codigo,
                descripcion: line.descripcion,
                montoAfectado: line.copago,
                bonificacion: line.bonificacion,
                copago: line.copago,
                declaracionFormal: buildDeclaracionFormal("GASTOS_NO_CUBIERTOS_GENERICOS", line.codigo, line.copago, line.descripcion),
                fundamentosJuridicos: [...FUNDAMENTOS_JURIDICOS],
                requerimientosDesglose: [...REQUERIMIENTOS_DESGLOSE],
                bandera: "OPACIDAD_LIQUIDATORIA",
                pamLineId: line.uniqueId,
            });
        }

        // =====================================================================
        // TIPO 3: FRAGMENTACIÓN INTERNA
        // Same code appears 2+ times: one bonified, one not
        // =====================================================================
        if (CODIGOS_AGRUPADORES.has(normCode) && line.bonificacion === 0 && line.copago > 0) {
            const siblings = linesByCode.get(normCode) || [];
            const hasBonifiedSibling = siblings.some(s => s.uniqueId !== line.uniqueId && s.bonificacion > 0);

            if (hasBonifiedSibling) {
                // Avoid duplicate: check if we already added this exact line as Tipo 3
                const alreadyAdded = declarations.some(d =>
                    d.tipo === "FRAGMENTACION_INTERNA" && d.pamLineId === line.uniqueId
                );
                if (!alreadyAdded) {
                    declarations.push({
                        tipo: "FRAGMENTACION_INTERNA",
                        tipoNumero: 3,
                        codigoGC: line.codigo,
                        descripcion: line.descripcion,
                        montoAfectado: line.copago,
                        bonificacion: line.bonificacion,
                        copago: line.copago,
                        declaracionFormal: buildDeclaracionFormal("FRAGMENTACION_INTERNA", line.codigo, line.copago, line.descripcion),
                        fundamentosJuridicos: [...FUNDAMENTOS_JURIDICOS],
                        requerimientosDesglose: [...REQUERIMIENTOS_DESGLOSE],
                        bandera: "OPACIDAD_LIQUIDATORIA",
                        pamLineId: line.uniqueId,
                    });
                }
            }
        }
    }

    return declarations;
}

/**
 * Convert OpacityDeclarations into Finding objects for the audit engine.
 */
export function opacityToFindings(declarations: OpacityDeclaration[]): any[] {
    return declarations.map((d, i) => ({
        id: `OPACITY_DET_${d.tipoNumero}_${i}`,
        label: `OPACIDAD TIPO ${d.tipoNumero}: ${d.tipo} — ${d.descripcion}`,
        description: d.declaracionFormal,
        amount: d.montoAfectado,
        category: "Z",
        basis: "OPACIDAD" as const,
        hypothesisParent: "H_OPACIDAD_ESTRUCTURAL",
        recomendacion_accion: "SOLICITAR_ACLARACION",
        nivel_confianza: "ALTA",
        tipo_monto: "COPAGO_OPACO" as const,
        normaFundamento: d.fundamentosJuridicos.join("; "),
        estado_juridico: "INDETERMINADO_POR_OPACIDAD",
        // Metadata for downstream processing
        _opacityMeta: {
            tipo: d.tipo,
            tipoNumero: d.tipoNumero,
            codigoGC: d.codigoGC,
            copago: d.copago,
            bonificacion: d.bonificacion,
            esDeteccionDeterminista: true,
            requerimientos: d.requerimientosDesglose,
        },
    }));
}

/**
 * Generate a human-readable summary of all opacity detections.
 */
export function generateOpacitySummary(declarations: OpacityDeclaration[]): string {
    if (declarations.length === 0) return "No se detectó opacidad liquidatoria en el PAM.";

    const totalOpaco = declarations.reduce((sum, d) => sum + d.montoAfectado, 0);
    const totalFmt = totalOpaco.toLocaleString('es-CL');

    let summary = `⚠️ OPACIDAD LIQUIDATORIA DETECTADA\n`;
    summary += `Se identificaron ${declarations.length} declaraciones de opacidad por un total de $${totalFmt}.\n\n`;

    for (const d of declarations) {
        summary += `🔴 TIPO ${d.tipoNumero} — ${d.tipo}\n`;
        summary += `   Código: ${d.codigoGC} | Monto: $${d.montoAfectado.toLocaleString('es-CL')}\n`;
        summary += `   "${d.descripcion}"\n\n`;
    }

    summary += `\n⚖️ FUNDAMENTOS JURÍDICOS:\n`;
    for (const f of FUNDAMENTOS_JURIDICOS) {
        summary += `• ${f}\n`;
    }

    return summary;
}
