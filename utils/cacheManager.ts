
export interface ForensicCase {
    id: string;
    patientName?: string;
    invoiceNumber?: string;
    timestamp: number;
    bill?: any;
    pam?: any;
    contract?: any;
    htmlContext?: string;
    fingerprints: {
        bill?: { name: string, size: number };
        pam?: { name: string, size: number };
        contract?: { name: string, size: number };
    }
}

const CACHE_KEY = 'forensic_cases_history';

export const cacheManager = {
    getAllCases(): ForensicCase[] {
        try {
            const data = localStorage.getItem(CACHE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to get cases from cache', e);
            return [];
        }
    },

    saveCase(forensicCase: Partial<ForensicCase>) {
        const cases = this.getAllCases();
        const existingIndex = cases.findIndex(c => c.id === forensicCase.id);

        const newCase: ForensicCase = {
            id: forensicCase.id || crypto.randomUUID(),
            timestamp: Date.now(),
            fingerprints: {},
            ...((existingIndex >= 0) ? cases[existingIndex] : {}),
            ...forensicCase
        };

        if (existingIndex >= 0) {
            cases[existingIndex] = newCase;
        } else {
            cases.unshift(newCase);
        }

        // Keep last 10 cases to avoid localStorage limit issues
        const limitedCases = cases.slice(0, 10);
        localStorage.setItem(CACHE_KEY, JSON.stringify(limitedCases));
    },

    getCaseByFingerprint(type: 'bill' | 'pam' | 'contract', name: string, size: number): ForensicCase | null {
        const cases = this.getAllCases();
        return cases.find(c => {
            const fp = c.fingerprints[type];
            return fp && fp.name === name && fp.size === size;
        }) || null;
    },

    deleteCase(id: string) {
        const cases = this.getAllCases().filter(c => c.id !== id);
        localStorage.setItem(CACHE_KEY, JSON.stringify(cases));
    },

    clearAll() {
        localStorage.removeItem(CACHE_KEY);
    }
};
