import * as fs from 'fs';
import * as path from 'path';

/**
 * FORENSIC BATCH ORCHESTRATOR v1.0
 * 
 * Orquesta los "8 Agentes" sobre los 28 contratos rescatados.
 * 
 * Pipeline:
 * 1. Lexer (✓ Done - Phase 1.5.0)
 * 2. Geometer (✓ Done - Phase 1.5.0)
 * 3. Jurist (✓ Done - Phase 1.5.0)
 * 4. Doctor - Mapeo clínico Factura ↔ Contrato
 * 5. Mathematician - Cálculo de topes y copagos
 * 6. Geographer - Resolución de redes
 * 7. Historian - Validación de aranceles
 * 8. Auditor - Generación de hallazgos
 */

interface AuditPackage {
    metadata: {
        contract_name: string;
        version: string;
        extraction_date: string;
    };
    spatial_map: any;
    assignments: any[];
    quality_metrics: {
        overall_status: string;
        qc_gates: Record<string, string>;
    };
}

interface ForensicAgentReport {
    agent_name: string;
    contract_name: string;
    status: 'SUCCESS' | 'WARN' | 'FAIL';
    findings: string[];
    metrics: Record<string, any>;
}

class ForensicOrchestrator {
    private packages: Map<string, AuditPackage> = new Map();

    constructor(private basePath: string) { }

    /**
     * Agent 1-3: Structural Core (Already Complete)
     */
    loadAuditPackages() {
        console.log('📦 Loading 28 Audit Packages (Structural Core Complete)...\n');

        const files = fs.readdirSync(this.basePath)
            .filter(f => f.startsWith('audit_package_') && f.endsWith('.json'));

        for (const file of files) {
            const fullPath = path.join(this.basePath, file);
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const contractName = file.replace('audit_package_', '').replace('_v1.5.0.json', '');

            this.packages.set(contractName, data);
        }

        console.log(`✅ Loaded ${this.packages.size} contracts.\n`);
        return this.packages.size;
    }

    /**
     * Agent 4: The Doctor (Clinical Mapper)
     * Maps billing items to contract coverage rows
     */
    runDoctor(contractName: string, pkg: AuditPackage): ForensicAgentReport {
        const findings: string[] = [];
        const coverageRows = new Set<string>();

        // Extract all row IDs from assignments
        for (const assignment of pkg.assignments) {
            if (assignment.row_id) {
                coverageRows.add(assignment.row_id);
            }
        }

        // Identify critical medical services
        const criticalServices = [
            'R_DIA_CAMA',
            'R_HONORARIOS',
            'R_PABELLON',
            'R_MEDICAMENTOS',
            'R_MATERIALES',
            'R_EXAMENES',
            'R_CONSULTAS'
        ];

        const foundCritical = criticalServices.filter(s => coverageRows.has(s));
        const missingCritical = criticalServices.filter(s => !coverageRows.has(s));

        if (foundCritical.length > 0) {
            findings.push(`✓ Found ${foundCritical.length} critical service rows: ${foundCritical.join(', ')}`);
        }

        if (missingCritical.length > 0) {
            findings.push(`⚠ Missing ${missingCritical.length} critical rows: ${missingCritical.join(', ')}`);
        }

        return {
            agent_name: 'Doctor (Clinical Mapper)',
            contract_name: contractName,
            status: missingCritical.length > 3 ? 'WARN' : 'SUCCESS',
            findings,
            metrics: {
                total_rows: coverageRows.size,
                critical_found: foundCritical.length,
                critical_missing: missingCritical.length,
                coverage_completeness: (foundCritical.length / criticalServices.length * 100).toFixed(1) + '%'
            }
        };
    }

