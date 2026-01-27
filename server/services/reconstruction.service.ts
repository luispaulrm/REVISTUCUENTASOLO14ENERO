
import { BillingItem, Finding, ExtractedAccount } from '../../src/types.js';
import { TaxonomyService, FamilyB, ZoneA } from './taxonomy.service.js';

export interface ReconstructionResult {
    matchedItems: BillingItem[];
    unmatchedAmount: number;
    success: boolean;
    compatibilityRationale?: string;
}

export class ArithmeticReconstructor {
    private usedItemIds: Set<number | string>;
    constructor(private bill: ExtractedAccount, initialUsedIds: Set<number | string> = new Set()) {
        this.usedItemIds = new Set(initialUsedIds);
    }

    public findMatches(target: number, glosa: string, context?: string): ReconstructionResult {
        if (target <= 0) return { matchedItems: [], unmatchedAmount: 0, success: true };

        const allItemsWithSection = this.bill.sections.flatMap(s =>
            (s.items || []).map(item => ({ item, section: s.category || "" }))
        );

        // MANDATORY RULE: Filter by strict domain compatibility
        const compatibleItems = allItemsWithSection.filter(entry => {
            const id = this.getItemUniqueId(entry.item);
            if (this.usedItemIds.has(id)) return false;

            return this.isCompatible(entry.item, entry.section, glosa, context);
        });

        const itemsOnly = compatibleItems.map(e => e.item);

        // Strategy 1: Match against item.copago (Forensic Priority)
        let result = this.subsetSum(target, itemsOnly, 0, (i) => i.copago || 0);
        let rationale = "";

        if (result) {
            rationale = `CIERRE MATEMÁTICO EXACTO (COPAGO): Se identificaron ${result.length} ítems cuyo copago suma exactamente $${target.toLocaleString('es-CL')}.`;
        } else {
            // Strategy 2: Match against item.total (Authoritative Total)
            result = this.subsetSum(target, itemsOnly, 0, (i) => i.total || 0);
            if (result) {
                rationale = `CIERRE MATEMÁTICO EXACTO (MONTO BRUTO): Se identificaron ${result.length} ítems cuyo valor total suma exactamente $${target.toLocaleString('es-CL')}.`;
            }
        }

        if (result) {
            result.forEach(item => {
                const id = this.getItemUniqueId(item);
                this.usedItemIds.add(id);

                // Find original section for taxonomy preservation
                const entry = allItemsWithSection.find(e => this.getItemUniqueId(e.item) === id);
                if (entry) {
                    const tax = TaxonomyService.classify(item, entry.section);
                    item.taxonomy = {
                        zona_A: tax.zona,
                        familia_B: tax.familia,
                        subfamilia_C: tax.subfamilia,
                        normalizedDesc: tax.normalizedDesc,
                        confidence: tax.confidence,
                        evidencia: `Item Index ${item.index} in ${entry.section}`
                    };
                }
            });
            return {
                matchedItems: result,
                unmatchedAmount: 0,
                success: true,
                compatibilityRationale: rationale
            };
        }

        return {
            matchedItems: [],
            unmatchedAmount: target,
            success: false
        };
    }

