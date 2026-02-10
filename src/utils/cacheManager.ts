
export interface ForensicCase {
    id: string;
    patientName?: string;
    invoiceNumber?: string;
    timestamp: number;
    bill?: any;
    pam?: any;
    contract?: any;
    htmlContext?: string;
    auditResult?: any; // Added to store the analysis result
    fingerprints: {
        bill?: { name: string, size: number };
        pam?: { name: string, size: number };
        contract?: { name: string, size: number };
    }
}

const HISTORY_KEY = 'forensic_cases_history';
const ACTIVE_ID_KEY = 'forensic_active_case_id';

export const cacheManager = {
    getActiveCase(): ForensicCase | null {
        try {
            const activeId = localStorage.getItem(ACTIVE_ID_KEY);
            if (!activeId) return null;

            const history = this.getAllCases();
            return history.find(c => c.id === activeId) || null;
        } catch (e) {
            console.error('Failed to get active case from cache', e);
            return null;
        }
    },

    getAllCases(): ForensicCase[] {
        try {
            const data = localStorage.getItem(HISTORY_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to get history from cache', e);
            return [];
        }
    },

    saveCase(forensicCase: Partial<ForensicCase>) {
        try {
            const history = this.getAllCases();
            const id = forensicCase.id || localStorage.getItem(ACTIVE_ID_KEY) || crypto.randomUUID();

            let existingIdx = history.findIndex(c => c.id === id);
            let updatedCase: ForensicCase;

            if (existingIdx >= 0) {
                updatedCase = {
                    ...history[existingIdx],
                    ...forensicCase,
                    id, // Ensure ID is preserved
                    timestamp: Date.now(),
                    fingerprints: {
                        ...(history[existingIdx].fingerprints || {}),
                        ...(forensicCase.fingerprints || {})
                    }
                };
                history[existingIdx] = updatedCase;
            } else {
                updatedCase = {
                    id,
                    timestamp: Date.now(),
                    fingerprints: {},
                    ...forensicCase
                } as ForensicCase;
                history.unshift(updatedCase); // Add to beginning
            }

            // Limit history to 20 cases
            const finalHistory = history.slice(0, 20);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(finalHistory));
            localStorage.setItem(ACTIVE_ID_KEY, id);
        } catch (e) {
            console.error('Failed to save case to cache', e);
        }
    },

    getCaseByFingerprint(type: 'bill' | 'pam' | 'contract', name: string, size: number): ForensicCase | null {
        const history = this.getAllCases();
        return history.find(c => {
            const fp = c.fingerprints?.[type];
            return fp && fp.name === name && fp.size === size;
        }) || null;
    },

    deleteCase(id: string) {
        try {
            const history = this.getAllCases();
            const filtered = history.filter(c => c.id !== id);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));

            if (localStorage.getItem(ACTIVE_ID_KEY) === id) {
                localStorage.removeItem(ACTIVE_ID_KEY);
            }
        } catch (e) {
            console.error('Failed to delete case', e);
        }
    },

    async clearAll() {
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(ACTIVE_ID_KEY);
        localStorage.removeItem('clinic_audit_result');
        localStorage.removeItem('clinic_audit_file_fingerprint');
        localStorage.removeItem('pam_audit_result');
        localStorage.removeItem('contract_audit_result');
        localStorage.removeItem('canonical_contract_result');
        localStorage.removeItem('html_projection_result');
        localStorage.removeItem('mental_model_cache');

        // RFC-15: Also clear backend cache
        try {
            await fetch('/api/contracts/clear-cache', { method: 'POST' });
            console.log('[CACHE] Backend contract cache cleared.');
        } catch (e) {
            console.error('[CACHE] Failed to clear backend cache', e);
        }
    }
};