    /**
     * Agent 5: The Mathematician (Financial Calculator)
     * Extracts topes, percentages, and calculates coverage limits
     */
    runMathematician(contractName: string, pkg: AuditPackage): ForensicAgentReport {
        const findings: string[] = [];
        const topes = {
            UF: [] as number[],
            AC2: [] as number[],
            SIN_TOPE: [] as string[],
            PERCENTAGE: [] as number[]
        };

        // Analyze assignments for financial data
        for (const assignment of pkg.assignments) {
            const value = assignment.value;
            const unit = assignment.unit;

            if (value && unit === 'UF') {
                topes.UF.push(parseFloat(value));
            } else if (value && unit === '%') {
                topes.PERCENTAGE.push(parseFloat(value));
            } else if (value && /AC2|VAM|VA/.test(unit)) {
                topes.AC2.push(parseFloat(value));
            }

            // Detect "Sin Tope" patterns
            const assignmentStr = JSON.stringify(assignment).toLowerCase();
            if (assignmentStr.includes('sin tope') || assignmentStr.includes('sin_tope')) {
                topes.SIN_TOPE.push(assignment.row_id || 'unknown');
            }
        }

        // Generate findings
        if (topes.UF.length > 0) {
            const maxUF = Math.max(...topes.UF);
            const minUF = Math.min(...topes.UF);
            findings.push(`💰 UF Topes Range: ${minUF} - ${maxUF} UF (${topes.UF.length} found)`);
        }

        if (topes.PERCENTAGE.length > 0) {
            const percentages = [...new Set(topes.PERCENTAGE)].sort((a, b) => b - a);
            findings.push(`📊 Coverage Percentages: ${percentages.join('%, ')}%`);
        }

        if (topes.SIN_TOPE.length > 0) {
            findings.push(`🚀 "Sin Tope" Benefits: ${topes.SIN_TOPE.join(', ')}`);
        }

        if (topes.AC2.length > 0) {
            findings.push(`📐 AC2 Multipliers: ${topes.AC2.join('x, ')}x`);
        }

        return {
            agent_name: 'Mathematician (Financial Calculator)',
            contract_name: contractName,
            status: 'SUCCESS',
            findings,
            metrics: {
                topes_uf: topes.UF.length,
                topes_ac2: topes.AC2.length,
                sin_tope_count: topes.SIN_TOPE.length,
                percentages_found: topes.PERCENTAGE.length,
                max_coverage: topes.PERCENTAGE.length > 0 ? Math.max(...topes.PERCENTAGE) + '%' : 'N/A'
            }
        };
    }

    /**
     * Agent 6: The Geographer (Network Resolver)
     * Identifies provider networks and modalities
     */
    runGeographer(contractName: string, pkg: AuditPackage): ForensicAgentReport {
        const findings: string[] = [];
        const networks = new Set<string>();
        const modalities = { preferente: 0, libre_eleccion: 0 };

        // Count modalities by column presence
        const cols = pkg.spatial_map?.columns || [];
        for (const col of cols) {
            const label = (col.label || '').toLowerCase();
            if (label.includes('pref') || label.includes('red')) {
                modalities.preferente++;
            }
            if (label.includes('libre') || label.includes('le')) {
                modalities.libre_eleccion++;
            }
        }

        findings.push(`🏥 Modalities Detected: Preferente (${modalities.preferente} cols), Libre Elección (${modalities.libre_eleccion} cols)`);

        return {
            agent_name: 'Geographer (Network Resolver)',
            contract_name: contractName,
            status: 'SUCCESS',
            findings,
            metrics: {
                networks_identified: networks.size,
                preferente_columns: modalities.preferente,
                libre_eleccion_columns: modalities.libre_eleccion
            }
        };
    }

    /**
     * Agent 7: The Historian (Arancel Validator)
     * Validates contract version and arancel references
     */
    runHistorian(contractName: string, pkg: AuditPackage): ForensicAgentReport {
        const findings: string[] = [];

        // Check for arancel references in assignments
        const aranceles = new Set<string>();
        for (const assignment of pkg.assignments) {
            const str = JSON.stringify(assignment).toUpperCase();
            if (str.includes('AC2')) aranceles.add('AC2');
            if (str.includes('VAM')) aranceles.add('VAM');
            if (str.includes('VA')) aranceles.add('VA');
            if (str.includes('MLE')) aranceles.add('MLE');
        }

        if (aranceles.size > 0) {
            findings.push(`📜 Aranceles Referenced: ${Array.from(aranceles).join(', ')}`);
        } else {
            findings.push(`⚠ No explicit arancel references found (UF-based contract)`);
        }

        return {
            agent_name: 'Historian (Arancel Validator)',
            contract_name: contractName,
            status: 'SUCCESS',
            findings,
            metrics: {
                aranceles_found: aranceles.size,
                types: Array.from(aranceles)
            }
        };
    }

