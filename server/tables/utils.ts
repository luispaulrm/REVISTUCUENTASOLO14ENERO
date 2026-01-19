// tables/utils.ts
export function sum(nums: Array<number | undefined | null>): number {
    return nums.reduce((acc, n) => acc + (typeof n === "number" && isFinite(n) ? n : 0), 0);
}

export function clampMoney(n: any): number {
    const x = typeof n === "number" ? n : Number(n);
    return Number.isFinite(x) ? Math.round(x) : 0;
}

export function formatCLP(n: number): string {
    // sin depender de Intl si no quieres; esto es simple y robusto
    const sign = n < 0 ? "-" : "";
    const v = Math.abs(n);
    return sign + "$" + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function normText(s: string): string {
    return (s || "")
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
