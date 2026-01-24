
import fetch from 'node-fetch';

interface UfCache {
    [dateStr: string]: number;
}

const ufCache: UfCache = {};
const FALLBACK_UF = 39750;

/**
 * Fetches the UF value for a specific date from mindicador.cl
 * @param date The date to fetch for (defaults to today)
 */
export async function getUfForDate(date: Date = new Date()): Promise<number> {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const dateStr = `${day}-${month}-${year}`;

    if (ufCache[dateStr]) {
        return ufCache[dateStr];
    }

    try {
        console.log(`[UFService] 🔍 Consultando UF para fecha: ${dateStr}`);
        const response = await fetch(`https://mindicador.cl/api/uf/${dateStr}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data: any = await response.json();
        if (data && data.serie && data.serie.length > 0) {
            const value = data.serie[0].valor;
            if (typeof value === 'number' && value > 10000) {
                ufCache[dateStr] = value;
                return value;
            }
        }
        throw new Error(`Invalid data format for date ${dateStr}`);
    } catch (error) {
        console.error(`[UFService] ❌ Error fetching UF for ${dateStr}: ${error instanceof Error ? error.message : String(error)}`);
        return FALLBACK_UF;
    }
}
