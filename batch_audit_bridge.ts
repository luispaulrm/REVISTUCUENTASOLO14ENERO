import * as fs from 'fs';
import * as path from 'path';

/**
 * BATCH AUDIT BRIDGE
 * Connects a Canonical Bill to 28 Rescued Contracts to generate Financial Audit Results.
 */

// --- Types ---
interface CanonicalBill {
    metadata: any;
    sections: Array<{
        category: string;
        items: Array<{
            description: string;
            total: number;
            copago: number;
        }>;
    }>;
}

interface ContractCoverage {
    contract_name: string;
    family: "A" | "B" | "C";
    benefits: {
        dia_cama: { value: string; unit: string; is_sin_tope: boolean };
        pabellon: { value: string; unit: string; is_sin_tope: boolean };
        honorarios: { value: string; unit: string; is_sin_tope: boolean };
    };
    financial_simulation: {
        total_bill: number;
        covered_amount: number;
        patient_share: number;
        effective_coverage_pct: number;
    };
}

class AuditBridge {
    private contracts: Map<string, any> = new Map();
    private bill: CanonicalBill | null = null;

    constructor(private basePath: string) { }

    loadResources(billPath: string) {
        // Load Bill
        this.bill = JSON.parse(fs.readFileSync(billPath, 'utf-8'));

        // Load Contracts
        const files = fs.readdirSync(this.basePath)
            .filter(f => f.startsWith('audit_package_') && f.endsWith('.json'));

        for (const file of files) {
            const name = file.replace('audit_package_', '').replace('_v1.5.0.json', '');
            this.contracts.set(name, JSON.parse(fs.readFileSync(path.join(this.basePath, file), 'utf-8')));
        }

        console.log(`Loaded Bill ${this.bill?.metadata.account_id} and ${this.contracts.size} contracts.`);
    }

    identifyFamily(pkg: any): "A" | "B" | "C" {
        // Simple heuristic based on assignments count and density
        const count = pkg.assignments.length;
        // Check for specific markers or clusters from previous artifacts if available
        // For now, heuristic:
        if (count < 5) return "B"; // Lite
        if (pkg.quality_metrics && pkg.quality_metrics.overall_status === "WARN") return "C"; // Hybrid/Dense
        return "A"; // Full
    }

    findBenefit(assignments: any[], rowKeys: string[]): { value: string, unit: string, is_sin_tope: boolean } | null {
        // Search for any assignment active for these rows
        const active = assignments.find(a => rowKeys.includes(a.row_id));
        if (!active) return null;

        const isSinTope = (active.value && active.value.toLowerCase().includes('sin tope')) ||
            (active.pointer && active.pointer.inherited_text && active.pointer.inherited_text.toLowerCase().includes('sin tope'));

        return {
            value: active.value,
            unit: active.unit || '',
            is_sin_tope: isSinTope || false
        };
    }

    calculateCoverage(pkg: any, bill: CanonicalBill): ContractCoverage['financial_simulation'] {
        let total = 0;
        let covered = 0;
        const assignments = pkg.assignments;

        // Simplified simulation logic
        for (const section of bill.sections) {
            for (const item of section.items) {
                total += item.total;

                // Map item category to contract row
                let targetRows = [];
                if (section.category === 'HOSPITALIZACION') targetRows = ['R_DIA_CAMA'];
                if (section.category === 'PABELLON') targetRows = ['R_PABELLON', 'R_DERECHO_PABELLON'];
                if (section.category === 'FARMACIA') targetRows = ['R_MEDICAMENTOS'];

                const benefit = this.findBenefit(assignments, targetRows);

                let itemCoverage = 0;
                if (benefit) {
                    // Normalize Percentage
                    let pct = 0;
                    if (benefit.is_sin_tope) pct = 1.0; // Assume 100% Sin Tope for simplicity unless value says otherwise
                    else if (benefit.unit === '%') pct = parseFloat(benefit.value) / 100;
                    else pct = 0.5; // Default fallback for fixed values/AC2 without calculator

                    if (isNaN(pct)) pct = 0;

                    // Simple logic: Apply % to total
                    itemCoverage = item.total * pct;

                    // TODO: Apply UF/AC2 caps in V2 (Mathematician Agent)
                }

                covered += itemCoverage;
            }
        }

        return {
            total_bill: total,
            covered_amount: Math.round(covered),
            patient_share: Math.round(total - covered),
            effective_coverage_pct: total > 0 ? Math.round((covered / total) * 100) : 0
        };
    }

