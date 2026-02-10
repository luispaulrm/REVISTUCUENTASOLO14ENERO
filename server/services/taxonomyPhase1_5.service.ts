import crypto from "crypto";
import { TaxonomyResult, TaxonomyContextAnchors, EtiologiaResult } from "../types/taxonomy.types.js";
import { GeminiService } from "./gemini.service.js";

// ----------------------------
// 1) Reglas determinísticas
// ----------------------------

const RX_FONASA_CODE = /\b\d{2}-\d{2}-\d{3}\b/; // Basic detection
const RX_INTERNAL_CODE = /\b\d{8}\b/; // ejemplo: 22200082 (insumo interno típico)
const RX_INSTALACION_VIA_VENOSA = /instalaci[oó]n.*v[ií]a.*venosa|v[ií]a.*venosa.*instalaci[oó]n/i;
const RX_FLEBOCLISIS = /\bfleboclisis\b/i;

// --- MOTOR 3: DOMINIOS FUNCIONALES (CAPA 2) ---
const DOMINIO_REGEX = {
    HOTELERIA: /term[oó]metro|calz[oó]n|set.*aseo|chata|pa[ñn]al|confort|hoteler[ií]a|faja.*compresora|medias?.*antiemb[oó]licas?/i,
    INSUMO_ESTANDAR: /mascarilla|bigotera|aquapack|frasco|jeringa|aguja|bajadas?|tegaderm|ap[oó]sito|algod[oó]n|gasas?|t[oó]rulas?/i,
    MATERIAL_CLINICO_ESPECIFICO: /trocar|clip|sutura|hemolock|stapler|grapadora|bistur[ií]|hoja.*bistur[ií]/i
};

// --- Helper Functions ---

function isMedicamento(text: string): boolean {
    return /f[áa]rmac|medicamento|drogas?|ampolla|vial|mg\b|ml\b|comp\b|gragea|jarabe/i.test(text);
}

// Lista “acto no autónomo” (puedes expandir)
function isActoNoAutonomo(text: string): boolean {
    return RX_INSTALACION_VIA_VENOSA.test(text) || RX_FLEBOCLISIS.test(text);
}

// Naturaleza obvia por keywords (rápido y barato)
type Naturaleza =
    | "ANESTESIA"
    | "MATERIAL_QUIRURGICO"
    | "INSUMO_SALA"
    | "HOTELERIA"
    | "URGENCIA"
    | "DIAGNOSTICO"
    | "MEDICAMENTO_GENERAL"
    | "AMBIGUA";

function inferNaturalezaFast(text: string): Naturaleza {
    const t = text.toLowerCase();
    // anestesia
    if (/(sevoflurane|propofol|rocuronio|sugammadex|bupivacain|lidocain|fentanyl)/i.test(text)) return "ANESTESIA";
    // quirúrgico
    if (/(trocar|hemolock|clip|endobag|sutura|vicryl|monocryl|laparosc|paquete cirug)/i.test(text)) return "MATERIAL_QUIRURGICO";
    // hotelería / día cama
    if (/(día cama|calz[oó]n cl[ií]nico|set de aseo|chata|delantal paciente)/i.test(text)) return "HOTELERIA";
    // insumo sala
    if (/(aposito|torula|jeringa|aguja|branula|llave 3 pasos)/i.test(text)) return "INSUMO_SALA";
    // diagnóstico
    if (RX_FONASA_CODE.test(text) && /(tac|hemograma|perfil|coombs|orina|lactato|glicemia)/i.test(text)) return "DIAGNOSTICO";
    // medicamento general
    if (/(\bmg\b|\biv\b|\bev\b|ceftriaxona|metronidazol|paracetamol|ondansetron|ketoprofeno)/i.test(text)) return "MEDICAMENTO_GENERAL";
    return "AMBIGUA";
}

