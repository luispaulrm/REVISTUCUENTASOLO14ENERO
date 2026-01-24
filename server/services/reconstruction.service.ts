
import { BillingItem, Finding, ExtractedAccount } from '../../types.js';

export interface ReconstructionResult {
    matchedItems: BillingItem[];
    unmatchedAmount: number;
    success: boolean;
    compatibilityRationale?: string;
}

export class ArithmeticReconstructor {
    private usedItemIds: Set<number | string>;
    constructor(private bill: ExtractedAccount, initialUsedIds: Set<number | string> = new Set()) {
        this.usedItemIds = new Set(initialUsedIds);
    }

    /**
     * Attempts to find a subset of unused bill items that sum up to the target amount.
     * Strictly filters items by compatibility with the glosa and clinical context.
     */
    public findMatches(target: number, glosa: string, context?: string, tolerancePct: number = 0.05): ReconstructionResult {
        if (target <= 0) return { matchedItems: [], unmatchedAmount: 0, success: true };

        const allItemsWithSection = this.bill.sections.flatMap(s =>
            (s.items || []).map(item => ({ item, section: s.category || "" }))
        );

        // MANDATORY RULE: Filter by semantic/contextual compatibility
        const compatibleItems = allItemsWithSection.filter(entry => {
            const id = this.getItemUniqueId(entry.item);
            if (this.usedItemIds.has(id)) return false;

            return this.isCompatible(entry.item, entry.section, glosa, context);
        });

        const toleranceAbs = target * tolerancePct;
        const itemsOnly = compatibleItems.map(e => e.item);

        const result = this.subsetSum(target, itemsOnly, toleranceAbs);

        if (result) {
            result.forEach(item => this.usedItemIds.add(this.getItemUniqueId(item)));
            return {
                matchedItems: result,
                unmatchedAmount: 0,
                success: true,
                compatibilityRationale: `Compatibilidad confirmada: ${result.length} ítems coinciden semánticamente con '${glosa}' en contexto ${context || 'General'}.`
            };
        }

        return {
            matchedItems: [],
            unmatchedAmount: target,
            success: false
        };
    }

