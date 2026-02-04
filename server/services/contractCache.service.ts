import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ContractAnalysisResult } from './contractTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, '../cache/canonicos');

export class ContractCacheService {
    private static async ensureCacheDir() {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true });
        } catch (err) {
            // Ignore if exists
        }
    }

    static calculateHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    static async get(hash: string): Promise<ContractAnalysisResult | null> {
        await this.ensureCacheDir();
        const filePath = path.join(CACHE_DIR, `${hash}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const result = JSON.parse(data);
            return { ...result, cached: true };
        } catch (err) {
            return null;
        }
    }

    static async save(hash: string, result: ContractAnalysisResult): Promise<void> {
        await this.ensureCacheDir();
        const filePath = path.join(CACHE_DIR, `${hash}.json`);
        try {
            await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
        } catch (err) {
            console.error('[ContractCacheService] Error saving cache:', err);
        }
    }

    static async clearAll(): Promise<number> {
        await this.ensureCacheDir();
        try {
            const files = await fs.readdir(CACHE_DIR);
            const deletePromises = files.map(file => fs.unlink(path.join(CACHE_DIR, file)));
            await Promise.all(deletePromises);
            console.log(`[ContractCacheService] Cleared ${files.length} items from cache.`);
            return files.length;
        } catch (err: any) {
            console.error('[ContractCacheService] Error clearing cache:', err);
            throw new Error(`Failed to clear cache: ${err.message}`);
        }
    }

    static async getCount(): Promise<number> {
        await this.ensureCacheDir();
        try {
            const files = await fs.readdir(CACHE_DIR);
            return files.filter(f => f.endsWith('.json')).length;
        } catch (err) {
            return 0;
        }
    }
}