// “Código FONASA válido” (heurística simple en Phase 1.5)
// Nota: si después integras el PDF de Arancel, aquí se vuelve determinístico de verdad.
function codigoFonasaValidoHeuristico(text: string): boolean {
    // Si trae código con guiones “xx-xx-xxx-xx”, suele ser arancelario
    if (RX_FONASA_CODE.test(text)) return true;
    // Si sólo trae código interno de 8 dígitos (insumos), no es “prestación FONASA”
    // pero NO implica fraude: sólo no es “código arancelario”
    return false;
}

// ----------------------------
// 2) Inferencia de dominio/absorción
// ----------------------------

function absorcionPorNaturaleza(n: Naturaleza, anchors: TaxonomyContextAnchors): EtiologiaResult["absorcion_clinica"] {
    // si hay pabellón, anestesia y material quirúrgico se absorben ahí
    if (anchors.hasPabellon && (n === "ANESTESIA" || n === "MATERIAL_QUIRURGICO")) return "PABELLON";
    // hotelería típicamente día cama
    if (anchors.hasDayBed && (n === "HOTELERIA" || n === "INSUMO_SALA")) return "DIA_CAMA";
    // fallback
    return null;
}

function buildDeterministicEtiology(item: TaxonomyResult, anchors: TaxonomyContextAnchors): EtiologiaResult | null {
    const text = item.text || item.item_original; // Fallback for stability

    // 1) Acto no autónomo (tu ejemplo clásico)
    if (isActoNoAutonomo(text)) {
        return {
            tipo: "ACTO_NO_AUTONOMO",
            absorcion_clinica: anchors.hasDayBed ? "DIA_CAMA" : "ATENCION_HOSPITALARIA",
            codigo_fonasa_valido: RX_FONASA_CODE.test(text), // suele venir como 99-00-xxx-xx, pero puede igual ser objetable
            motivo_rechazo_previsible: "ACTO_INCLUIDO_EN_PAQUETE",
            impacto_previsional: "REBOTE_ISAPRE_PREVISIBLE",
            rationale_short: "Acto accesorio frecuente absorbido por atención/hospitalización; alto riesgo de rechazo.",
            confidence: 0.85,
            evidence: { anchors: anchorFlags(anchors), rules: ["RULE_ACTO_NO_AUTONOMO"], matches: ["regex:ACTO_NO_AUTONOMO"] }
        };
    }

    // --- MOTOR 3 (MEP) IMPLEMENTATION ---

    // CAPA 1: BARRERA ARANCELARIA (Determinística)
    // We can check Phase 1 known nature as proxy for "Arancelaria/Farmacia" check
    const isFarmacia = text.match(/f[áa]rmac|medicamento|drogas?|ampolla|vial/i) || false; // Quick heuristic if not passed
    const tieneBarrera = RX_FONASA_CODE.test(text) || isFarmacia;

    // CAPA 2: DOMINIO FUNCIONAL
    let dominioFuncional = null;
    if (DOMINIO_REGEX.HOTELERIA.test(text)) dominioFuncional = "HOTELERIA";
    else if (DOMINIO_REGEX.INSUMO_ESTANDAR.test(text)) dominioFuncional = "INSUMO_ESTANDAR";
    else if (DOMINIO_REGEX.MATERIAL_CLINICO_ESPECIFICO.test(text)) dominioFuncional = "MATERIAL_CLINICO_ESPECIFICO";

    // CAPA 3: ABSORCIÓN NORMATIVA (REGLA DE ORO)
    if (dominioFuncional === "HOTELERIA") {
        return {
            tipo: "DESCLASIFICACION_ADMINISTRATIVA",
            absorcion_clinica: "NO_APLICA",
            codigo_fonasa_valido: false,
            motivo_rechazo_previsible: "ITEM_MAL_IMPUTADO",
            impacto_previsional: "NO_BONIFICABLE_POR_NORMA",
            rationale_short: "MEP: Hotelería/Confort expulsado de cobertura (Dominio Administrativo)",
            confidence: 0.99,
            evidence: { matches: ["dominio:HOTELERIA", "regla:RECHAZO_DIRECTO"] }
        };
    }

    if (dominioFuncional === "INSUMO_ESTANDAR") {
        // En pabellón o sala, el insumo estándar se asume incluido
        if (anchors.hasPabellon || anchors.hasDayBed) {
            return {
                tipo: "DESCLASIFICACION_ADMINISTRATIVA",
                absorcion_clinica: "NO_APLICA", // Or "PABELLON" if we want to imply it was absorbed there, but user prefers "Administrative Rejection" for these.
                // Let's stick to "Administrative Unbundling" as agreed
                codigo_fonasa_valido: false,
                motivo_rechazo_previsible: "ACTO_INCLUIDO_EN_PAQUETE",
                impacto_previsional: "NO_BONIFICABLE_POR_NORMA",
                rationale_short: `MEP: Insumo Estándar absorbido por derecho de ${anchors.hasPabellon ? 'Pabellón' : 'Sala'}`,
                confidence: 0.90,
                evidence: { matches: ["dominio:INSUMO_ESTANDAR", `contexto:${anchors.hasPabellon ? 'PABELLON' : 'SALA'}`] }
            };
        }
    }

    // CAPA 4: SEMÁNTICA (LLM Fallback happens later if this function returns null)
    // ... code continues to next checks ...

    // 3) Si es claramente prestación arancelaria (tiene código FONASA) -> normalmente correcto en Phase 1.5
    // OJO: “correcto” aquí significa “no hay causal etiológica dura con la info actual”.
    if (RX_FONASA_CODE.test(text)) {
        // Small refinement: Ensure it's not one of the specific non-autonomous acts caught above
        return {
            tipo: "CORRECTO",
            absorcion_clinica: null,
            codigo_fonasa_valido: true,
            motivo_rechazo_previsible: "SIN_CAUSAL_PREVISIBLE",
            impacto_previsional: "BONIFICABLE",
            rationale_short: "Prestación con forma de código arancelario; sin señales duras de desclasificación.",
            confidence: 0.7,
            evidence: { anchors: anchorFlags(anchors), rules: ["RULE_CODIGO_ARANCELARIO"], matches: ["regex:RX_FONASA_CODE"] }
        };
    }

    // 4) Si no es arancelario, no significa fraude; podría ser insumo. Se decide por absorción.
    const nat = inferNaturalezaFast(text);
    if (nat !== "AMBIGUA") {
        const absorcion = absorcionPorNaturaleza(nat, anchors);

        // si se absorbe a pabellón y el item aparece fuera de pabellón (esto lo sabrás por sourceRef/section si lo pasas)
        // aquí asumimos que Phase 1.5 recibe el section name via item.sourceRef o item.atributos.section
        const section = (item as any)?.atributos?.section ?? item.sourceRef ?? "";
        const isOutsidePabellon = absorcion === "PABELLON" && !/pabell/i.test(section);

        if (absorcion === "PABELLON" && isOutsidePabellon) {
            return {
                tipo: "DESCLASIFICACION_CLINICA",
                absorcion_clinica: "PABELLON",
                codigo_fonasa_valido: false,
                motivo_rechazo_previsible: "ITEM_MAL_IMPUTADO",
                impacto_previsional: "REBOTE_ISAPRE_PREVISIBLE",
                rationale_short: "Ítem de naturaleza quirúrgica/anestésica fuera de Pabellón; probable rechazo por imputación.",
                confidence: 0.8,
                evidence: { anchors: anchorFlags(anchors), rules: ["RULE_ABSORCION_PABELLON"], matches: [`nature:${nat}`] }
            };
        }

        // si se absorbe, pero está coherente, lo marcamos como correcto (o “no_bonificable_por_norma” según tu criterio)
        if (absorcion) {
            return {
                tipo: "CORRECTO",
                absorcion_clinica: absorcion,
                codigo_fonasa_valido: false,
                motivo_rechazo_previsible: "SIN_CAUSAL_PREVISIBLE",
                impacto_previsional: "BONIFICABLE",
                rationale_short: "Ítem no arancelario, pero coherente con dominio activo; sin señal etiológica dura.",
                confidence: 0.6,
                evidence: { anchors: anchorFlags(anchors), rules: ["RULE_ABSORCION_DOMINIO"], matches: [`nature:${nat}`] }
            };
        }
    }

    // no determinable sin ayuda
    return null;
}

