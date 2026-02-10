import { TaxonomyResult } from '../types/taxonomy.types.js';
import { FORENSIC_RULES_V1, AuditContext, ForensicFinding } from '../rules/forensicRules.v1.js';

export interface AuditResultRefactored {
    context: AuditContext;
    findings: ForensicFinding[];
    stats: {
        total_items: number;
        total_findings: number;
        items_with_findings: number;
    }
}

export class AuditEngineRefactored {

    constructor() {
        // In the future, we could inject Rule Sets here
    }

    public performAudit(taxonomyResults: TaxonomyResult[]): AuditResultRefactored {
        // 1. Build Context (The "Judge's Gavel")
        const context: AuditContext = {
            existe_dia_cama: taxonomyResults.some(r => r.grupo === 'HOTELERA'),
            existe_pabellon: taxonomyResults.some(r => r.grupo === 'PABELLON')
        };

        const findings: ForensicFinding[] = [];
        const itemsWithFindings = new Set<string>();

        // 2. Iterate & Judge
        for (const item of taxonomyResults) {
            // Apply all rules from V1 set
            for (const rule of FORENSIC_RULES_V1) {
                if (rule.when(item, context)) {
                    const finding = rule.then(item, context);
                    findings.push(finding);
                    itemsWithFindings.add(item.id);

                    // Optional: Break on first finding per item? 
                    // Usually forensically we want all violations, so we continue.
                }
            }
        }

        // 3. Summarize
        return {
            context,
            findings,
            stats: {
                total_items: taxonomyResults.length,
                total_findings: findings.length,
                items_with_findings: itemsWithFindings.size
            }
        };
    }
}