    private normalizeString(s: string): string {
        return (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    private isCompatible(item: BillingItem, section: string, glosa: string, context?: string): boolean {
        const tax = TaxonomyService.classify(item, section);
        const glo = this.normalizeString(glosa);

        // 1. HARD RULE: VALIDATE CLASSIFICATION PURITY (V-01)
        if (!TaxonomyService.validateIntegrity(tax)) return false;

        // 2. MAPPING PAM GLOSA TO TAXONOMY FAMILY
        const isMedGlosa = /MEDICAMENTO|FARMA|DROGA/i.test(glo);
        const isMatGlosa = /MATERIAL|INSUMO/i.test(glo);
        const isBedGlosa = /DIA CAMA|HABITACION|ESTANCIA/i.test(glo);
        const isSurgContext = /QUIRURGICO|PABELLON|CIRUGIA/i.test(glo) || context === "QUIRURGICO";

        // 3. ENFORCE REGLA R-01 & R-02 (Categorical Exclusion)
        if (isMedGlosa) {
            // Must BE a medication AND NOT a material
            return tax.familia === FamilyB.MEDICAMENTOS;
        }

        if (isMatGlosa) {
            // Must BE a material AND NOT a medication
            return tax.familia === FamilyB.INSUMOS_MATERIALES;
        }

        if (isBedGlosa) {
            // Room charges or basic nursing unbundling
            const isNursingProc = /NURSING|ENFERMERIA|SIGNOS VITALES|CURACION|INSTALACION.*VIA|FLEBOCLISIS|PUNCION|TOMA.DE.MUESTRA|ADMINISTRACION.*MEDICAMENTOS|HIGIENIZACION/i.test(tax.normalizedDesc);
            return tax.familia === FamilyB.ESTADA_CAMA || isNursingProc;
        }

        if (isSurgContext) {
            // Pabellón allows both but must be surgical nature
            return tax.zona === ZoneA.PABELLON || tax.subfamilia.includes("PABELLON") || tax.subfamilia.includes("QUIRURGICO");
        }

        // 4. "Gastos No Cubiertos" / "Preg. No Contemplada" (Residual bucket)
        if (/GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|VARIOS|AJUSTE|DIFERENCIA/i.test(glo)) {
            const isHospitality = /SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|TERMOMETRO|CONFORT|TELEVISOR|ESTACIONAMIENTO|ALIMENTAC|KITS?.HIGIENE|PASTA.DENTAL|PEINETA|BATA|CAMISOLA|FRAZADA|ALMOHADA/i.test(tax.normalizedDesc);
            const isAdmin = /ADMINISTRATIVO|CARGOS.GENERALES|OTROS|EPP|SEGURIDAD|INFRAESTRUCTURA|COSTO.OPERACIONAL|INSUMO.INSTITUCIONAL/i.test(tax.normalizedDesc) || tax.zona === ZoneA.OTROS;
            const isResidualUnbundling = /INSTALACION.*VIA|FLEBOCLISIS|PUNCION|SIGNOS VITALES|CURACION/i.test(tax.normalizedDesc);
            return isHospitality || isAdmin || isResidualUnbundling;
        }

        // Exact linguistic match as fallback (Only for non-clinical)
        return this.normalizeString(section).includes(glo) || glo.includes(this.normalizeString(section));
    }

    private subsetSum(target: number, items: BillingItem[], tolerance: number, amountSelector: (i: BillingItem) => number = (i) => i.total || 0): BillingItem[] | null {
        const n = items.length;
        let result: BillingItem[] | null = null;
        let nodes = 0;
        const MAX_NODES = 500000; // Efficient limit for search

        // Sort descending to prune faster
        const sorted = [...items].sort((a, b) => amountSelector(b) - amountSelector(a));

        const suffixSums = new Array(n + 1).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            suffixSums[i] = suffixSums[i + 1] + amountSelector(sorted[i]);
        }

        function dfs(idx: number, currentSum: number, chosen: BillingItem[]) {
            if (result) return;
            nodes++;
            if (nodes > MAX_NODES) return;

            if (Math.abs(currentSum - target) <= tolerance) {
                result = chosen;
                return;
            }

            if (idx === n) return;
            if (currentSum > target + tolerance) return;
            if (currentSum + suffixSums[idx] < target - tolerance) return;

            dfs(idx + 1, currentSum + amountSelector(sorted[idx]), [...chosen, sorted[idx]]);
            dfs(idx + 1, currentSum, chosen);
        }

        dfs(0, 0, []);
        return result;
    }

    private getItemUniqueId(item: BillingItem): string | number {
        return item.index !== undefined ? item.index : `${item.description}_${item.total}`;
    }
}

/**
 * Clinical classifier for bill items (Forensic Priority)
 */
function classifyItemNorm(item: BillingItem): { norma: string, isCatA: boolean } {
    const desc = (item.description || "").toUpperCase();

    // 1. Nursing Unbundling (Practice #5)
    if (/INSTALACION.*VIA|FLEBOCLISIS|PUNCION|SIGNOS VITALES|CURACION/i.test(desc)) {
        return {
            norma: `PRÁCTICA IRREGULAR #5: Cobro de enfermería básica ya incluida en el Día Cama.\n` +
                `• PERSPECTIVA CLÍNICA: Procedimientos como instalación de vías y control de signos vitales son inherentes al cuidado continuo de enfermería.\n` +
                `• PERSPECTIVA LEGAL: Circular IF-319 y aranceles institucionales establecen que estas prestaciones forman parte del valor integral del Día Cama.\n` +
                `• PERSPECTIVA FINANCIERA: La fragmentación genera un doble cobro duplicado, trasladando al paciente un costo que ya ha sido cubierto por el beneficio de hospitalización.`,
            isCatA: true
        };
    }

    // 2. Intraoperative Medication (Practice #3)
    if (/PROPOFOL|FENTANIL|SEVOFLURANO|LIDOCAINA|BUPIVACAINA|ROCURONIO|VECURONIO|MIDAZOLAM|REMIFENTANIL|SUGAMMADEX|ANESTESIA/i.test(desc)) {
        return {
            norma: `PRÁCTICA IRREGULAR #3: Fármacos de pabellón cobrados aparte (medicación intraoperatoria desagregada).\n` +
                `• PERSPECTIVA CLÍNICA: Los agentes anestésicos y relajantes musculares administrados durante la cirugía deben ser reportados en la hoja de anestesia y forman parte del acto quirúrgico.\n` +
                `• PERSPECTIVA LEGAL: Norma Técnica #3/IF: Estos fármacos constituyen componentes esenciales del Derecho de Pabellón y no pueden facturarse como farmacia general.\n` +
                `• PERSPECTIVA FINANCIERA: El desplazamiento a farmacia ambulatoria/general anula la bonificación quirúrgica paquetizada, aumentando artificialmente el copago.`,
            isCatA: true
        };
    }

    // 2b. Surgical Unbundling (Practice #2)
    if (/SUTURA|GASA|DRENAJE|BISTURI|TUBO.ENDOTRAQUEAL|ESTILETE|CANULA.MAYO|CIRCUITO.ANESTESIA|DELANTAL.ESTERIL|PAQUETE.CIRUGIA|SABANA.QUIRURGICA|MANGA.LAPAROSCOPICA/i.test(desc)) {
        return {
            norma: `PRÁCTICA IRREGULAR #2: Desagregación de materiales de pabellón (Unbundling).\n` +
                `• PERSPECTIVA CLÍNICA: Insumos básicos estériles y equipos quirúrgicos son recursos estructurales del quirófano.\n` +
                `• PERSPECTIVA LEGAL: Aranceles Isapre/Fonasa definen explícitamente qué insumos básicos se incluyen en el Derecho de Pabellón.\n` +
                `• PERSPECTIVA FINANCIERA: Cobrar separadamente sábanas, gasas o jeringas básicas constituye un cobro redundante sobre una tarifa global ya pactada.`,
            isCatA: true
        };
    }

    // 3. Hospitality & Comfort (Practice #4)
    if (/SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|TERMOMETRO|CONFORT|TELEVISOR|ESTACIONAMIENTO|ALIMENTAC/i.test(desc)) {
        return {
            norma: `PRÁCTICA IRREGULAR #4: Cobro de hotelería no clínica como si fuera atención médica.\n` +
                `• PERSPECTIVA CLÍNICA: Artículos de aseo personal, ropa de cama adicional o entretenimiento no constituyen prestaciones de salud para la recuperación.\n` +
                `• PERSPECTIVA LEGAL: Criterio SIS/Superintendencia: Insumos de confort personal deben ser informados como opcionales y no se bonifican como gasto médico.\n` +
                `• PERSPECTIVA FINANCIERA: Facturar estos ítems bajo códigos médicos 'camufla' gastos personales como costos de salud, vulnerando la transparencia debida al paciente.`,
            isCatA: true
        };
    }

    // 4. Mandatory Detail (Practice #6)
    return {
        norma: `PRÁCTICA IRREGULAR #6: Uso de glosas genéricas para cargar costos opacos al paciente.\n` +
            `• PERSPECTIVA CLÍNICA: La falta de desglose impide correlacionar el cobro con el registro en la ficha médica.\n` +
            `• PERSPECTIVA LEGAL: Ley 20.584: El paciente tiene derecho a conocer el desglose detallado de su cuenta. Los agrupadores inespecíficos vulneran el deber de información.\n` +
            `• PERSPECTIVA FINANCIERA: Agrupar cargos en códigos como 3201001 traslada el 100% del costo al paciente sin posibilidad de auditoría o bonificación justa.`,
        isCatA: true
    };
}

/**
 * Main entry point for reconstruction during audit.
 * Implements "Desglose Especulativo Controlado" doctrine.
 */
export function reconstructAllOpaque(bill: ExtractedAccount, findings: Finding[], initialUsedIds?: Set<number | string>): Finding[] {
    if (!bill || !bill.sections) return findings;

    const usedIds = initialUsedIds || new Set<number | string>();
    const reconstructor = new ArithmeticReconstructor(bill, usedIds);
    const output: Finding[] = [];

    const norm = (s: string) => (s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    for (const f of findings) {
        const desc = norm(f.label);

        // AXIOM: Multi-domain (Aggregate) findings MUST NOT be reconstructed.
        // Forensic reconstruction is atomic (per PAM line).
        const isAggregate = /MEDICAMENTO.*MATERIAL|MATERIAL.*MEDICAMENTO|INSUMO.*FARMA|FARMA.*INSUMO|TOTAL/i.test(desc);
        if (isAggregate) {
            output.push(f);
            continue;
        }

        // TRIGGER: Identify opaque OR clinical aggregate glosas (Forensic Breakdown)
        const isOpaqueTrigger = /PRESTACION NO CONTEMPLADA|GASTOS? NO CUBIERTO|VARIOS|AJUSTE|DIFERENCIA|MEDICAMENTO|MATERIAL|INSUMO|PABELLON|DIA CAMA|HABITACION/i.test(desc) ||
            /3201001|3201002/.test(desc);

        const amount = f.amount || 0;

        if (isOpaqueTrigger && amount > 0) {
            // STEP 3: Exact Forensic Reconstruction (Zero Tolerance)
            const context = /PABELLON|INTERVENCION|SURGERY|QUIRURGICA/i.test(desc) ? "QUIRURGICO" : undefined;

            let result = reconstructor.findMatches(amount, desc, context);

            if (result.success && result.matchedItems.length > 0) {
                let category: "A" | "B" | "K" | "Z" | "OK" = "A"; // Promote to A on exact match
                let action: "IMPUGNAR" = "IMPUGNAR";
                let forensicStatus = "COBRO_ENCUBIERTO_IDENTIFICADO";

                // Determine if any matched item confirms unbundling or discomfort
                const hasHardImprocedencia = result.matchedItems.some(i => classifyItemNorm(i).isCatA && !classifyItemNorm(i).norma.includes("Ley 20.584"));

                if (!hasHardImprocedencia) {
                    category = "K"; // If exact match but no specific unbundling rule, stay in K (Opacidad probada)
                    forensicStatus = "OPACIDAD_IDENTIFICADA_MATEMATICAMENTE";
                }

                let itemsTable = "| Zona | Familia | Item Detalle | Monto | Norma Aplicable |\n| :--- | :--- | :--- | :--- | :--- |\n";
                result.matchedItems.forEach(i => {
                    const normInfo = classifyItemNorm(i);
                    const tx = i.taxonomy;
                    itemsTable += `| ${tx?.zona_A || 'OTROS'} | ${tx?.familia_B || 'GENERICO'} | ${i.description} | $${(i.total || 0).toLocaleString('es-CL')} | ${normInfo.norma} |\n`;
                });

                const techMessage = `El monto clasificado como '${f.label}' se explica matemáticamente por la agregación de ítems de la cuenta clínica. ${result.compatibilityRationale || ''} Status: ${forensicStatus}.`;
                const userMessage = `Detectamos que este cargo coincide con materiales e insumos de su hospitalización que carecen de detalle. Esto sugiere cobros redundantes o falta de transparencia.`;

                // CRITICAL: If rationale includes "Indeterminación" or "Ley 20.584", FORCE Z category
                const isForceIndete = /INDETERMINACION|NO PERMITE CLASIFICAR|LEY 20.?584/i.test(f.rationale || "");
                const finalCategory = isForceIndete ? "Z" : category;
                const finalAction = finalCategory === "Z" ? "SOLICITAR_ACLARACION" : action;

                output.push({
                    ...f,
                    category: finalCategory,
                    action: finalAction,
                    label: `${f.label} (Identificado Forense)`,
                    rationale: `${f.rationale}\n\n### RECONSTRUCCIÓN FORENSE (CIERRE MATEMÁTICO EXACTO)\n${techMessage}\n\n**Explicación para el paciente:** ${userMessage}\n\n${itemsTable}\n\n**Conclusión:** Se impugna por haber identificado los ítems exactos que componen el cobro opaco, confirmando que se trata de cobros redundantes o no detallados ante la Isapre.`,
                    hypothesisParent: finalCategory === 'A' ? 'H_UNBUNDLING_IF319' : 'H_OPACIDAD_ESTRUCTURAL',
                    evidenceRefs: [
                        ...(f.evidenceRefs || []),
                        ...result.matchedItems.map(i => `ITEM INDEX: ${i.index}`)
                    ]
                });
                continue;
            }
        }
        output.push(f);
    }

    return output;
}