function anchorFlags(a: TaxonomyContextAnchors): string[] {
    const out: string[] = [];
    if (a.hasPabellon) out.push("EXISTE_PABELLON");
    if (a.hasDayBed) out.push("EXISTE_DIA_CAMA");
    if (a.hasUrgencia) out.push("EXISTE_URGENCIA");
    if (a.hasEventoUnicoHint) out.push("HINT_EVENTO_UNICO");
    return out;
}

// ----------------------------
// 3) LLM “constrained” para casos ambiguos
// ----------------------------

function sha(x: unknown) {
    return crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
}

export class TaxonomyPhase1_5Service {
    private geminiService: GeminiService;

    constructor(geminiService: GeminiService, private opts: { enableLLM?: boolean; cache?: Map<string, EtiologiaResult> } = {}) {
        this.geminiService = geminiService;
    }

    async run(items: TaxonomyResult[], anchors: TaxonomyContextAnchors): Promise<TaxonomyResult[]> {
        const out: TaxonomyResult[] = [];

        for (const it of items) {
            // 1) intento determinístico
            const det = buildDeterministicEtiology(it, anchors);
            if (det) {
                out.push({ ...it, etiologia: det });
                continue;
            }

            // 2) LLM opt-in para ambiguos
            if (!this.opts.enableLLM) {
                out.push({
                    ...it,
                    etiologia: {
                        tipo: "CORRECTO",
                        absorcion_clinica: null,
                        codigo_fonasa_valido: codigoFonasaValidoHeuristico(it.text || it.item_original),
                        motivo_rechazo_previsible: "SIN_CAUSAL_PREVISIBLE",
                        impacto_previsional: "BONIFICABLE",
                        rationale_short: "Ambiguo sin LLM; se difiere etiología.",
                        confidence: 0.4,
                        evidence: { anchors: anchorFlags(anchors), rules: ["RULE_NO_LLM_FALLBACK"] }
                    }
                });
                continue;
            }

            // We need 'text' for hashing and processing.
            const textToProcess = it.text || it.item_original;

            const key = sha({ t: textToProcess, g: it.grupo, s: it.sub_familia, anchors });
            const cached = this.opts.cache?.get(key);
            if (cached) {
                out.push({ ...it, etiologia: cached });
                continue;
            }

            const llm = await this.inferEtiologyWithLLM(it, anchors);
            this.opts.cache?.set(key, llm);
            out.push({ ...it, etiologia: llm });
        }

        return out;
    }