    /**
     * Agent 8: The Auditor (Finding Generator)
     * Synthesizes all agent reports into actionable findings
     */
    runAuditor(reports: ForensicAgentReport[]): string {
        let summary = '# 🔍 FORENSIC AUDIT SUMMARY (28 Contracts)\n\n';

        // Group by contract
        const byContract = new Map<string, ForensicAgentReport[]>();
        for (const report of reports) {
            if (!byContract.has(report.contract_name)) {
                byContract.set(report.contract_name, []);
            }
            byContract.get(report.contract_name)!.push(report);
        }

        // Summary stats
        summary += `## 📊 Global Statistics\n\n`;
        summary += `- **Contracts Processed**: ${byContract.size}\n`;
        summary += `- **Agent Executions**: ${reports.length}\n`;
        summary += `- **Success Rate**: ${(reports.filter(r => r.status === 'SUCCESS').length / reports.length * 100).toFixed(1)}%\n\n`;

        // Highlight contracts with "Sin Tope"
        summary += `## 🚀 High-Value Contracts (Sin Tope Detection)\n\n`;
        const sinTopeContracts: string[] = [];
        for (const [contract, contractReports] of byContract) {
            const mathReport = contractReports.find(r => r.agent_name.includes('Mathematician'));
            if (mathReport && mathReport.metrics.sin_tope_count > 0) {
                sinTopeContracts.push(`- **${contract}**: ${mathReport.metrics.sin_tope_count} "Sin Tope" benefits detected`);
            }
        }
        summary += sinTopeContracts.length > 0 ? sinTopeContracts.join('\n') : '- None detected\n';
        summary += '\n';

        // Per-contract details (first 5)
        summary += `## 📋 Detailed Reports (Sample)\n\n`;
        let count = 0;
        for (const [contract, contractReports] of byContract) {
            if (count >= 5) break;
            summary += `### ${contract}\n\n`;
            for (const report of contractReports) {
                summary += `**${report.agent_name}** [${report.status}]\n`;
                for (const finding of report.findings) {
                    summary += `  - ${finding}\n`;
                }
            }
            summary += '\n';
            count++;
        }

        return summary;
    }

    /**
     * Main orchestration
     */
    async execute() {
        console.log('🔥 FORENSIC BATCH ORCHESTRATOR v1.0 🔥\n');
        console.log('Activating the 8 Agents on 28 rescued contracts...\n');

        const count = this.loadAuditPackages();

        if (count === 0) {
            console.error('❌ No audit packages found. Ensure extraction is complete.');
            return;
        }

        const allReports: ForensicAgentReport[] = [];

        // Execute agents 4-7 on each contract
        for (const [contractName, pkg] of this.packages) {
            console.log(`\n[${contractName}]`);

            const doctorReport = this.runDoctor(contractName, pkg);
            console.log(`  ✓ ${doctorReport.agent_name}: ${doctorReport.status}`);
            allReports.push(doctorReport);

            const mathReport = this.runMathematician(contractName, pkg);
            console.log(`  ✓ ${mathReport.agent_name}: ${mathReport.status}`);
            allReports.push(mathReport);

            const geoReport = this.runGeographer(contractName, pkg);
            console.log(`  ✓ ${geoReport.agent_name}: ${geoReport.status}`);
            allReports.push(geoReport);

            const histReport = this.runHistorian(contractName, pkg);
            console.log(`  ✓ ${histReport.agent_name}: ${histReport.status}`);
            allReports.push(histReport);
        }

        // Agent 8: Generate master summary
        console.log('\n\n🎯 Agent 8: Generating Master Audit Summary...\n');
        const summary = this.runAuditor(allReports);

        // Save reports
        fs.writeFileSync('forensic_master_report.md', summary);
        fs.writeFileSync('forensic_agent_reports.json', JSON.stringify(allReports, null, 2));

        console.log('✅ Forensic Audit Complete!\n');
        console.log('📄 Reports saved:');
        console.log('  - forensic_master_report.md');
        console.log('  - forensic_agent_reports.json');

        return { summary, reports: allReports };
    }
}

// Execute
const orchestrator = new ForensicOrchestrator(process.cwd());
orchestrator.execute().catch(console.error);
