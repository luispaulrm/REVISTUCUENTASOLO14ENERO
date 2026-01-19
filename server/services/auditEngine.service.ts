import { GoogleGenerativeAI } from "@google/generative-ai";
import { GeminiService } from './gemini.service.js';
import { AUDIT_PROMPT, FORENSIC_AUDIT_SCHEMA } from '../config/audit.prompts.js';
import { AI_MODELS, GENERATION_CONFIG } from '../config/ai.config.js';
import {
    extractCaseKeywords,
    getRelevantKnowledge,
    loadHoteleriaRules,
    getKnowledgeFilterInfo
} from './knowledgeFilter.service.js';
import { preProcessEventos } from './eventProcessor.service.js';

// ============================================================================
// UTILITY: Canonical Amount Parser (CLP - Chilean Peso)
// ============================================================================
function parseAmountCLP(val: any): number {
    if (val == null) return 0;
    if (typeof val === "number") return Math.round(val);
    if (typeof val === "string") {
        const n = parseInt(val.replace(/[^0-9-]/g, ""), 10);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

// ============================================================================
// UTILITY: Deterministic Finding Classifier (CAT A vs CAT B)
// ============================================================================
function classifyFinding(h: any): "A" | "B" {
    const gl = (h.glosa || "").toUpperCase();
    const text = (h.hallazgo || "").toUpperCase();

    // CAT A: Cobros improcedentes de cuenta (glosas genéricas sin PAM)
    const isCuentaOpaca = /VARIOS|AJUSTE|DIFERENCIA/.test(gl) || /VARIOS|AJUSTE/.test(text);
    if (isCuentaOpaca) return "A";

    // CAT B: PAM con cajas negras (materiales/medicamentos agrupados)
    const isPamCajaNegra = /MATERIALES|MEDICAMENTOS|INSUMO|FARMAC/.test(gl) && /DESGLOSE|OPACIDAD|CAJA/.test(text);
    if (isPamCajaNegra) return "B";

    // Default: Conservative (treat as CAT A if unclear)
    return "A";
}

export async function performForensicAudit(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any,
    apiKey: string,
    log: (msg: string) => void,
    htmlContext: string = '',
    onUsageUpdate?: (usage: any) => void,
    onProgressUpdate?: (progress: number) => void
) {
    // AUDIT-SPECIFIC: Reasoner First (Pro), then Flash 3, then Fallback (2.5)
    const modelsToTry = [AI_MODELS.reasoner, AI_MODELS.primary, AI_MODELS.fallback];
    let result;
    let lastError;
    let accumulatedTokens = 0;
    const ESTIMATED_TOTAL_TOKENS = 4000; // Estimate for progress bar

    // =========================================================================
    // MINI-RAG: BIBLIOTECARIO INTELIGENTE
    // Carga dinámica de conocimiento legal relevante para este caso específico
    // =========================================================================
    log('[AuditEngine] 📚 Activando Bibliotecario Inteligente (Mini-RAG)...');
    onProgressUpdate?.(10);
    log(`[AuditEngine] ℹ️ ${getKnowledgeFilterInfo()} `);

    // Paso 1: Extraer keywords del caso (cuenta, PAM, contrato)
    const caseKeywords = extractCaseKeywords(cuentaJson, pamJson, contratoJson, htmlContext);
    log(`[AuditEngine] 🔑 Keywords extraídas: ${caseKeywords.length} términos`);
    log(`[AuditEngine] 🔑 Muestra: ${caseKeywords.slice(0, 8).join(', ')}...`);

    // Paso 2: Filtrar y cargar solo conocimiento relevante (máx 30K tokens)
    /*
    const MAX_KNOWLEDGE_TOKENS = 40000;  // Reduced to 40k for better prompt stability
    const { text: knowledgeBaseText, sources, tokenEstimate, keywordsMatched } =
        await getRelevantKnowledge(caseKeywords, MAX_KNOWLEDGE_TOKENS, log);
    */

    // DISABLE MINI-RAG PER USER REQUEST
    const knowledgeBaseText = "(Base de conocimiento legal omitida en esta iteración para optimización de rendimiento).";
    const sources: string[] = ["Mini-RAG Desactivado"];
    const tokenEstimate = 0;

    log(`[AuditEngine] 📊 Conocimiento inyectado: 0 fuentes (Mini-RAG OFF)`);
    // log(`[AuditEngine] 📚 Fuentes: ${sources.join(' | ')} `);
    onProgressUpdate?.(20);

    // Paso 3: Cargar reglas de hotelería (siempre, es pequeño)
    const hoteleriaRules = await loadHoteleriaRules();
    if (hoteleriaRules) {
        log('[AuditEngine] 🏨 Cargadas reglas de hotelería (IF-319)');
    }

    log('[AuditEngine] 🧠 Sincronizando datos y analizando hallazgos con Super-Contexto...');
    onProgressUpdate?.(30);

    // ============================================================================
    // TOKEN OPTIMIZATION: Reduce input costs by 30-40%
    // ============================================================================

    // 1. Clean Cuenta JSON - Remove non-essential fields (Handle empty cuenta)
    const hasStructuredCuenta = cuentaJson && Object.keys(cuentaJson).length > 0 && (cuentaJson.sections || cuentaJson.items);

    const cleanedCuenta = hasStructuredCuenta ? {
        ...cuentaJson,
        sections: cuentaJson.sections?.map((section: any) => ({
            category: section.category || section.name,
            sectionTotal: section.sectionTotal,
            items: section.items?.map((item: any) => ({
                code: item.code,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total
            }))
        }))
    } : { ...cuentaJson, info: "No structured bill provided. Use HTML context if available." };

    // 2. Clean PAM JSON - Preserve the structure but minimize items
    const cleanedPam = {
        ...pamJson, // This preserves resumenTotal, patient info, etc.
        folios: pamJson.folios?.map((folio: any) => ({
            ...folio,
            desglosePorPrestador: folio.desglosePorPrestador?.map((prestador: any) => ({
                ...prestador,
                items: prestador.items
                    ?.filter((item: any) => item.bonificacion > 0 || item.copago > 0)
                    ?.map((item: any) => ({
                        codigo: item.codigo,
                        descripcion: item.descripcion,
                        bonificacion: item.bonificacion,
                        copago: item.copago
                    }))
            }))
        }))
    };

    // 3. Clean Contrato JSON - Keep only essential coverage data
    const cleanedContrato = {
        coberturas: contratoJson.coberturas?.map((cob: any) => ({
            categoria: cob.categoria,
            item: cob.item,
            modalidad: cob.modalidad,
            cobertura: cob.cobertura,
            tope: cob.tope,
            nota_restriccion: cob.nota_restriccion,
            CODIGO_DISPARADOR_FONASA: cob.CODIGO_DISPARADOR_FONASA
            // Removed: LOGICA_DE_CALCULO, NIVEL_PRIORIDAD, copago, categoria_canonica
        })),
        reglas: contratoJson.reglas?.map((regla: any) => ({
            'CÓDIGO/SECCIÓN': regla['CÓDIGO/SECCIÓN'],
            'VALOR EXTRACTO LITERAL DETALLADO': regla['VALOR EXTRACTO LITERAL DETALLADO'],
            'SUBCATEGORÍA': regla['SUBCATEGORÍA']
            // Removed: PÁGINA ORIGEN, LOGICA_DE_CALCULO, categoria_canonica
        }))
    };

    //  4. Minify JSONs (remove whitespace) - saves ~20% tokens
    let finalCuentaContext = JSON.stringify(cleanedCuenta);
    let finalPamContext = JSON.stringify(cleanedPam);
    let finalContratoContext = JSON.stringify(cleanedContrato);

    // ============================================================================
    // EVENT PRE-PROCESSING (DETERMINISTIC LAYER - V3 ARCHITECTURE)
    // ============================================================================
    log('[AuditEngine] 🏥 Pre-procesando Eventos Hospitalarios (Arquitectura V3)...');
    onProgressUpdate?.(35);

    const eventosHospitalarios = preProcessEventos(pamJson, contratoJson);

    // --- LOG V.A DEDUCTION EVIDENCE ---
    let vaDeductionSummary = "⚠️ No se pudo deducir el V.A/VAM automáticamente por falta de ítems ancla conocidos.";
    if (eventosHospitalarios.length > 0 && eventosHospitalarios[0].analisis_financiero) {
        const fin = eventosHospitalarios[0].analisis_financiero;
        if (fin.valor_unidad_inferido) {
            vaDeductionSummary = `💎 DEDUCCIÓN V.A / VAM: $${fin.valor_unidad_inferido?.toLocaleString('es-CL')} | EVIDENCIA: ${fin.glosa_tope} `;
            log(`[AuditEngine] ${vaDeductionSummary} `);
        }
    }
    log(`[AuditEngine] 📋 Eventos detectados: ${eventosHospitalarios.length} `);

    // --- INTEGRITY CHECK (FAIL FAST - NO MONEY NO HONEY) ---
    // If PAM has money but Events show $0, abort to prevent hallucinations.
    const pamTotalCopago = pamJson?.global?.totalCopagoDeclarado || pamJson?.resumenTotal?.totalCopago || 0;
    const numericPamCopago = typeof pamTotalCopago === 'string' ? parseInt(pamTotalCopago.replace(/[^0-9]/g, '')) : pamTotalCopago;

    // Sum from events (using the newly added total_copago field)
    const eventsTotalCopago = eventosHospitalarios.reduce((sum, e) => sum + (e.total_copago || 0), 0);

    // Allow small tolerance? Or strict? User said "FAIL FAST".
    // If PAM > 0 and Events == 0 -> CRITICAL ERROR.
    if (numericPamCopago > 0 && eventsTotalCopago === 0) {
        throw new Error(`[DATA_INTEGRITY_FAIL] El PAM declara copago($${numericPamCopago}) pero los eventos sumaron $0. ` +
            `Revisar parsing de montos en eventProcessor.Abortando para evitar alucinaciones.`);
    }

    eventosHospitalarios.forEach((evento, idx) => {
        log(`[AuditEngine]   ${idx + 1}.Tipo: ${evento.tipo_evento}, Prestador: ${evento.prestador}, Copago: $${evento.total_copago?.toLocaleString('es-CL') || 0} `);
        if (evento.honorarios_consolidados && evento.honorarios_consolidados.length > 0) {
            const validFractions = evento.honorarios_consolidados.filter(h => h.es_fraccionamiento_valido);
            if (validFractions.length > 0) {
                log(`[AuditEngine]      └─ Fraccionamientos válidos detectados: ${validFractions.length} (NO son duplicidad)`);
            }
        }
    });

    const eventosContext = JSON.stringify(eventosHospitalarios);
    log(`[AuditEngine] ✅ Eventos serializados(~${(eventosContext.length / 1024).toFixed(2)} KB)`);

    // CONDITIONAL HTML: Only use HTML if structured JSON is incomplete
    const hasStructuredPam = cleanedPam && Object.keys(cleanedPam).length > 2;
    const useHtmlContext = !hasStructuredCuenta || !hasStructuredPam || (htmlContext && htmlContext.includes('--- ORIGEN:'));

    if (useHtmlContext && htmlContext) {
        log('[AuditEngine] 💎 Usando HTML Context (JSON incompleto o Módulo 8 detectado).');
    } else if (!useHtmlContext) {
        log('[AuditEngine] ⚡ HTML Context omitido (JSON estructurado completo, ahorro ~40k tokens).');
    }

    // ============================================================================
    // TRACEABILITY CHECK (DETERMINISTIC LAYER - V3)
    // ============================================================================
    const traceAnalysis = traceGenericChargesTopK(cleanedCuenta, cleanedPam);
    log('[AuditEngine] 🔍 Trazabilidad de Ajustes:');
    traceAnalysis.split('\n').forEach(line => log(`[AuditEngine]   ${line} `));

    const prompt = AUDIT_PROMPT
        .replace('{jurisprudencia_text}', '')
        .replace('{normas_administrativas_text}', '')
        .replace('{evento_unico_jurisprudencia_text}', '')
        .replace('{knowledge_base_text}', knowledgeBaseText)
        .replace('{hoteleria_json}', hoteleriaRules || '')
        .replace('{cuenta_json}', finalCuentaContext)
        .replace('{pam_json}', finalPamContext)
        .replace('{contrato_json}', finalContratoContext)
        .replace('{eventos_hospitalarios}', eventosContext)
        .replace('{contexto_trazabilidad}', traceAnalysis)
        .replace('{va_deduction_context}', vaDeductionSummary)
        .replace('{html_context}', useHtmlContext ? (htmlContext || '') : '(Omitido: JSON completo)');

    // Log prompt size for debugging
    const promptSize = prompt.length;
    const promptSizeKB = (promptSize / 1024).toFixed(2);
    log(`[AuditEngine] 📏 Tamaño del prompt: ${promptSizeKB} KB(${promptSize} caracteres)`);
    // -----------------------------------------------------

    // Initialize GeminiService with multiple API keys for rotation
    const apiKeys = [
        apiKey,
        process.env.GEMINI_API_KEY_SECONDARY,
        process.env.GEMINI_API_KEY_TERTIARY,
        process.env.GEMINI_API_KEY_QUATERNARY
    ].filter(k => k && k.length > 5);

    const geminiService = new GeminiService(apiKeys);
    log(`[AuditEngine] 🔑 GeminiService initialized with ${apiKeys.length} API key(s)`);

    for (const modelName of modelsToTry) {
        if (!modelName) continue;

        for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
            const currentKey = apiKeys[keyIdx];
            const keyMask = currentKey.substring(0, 4) + '...';

            try {
                log(`[AuditEngine] 🛡️ Strategy: Intentando con modelo ${modelName} (Key ${keyIdx + 1}/${apiKeys.length}: ${keyMask})...`);
                onProgressUpdate?.(40);

                const timeoutMs = 120000;
                let fullText = '';
                let usage: any = null;

                const genAI = new GoogleGenerativeAI(currentKey);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: FORENSIC_AUDIT_SCHEMA as any,
                        maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                        temperature: GENERATION_CONFIG.temperature,
                        topP: GENERATION_CONFIG.topP,
                        topK: GENERATION_CONFIG.topK
                    }
                });

                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Timeout: La API no respondió en ${timeoutMs / 1000} segundos`)), timeoutMs);
                });

                log('[AuditEngine] 📡 Enviando consulta a Gemini (Streaming)...');
                const streamResult = await Promise.race([
                    model.generateContentStream(prompt),
                    timeoutPromise
                ]) as any;

                log('[AuditEngine] 📥 Recibiendo respuesta en tiempo real...');
                for await (const chunk of streamResult.stream) {
                    const chunkText = chunk.text();
                    fullText += chunkText;

                    if (chunk.usageMetadata) {
                        usage = chunk.usageMetadata;
                        onUsageUpdate?.(usage);
                    }

                    if (fullText.length % 500 < chunkText.length) {
                        const kbReceived = Math.floor(fullText.length / 1024);
                        log(`[AuditEngine] 📊 Procesando... ${kbReceived}KB recibidos`);
                        const simulatedProgress = Math.min(90, 40 + (fullText.length / ESTIMATED_TOTAL_TOKENS) * 50);
                        onProgressUpdate?.(simulatedProgress);
                    }
                }

                result = {
                    response: {
                        text: () => fullText,
                        usageMetadata: usage
                    }
                };

                log(`[AuditEngine] ✅ Éxito con modelo ${modelName} y Key ${keyIdx + 1}`);
                break; // Exit key loop on success

            } catch (error: any) {
                lastError = error;
                const errStr = (error?.toString() || "") + (error?.message || "");
                const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || error?.status === 429 || error?.status === 503;
                const isTimeout = errStr.includes('Timeout');

                if (isTimeout) {
                    log(`[AuditEngine] ⏱️ Timeout en ${modelName} con Key ${keyIdx + 1}.`);
                    // Try next key
                    continue;
                } else if (isQuota) {
                    log(`[AuditEngine] ⚠️ Fallo en ${modelName} con Key ${keyIdx + 1} por Quota/Server. Probando siguiente clave...`);
                    // Small backoff
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                } else {
                    log(`[AuditEngine] ❌ Error no recuperable en ${modelName} / Key ${keyIdx + 1}: ${error.message}`);
                    // Depending on error, we might want to try next key or bail
                    // If it's 400 (Bad Request), trying next key won't help.
                    // But for robustness, let's try at least one more key or switch model.
                    if (errStr.includes('400')) throw error;
                    continue;
                }
            }
        }
        if (result) break; // Exit model loop on success
    }

    if (!result) {
        log(`[AuditEngine] ❌ Todos los modelos fallaron.`);
        throw lastError || new Error("Forensic Audit failed on all models.");
    }

    // --- ROBUST JSON PARSING ---
    try {
        let responseText = result.response.text();

        // 1. Remove Markdown fences
        responseText = responseText.replace(/```json\n ?| ```/g, '').trim();

        // 2. Escape bad control characters (newlines/tabs inside strings)
        // This regex looks for control chars that are NOT properly escaped
        // However, a simpler approach for AI JSON is often just to clean common issues

        // Attempt parse
        let auditResult;
        try {
            auditResult = JSON.parse(responseText);
        } catch (parseError) {
            log(`[AuditEngine] ⚠️ JSON.parse falló inicialmente: ${parseError.message}. Intentando reparación básica...`);

            // Repair: sometimes AI returns newlines inside strings which breaks JSON
            // We can try to strip newlines that are not structural (risky but often works for AI)
            // Or use a more advanced repair if available. For now, let's try a simple control char cleanup
            const cleanedText = responseText.replace(/[\u0000-\u001F]+/g, (match) => {
                // Keep legitimate newlines/tabs if they are outside strings (hard to know with regex)
                // Better approach: allow "repairSection" logic or just fail gracefully with raw text wrapper
                if (match === '\n') return ' '; // Replace stray newlines with space
                return '';
            });

            try {
                auditResult = JSON.parse(cleanedText);
                log('[AuditEngine] ✅ Reparación de JSON exitosa.');
            } catch (repairError) {
                log(`[AuditEngine] ❌ Reparación falló.Devolviendo raw text para depuración.`);
                // Fallback: return structure with raw content
                auditResult = {
                    metadata: { type: 'ERROR_FALLBACK' },
                    resumen_financiero: { total_reclamado: 0, total_cobertura: 0, copago_final: 0 },
                    hallazgos: [{
                        titulo: "Error de Formato JSON",
                        descripcion: "La IA generó una respuesta válida pero con formato JSON corrupto. Ver 'observaciones' para el texto crudo.",
                        impacto_financiero: 0,
                        categoria: "SISTEMA",
                        estado: "REVISION_MANUAL",
                        recomendacion: "Revisar texto crudo."
                    }],
                    observaciones_generales: responseText
                };
            }
        }

        const usage = result.response.usageMetadata;

        // --- POST-PROCESSING: SAFETY BELT (DOWNGRADE RULES) ---
        // Downgrade findings that lack valid Table VIII or contradict financial truth
        auditResult = postValidateLlmResponse(auditResult, eventosHospitalarios, cleanedCuenta, cleanedPam);
        log('[AuditEngine] 🛡️ Validaciones de seguridad aplicadas (Safety Belt).');

        // --- POST-PROCESSING: DETERMINISTIC GAP RECONCILIATION ---
        try {
            const pamTotalCopago = pamJson?.global?.totalCopagoDeclarado || pamJson?.resumenTotal?.totalCopago || 0;

            const numericTotalCopago = parseAmountCLP(pamTotalCopago);
            const sumFindings = auditResult.hallazgos.reduce((sum: number, h: any) => sum + (h.montoObjetado || 0), 0);

            // NEW LOGIC: Use AI's financial summary if available to deduce Legitimate Copay
            const financialSummary = auditResult.resumenFinanciero || {};
            const legitimadoPorIA = parseAmountCLP(financialSummary.totalCopagoLegitimo || 0);
            const estadoCopago = financialSummary.estado_copago || 'VALIDADO';

            // True Gap = TotalCopago - (Legitimate + Objected)
            // If AI says $1.4M is legitimate (30% copay) and $395k is objected, and Total is $1.8M
            // Gap = 1.8M - (1.4M + 0.395M) = ~0.

            // 🚨 REGLA NUCLEAR: Si el estado es INDETERMINADO, NO generamos GAP/orphans
            if (estadoCopago === 'INDETERMINADO_POR_OPACIDAD') {
                log(`[AuditEngine] 🔍 Estado INDETERMINADO detectado.NO se ejecuta GAP reconciliation(evita ghost hunters).`);
                // Early return: skip all gap/orphan logic
            } else {

                // Verify consistency:
                // If AI didn't provide breakdown, we default to the old "Gap = Total - Findings" logic BUT
                // ONLY if the gap is massive.

                let gap = 0;
                if (legitimadoPorIA > 0) {
                    gap = numericTotalCopago - (legitimadoPorIA + sumFindings);
                } else {
                    // If AI was lazy and didn't fill legitimado, we can't assume everything is a Gap.
                    // We trust the AI's "hallazgos". If AI says "No findings", then Copay matches Contract.
                    // So Gap should be 0 unless we forced it.
                    // BUT, to catch "Ghost Codes", we can check if there are 00-00 codes that are NOT in findings.
                    // For now, let's be conservative: If no explicit legitimization, assume AI did its job.
                    // Only creating Gap finding if explicit "resumenFinanciero" indicates a mismatch.
                    gap = 0;
                    if (financialSummary.analisisGap && financialSummary.analisisGap.toLowerCase().includes('diferencia')) {
                        // Try to parse number from text or default to simple arithmetic
                        gap = numericTotalCopago - sumFindings; // Fallback to simple math only if AI admits a gap
                    }
                }

                // Threshold: $5000 CLP
                if (gap > 5000) {
                    log(`[AuditEngine] 🚨 GAP REAL DETECTADO: $${gap} (Total: $${numericTotalCopago} - Validado: $${legitimadoPorIA} - Hallazgos: $${sumFindings})`);

                    // 1. SCAN FOR ORPHANED ITEMS (The "Ghost Code Hunter")
                    const orphanedItems: any[] = [];
                    let remainingGap = gap;

                    if (pamJson && pamJson.folios) {
                        for (const folio of pamJson.folios) {
                            if (folio.desglosePorPrestador) {
                                for (const prestador of folio.desglosePorPrestador) {
                                    if (prestador.items) {
                                        for (const item of prestador.items) {
                                            const itemCopago = parseAmountCLP(item.copago);
                                            // Heuristic: If item has copay > 0 AND fits within the gap AND is likely a "Ghost Code" (00-00-000-00 or 99-XX)
                                            // We prioritize these as the culprits.
                                            if (itemCopago > 0 && itemCopago <= (remainingGap + 500)) {
                                                const isCode0 = item.codigo?.includes('00-00-000') || item.codigo?.startsWith('0') || item.codigo?.startsWith('99-');
                                                const description = (item.descripcion || '').toUpperCase();
                                                const isGeneric = description.includes('INSUMO') || description.includes('MATERIAL') || description.includes('VARIO');

                                                // Check if this item was already "caught" (approximate match by amount/code)
                                                const alreadyCaught = auditResult.hallazgos.some((h: any) =>
                                                    (h.montoObjetado === itemCopago) ||
                                                    (h.codigos && h.codigos.includes(item.codigo))
                                                );

                                                if (!alreadyCaught && (isCode0 || isGeneric)) {
                                                    orphanedItems.push(item);
                                                    remainingGap -= itemCopago;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 2. ASSIGN GAP TO ORPHANS (Traceability)
                    if (orphanedItems.length > 0) {
                        log(`[AuditEngine] 🕵️‍♂️ Ítems Huérfanos encontrados: ${orphanedItems.length} `);

                        orphanedItems.forEach(item => {
                            const monto = parseAmountCLP(item.copago);
                            auditResult.hallazgos.push({
                                codigos: item.codigo || "SIN-CODIGO",
                                glosa: item.descripcion || "ÍTEM SIN DESCRIPCION",
                                hallazgo: `
    ** I.Identificación del ítem cuestionado **
        Se cuestiona el cobro de ** $${monto.toLocaleString('es-CL')}** asociado a la prestación codificada como "${item.codigo}".

** II.Contexto clínico y administrativo **
    Este ítem aparece con copago positivo en el PAM pero no cuenta con bonificación adecuada ni código arancelario estándar(Código Fantasma / 0), generando una "fuga de cobertura" silenciosa.

** III.Norma contractual aplicable **
    Según Circular IF / N°176 y Art. 33 Ley 18.933, los errores de codificación o el uso de códigos internos(no homologados) por parte del prestador NO pueden traducirse en copagos para el afiliado.La Isapre debe cubrir la prestación al 100 % (Plan Pleno) asimilándola al código Fonasa más cercano(ej: Vía Venosa, Insumos de Pabellón).

** IV.Forma en que se materializa la controversia **
    Se configura un ** Error de Codificación Imputable al Prestador **.La clínica utilizó un código interno(99 - XX o 00-00) que la Isapre rechazó o bonificó parcialmente como "No Arancelado", cuando en realidad corresponde a insumos / procedimientos cubiertos.

** VI.Efecto económico concreto **
    El afiliado paga $${monto.toLocaleString('es-CL')} indebidamente por un error administrativo de catalogación.

** VII.Conclusión de la impugnación **
    Se solicita la re - liquidación total de este ítem bajo el principio de homologación y cobertura integral.

** VIII.Trazabilidad y Origen del Cobro **
    Anclaje exacto en PAM: Ítem "${item.descripcion}"(Copago: $${monto}).
                             `,
                                montoObjetado: monto,
                                tipo_monto: "COBRO_IMPROCEDENTE", // GAP: Orphan items are exigible
                                normaFundamento: "Circular IF/176 (Errores de Codificación) y Ley 18.933",
                                anclajeJson: `PAM_AUTO_DETECT: ${item.codigo} `
                            });
                            // DO NOT add to totalAhorroDetectado here - Safety Belt will calculate
                        });

                        // If there is still a residual gap, create a smaller generic finding
                        if (remainingGap > 5000) {
                            // ... (Add generic finding logic for remainingGap if needed, or ignore if small)
                            log(`[AuditEngine] ⚠️ Aún queda un gap residual de $${remainingGap} no asignable a ítems específicos.`);
                        }

                    } else {
                        // 3. FALLBACK TO GENERIC GAP (If no orphans found)
                        auditResult.hallazgos.push({
                            codigos: "GAP_RECONCILIATION",
                            glosa: "DIFERENCIA NO EXPLICADA (DÉFICIT DE COBERTURA)",
                            hallazgo: `
    ** I.Identificación del ítem cuestionado **
        Se detecta un monto residual de ** $${gap.toLocaleString('es-CL')}** que no fue cubierto por la Isapre y NO corresponde al copago contractual legítimo.

** II.Contexto clínico y administrativo **
    Diferencia aritmética entre Copago Total y la suma de(Copago Legítimo + Hallazgos).

** III.Norma contractual aplicable **
    El plan(cobertura preferente) no debería generar copagos residuales salvo Topes Contractuales alcanzados o Exclusiones legítimas.

** IV.Forma en que se materializa la controversia **
    Existe un ** Déficit de Cobertura Global **.Si este monto de $${gap.toLocaleString('es-CL')} corresponde a prestaciones no aranceladas, debe ser acreditado.De lo contrario, se presume cobro en exceso por falta de bonificación integral.

** VI.Efecto económico concreto **
    Costo adicional de $${gap.toLocaleString('es-CL')} sin justificación contractual.

** VII.Conclusión de la impugnación **
    Se objeta este remanente por falta de transparencia.

** VIII.Trazabilidad y Origen del Cobro **
| Concepto | Monto |
| : --- | : --- |
| Copago Total PAM | $${numericTotalCopago.toLocaleString('es-CL')} |
| (-) Copago Legítimo(Contrato) | -$${legitimadoPorIA.toLocaleString('es-CL')} |
| (-) Suma Hallazgos | -$${sumFindings.toLocaleString('es-CL')} |
| **= GAP(DIFERENCIA) ** | ** $${gap.toLocaleString('es-CL')}** |
    `,
                            montoObjetado: gap,
                            tipo_monto: "COBRO_IMPROCEDENTE", // GAP: Generic coverage deficit is exigible
                            normaFundamento: "Principio de Cobertura Integral y Transparencia (Ley 20.584)",
                            anclajeJson: "CÁLCULO_AUTOMÁTICO_SISTEMA"
                        });
                        // DO NOT add to totalAhorroDetectado here - Safety Belt will calculate
                        log('[AuditEngine] ✅ GAP GENÉRICO inyectado (no se encontraron ítems huérfanos específicos).');
                    }
                }
            } // End of else block for !INDETERMINADO
        } catch (gapError: any) {
            const errMsg = gapError?.message || String(gapError);
            log(`[AuditEngine] ⚠️ Error en cálculo de Gap: ${errMsg} `);
        }
        log('[AuditEngine] ✅ Auditoría forense completada.');

        return {
            data: auditResult,
            usage: usage ? {
                promptTokens: usage.promptTokenCount,
                candidatesTokens: usage.candidatesTokenCount,
                totalTokens: usage.totalTokenCount
            } : null
        };
    } catch (error: any) {
        log(`[AuditEngine] ❌ Error en el proceso de auditoría: ${error.message} `);
        throw error;
    }
}

// ============================================================================
// HELPER: Subset-Sum for Nutrition (Alimentación) Reconciliation
// ============================================================================
function reconcileNutritionCharges(cuenta: any, pam: any): any {
    // 1. Identify Target Amount (Code 3101306 or PRESTACIONES SIN BONIFICACIÓN)
    let targetAmount = 0;
    let pamItemName = "";

    if (pam && pam.folios) {
        for (const folio of pam.folios) {
            if (folio.desglosePorPrestador) {
                for (const prestador of folio.desglosePorPrestador) {
                    if (prestador.items) {
                        for (const item of prestador.items) {
                            const code = (item.codigo || "").toString();
                            const desc = (item.descripcion || "").toUpperCase();
                            const bonif = parseAmountCLP(item.bonificacion);

                            // Criteria: Code 3101306 OR (Bonif=0 AND Desc includes 'SIN BONI')
                            if (code.includes("3101306") || (bonif === 0 && desc.includes("SIN BONIFI"))) {
                                targetAmount = parseAmountCLP(item.copago) || parseAmountCLP(item.valorTotal);
                                pamItemName = item.descripcion || "3101306 PRESTACIONES SIN BONIFICACION";
                                break;
                            }
                        }
                    }
                    if (targetAmount > 0) break;
                }
            }
            if (targetAmount > 0) break;
        }
    }

    if (targetAmount === 0) return null; // No nutrition charge found in PAM

    // 2. Identify Candidates in Account (Greedy Filter)
    const candidates: any[] = [];
    const NUTRITION_KEYWORDS = ["ALMUERZO", "CENA", "DESAYUNO", "REGIMEN", "BANDEJA", "COLACTI", "COLACION", "LIQUIDO", "ONCE", "TRAMO"];

    // Also include "PRUEBA COMPATIBILIDAD" only if explicitly requested, but usually that's false positive.
    // User logic: "Agrupar candidatos por familia hotelería/alimentación"

    if (cuenta && cuenta.sections) {
        cuenta.sections.forEach((sec: any) => {
            (sec.items ?? []).forEach((item: any) => {
                const desc = (item.description || "").toUpperCase();
                // Filter by keyword
                if (NUTRITION_KEYWORDS.some(k => desc.includes(k))) {
                    candidates.push({
                        description: item.description,
                        total: parseAmountCLP(item.total),
                        original: item
                    });
                }
            });
        });
    }

    // 3. Subset Sum (Backtracking - Simplified for reasonable N)
    // We want to find a subset of 'candidates' that sums exactly to 'targetAmount'
    // Tolerance: Let's allow strictly 0 or very small (e.g. $1) to be "Exact"

    function findSubset(target: number, items: any[]): any[] | null {
        // Optimize: Sort items descending
        items.sort((a, b) => b.total - a.total);

        const result: any[] = [];
        function backtrack(remaining: number, start: number): boolean {
            if (Math.abs(remaining) < 2) return true; // Found (approx 0)
            if (remaining < 0) return false;

            for (let i = start; i < items.length; i++) {
                result.push(items[i]);
                if (backtrack(remaining - items[i].total, i + 1)) return true;
                result.pop();
            }
            return false;
        }

        if (backtrack(target, 0)) return result;
        return null;
    }

    const matchedSubset = findSubset(targetAmount, candidates);

    return {
        targetFound: true,
        targetAmount,
        pamItemName,
        matchFound: matchedSubset !== null,
        items: matchedSubset || []
    };
}

function traceGenericChargesTopK(cuenta: any, pam: any): string {
    const traceResults: string[] = [];

    // 1. Identify "Generic/Adjustments" in Account
    // Strategy: Look for specific codes or keywords in Description (Regex Robustness)
    const adjustments: any[] = [];
    const REGEX_GENERIC = /(ajuste|vario|diferencia|suministro|cargo admin|otros|insumos)/i;
    const REGEX_CODES = /^(14|02|99)\d+/;

    const sections = cuenta.sections ?? [];
    if (sections.length === 0) {
        return "No se detectaron secciones en cuenta para trazar (Cuenta vacía o no estructurada).";
    }

    sections.forEach((sec: any) => {
        (sec.items ?? []).forEach((item: any) => {
            const desc = (item.description || "").toUpperCase();
            const code = (item.code || "").toString();

            const isKeyword = REGEX_GENERIC.test(desc);
            const isInternalCode = REGEX_CODES.test(code);
            const isSectionGeneric = /(varios|ajustes|exento|diferencias)/i.test(sec.category || "");

            const itemTotal = parseAmountCLP(item.total);
            const MIN_TRACE_AMOUNT = 1000;

            if ((isKeyword || isInternalCode || isSectionGeneric) && itemTotal >= MIN_TRACE_AMOUNT) {
                adjustments.push({ ...item, total: itemTotal });
            }
        });
    });

    if (adjustments.length === 0) return "No se detectaron cargos genéricos relevantes para trazar (Clean Bill).";

    // 2. Identify Candidates in PAM (Bonified Items)
    // We look for any PAM item that might explain the adjustment.
    const pamItems: any[] = [];
    pam.folios?.forEach((f: any) => {
        f.desglosePorPrestador?.forEach((d: any) => {
            d.items?.forEach((i: any) => {
                pamItems.push({
                    ...i,
                    amount: parseAmountCLP(i.bonificacion)
                });
            });
        });
    });

    // 3. Top-K Matching Logic
    adjustments.forEach(adj => {
        const target = adj.total;
        let matchFound = false;

        // A. Direct Match (Target == PAM_Item ± Tolerance)
        const directMatch = pamItems.find(p => Math.abs(p.amount - target) <= 1000);
        if (directMatch) {
            traceResults.push(`- AJUSTE '${adj.description}'($${target}) COINCIDE con ítem PAM '${directMatch.descripcion}'($${directMatch.amount}).ESTATUS: TRACEADO(No oculto).`);
            matchFound = true;
        }

        // B. Component Sum (Target == Sum(Subset of PAM) ± Tolerance)
        // Heuristic: Try to sum top 5 largest PAM items that are smaller than target
        if (!matchFound) {
            // Simple greedy approach for demo (User asked for Top-K or pragmatism)
            // Real subset sum is hard, let's check if it matches the sum of a specific group?
            // Or check if the adjustment equals TotalBonification of a Folio?
            // That's a common pattern: Adjustment = Total Bonified of Folio X.

            // Check against Folio Totals
            const folioMatch = pam.folios?.find((f: any) => {
                // Calculate folio total bonification
                let totalB = 0;
                f.desglosePorPrestador?.forEach((d: any) => d.items?.forEach((i: any) => {
                    totalB += parseAmountCLP(i.bonificacion) || 0;
                }));
                return Math.abs(totalB - target) <= 2000;
            });

            if (folioMatch) {
                traceResults.push(`- AJUSTE '${adj.description}'($${target}) COINCIDE con Bonificación Total del Folio ${folioMatch.folioPAM}.ESTATUS: TRACEADO(Agrupado).`);
                matchFound = true;
            }
        }

        if (!matchFound) {
            traceResults.push(`- AJUSTE '${adj.description}'($${target}) NO TIENE CORRELACIÓN aritmética evidente en PAM.ESTATUS: NO_TRAZABLE(requiere aclaración: ¿fuera del PAM o absorbido en agrupadores ?).`);
        }
    });

    return traceResults.join('\n');
}

// ============================================================================
// HELPER: Post-Validate LLM Response (The "Safety Belt")
// ============================================================================
// ============================================================================
// HELPER: Post-Validate LLM Response (The "Safety Belt" - Cross-Validation v9)
// ============================================================================
function postValidateLlmResponse(resultRaw: any, eventos: any[], cuentaContext: any, pamContext: any): any {
    const validatedResult = { ...resultRaw };
    let hasStructuralOpacity = false;


    // 1. Table VIII Enforcement & Hallmark Check (Cross-Validation v9)
    if (validatedResult.hallazgos) {
        validatedResult.hallazgos = validatedResult.hallazgos.filter((h: any) => {
            // Skip logic for "ACEPTAR" findings
            const isImpugnar = h.hallazgo?.toUpperCase().includes("IMPUGNAR") || (h.montoObjetado || 0) > 0;

            if (isImpugnar) {
                // Check for Table VIII presence (Strict)
                const hasTableCheck = h.hallazgo?.includes("|") && h.hallazgo?.includes("---");

                // CRITICAL BLOQUEO v9: Si es genérico/opacidad Y no tiene tabla de traza -> BLOQUEAR (ELIMINAR)
                const isGenericOrOpacidad = h.categoria === "OPACIDAD" || /GENERICO|GEN[EÉ]RICO|AGRUPADOR/i.test(h.glosa || "");

                if (isGenericOrOpacidad && !hasTableCheck) {
                    console.log(`[Cross - Validation v9] 🛡️ DEGRADANDO hallazgo: ${h.titulo} (Falta Tabla VIII)`);
                    h.recomendacion_accion = "SOLICITAR_ACLARACION";
                    h.nivel_confianza = "BAJA";
                    h.motivo_degradacion = "SIN_TRAZABILIDAD";
                    h.tipo_monto = "COPAGO_OPACO";
                    // Keep the finding but mark it as degraded
                }

                // Check for "Hallucinated" High Value Objections
                // If finding > $1M and no specific code provided -> BLOCK
                if ((h.montoObjetado || 0) > 1000000 && (!h.codigos || h.codigos === "SIN-CODIGO")) {
                    console.log(`[Cross - Validation v9] 🛡️ BLOQUEADO hallazgo de alto valor sin código: ${h.titulo} `);
                    return false;
                }
            }

            // DETECTOR DE OPACIDAD ESTRUCTURAL
            // Si el hallazgo es de Opacidad o Materiales/Medicamentos con mención de falta de desglose
            const isOpacidad = h.categoria === "OPACIDAD" ||
                (h.glosa && /MATERIAL|INSUMO|MEDICAMENTO|FARMACO|VARIOS/i.test(h.glosa) && /DESGLOSE|OPACIDAD/i.test(h.hallazgo || ""));

            if (isOpacidad) {
                hasStructuralOpacity = true;
            }

            return true;
        });
    }

    // --- ARQUITECTURA DE DECISIÓN: RECALCULO DE TOTALES (Anti-Sumas Fantasmas) ---
    if (validatedResult.hallazgos) {
        let sumA = 0; // COBRO_IMPROCEDENTE
        let sumB = 0; // COPAGO_OPACO

        validatedResult.hallazgos.forEach((h: any) => {
            const monto = Number(h.montoObjetado || 0);

            // Use deterministic classifier
            const category = classifyFinding(h);

            // 🚨 NUCLEAR RULE: If OPACIDAD exists, GAP cannot be ahorro (it's indeterminate)
            const isGapInOpacityContext = hasStructuralOpacity &&
                (h.codigos === "GAP_RECONCILIATION" || h.anclajeJson?.includes("PAM_AUTO_DETECT"));

            if (category === "B" || isGapInOpacityContext) {
                h.tipo_monto = "COPAGO_OPACO";
                // Action Rule for Cat B
                if (h.recomendacion_accion !== "SOLICITAR_ACLARACION") {
                    h.recomendacion_accion = "SOLICITAR_ACLARACION";
                }
                sumB += monto;
            } else {
                h.tipo_monto = "COBRO_IMPROCEDENTE";
                // Action Rule for Cat A
                if (h.nivel_confianza !== "BAJA") {
                    h.recomendacion_accion = "IMPUGNAR";
                }
                sumA += monto;
            }
        });

        if (!validatedResult.resumenFinanciero) validatedResult.resumenFinanciero = {};

        validatedResult.resumenFinanciero.cobros_improcedentes_exigibles = sumA;
        validatedResult.resumenFinanciero.copagos_bajo_controversia = sumB;
        validatedResult.resumenFinanciero.ahorro_confirmado = sumA; // SOLO CAT A
        validatedResult.resumenFinanciero.totalCopagoObjetado = sumA + sumB;
    }


    // --- NUTRITION RECONCILIATION (ALIMENTACIÓN CHECK) ---
    // Runs before final output to verify 3101306 findings
    try {
        if (cuentaContext && pamContext) {
            const nutritionCheck = reconcileNutritionCharges(cuentaContext, pamContext);

            if (nutritionCheck && nutritionCheck.targetFound) {
                // Check if there is an existing "Alimentación" finding
                const nutriFindingIndex = validatedResult.hallazgos.findIndex((h: any) =>
                    (h.codigos && h.codigos.includes("3101306")) ||
                    (h.glosa && /ALIMENTA|NUTRICI/i.test(h.glosa))
                );

                if (nutritionCheck.matchFound) {
                    // EXACT MATCH: Confirm or Inject Finding
                    console.log(`[AuditEngine] 🍎 ALIMENTACION: Match Exacto ($${nutritionCheck.targetAmount}). items: ${nutritionCheck.items.length}`);

                    // If finding exists, confirm it. If not, create it.
                    const findingPayload = {
                        codigos: "3101306",
                        titulo: "UNBUNDLING EN ALIMENTACIÓN – COBRO IMPROCEDENTE",
                        glosa: "PRESTACIONES SIN BONIFICACIÓN (ALIMENTACION)",
                        hallazgo: `**I. Identificación del ítem**
PRESTACIONES SIN BONIFICACIÓN (GC 3101306 / ALIMENTACIÓN)
Copago: **$${nutritionCheck.targetAmount.toLocaleString('es-CL')}**

**II. Contexto**
El paciente se encontraba hospitalizado. El concepto Día Cama, ya cobrado y bonificado, incluye por definición técnica y contractual la alimentación básica del paciente.

**III. Análisis**
El cobro separado de alimentación constituye una desagregación improcedente (unbundling) de una prestación integral ya arancelada. Se ha verificado matemáticamente que el monto cobrado corresponde exactamente a la suma de los siguientes ítems de alimentación en la cuenta:
${nutritionCheck.items.map((i: any) => `- ${i.description}: $${i.total.toLocaleString('es-CL')}`).join('\n')}

**IV. Conclusión**
El monto de **$${nutritionCheck.targetAmount.toLocaleString('es-CL')}** debe ser impugnado como cobro improcedente, por duplicar un componente inherente al Día Cama.`,
                        montoObjetado: nutritionCheck.targetAmount,
                        tipo_monto: "COBRO_IMPROCEDENTE",
                        recomendacion_accion: "IMPUGNAR",
                        nivel_confianza: "ALTA",
                        normaFundamento: "Circular IF/319 (Cobertura Integral dia cama) y Definición Arancelaria Día Cama",
                        anclajeJson: "MATCH_EXACTO_SUBSET_SUM"
                    };

                    if (nutriFindingIndex >= 0) {
                        // Update existing
                        validatedResult.hallazgos[nutriFindingIndex] = { ...validatedResult.hallazgos[nutriFindingIndex], ...findingPayload };
                    } else {
                        // Inject new
                        validatedResult.hallazgos.push(findingPayload);
                    }

                } else {
                    // NO MATCH: Downgrade logic
                    console.log(`[AuditEngine] 🍎 ALIMENTACION: NO cuadra (Target $${nutritionCheck.targetAmount}). Downgrading...`);

                    if (nutriFindingIndex >= 0) {
                        const h = validatedResult.hallazgos[nutriFindingIndex];
                        h.tipo_monto = "COPAGO_OPACO";
                        h.recomendacion_accion = "SOLICITAR_ACLARACION";
                        h.nivel_confianza = "MEDIA";
                        h.hallazgo = `** Indeterminación de Trazabilidad **\nSi bien existe el cargo '${nutritionCheck.pamItemName}' ($${nutritionCheck.targetAmount}) en el PAM, la suma de los ítems de alimentación en la cuenta NO CALZA con este monto.\n\nSe requiere desglose exacto para confirmar si corresponde a alimentación del paciente (duplicidad) o a otro concepto.`;
                        h.estado_juridico = "EN_CONTROVERSIA";
                    }
                    // If no finding existed, we do nothing (we don't create false alarms for stuff not found)
                }
            }
        }
    } catch (e) {
        console.log(`[AuditEngine] ⚠️ Error en reconciliación nutricional: ${e}`);
    }


    // --- CANONICAL OPACITY OVERRIDE (HARD RULE) ---
    if (hasStructuralOpacity) {
        console.log('[AuditEngine] 🛡️ DETECTADA OPACIDAD ESTRUCTURAL. Aplicando Regla Canónica de Indeterminación.');

        // 🚨 INJECT FIXED HALLAZGO: Canonical "OPACIDAD_ESTRUCTURAL"
        validatedResult.hallazgos = validatedResult.hallazgos ?? [];
        const existsOpacidadHallazgo = validatedResult.hallazgos.some((h: any) => h.codigos === "OPACIDAD_ESTRUCTURAL");
        if (!existsOpacidadHallazgo) {
            const montoOpaco = validatedResult.resumenFinanciero?.copagos_bajo_controversia || 0;
            validatedResult.hallazgos.unshift({
                codigos: "OPACIDAD_ESTRUCTURAL",
                titulo: "OPACIDAD EN DOCUMENTO DE COBRO (PAM) – COPAGO NO VERIFICABLE",
                glosa: "MATERIALES/MEDICAMENTOS SIN APERTURA",
                categoria: "OPACIDAD",
                tipo_monto: "COPAGO_OPACO",
                montoObjetado: montoOpaco,
                recomendacion_accion: "SOLICITAR_ACLARACION",
                nivel_confianza: "ALTA",
                hallazgo: `**I. Identificación del problema**
En el PAM del evento quirúrgico se presentan las siguientes líneas consolidadas, sin apertura de componentes:

- MATERIALES CLÍNICOS QUIRÚRGICOS (GC 3101304)
- MEDICAMENTOS HOSPITALIZADOS (GC 3101302)

Total copago asociado a líneas no desglosadas: **$${montoOpaco.toLocaleString('es-CL')}**.

**II. Contexto clínico y administrativo**
El evento corresponde a una hospitalización quirúrgica de alta complejidad. Si bien la cuenta clínica interna del prestador contiene múltiples ítems detallados, el documento de cobro y liquidación (PAM) —que es el instrumento que determina el copago exigido al afiliado— agrupa dichos conceptos en glosas genéricas, impidiendo su auditoría directa.

**III. Norma aplicable**
- **Ley 20.584**, derecho del paciente a recibir información clara, comprensible y detallada sobre las prestaciones y sus cobros.
- Principios de transparencia y trazabilidad exigidos por la Superintendencia de Salud en procesos de liquidación.

**IV. Forma en que se configura la controversia**
La ausencia de desglose en el PAM impide verificar, desde el propio documento de pago:
1. La correcta aplicación de topes contractuales.
2. La exclusión de ítems no clínicos (hotelería, confort).
3. La no duplicidad con prestaciones integrales ya bonificadas (día cama, derecho de pabellón).

**V. Análisis técnico-contractual**
Desde un punto de vista de auditoría, el copago asociado a estas líneas no es verificable en el PAM, por lo que no puede considerarse plenamente exigible mientras no se entregue un desglose verificable y trazable en el documento de liquidación o en un anexo formal validado por la aseguradora.

**VI. Efecto económico**
El afiliado asume un copago de **$${montoOpaco.toLocaleString('es-CL')}** cuya composición no puede ser auditada desde el PAM.

**VII. Conclusión**
Se solicita aclaración formal y reliquidación, mediante entrega de desglose completo de materiales y medicamentos en el PAM o documento equivalente, que permita validar cobertura, exclusiones y topes contractuales.`,
                anclajeJson: "PAM/CUENTA: LINEAS AGRUPADAS",
                estado_juridico: "EN_CONTROVERSIA"
            });
            console.log(`[AuditEngine] 🔧 Hallazgo canónico "OPACIDAD_ESTRUCTURAL" inyectado(${montoOpaco} CLP).`);
        }

        // 1. Force Global Status
        if (!validatedResult.decisionGlobal) validatedResult.decisionGlobal = {};
        validatedResult.decisionGlobal.estado = "COPAGO_INDETERMINADO_POR_OPACIDAD";
        validatedResult.decisionGlobal.fundamento = "La auditoría no puede validar el copago debido a una opacidad estructural en ítems genéricos (Materiales/Medicamentos) sin desglose que vulnera la Ley 20.584.";

        // 2. Force Financial Summary
        if (!validatedResult.resumenFinanciero) validatedResult.resumenFinanciero = {};
        validatedResult.resumenFinanciero.estado_copago = "INDETERMINADO_POR_OPACIDAD";
        validatedResult.resumenFinanciero.totalCopagoLegitimo = 0; // Cannot act as legitimizer
        validatedResult.resumenFinanciero.analisisGap = "No aplicable por indeterminación del copago.";

        // 3. Mark findings as controversial
        if (validatedResult.hallazgos) {
            validatedResult.hallazgos.forEach((h: any) => {
                if (h.tipo_monto === 'COPAGO_OPACO') {
                    h.estado_juridico = "EN_CONTROVERSIA";
                }
            });
        }
    }

    // Ensure totalAhorroDetectado for UI compatibility matches ahorro_confirmado
    validatedResult.totalAhorroDetectado = validatedResult.resumenFinanciero?.ahorro_confirmado || 0;

    return validatedResult;
}