    private async inferEtiologyWithLLM(item: TaxonomyResult, anchors: TaxonomyContextAnchors): Promise<EtiologiaResult> {
        const prompt = buildEtiologyPrompt(item, anchors);

        // Using extractText similar to Phase 1 but we need JSON parsing logic
        // The user example used 'geminiJson', but to avoid missing dependencies I'll adapt to what I saw in Phase1 service.

        try {
            const responseText = await this.geminiService.extractText(prompt, { temperature: 0.1 });
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const json = JSON.parse(cleanJson);
            return clampEtiology(json);
        } catch (e) {
            // Fallback on error
            return {
                tipo: "CORRECTO",
                absorcion_clinica: null,
                codigo_fonasa_valido: false,
                motivo_rechazo_previsible: "SIN_CAUSAL_PREVISIBLE",
                impacto_previsional: "BONIFICABLE",
                rationale_short: "LLM_ERROR_FALLBACK",
                confidence: 0.0
            };
        }
    }
}


function clampEtiology(x: Partial<EtiologiaResult>): EtiologiaResult {
    // aplica defaults y evita valores fuera del enum
    const safe: EtiologiaResult = {
        tipo: x?.tipo ?? "CORRECTO",
        absorcion_clinica: x?.absorcion_clinica ?? null,
        codigo_fonasa_valido: Boolean(x?.codigo_fonasa_valido),
        motivo_rechazo_previsible: x?.motivo_rechazo_previsible ?? "SIN_CAUSAL_PREVISIBLE",
        impacto_previsional: x?.impacto_previsional ?? "BONIFICABLE",
        rationale_short: x?.rationale_short || "Inferido por IA",
        confidence: typeof x?.confidence === "number" ? Math.max(0, Math.min(1, x.confidence)) : 0.5,
        evidence: x?.evidence
    };
    return safe;
}

