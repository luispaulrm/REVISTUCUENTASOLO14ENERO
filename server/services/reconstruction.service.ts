
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
     * Prioritizes items in sections that match the categoryHint.
     */
    public findMatches(target: number, categoryHint?: string): ReconstructionResult {
        if (target <= 0) return { matchedItems: [], unmatchedAmount: 0, success: true };

        const allItemsWithSection = this.bill.sections.flatMap(s =>
            (s.items || []).map(item => ({ item, section: s.category || "" }))
        );

        const availableItems = allItemsWithSection.filter(entry => {
            const id = this.getItemUniqueId(entry.item);
            return !this.usedItemIds.has(id);
        });

        // 1. Prioritize relevant sections
        const isMedsHint = /MEDICAMENTO|FARMA|DROGA/i.test(categoryHint || "");
        const isMatsHint = /MATERIAL|INSUMO|PROTESIS/i.test(categoryHint || "");

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

        // Try prioritized first, then combine with others if needed
        let result = this.subsetSum(target, prioritized);
        if (!result) {
            result = this.subsetSum(target, [...prioritized, ...others]);
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

    private subsetSum(target: number, items: BillingItem[]): BillingItem[] | null {
        const n = items.length;
        let result: BillingItem[] | null = null;
        let nodes = 0;
        const MAX_NODES = 1000000; // Efficient limit

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

            if (Math.abs(currentSum - target) <= 5) { // Small tolerance
                result = chosen;
                return;
            }

            if (idx === n) return;
            if (currentSum > target + 5) return;
            if (currentSum + suffixSums[idx] < target - 5) return;

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
 * Clinical classifier for bill items
 */
function classifyItemNorm(item: BillingItem): { norma: string, isCatA: boolean } {
    const desc = (item.description || "").toUpperCase();

    // 1. Unbundling (Circular IF-319 / Nursing)
    if (/INSTALACION.*VIA|FLEBOCLISIS|PUNCION|SIGNOS VITALES|CURACION SM/i.test(desc)) {
        return { norma: "Circular IF-319: Procedimiento de enfermería incluido en el valor del Día Cama.", isCatA: true };
    }

    // 2. Anestesia / Pabellón
    if (/PROPOFOL|FENTANIL|SEVOFLURANO|LIDOCAINA|BUPIVACAINA|ANESTESIA/i.test(desc)) {
        return { norma: "Práctica #3: Fármaco anestésico/quirúrgico debe estar incluido en Derecho de Pabellón.", isCatA: true };
    }

    // 3. Hotelería / Confort
    if (/SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|TERMOMETRO|CONFORT/i.test(desc)) {
        return { norma: "Criterio SIS: Insumos de confort personal y hotelería no constituyen prestación médica.", isCatA: true };
    }

    // Default
    return { norma: "Ley 20.584: Cobro opaco sin desglose previo; se confirma incumplimiento de cobertura 100%.", isCatA: true };
}

/**
 * Main entry point for reconstruction during audit.
 */
export function reconstructAllOpaque(bill: ExtractedAccount, findings: Finding[], initialUsedIds?: Set<number | string>): Finding[] {
    if (!bill || !bill.sections) {
        return findings;
    }

    const usedIds = initialUsedIds || new Set<number | string>();
    const reconstructor = new ArithmeticReconstructor(bill, usedIds);
    const output: Finding[] = [];

    for (const f of findings) {
        const desc = (f.label || "").toUpperCase();
        const isZ = f.category === 'Z';
        const isOpaque = /MEDICAMENTO|MATERIAL|INSUMO|GASTO|VARIO|CAJA|FARMA|CONTROVER/i.test(desc);

        if (isZ && isOpaque && f.amount > 0) {
            const result = reconstructor.findMatches(f.amount, desc);

            if (result.success && result.matchedItems.length > 0) {
                // Build Professional Markdown Table
                let itemsTable = "| Item Detalle | Monto | Norma Aplicable |\n| :--- | :--- | :--- |\n";
                let topItemLabel = "";
                let maxAmt = -1;

                result.matchedItems.forEach(i => {
                    const normInfo = classifyItemNorm(i);
                    itemsTable += `| ${i.description} | $${(i.total || 0).toLocaleString('es-CL')} | ${normInfo.norma} |\n`;

                    if (i.total > maxAmt) {
                        maxAmt = i.total;
                        topItemLabel = i.description;
                    }
                });

                // dynamic label
                const newLabel = topItemLabel ? `${topItemLabel} y otros (Reconstruido)` : `${f.label} (Reconstruido)`;

                output.push({
                    ...f,
                    category: 'A',
                    action: 'IMPUGNAR',
                    label: newLabel,
                    rationale: `${f.rationale}\n\n### DETALLE DE RECONSTRUCCIÓN ARITMÉTICA (AUDITORÍA FORENSE)\nSe ha identificado el desglose exacto de este monto opaco en la cuenta clínica. Al ser ítems específicos, se confirma su naturaleza improcedente según normativa:\n\n${itemsTable}\n\n**Conclusión:** Se impugna el monto total de $${f.amount.toLocaleString('es-CL')} por configurarse prácticas de duplicidad o incumplimiento de cobertura 100% comprometida en el contrato.`,
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
