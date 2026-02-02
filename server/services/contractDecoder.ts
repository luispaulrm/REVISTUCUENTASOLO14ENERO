
import { RawCell, ContractCoverage } from './contractTypes.js';

/**
 * CONTRACT DECODER SERVICE (The Brain)
 * 
 * Responsibilities:
 * 1. Reconstruct 2D Grid from RawCell[] sparse matrix.
 * 2. Perform "Header Analysis" to identify columns (Preferente, Libre, Tope).
 * 3. Extract data row-by-row using deterministic coordinates.
 * 4. Normalize values (UF, percentages).
 */


export function decodeCartesian(cells: RawCell[], ambito: "HOSPITALARIO" | "AMBULATORIO"): ContractCoverage[] {
    if (!cells || cells.length === 0) return [];

    // 1. RECONSTRUCT GRID
    const { grid } = reconstructGrid(cells);
    if (grid.length === 0) return [];

    // 2. HEADER ANALYSIS (Determines Semantic Map)
    const columnMap = analyzeHeaders(grid);

    // 3. EXTRACTION LOOP
    const results: ContractCoverage[] = [];

    // We scan all rows and filter by "has item text".
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;

        const itemText = findItemName(row, columnMap);
        if (!itemText || itemText.length < 3 || isHeaderRow(itemText)) continue;

        // Process Modalities
        ["PREFERENTE", "LIBRE_ELECCION"].forEach(modality => {
            const cols = modality === "PREFERENTE" ? columnMap.preferente : columnMap.libre;
            const text = extractValue(row, cols).raw;
            if (!text) return;

            const percentage = parsePercentage(text);
            const { value, unit } = parseTope(text);

            results.push({
                prestacion: itemText,
                ambito: ambito,
                modalidad: modality as any,
                porcentaje: percentage,
                tope: value,
                unidad: unit,
                tipoTope: "POR_EVENTO",
                fuente: "TABLA_CONTRATO"
            });
        });
    }

    return results;
}

// ============================================================================
// HELPERS
// ============================================================================

function reconstructGrid(cells: RawCell[]): { grid: string[][] } {
    const grid: string[][] = [];
    let maxR = 0;
    let maxC = 0;

    cells.forEach(c => {
        if (typeof c.fila_index === 'number' && c.fila_index > maxR) maxR = c.fila_index;
        if (typeof c.col_index === 'number' && c.col_index > maxC) maxC = c.col_index;
    });

    for (let r = 0; r <= maxR; r++) {
        grid[r] = new Array(maxC + 1).fill("");
    }

    cells.forEach(c => {
        // ROBUST CHECK: Skip cells with missing, invalid or negative indices
        if (typeof c.fila_index !== 'number' || typeof c.col_index !== 'number' || c.fila_index < 0 || c.col_index < 0) return;
        if (grid[c.fila_index]) {
            grid[c.fila_index][c.col_index] = (c.texto || "").trim();
        }
    });

    return { grid };
}

interface ColumnMap {
    preferente: number[];
    libre: number[];
}

function analyzeHeaders(grid: string[][]): ColumnMap {
    const map: ColumnMap = { preferente: [], libre: [] };

    for (let r = 0; r < Math.min(grid.length, 10); r++) {
        for (let c = 0; c < grid[r].length; c++) {
            const txt = grid[r][c].toUpperCase();

            // LIBRE ELECCION
            if (txt.includes("LIBRE") || txt.includes("ELECCION") || txt.includes("REEMBOLSO")) {
                if (!map.libre.includes(c)) map.libre.push(c);
                // Also capture next col if it's likely part of the same modality (e.g. Tope)
                if (c + 1 < grid[r].length && !txt.includes("PREFERENTE")) {
                    if (!map.libre.includes(c + 1)) map.libre.push(c + 1);
                }
            }

            // PREFERENTE
            if (txt.includes("PREFERENTE") || txt.includes("CONVENIO") || txt.includes("CLINICA") || txt.includes("PLAN")) {
                if (!map.preferente.includes(c)) map.preferente.push(c);
                if (c + 1 < grid[r].length && !txt.includes("LIBRE")) {
                    if (!map.preferente.includes(c + 1)) map.preferente.push(c + 1);
                }
            }
        }
    }

    // Strict overlap prevention: if a column is in both, remove from Preferente (usually Libre is more specific) or vice versa.
    // Better: if Preferente was found first, and a column is common, prioritize based on position.

    // Fallback if empty
    if (map.preferente.length === 0) map.preferente = [1, 2];
    if (map.libre.length === 0) map.libre = [3, 4, 5];

    return map;
}