function buildEtiologyPrompt(item: TaxonomyResult, anchors: TaxonomyContextAnchors) {
    const textSafe = item.text || item.item_original;
    return `
Eres un motor forense de "Etiología de Cobros Clínicos" (Chile).
Tu tarea NO es auditar montos, sólo clasificar etiología probable.

CONCEPTOS:
- CODIGO_INEXISTENTE: el ítem se presenta como "prestación bonificable" pero su codificación es interna/no reconocible como arancel (o es inventada).
- ACTO_NO_AUTONOMO: acto accesorio típicamente incluido en atención (p.ej. instalación vía venosa, fleboclisis) y suele ser rechazado por duplicidad/absorción.
- DESCLASIFICACION_CLINICA: el ítem es real (insumo/medicamento), pero está imputado en un dominio incorrecto para maximizar cobro; se espera rechazo o rebote.
- CORRECTO: no hay causal etiológica previsible con la info dada.

DOMINIOS ACTIVOS (anclas):
hasPabellon=${anchors.hasPabellon}
hasDayBed=${anchors.hasDayBed}
hasUrgencia=${anchors.hasUrgencia}
hasEventoUnicoHint=${Boolean(anchors.hasEventoUnicoHint)}
sectionNames=${JSON.stringify(anchors.sectionNames ?? [])}

ITEM (Phase 1 output):
id=${item.id}
text=${JSON.stringify(textSafe)}
grupo=${JSON.stringify(item.grupo ?? null)}
subfamilia=${JSON.stringify(item.sub_familia ?? null)}
atributos=${JSON.stringify(item.atributos ?? {})}

REGLAS:
1) Si el texto sugiere "acto accesorio" (vía venosa/fleboclisis), prioriza ACTO_NO_AUTONOMO.
2) Si es anestesia/quirúrgico y hasPabellon=true pero aparece fuera de Pabellón (si hay sección en atributos/sourceRef), DESCLASIFICACION_CLINICA con absorcion_clinica="PABELLON".
3) Si parece "prestación" pero no tiene forma de código arancelario y se ve como inventado -> CODIGO_INEXISTENTE.
4) Si no estás seguro, CORRECTO con motivo SIN_CAUSAL_PREVISIBLE.

DEVUELVE SOLO JSON ESTRICTO con este shape:
{
  "tipo": "...",
  "absorcion_clinica": "PABELLON"|"DIA_CAMA"|"EVENTO_UNICO"|"ATENCION_HOSPITALARIA"|null,
  "codigo_fonasa_valido": true|false,
  "motivo_rechazo_previsible": "...",
  "impacto_previsional": "...",
  "rationale_short": "string corto",
  "confidence": 0.0-1.0,
  "evidence": { "anchors": [], "rules": [], "matches": [] }
}
`.trim();
}
