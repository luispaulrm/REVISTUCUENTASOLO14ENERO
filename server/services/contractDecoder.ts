
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
    const { grid, maxBytes } = reconstructGrid(cells);
    if (grid.length === 0) return [];

    // 2. HEADER ANALYSIS (Determines Semantic Map)
    const columnMap = analyzeHeaders(grid);

    // 3. EXTRACTION LOOP
    const results: ContractCoverage[] = [];

    // Start from row after header (heuristic: row 3 or first row with data)
    // We scan all rows and filter by "has item text".
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;

        // Heuristic: Item name is usually in col 0 or 1
        // We look for the first non-empty column that isn't a known numeric value
        const itemText = findItemName(row, columnMap);
        if (!itemText || itemText.length < 3 || isHeaderRow(itemText)) continue;

        // Extract values using the Map
        const preferente = extractValue(row, columnMap.preferente);
        const libre = extractValue(row, columnMap.libre);

        // Use Modalidad-specific logic if needed. For now, flat coverage.

        // CREATE PREFERENTE ENTRY
        if (preferente.raw) {
            results.push({
                prestacion: itemText,
                ambito: ambito,
                modalidad: "PREFERENTE",
                porcentaje: parsePercentage(preferente.raw),
                tope: parseTope(preferente.raw).value,
                unidad: parseTope(preferente.raw).unit,
                tipoTope: "POR_EVENTO", // Default, refined by logic later
                fuente: "TABLA_CONTRATO"
            });
        }

        // CREATE LIBRE ELECCION ENTRY
        if (libre.raw) {
            results.push({
                prestacion: itemText,
                ambito: ambito,
                modalidad: "LIBRE_ELECCION",
                porcentaje: parsePercentage(libre.raw),
                tope: parseTope(libre.raw).value,
                unidad: parseTope(libre.raw).unit,
                tipoTope: "POR_EVENTO",
                fuente: "TABLA_CONTRATO"
            });
        }
    }

    return results;
}

// ============================================================================
// HELPERS
// ============================================================================

function reconstructGrid(cells: RawCell[]): { grid: string[][], maxBytes: number } {
    const grid: string[][] = [];
    let maxR = 0;
    let maxC = 0;

    cells.forEach(c => {
        if (c.fila_index > maxR) maxR = c.fila_index;
        if (c.col_index > maxC) maxC = c.col_index;
    });

    // Initialize
    for (let r = 0; r <= maxR; r++) {
        grid[r] = [];
        for (let c = 0; c <= maxC; c++) {
            grid[r][c] = "";
        }
    }

    // Fill
    cells.forEach(c => {
        grid[c.fila_index][c.col_index] = (c.texto || "").trim();
    });

    return { grid, maxBytes: maxC };
}

interface ColumnMap {
    preferente: number[]; // Indices of columns belonging to Preferente
    libre: number[];     // Indices of columns belonging to Libre Eleccion
}

function analyzeHeaders(grid: string[][]): ColumnMap {
    // Scan first 5 rows for keywords
    const map: ColumnMap = { preferente: [], libre: [] };

    // Heuristic:
    // "Preferente", "Convenio", "Prestador" -> Preferente
    // "Libre", "Elección", "Reembolso" -> Libre

    // If we can't find headers, we assume standard layout:
    // Col 0: Item
    // Col 1-2: Preferente
    // Col 3-4: Libre
    // But let's try to be smart.

    // Simple default for now (v1.0):
    // Often: Item | % Pref | Tope Pref | % Libre | Tope Libre
    // Indices: 0 | 1 | 2 | 3 | 4

    // Let's look for "Libre"
    for (let r = 0; r < Math.min(grid.length, 5); r++) {
        for (let c = 0; c < grid[r].length; c++) {
            const txt = grid[r][c].toUpperCase();
            if (txt.includes("LIBRE") || txt.includes("ELECCION")) {
                // Determine if this col and next are Libre
                if (!map.libre.includes(c)) map.libre.push(c);
                if (!map.libre.includes(c + 1)) map.libre.push(c + 1); // Assume pair
            }
            if (txt.includes("PREFERENTE") || txt.includes("CONVENIO")) {
                if (!map.preferente.includes(c)) map.preferente.push(c);
                if (!map.preferente.includes(c + 1)) map.preferente.push(c + 1);
            }
        }
    }

    // Fallback if empty
    if (map.preferente.length === 0) map.preferente = [1, 2];
    if (map.libre.length === 0) map.libre = [3, 4];

    return map;
}

function findItemName(row: string[], map: ColumnMap): string {
    // Item name is in a column NOT in the map
    // Usually col 0
    if (row[0] && row[0].length > 3) return row[0];
    return "";
}

function isHeaderRow(text: string): boolean {
    const t = text.toUpperCase();
    return t.includes("PRESTACION") || t.includes("ITEM") || t.includes("BENEFICIO");
}

function extractValue(row: string[], cols: number[]): { raw: string } {
    // Combine text from all assigned columns
    const texts = cols.map(c => row[c]).filter(t => t && t.trim().length > 0);
    if (texts.length === 0) return { raw: "" };
    return { raw: texts.join(" ") };
}

function parsePercentage(raw: string): number | null {
    if (!raw) return null;
    const clean = raw.replace(/,/g, '.');
    const match = clean.match(/(\d+)\s*%/);
    if (match) return parseFloat(match[1]);

    // Try bare number if it's small (e.g. 80)
    const num = parseFloat(clean);
    if (!isNaN(num) && num > 1 && num <= 100) return num;

    return null;
}

function parseTope(raw: string): { value: number | null, unit: "UF" | "AC2" | "SIN_TOPE" } {
    if (!raw) return { value: null, unit: "SIN_TOPE" }; // Default assumption? No, careful.
    const up = raw.toUpperCase();

    if (up.includes("SIN TOPE") || up.includes("ILIMITADO")) return { value: null, unit: "SIN_TOPE" };

    // Detect Unit
    let unit: "UF" | "AC2" | "SIN_TOPE" = "UF"; // Default
    if (up.includes("AC2") || up.includes("ARANCEL")) unit = "AC2";

    // Detect Value
    const match = raw.match(/([\d\.,]+)/);
    if (match) {
        return { value: parseFloat(match[1].replace(',', '.')), unit };
    }

    return { value: null, unit };
}
