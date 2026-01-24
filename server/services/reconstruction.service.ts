
import { BillingItem, Finding, ExtractedAccount } from '../../types.js';

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

    /**
     * Attempts to find a subset of unused bill items that sum up to the target amount.
     * Strictly filters items by compatibility with the glosa and clinical context.
     */
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

        // AXIOM: ZERO TOLERANCE for forensic reconstruction
        const toleranceAbs = 0;
        const itemsOnly = compatibleItems.map(e => e.item);

        const result = this.subsetSum(target, itemsOnly, toleranceAbs);

        if (result) {
            result.forEach(item => this.usedItemIds.add(this.getItemUniqueId(item)));
            return {
                matchedItems: result,
                unmatchedAmount: 0,
                success: true,
                compatibilityRationale: `CIERRE MATEMÁTICO EXACTO: Se identificaron ${result.length} ítems que suman exactamente $${target.toLocaleString('es-CL')} y son semánticamente compatibles con '${glosa}'.`
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
        const desc = this.normalizeString(item.description);
        const sec = this.normalizeString(section);
        const glo = this.normalizeString(glosa);
        const ctx = this.normalizeString(context || "");

        // HELPERS: Precise Nature Detection (Clinical Purity)
        const isMaterialDesc = /GASA|JERINGA|GUANTE|DRENAJE|SUTURA|SONDA|CATETER|EQUIPO.FLEBO|LLAVE.3.PASOS|BRANULA|DELANTAL|PAQUETE|SABANA|MANGA|FUNDA|ELECTRODO|PARCHE|BISTURI|TUBO.ENDOTRAQUEAL|ESTILETE|CANULA.MAYO|CIRCUITO.ANESTESIA|MASCARA.LARINGEA|FILTRO|ALUSA|BANDEJA|SET.ASEO|TERMOMETRO|CALZON|CONFORT|CEPILLO|AGUJA|CURACION|PROTECTOR/i.test(desc);
        const isMedicationDesc = /(^|\s)(INY|AMP|SOL|GRAG|TAB|CAPS|SUSP|MG|ML|UI|UG|MCG|MEQ|G|UNID|DOSIS|SACHET)(\s|$)/i.test(desc) || /PARACETAMOL|CEFTRIAXONA|ATROPINA|HEPARINA|KETOPROFENO|PROPOFOL|FENTANIL|LIDOCAINA|OMEPRAZOL|SUERO|NATRECUR|PROPO|FENT|SEVO/i.test(desc);

        // 1. Bed/Room Charges & Unbundling (Día Cama)
        if (glo.includes("DIA CAMA") || glo.includes("HABITACION") || glo.includes("ESTANCIA")) {
            const isBedSection = /HABITACION|DIA CAMA|ESTANCIA|HOSPITALIZACION/i.test(sec);
            // Nursing/Basic Unbundling (Standard IF-319 / Practice #5)
            const isNursingProc = /NURSING|ENFERMERIA|SIGNOS VITALES|CURACION|INSTALACION.*VIA|FLEBOCLISIS|PUNCION|TOMA.DE.MUESTRA|ADMINISTRACION.*MEDICAMENTOS|HIGIENIZACION/i.test(desc);
            // Day-bed must NOT pull medical drugs (Expensive Pharmacy) or Surgical Material
            if (isMedicationDesc || isMaterialDesc) {
                // Exception: very basic nursing supplies (guantes, gasa simple) can stay if nursing glosa
                const isVeryBasicSupply = /GUANTE|GASA|APOSITO|JERINGA.SIMPLE/i.test(desc);
                if (isNursingProc || isVeryBasicSupply) return true;
                return false;
            }
            return isBedSection;
        }

        // 2. Surgical Context (Surgical Unbundling / Intraoperative Meds / Practice #2 & #3)
        if (glo.includes("QUIRURGICO") || glo.includes("PABELLON") || ctx === "QUIRURGICO" || glo.includes("CIRUGIA")) {
            // AXIOM: When reconstructing PABELLON, we allow both BUT strictly surgical meds and surgical items
            const isSurgicalSec = /PABELLON|QUIRURGICO|ANESTESIA|RECUPERACION/i.test(sec);
            const isSurgicalMed = /PROPOFOL|FENTANIL|SEVOFLURANO|LIDOCAINA|BUPIVACAINA|ROCURONIO|VECURONIO|MIDAZOLAM|ETOMIDATO|REMIFENTANIL|NEOSTIGMINA|SUGAMMADEX|ATROPINA|EFEDRINA|FENILEFRINA|NALOXONA|FLUMAZENIL/i.test(desc);
            const isSurgicalItem = /SUTURA|GASA|DRENAJE|BISTURI|TUBO.ENDOTRAQUEAL|ESTILETE|CANULA.MAYO|CIRCUITO.ANESTESIA|MASCARA.LARINGEA|MANGA.LAPAROSCOPICA|FUNDA.CAMARA|ELECTRODO|PARCHE/i.test(desc);
            const isSurgicalConsumable = /DELANTAL.ESTERIL|PAQUETE.CIRUGIA|SABANA.QUIRURGICA|EQUIPO.QUIRURGICO|ROPA.ESTERIL/i.test(desc);

            return isSurgicalSec || isSurgicalMed || isSurgicalItem || isSurgicalConsumable;
        }

        // 3. Meds/Materials (STRICT CLINICAL PARTITIONING)
        if (/MEDICAMENTO|FARMA|DROGA/i.test(glo)) {
            // Must BE a medication AND NOT a material
            if (isMaterialDesc) return false;
            const isMedSec = /MEDICAMENTO|FARMA|DROGA|FARMACIA/i.test(sec);
            return isMedSec || isMedicationDesc;
        }

        if (/MATERIAL|INSUMO/i.test(glo)) {
            // Must BE a material AND NOT a medication
            if (isMedicationDesc) return false;
            const isMatSec = /MATERIAL|INSUMO|EQUIPO|ESTERIL/i.test(sec);
            const isComfort = /SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|CONFORT|TELEVISOR|ESTACIONAMIENTO|TOALLA.HUMEDA|KITS?.HIGIENE|PASTA.DENTAL|PEINETA/i.test(desc);
            if (isComfort) return false;
            return isMatSec || isMaterialDesc;
        }

        // 4. "Gastos No Cubiertos" / "Preg. No Contemplada" (Hospitality & Comfort / Practice #4 & #6)
        if (/GASTOS? NO CUBIERTO|PRESTACION NO CONTEMPLADA|VARIOS|AJUSTE|DIFERENCIA/i.test(glo)) {
            // Hospitality/Comfort (Criterio SIS)
            const isHospitality = /SET.*ASEO|PANTUFLA|CEPILLO|JABON|CALZON|TERMOMETRO|CONFORT|TELEVISOR|ESTACIONAMIENTO|ALIMENTAC|KITS?.HIGIENE|PASTA.DENTAL|PEINETA|BATA|CAMISOLA|FRAZADA|ALMOHADA/i.test(desc);
            // Operational/Administrative costs (Hypothesis C)
            const isAdmin = /ADMINISTRATIVO|CARGOS.GENERALES|OTROS|EPP|SEGURIDAD|INFRAESTRUCTURA|COSTO.OPERACIONAL|INSUMO.INSTITUCIONAL/i.test(desc) || /ADMINISTRATIVO|VARIOS/i.test(sec);
            // Residual unbundling that ended up here (Practice #5)
            const isResidualUnbundling = /INSTALACION.*VIA|FLEBOCLISIS|PUNCION|SIGNOS VITALES|CURACION/i.test(desc);

            return isHospitality || isAdmin || isResidualUnbundling;
        }

        // Exact linguistic match as fallback
        return sec.includes(glo) || glo.includes(sec);
    }

    private subsetSum(target: number, items: BillingItem[], tolerance: number): BillingItem[] | null {
        const n = items.length;
        let result: BillingItem[] | null = null;
        let nodes = 0;
        const MAX_NODES = 500000; // Efficient limit for search

        // Sort descending to prune faster
        const sorted = [...items].sort((a, b) => (b.total || 0) - (a.total || 0));

        const suffixSums = new Array(n + 1).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            suffixSums[i] = suffixSums[i + 1] + (sorted[i].total || 0);
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

            dfs(idx + 1, currentSum + (sorted[idx].total || 0), [...chosen, sorted[idx]]);
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

                let itemsTable = "| Item Detalle | Monto | Norma Aplicable |\n| :--- | :--- | :--- |\n";
                result.matchedItems.forEach(i => {
                    const normInfo = classifyItemNorm(i);
                    itemsTable += `| ${i.description} | $${(i.total || 0).toLocaleString('es-CL')} | ${normInfo.norma} |\n`;
                });

                const techMessage = `El monto clasificado como '${f.label}' se explica matemáticamente por la agregación de ítems de la cuenta clínica. ${result.compatibilityRationale || ''} Status: ${forensicStatus}.`;
                const userMessage = `Detectamos que este cargo coincide con materiales e insumos de su hospitalización que carecen de detalle. Esto sugiere cobros redundantes o falta de transparencia.`;

                output.push({
                    ...f,
                    category,
                    action,
                    label: `${f.label} (Identificado Forense)`,
                    rationale: `${f.rationale}\n\n### RECONSTRUCCIÓN FORENSE (CIERRE MATEMÁTICO EXACTO)\n${techMessage}\n\n**Explicación para el paciente:** ${userMessage}\n\n${itemsTable}\n\n**Conclusión:** Se impugna por haber identificado los ítems exactos que componen el cobro opaco, confirmando que se trata de cobros redundantes o no detallados ante la Isapre.`,
                    hypothesisParent: category === 'A' ? 'H_UNBUNDLING_IF319' : 'H_OPACIDAD_ESTRUCTURAL',
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
