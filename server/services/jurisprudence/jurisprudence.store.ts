// ============================================================================
// JURISPRUDENCE LAYER - Persistent Store
// ============================================================================
// Purpose: Persist precedents to JSON file for cross-audit learning
// MVP: JSON file. Migrate to SQLite/Postgres for production.

import fs from "node:fs";
import path from "node:path";
import type { Precedent, JurisprudenceData } from "./jurisprudence.types.js";

const STORE_VERSION = "1.0.0";

export class JurisprudenceStore {
    private file: string;
    private cache: Precedent[] = [];

    constructor(filePath?: string) {
        this.file = filePath || path.join(process.cwd(), "server", "data", "jurisprudence.json");
        this.load();
    }

    /**
     * Load precedents from disk
     */
    private load(): void {
        try {
            if (!fs.existsSync(this.file)) {
                // Create directory and initial file
                fs.mkdirSync(path.dirname(this.file), { recursive: true });
                const initialData: JurisprudenceData = {
                    precedents: [],
                    version: STORE_VERSION,
                    lastUpdated: new Date().toISOString()
                };
                fs.writeFileSync(this.file, JSON.stringify(initialData, null, 2));
                console.log(`[JurisprudenceStore] Created new store at: ${this.file}`);
            }

            const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
            this.cache = Array.isArray(raw.precedents) ? raw.precedents : [];
            console.log(`[JurisprudenceStore] Loaded ${this.cache.length} precedents from disk.`);
        } catch (error) {
            console.error(`[JurisprudenceStore] Error loading store:`, error);
            this.cache = [];
        }
    }

    /**
     * Persist precedents to disk
     */
    private persist(): void {
        try {
            const data: JurisprudenceData = {
                precedents: this.cache,
                version: STORE_VERSION,
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error(`[JurisprudenceStore] Error persisting store:`, error);
        }
    }

    /**
     * Get all precedents
     */
    list(): Precedent[] {
        return this.cache.slice();
    }

    /**
     * Get precedent by ID
     */
    get(id: string): Precedent | undefined {
        return this.cache.find(p => p.id === id);
    }

    /**
     * Create or update a precedent
     */
    upsert(p: Precedent): void {
        const idx = this.cache.findIndex(x => x.id === p.id);
        const now = new Date().toISOString();

        if (idx >= 0) {
            // Update existing
            this.cache[idx] = {
                ...this.cache[idx],
                ...p,
                updatedAt: now
            };
            console.log(`[JurisprudenceStore] Updated precedent: ${p.id}`);
        } else {
            // Create new
            this.cache.push({
                ...p,
                createdAt: p.createdAt || now,
                updatedAt: now
            });
            console.log(`[JurisprudenceStore] Created precedent: ${p.id}`);
        }

        this.persist();
    }

    /**
     * Delete a precedent by ID
     */
    delete(id: string): boolean {
        const idx = this.cache.findIndex(p => p.id === id);
        if (idx >= 0) {
            this.cache.splice(idx, 1);
            this.persist();
            console.log(`[JurisprudenceStore] Deleted precedent: ${id}`);
            return true;
        }
        return false;
    }

    /**
     * Find precedents matching contract and fact fingerprints
     * Returns matches sorted by confidence (highest first)
     */
    findByFingerprints(contractFp: string, factFp: string): Precedent[] {
        return this.cache
            .filter(p => p.contractFingerprint === contractFp && p.factFingerprint === factFp)
            .sort((a, b) => b.decision.confidence - a.decision.confidence);
    }

    /**
     * Find precedents by tag
     */
    findByTag(tag: string): Precedent[] {
        return this.cache.filter(p => p.tags?.includes(tag));
    }

    /**
     * Find precedents by contract fingerprint only (for related cases)
     */
    findByContractFingerprint(contractFp: string): Precedent[] {
        return this.cache
            .filter(p => p.contractFingerprint === contractFp)
            .sort((a, b) => b.decision.confidence - a.decision.confidence);
    }

    /**
     * Get store statistics
     */
    stats(): { total: number; byCategory: Record<string, number>; bySource: Record<string, number> } {
        const byCategory: Record<string, number> = { A: 0, B: 0, Z: 0 };

        for (const p of this.cache) {
            const cat = p.decision.categoria_final;
            byCategory[cat] = (byCategory[cat] || 0) + 1;
        }

        return {
            total: this.cache.length,
            byCategory,
            bySource: {} // Could track if we add source field
        };
    }

    /**
     * Clear all precedents (use with caution)
     */
    clear(): void {
        this.cache = [];
        this.persist();
        console.log(`[JurisprudenceStore] Store cleared.`);
    }
}