function findItemName(row: string[], map: ColumnMap): string {
    // Try col 0, then col 1 if col 0 is a number (index)
    if (row[0]) {
        if (row[0].length > 4) return row[0];
        // If row[0] is a short number (index), try row[1]
        if (/^\d{1,3}$/.test(row[0]) && row[1]) return row[1];
    }
    return row[0] || "";
}

function isHeaderRow(text: string): boolean {
    const t = text.toUpperCase();
    return t.includes("PRESTACION") || t.includes("ITEM") || t.includes("BENEFICIO") || t.includes("TABLA");
}

function extractValue(row: string[], cols: number[]): { raw: string } {
    const texts = cols.map(c => row[c]).filter(t => t && t.trim().length > 0);
    if (texts.length === 0) return { raw: "" };
    return { raw: texts.join(" ") };
}

function parsePercentage(raw: string): number | null {
    if (!raw) return null;

    // --- ALGORITHMIC EXCLUSION DETECTION (User Request: "Visual Reading Comprehension") ---
    const upper = raw.toUpperCase();
    const exclusions = ["EXCLUIDO", "SIN COBERTURA", "NO CUBRE", "NO BONIFICA", "SIN BONIFICACION", "NC", "S/C"];

    // Explicit 0% markers
    if (exclusions.some(ex => upper.includes(ex)) || raw.trim() === "-" || raw.trim() === "—") {
        return 0;
    }

    const clean = raw.replace(/,/g, '.');
    // Look for a number immediately followed by %
    const match = clean.match(/(\d+)\s*%/);
    if (match) return parseFloat(match[1]);

    // Bare number fallback (only if no other numbers exist or it's clearly a lone percentage)
    const num = parseFloat(clean);
    if (!isNaN(num) && num > 1 && num <= 100 && !clean.includes("UF") && !clean.includes("AC2")) {
        return num;
    }

    return null;
}

function parseTope(raw: string): { value: number | null, unit: "UF" | "AC2" | "SIN_TOPE" } {
    if (!raw) return { value: null, unit: "SIN_TOPE" };
    const up = raw.toUpperCase();

    if (up.includes("SIN TOPE") || up.includes("ILIMITADO")) return { value: null, unit: "SIN_TOPE" };

    // Detect Unit
    let unit: "UF" | "AC2" | "SIN_TOPE" = "UF";
    if (up.includes("AC2") || up.includes("ARANCEL") || up.includes("VECES")) unit = "AC2";

    // Detect Value: Skip any number followed by %
    const tokens = raw.split(/[\s\(\)]+/);
    for (const token of tokens) {
        if (token.includes("%")) continue;
        const match = token.match(/([\d\.,]+)/);
        if (match) {
            const val = parseFloat(match[1].replace(/\./g, '').replace(',', '.')); // Handle thousands
            // Refined parsing for thousands vs decimals
            // 3.0 -> 3
            // 2.000 -> 2000
            let finalVal = val;
            if (token.includes(".") && token.includes(",")) {
                // Standard format 2.000,50
                finalVal = parseFloat(token.replace(/\./g, '').replace(',', '.'));
            } else if (token.includes(".") && token.split(".")[1].length === 3) {
                // Likely thousands: 2.000
                finalVal = parseFloat(token.replace(/\./g, ''));
            }

            if (!isNaN(finalVal)) return { value: finalVal, unit };
        }
    }

    return { value: null, unit: "SIN_TOPE" };
}
