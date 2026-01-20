import { BillingModel } from '../../types';

export interface BillingModelClassification {
    model: BillingModel;
    authoritativeTotal: number;
    unitPriceTrust: number;
    qtyIsProration: boolean;
    suspectedColumnShift: boolean;
    rationale: string;
    toleranceApplied?: number;
}

export interface RawItemContext {
    quantity: number;
    unitPrice: number;
    total: number;
    valorIsa?: number;
    description?: string;
}

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

// Common proration factors found in clinical billing (packs, boxes, fractionals)
// These quantities almost ALWAYS imply the Unit Price is a "Reference Price" (box price), not per-unit.
const PRORATION_WHITELIST = new Set([
    0.02, 0.03, 0.04, 0.05, 0.06, 0.08,
    0.1, 0.12, 0.15, 0.16, 0.2, 0.25, 0.3, 0.33, 0.4, 0.5, 0.6, 0.75, 0.8,
    1.2, 1.5, 1.8 // Sometimes > 1 but still fractional/packs
]);

const PRORATION_TOLERANCE = 0.015; // Tolerance for float comparison (e.g. 0.02999 vs 0.03)

// Price threshold to consider "Sanity" for multiplicative validation
// If price is > 2M, we are extra careful about column shifts.
const PRICE_SANITY_LIMIT = 2000000;

// If implied unit price differs by > 30%, we suspect extraction error
const SUSPICIOUS_PRICE_RATIO = 0.30;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isTypicalProration(qty: number): boolean {
    if (qty >= 2) return false; // Usually proration is small, unless it's 1.5 etc.

    // Check if close to any whitelist value
    for (const val of PRORATION_WHITELIST) {
        if (Math.abs(qty - val) < PRORATION_TOLERANCE) return true;
    }

    // Also checks if typically small decimal < 1 (that isn't 0)
    if (qty < 0.99 && qty > 0) return true;

    return false;
}

function hasStrongMultiplicativeEvidence(
    qty: number,
    unitPrice: number,
    authTotal: number
): boolean {
    const calcTotal = qty * unitPrice;
    // Tolerance: 0.1% of total or 1 peso, whichever is larger
    // This allows for rounding differences in large numbers (e.g. 212486 vs 212484)
    const tolerance = Math.max(2, 0.002 * authTotal);

    const matches = Math.abs(authTotal - calcTotal) <= tolerance;
    const reasonablePrice = unitPrice < PRICE_SANITY_LIMIT;

    return matches && reasonablePrice;
}

function isSuspiciousUnitPrice(
    qty: number,
    unitPrice: number,
    authTotal: number
): boolean {
    if (qty <= 0 || unitPrice <= 0 || authTotal <= 0) return false;

    const impliedUnitPrice = authTotal / qty;
    const priceDifference = Math.abs(impliedUnitPrice - unitPrice);
    const denominator = Math.max(impliedUnitPrice, unitPrice);

    const ratio = priceDifference / denominator;

    // If the math is WAY off (>30% diff), it's likely a column shift
    // e.g. Price=9805, Total=850, Qty=2. Implied=425. Diff=9380. Ratio=0.95 (95% off) -> Suspicious.
    return ratio > SUSPICIOUS_PRICE_RATIO;
}

// ============================================================================
// MAIN CLASSIFIER
// ============================================================================

export function classifyBillingModel(item: RawItemContext): BillingModelClassification {
    // RULE 1: Authoritative Total
    // If valorIsa exists and is > 0, it is the TRUTH.
    // Otherwise, use the stated Total.
    const authTotal = (item.valorIsa && item.valorIsa > 0) ? item.valorIsa : item.total;

    // Defaults
    let model: BillingModel = 'MULTIPLICATIVE_EXACT';
    let unitPriceTrust = 1.0;
    let qtyIsProration = false;
    let suspectedColumnShift = false;
    let rationale = '';
    let tolerance = 0;

    // RULE 4: Suspicious Unit Price (Check FIRST to catch column shifts masquerading as errors)
    // Validate if the Unit Price makes ANY sense mathematically vs the Total.
    if (isSuspiciousUnitPrice(item.quantity, item.unitPrice, authTotal)) {
        // Double check: Is it perhaps a proration case that looks like a shift?
        // E.g. Qty 0.03, Price 15M, Total 468k. Implied=15.6M. Matches Price. Not suspicious.
        // The check inside isSuspiciousUnitPrice handles this by comparing implied vs actual.
        // In the Item 41 case: Qty=0.12, Price=1.13M. Total=135k. Implied=1.13M.
        // Wait, if 0.12 * 1.13M = 135k, then it IS multiplicative!
        // Item 41 actual data: Total=135603 but ValorISA=226005.
        // If we use ValorISA as authTotal (226005), then 226005 / 0.12 = 1.88M.
        // Stated Price is 1.13M. Diff is huge -> Suspicious!

        model = 'UNIT_PRICE_UNTRUSTED';
        unitPriceTrust = 0.0; // Do not trust this unit price
        suspectedColumnShift = true;
        rationale = 'Inconsistencia severa entre Precio Unitario y Total Autorizado (posible Desplazamiento de Columna).';

        return { model, authoritativeTotal: authTotal, unitPriceTrust, qtyIsProration, suspectedColumnShift, rationale };
    }

    // RULE 3: Strong Multiplicative Evidence
    // If the math works out perfectly (or very close), we prefer the EXACT model.
    // This overrides generic proration assumptions if the numbers actually match.
    // Example: Sevoflurano 1.8 * 118047 = 212484.6. AuthTotal = 212486. Match!
    if (hasStrongMultiplicativeEvidence(item.quantity, item.unitPrice, authTotal)) {
        model = 'MULTIPLICATIVE_EXACT';
        rationale = 'Validación matemática exitosa (Cantidad x Precio = Total).';
        unitPriceTrust = 1.0;
        tolerance = Math.max(2, 0.002 * authTotal);

        return { model, authoritativeTotal: authTotal, unitPriceTrust, qtyIsProration, suspectedColumnShift, rationale, toleranceApplied: tolerance };
    }

    // RULE 2: Prorated Reference Price
    // If it didn't match perfectly, AND it looks like a proration quantity, assume it is Proration.
    // We do NOT flag this as a calculation error.
    if (isTypicalProration(item.quantity)) {
        model = 'PRORATED_REFERENCE_PRICE';
        qtyIsProration = true;
        unitPriceTrust = 0.5; // It's a reference price, not a transactional unit price
        rationale = `Cantidad fraccional (${item.quantity}) indica modelo de Prorrateo/Pack.`;

        return { model, authoritativeTotal: authTotal, unitPriceTrust, qtyIsProration, suspectedColumnShift, rationale };
    }

    // FALLBACK
    // If it's a whole number (e.g. 1, 5) and didn't match Rule 3 (Math), then it IS a calculation error.
    // We keep it as MULTIPLICATIVE_EXACT so the auditor flags the discrepancy.
    model = 'MULTIPLICATIVE_EXACT';
    rationale = 'Cantidad entera sin coincidencia matemática. Requiere revisión.';
    unitPriceTrust = 0.8;

    return {
        model,
        authoritativeTotal: authTotal,
        unitPriceTrust,
        qtyIsProration,
        suspectedColumnShift,
        rationale
    };
}
