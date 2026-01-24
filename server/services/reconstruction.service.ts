
import { BillingItem, Finding, ExtractedAccount } from '../../types.js';

export interface ReconstructionResult {
    matchedItems: BillingItem[];
    unmatchedAmount: number;
    success: boolean;
}

export class ArithmeticReconstructor {
    private usedItemIds: Set<number | string>;
    constructor(private bill: ExtractedAccount, initialUsedIds: Set<number | string> = new Set()) {
        this.usedItemIds = new Set(initialUsedIds);
    }

    /**
     * Attempts to find a subset of unused bill items that sum up to the target amount.
     * Supports tolerance for speculative breakdown.
     */
    public findMatches(target: number, categoryHint?: string, tolerancePct: number = 0.05): ReconstructionResult {
        if (target <= 0) return { matchedItems: [], unmatchedAmount: 0, success: true };

        const allItemsWithSection = this.bill.sections.flatMap(s =>
            (s.items || []).map(item => ({ item, section: s.category || "" }))
        );

        const availableItems = allItemsWithSection.filter(entry => {
            const id = this.getItemUniqueId(entry.item);
            return !this.usedItemIds.has(id);
        });

        // Step 2: Candidates filter
        const isMedsHint = /MEDICAMENTO|FARMA|DROGA/i.test(categoryHint || "");
        const isMatsHint = /MATERIAL|INSUMO|EQUIPO|ESTERIL/i.test(categoryHint || "");

        const prioritized = availableItems.filter(entry => {
            if (isMedsHint) return /MEDICAMENTO|FARMA|DROGA/i.test(entry.section);
            if (isMatsHint) return /MATERIAL|INSUMO|EQUIPO|ESTERIL/i.test(entry.section);
            return true;
        }).map(e => e.item);

        const others = availableItems.filter(entry => {
            if (isMedsHint) return !/MEDICAMENTO|FARMA|DROGA/i.test(entry.section);
            if (isMatsHint) return !/MATERIAL|INSUMO|EQUIPO|ESTERIL/i.test(entry.section);
            return false;
        }).map(e => e.item);

        const toleranceAbs = target * tolerancePct;

        let result = this.subsetSum(target, prioritized, toleranceAbs);
        if (!result) {
            result = this.subsetSum(target, [...prioritized, ...others], toleranceAbs);
        }

        if (result) {
            result.forEach(item => this.usedItemIds.add(this.getItemUniqueId(item)));
            return {
                matchedItems: result,
                unmatchedAmount: 0,
                success: true
            };
        }

        return {
            matchedItems: [],
            unmatchedAmount: target,
            success: false
        };
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
            // STEP 3: Multi-level tolerance check

            // Try 5% (Cat A - High Probability)
            let result = reconstructor.findMatches(amount, desc, 0.05);
            let category: "A" | "B" | "Z" = result.success ? "A" : "Z";
            let action: "IMPUGNAR" | "SOLICITAR_ACLARACION" = result.success ? "IMPUGNAR" : "SOLICITAR_ACLARACION";
            let forensicStatus = result.success ? "COBRO_ENCUBIERTO" : "OPACIDAD_ESTRUCTURAL_SEVERA";

            // If 5% fails, try 10% (Cat B - Partial Redistribution)
            if (!result.success) {
                result = reconstructor.findMatches(amount, desc, 0.10);
                if (result.success) {
                    category = "B";
                    action = "SOLICITAR_ACLARACION";
                    forensicStatus = "REDISTRIBUCION_PARCIAL";
                }
            }

            if (result.success && result.matchedItems.length > 0) {
                let itemsTable = "| Item Detalle | Monto | Norma Aplicable |\n| :--- | :--- | :--- |\n";
                result.matchedItems.forEach(i => {
                    const normInfo = classifyItemNorm(i);
                    itemsTable += `| ${i.description} | $${(i.total || 0).toLocaleString('es-CL')} | ${normInfo.norma} |\n`;
                });

                const techMessage = `El monto clasificado como '${f.label}' puede explicarse matemáticamente mediante la agregación de ítems de la cuenta clínica que carecen de desglose suficiente y presentan alta probabilidad de corresponder a insumos incluidos en la hospitalización o el acto quirúrgico. Status: ${forensicStatus}.`;
                const userMessage = `Este cobro no explica qué se está pagando. Al analizar su cuenta, detectamos que el monto coincide con materiales e insumos ya utilizados durante su hospitalización, los que normalmente están cubiertos o incluidos. Esto sugiere un posible cobro improcedente.`;

                output.push({
                    ...f,
                    category,
                    action,
                    label: `${f.label} (Reconstruido)`,
                    rationale: `${f.rationale}\n\n### DESGLOSE ESPECULATIVO CONTROLADO (AUDITORÍA FORENSE)\n${techMessage}\n\n**Explicación para el paciente:** ${userMessage}\n\n${itemsTable}\n\n**Conclusión:** ${category === 'A' ? 'Se impugna el monto por cierre contable exacto.' : 'Se solicita aclaración por coincidencia matemática parcial.'}`,
                    hypothesisParent: 'H_INCUMPLIMIENTO_CONTRACTUAL',
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
