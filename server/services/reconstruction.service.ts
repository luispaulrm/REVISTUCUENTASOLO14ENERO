
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
     */
    public findMatches(target: number, categoryHint?: string): ReconstructionResult {
        if (target <= 0) return { matchedItems: [], unmatchedAmount: 0, success: true };

        const allItems = this.bill.sections.flatMap(s => s.items || []);
        const availableItems = allItems.filter(item => {
            const id = this.getItemUniqueId(item);
            return !this.usedItemIds.has(id);
        });

        // Search all available items for maximum robustness
        const candidateItems = availableItems;

        const result = this.subsetSum(target, candidateItems);

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
        const MAX_NODES = 2000000;

        // Sort descending to prune faster
        const sorted = [...items].sort((a, b) => b.total - a.total);

        // Pre-calculate suffix sums for powerful pruning
        // if (currentSum + suffixSum[idx] < target) then we can't reach the target.
        const suffixSums = new Array(n + 1).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            suffixSums[i] = suffixSums[i + 1] + sorted[i].total;
        }

        function dfs(idx: number, currentSum: number, chosen: BillingItem[]) {
            if (result) return;
            nodes++;
            if (nodes > MAX_NODES) return;

            // Tolerance of 2 units for rounding differences
            if (Math.abs(currentSum - target) <= 2) {
                result = chosen;
                return;
            }

            if (idx === n) return;

            // Pruning 1: Current sum already exceeds target
            if (currentSum > target + 2) return;

            // Pruning 2: Even including all remaining items is not enough
            if (currentSum + suffixSums[idx] < target - 2) return;

            // Standard DFS:
            // Option A: Include current item
            dfs(idx + 1, currentSum + sorted[idx].total, [...chosen, sorted[idx]]);

            // Option B: Exclude current item
            if (nodes % 100000 === 0) {
                // Keep track of progress if it's very slow
            }
            dfs(idx + 1, currentSum, chosen);
        }

        dfs(0, 0, []);
        return result;
    }

    private getItemUniqueId(item: BillingItem): string | number {
        return item.index !== undefined ? item.index : `${item.description}_${item.total}`;
    }

    private getItemCategory(item: BillingItem): string {
        return this.bill.sections.find(s => s.items.includes(item))?.category || "";
    }
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
        const matchesRegex = /MEDICAMENTO|MATERIAL|INSUMO|GASTO|VARIO|CAJA|FARMA|CONTROVER/i.test(desc);

        if (isZ && matchesRegex && f.amount > 0) {
            const result = reconstructor.findMatches(f.amount, desc);

            if (result.success && result.matchedItems.length > 0) {
                // Transform finding to Cat A with breadown
                const itemsList = result.matchedItems.map(i => `  - ${i.description}: $${(i.total || 0).toLocaleString('es-CL')}`).join('\n');

                output.push({
                    ...f,
                    category: 'A',
                    action: 'IMPUGNAR',
                    label: `${f.label} (RECONSTRUIDO)`,
                    rationale: `${f.rationale}\n\n**DETALLE DE RECONSTRUCCIÓN ARITMÉTICA:**\nSe ha logrado identificar el desglose exacto de este monto opaco en la cuenta clínica:\n${itemsList}\n\nAl haberse identificado los ítems, se confirma que corresponden a prestaciones cuya bonificación fue omitida o rechazada sin justificación contractual (cobertura 100% comprometida).`,
                    hypothesisParent: 'H_INCUMPLIMIENTO_CONTRACTUAL'
                });
                continue;
            }
        }
        output.push(f);
    }

    return output;
}