    run() {
        if (!this.bill) return;

        const results: ContractCoverage[] = [];

        for (const [name, pkg] of this.contracts) {
            const family = this.identifyFamily(pkg);
            const simulation = this.calculateCoverage(pkg, this.bill);

            // Extract key benefits for display
            const diaCama = this.findBenefit(pkg.assignments, ['R_DIA_CAMA']);
            const pabellon = this.findBenefit(pkg.assignments, ['R_PABELLON', 'R_DERECHO_PABELLON']);
            const honorarios = this.findBenefit(pkg.assignments, ['R_HONORARIOS', 'R_HONORARIOS_MEDICOS_QUIRURGICOS']);

            results.push({
                contract_name: name,
                family,
                benefits: {
                    dia_cama: diaCama ? { value: diaCama.value, unit: diaCama.unit, is_sin_tope: diaCama.is_sin_tope } : { value: 'N/A', unit: '', is_sin_tope: false },
                    pabellon: pabellon ? { value: pabellon.value, unit: pabellon.unit, is_sin_tope: pabellon.is_sin_tope } : { value: 'N/A', unit: '', is_sin_tope: false },
                    honorarios: honorarios ? { value: honorarios.value, unit: honorarios.unit, is_sin_tope: honorarios.is_sin_tope } : { value: 'N/A', unit: '', is_sin_tope: false }
                },
                financial_simulation: simulation
            });
        }

        // Output Report
        let md = '# 💰 BRIDGE REPORT: Factura D1305597 vs 28 Contratos\n\n';
        md += `**Monto Factura**: $${this.bill.metadata.total_amount.toLocaleString('es-CL')}\n\n`;

        md += '## 🏆 Top Performers (Mayor Cobertura)\n\n';
        const sorted = [...results].sort((a, b) => b.financial_simulation.covered_amount - a.financial_simulation.covered_amount);

        for (const r of sorted.slice(0, 5)) {
            md += `- **${r.contract_name}** (${r.family}): Cubre **$${r.financial_simulation.covered_amount.toLocaleString('es-CL')}** (${r.financial_simulation.effective_coverage_pct}%)\n`;
            if (r.benefits.dia_cama.is_sin_tope) md += `  - 🔥 Día Cama: Sin Tope\n`;
            if (r.benefits.pabellon.is_sin_tope) md += `  - 🔥 Pabellón: Sin Tope\n`;
        }

        md += '\n## 📉 Low Performers (Posibles Planes Lite/Incompletos)\n\n';
        for (const r of sorted.slice(-5).reverse()) {
            md += `- **${r.contract_name}** (${r.family}): Cubre **$${r.financial_simulation.covered_amount.toLocaleString('es-CL')}** (${r.financial_simulation.effective_coverage_pct}%)\n`;
            if (r.family === 'B') md += `  - ℹ️ Plan Lite (Cobertura ambulatoria normal)\n`;
            else md += `  - ⚠️ Posible falla de extracción (Revisar WARN)\n`;
        }

        fs.writeFileSync('audit_bridge_results.md', md);
        console.log('Bridge execution complete. Saved audit_bridge_results.md');
    }
}

const bridge = new AuditBridge(process.cwd());
bridge.loadResources('./canonical_bill_D1305597.json');
bridge.run();
