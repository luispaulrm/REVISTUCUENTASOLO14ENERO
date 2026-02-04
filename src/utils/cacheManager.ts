
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

const CACHE_KEY = 'forensic_active_case';

export const cacheManager = {
    getActiveCase(): ForensicCase | null {
        try {
            const data = localStorage.getItem(CACHE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Failed to get active case from cache', e);
            return null;
        }
    },

    getAllCases(): ForensicCase[] {
        const active = this.getActiveCase();
        return active ? [active] : [];
    },

    saveCase(forensicCase: Partial<ForensicCase>) {
        try {
            const current = this.getActiveCase();

            const newCase: ForensicCase = {
                ...(current || {}),
                id: forensicCase.id || (current ? current.id : crypto.randomUUID()),
                timestamp: Date.now(),
                ...forensicCase,
                fingerprints: {
                    ...(current ? current.fingerprints : {}),
                    ...(forensicCase.fingerprints || {})
                }
            };

            localStorage.setItem(CACHE_KEY, JSON.stringify(newCase));
        } catch (e) {
            console.error('Failed to save case to cache', e);
        }
    },

    getCaseByFingerprint(type: 'bill' | 'pam' | 'contract', name: string, size: number): ForensicCase | null {
        const active = this.getActiveCase();
        if (!active) return null;

        const fp = active.fingerprints[type];
        if (fp && fp.name === name && fp.size === size) {
            return active;
        }
        return null;
    },

    deleteCase(id: string) {
        localStorage.removeItem(CACHE_KEY);
    },

    clearAll() {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem('clinic_audit_result');
        localStorage.removeItem('clinic_audit_file_fingerprint');
        localStorage.removeItem('pam_audit_result');
        localStorage.removeItem('contract_audit_result');
        localStorage.removeItem('forensic_active_case_id');
    }
};