    private normalizeString(s: string): string {
        return (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    private isCompatible(item: BillingItem, section: string, glosa: string, context?: string): boolean {
        const desc = this.normalizeString(item.description);
        const sec = this.normalizeString(section);
        const glo = this.normalizeString(glosa);
        const ctx = this.normalizeString(context || "");

        // PRINCIPLE: Semantic Lock-in per Glosa

        // 1. Bed/Room Charges (Día Cama)
        if (glo.includes("DIA CAMA") || glo.includes("HABITACION") || glo.includes("ESTANCIA")) {
            const isBedSection = /HABITACION|DIA CAMA|ESTANCIA|HOSPITALIZACION/i.test(sec);
            const isNursingProced = /NURSING|ENFERMERIA|SIGNOS VITALES|CURACION|INSTALACION.*VIA/i.test(desc);
            return isBedSection || isNursingProced;
        }

        // 2. Surgical Context (Direct lock or Glosa)
        if (glo.includes("QUIRURGICO") || glo.includes("PABELLON") || ctx === "QUIRURGICO") {
            const isSurgicalSec = /PABELLON|QUIRURGICO|ANESTESIA|RECUPERACION/i.test(sec);
            const isSurgicalItem = /PROPOFOL|FENTANIL|SEVOFLURANO|LIDOCAINA|BUPIVACAINA|ANESTESIA|SUTURA|GASA|DRENAJE|BISTURI/i.test(desc);
            const isClinicalMed = /INYECTABLE|AMPOLLA|FRASCO|SOLUCION/i.test(desc) && /PABELLON/i.test(sec);
            return isSurgicalSec || isSurgicalItem || isClinicalMed;
        }

        // 3. Meds/Materials (Specific Pools)
        if (/MEDICAMENTO|FARMA|DROGA/i.test(glo)) {
            const isMedSec = /MEDICAMENTO|FARMA|DROGA|FARMACIA/i.test(sec);
            const isMedDesc = /INYECTABLE|AMPOLLA|FRASCO|SOLUCION|GRAGEA|TABLETA/i.test(desc);
            return isMedSec || isMedDesc;
        }

        if (/MATERIAL|INSUMO/i.test(glo)) {
            const isMatSec = /MATERIAL|INSUMO|EQUIPO|ESTERIL/i.test(sec);
            const isMatDesc = /GASA|JERINGA|GUANTE|DRENAJE|SUTURA|SONDA|CATETER/i.test(desc);
            return isMatSec || isMatDesc;
        }

        // 4. "Gastos No Cubiertos" / "Prestación No Contemplada" (Forensic Catch-all)
        if (/GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|VARIOS|AJUSTE|DIFERENCIA/i.test(glo)) {
            const isComfort = /SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|TERMOMETRO|CONFORT|TELEVISOR|ESTACIONAMIENTO|ALIMENTAC/i.test(desc);
            const isUnbundled = /INSTALACION.*VIA|FLEBOCLISIS|PUNCION|SIGNOS VITALES/i.test(desc);
            const isGenericSec = /VARIOS|OTROS|CARGOS GENERALES|ADMINISTRATIVO/i.test(sec);
            return isComfort || isUnbundled || isGenericSec;
        }

        // Fallback: If no strict rule matches, allow only if there's generic linguistic overlap
        return sec.includes(glo) || glo.includes(sec);
    }

    private subsetSum(target: number, items: BillingItem[], tolerance: number): BillingItem[] | null {
        const n = items.length;
        let result: BillingItem[] | null = null;
        let nodes = 0;
        const MAX_NODES = 500000; // Efficient limit for search

        // Sort descending to prune faster
        const sorted = [...items].sort((a, b) => (b.total || 0) - (a.total || 0));

        const suffixSums = new Array(n + 1).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            suffixSums[i] = suffixSums[i + 1] + (sorted[i].total || 0);
        }

        function dfs(idx: number, currentSum: number, chosen: BillingItem[]) {
            if (result) return;
            nodes++;
            if (nodes > MAX_NODES) return;

            if (Math.abs(currentSum - target) <= tolerance) {
                result = chosen;
                return;
            }

            if (idx === n) return;
            if (currentSum > target + tolerance) return;
            if (currentSum + suffixSums[idx] < target - tolerance) return;

            dfs(idx + 1, currentSum + (sorted[idx].total || 0), [...chosen, sorted[idx]]);
            dfs(idx + 1, currentSum, chosen);
        }

        dfs(0, 0, []);
        return result;
    }

    private getItemUniqueId(item: BillingItem): string | number {
        return item.index !== undefined ? item.index : `${item.description}_${item.total}`;
    }
}

/**
 * Clinical classifier for bill items (Forensic Priority)
 */
function classifyItemNorm(item: BillingItem): { norma: string, isCatA: boolean } {
    const desc = (item.description || "").toUpperCase();

    if (/INSTALACION.*VIA|FLEBOCLISIS|PUNCION|SIGNOS VITALES|CURACION/i.test(desc)) {
        return { norma: "Circular IF-319: Procedimiento de enfermería incluido en el valor del Día Cama.", isCatA: true };
    }

    if (/PROPOFOL|FENTANIL|SEVOFLURANO|LIDOCAINA|BUPIVACAINA|ANESTESIA/i.test(desc)) {
        return { norma: "Práctica #3: Fármaco anestésico/quirúrgico debe estar incluido en Derecho de Pabellón.", isCatA: true };
    }

    if (/SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|TERMOMETRO|CONFORT/i.test(desc)) {
        return { norma: "Criterio SIS: Insumos de confort personal y hotelería no constituyen prestación médica.", isCatA: true };
    }

    return { norma: "Ley 20.584: Cobro opaco sin desglose previo; se confirma incumplimiento de transparencia.", isCatA: true };
}

/**
 * Main entry point for reconstruction during audit.
 * Implements "Desglose Especulativo Controlado" doctrine.
 */
export function reconstructAllOpaque(bill: ExtractedAccount, findings: Finding[], initialUsedIds?: Set<number | string>): Finding[] {
    if (!bill || !bill.sections) return findings;

    const usedIds = initialUsedIds || new Set<number | string>();
    const reconstructor = new ArithmeticReconstructor(bill, usedIds);
    const output: Finding[] = [];

    for (const f of findings) {
        const desc = (f.label || "").toUpperCase();
        // TRIGGER: Identify opaque glosas
        const isOpaqueTrigger = /PRESTACION NO CONTEMPLADA|GASTOS? NO CUBIERTO|VARIOS|AJUSTE|DIFERENCIA|MEDICAMENTO|MATERIAL|INSUMO/i.test(desc) ||
            /3201001|3201002/.test(desc);

        const amount = f.amount || 0;

        if (isOpaqueTrigger && amount > 0) {
            // STEP 3: Multi-level tolerance check with context
            const context = /PABELLON|INTERVENCION|SURGERY|QUIRURGICA/i.test(desc) ? "QUIRURGICO" : undefined;

            // Try 5% (Cat A - High Probability)
            let result = reconstructor.findMatches(amount, desc, context, 0.05);
            let category: "A" | "B" | "K" | "Z" | "OK" = result.success ? "A" : "Z";
            let action: "IMPUGNAR" | "SOLICITAR_ACLARACION" = result.success ? "IMPUGNAR" : "SOLICITAR_ACLARACION";
            let forensicStatus = result.success ? "COBRO_ENCUBIERTO" : "OPACIDAD_ESTRUCTURAL_SEVERA";

            // If 5% fails, try 10% (Cat B - Partial Redistribution)
            if (!result.success) {
                result = reconstructor.findMatches(amount, desc, context, 0.10);
                if (result.success) {
                    category = "B";
                    action = "SOLICITAR_ACLARACION";
                    forensicStatus = "REDISTRIBUCION_PARCIAL";
                }
            }

            if (result.success && result.matchedItems.length > 0) {
                // Determine if any matched item confirms improcedencia (for Cat A promotion)
                const hasHardImprocedencia = result.matchedItems.some(i => classifyItemNorm(i).isCatA && !classifyItemNorm(i).norma.includes("Ley 20.584"));

                // If it was originally A or if we found hard improcedencia, keep/promote to A
                // Otherwise, use K (Impugnable por Opacidad)
                if (category === "A" && !hasHardImprocedencia) {
                    category = "K";
                    forensicStatus = "COBRO_IMPUNABLE_POR_OPACIDAD";
                }

                let itemsTable = "| Item Detalle | Monto | Norma Aplicable |\n| :--- | :--- | :--- |\n";
                result.matchedItems.forEach(i => {
                    const normInfo = classifyItemNorm(i);
                    itemsTable += `| ${i.description} | $${(i.total || 0).toLocaleString('es-CL')} | ${normInfo.norma} |\n`;
                });

                const techMessage = `El monto clasificado como '${f.label}' se explica matemáticamente por la agregación de ítems de la cuenta clínica. ${result.compatibilityRationale || ''} Status: ${forensicStatus}.`;
                const userMessage = `Detectamos que este cargo coincide con materiales e insumos de su hospitalización que carecen de detalle. Esto sugiere cobros redundantes o falta de transparencia.`;

                output.push({
                    ...f,
                    category,
                    action,
                    label: `${f.label} (Reconstruido)`,
                    rationale: `${f.rationale}\n\n### DESGLOSE ESPECULATIVO CONTROLADO (AUDITORÍA FORENSE)\n${techMessage}\n\n**Explicación para el paciente:** ${userMessage}\n\n${itemsTable}\n\n**Conclusión:** ${category === 'A' ? 'Se impugna por improcedencia confirmada.' : 'Se impugna por falta de transparencia y coincidencia aritmética.'}`,
                    hypothesisParent: category === 'A' ? 'H_UNBUNDLING_IF319' : 'H_OPACIDAD_ESTRUCTURAL',
                    evidenceRefs: [
                        ...(f.evidenceRefs || []),
                        ...result.matchedItems.map(i => `ITEM INDEX: ${i.index}`)
                    ]
                });
                continue;
            }
        }
        output.push(f);
    }

    return output;
}
