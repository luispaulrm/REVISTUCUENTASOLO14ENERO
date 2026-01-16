import { GoogleGenerativeAI } from "@google/generative-ai";
import { AUDIT_PROMPT, FORENSIC_AUDIT_SCHEMA } from '../config/audit.prompts.js';
import { AI_CONFIG, GENERATION_CONFIG } from '../config/ai.config.js';
import {
    extractCaseKeywords,
    getRelevantKnowledge,
    loadHoteleriaRules,
    getKnowledgeFilterInfo
} from './knowledgeFilter.service.js';

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
    // AUDIT-SPECIFIC: Gemini 3 Flash primary, 2.5 Flash fallback
    const modelsToTry = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
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
    log(`[AuditEngine] ℹ️ ${getKnowledgeFilterInfo()}`);

    // Paso 1: Extraer keywords del caso (cuenta, PAM, contrato)
    const caseKeywords = extractCaseKeywords(cuentaJson, pamJson, contratoJson, htmlContext);
    log(`[AuditEngine] 🔑 Keywords extraídas: ${caseKeywords.length} términos`);
    log(`[AuditEngine] 🔑 Muestra: ${caseKeywords.slice(0, 8).join(', ')}...`);

    // Paso 2: Filtrar y cargar solo conocimiento relevante (máx 30K tokens)
    const MAX_KNOWLEDGE_TOKENS = 50000;  // Aumentado para garantizar carga de jurisprudencia
    const { text: knowledgeBaseText, sources, tokenEstimate, keywordsMatched } =
        await getRelevantKnowledge(caseKeywords, MAX_KNOWLEDGE_TOKENS, log);

    log(`[AuditEngine] 📊 Conocimiento inyectado: ${sources.length} fuentes (~${tokenEstimate} tokens)`);
    log(`[AuditEngine] 📚 Fuentes: ${sources.join(' | ')}`);
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
                description: item.description,
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

    // 4. Minify JSONs (remove whitespace) - saves ~20% tokens
    let finalCuentaContext = JSON.stringify(cleanedCuenta);
    let finalPamContext = JSON.stringify(cleanedPam);
    let finalContratoContext = JSON.stringify(cleanedContrato);

    // SMARTEST: If we have raw OCR texts, use them if JSON is empty
    if (htmlContext && htmlContext.includes('--- ORIGEN:')) {
        log('[AuditEngine] 💎 Detectado Contexto Triple Crudo (Módulo 8). Optimizando prompt para Contexto Largo.');
    }

    const prompt = AUDIT_PROMPT
        .replace('{jurisprudencia_text}', '')
        .replace('{normas_administrativas_text}', '')
        .replace('{evento_unico_jurisprudencia_text}', '')
        .replace('{knowledge_base_text}', knowledgeBaseText)
        .replace('{hoteleria_json}', hoteleriaRules || '')
        .replace('{cuenta_json}', finalCuentaContext)
        .replace('{pam_json}', finalPamContext)
        .replace('{contrato_json}', finalContratoContext)
        .replace('{html_context}', htmlContext || 'No HTML context provided.');

    // Log prompt size for debugging
    const promptSize = prompt.length;
    const promptSizeKB = (promptSize / 1024).toFixed(2);
    log(`[AuditEngine] 📏 Tamaño del prompt: ${promptSizeKB} KB (${promptSize} caracteres)`);
    // -----------------------------------------------------

    for (const modelName of modelsToTry) {
        if (!modelName) continue;

        try {
            log(`[AuditEngine] 🛡️ Strategy: Intentando con modelo ${modelName}...`);
            const genAI = new GoogleGenerativeAI(apiKey);
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

            log('[AuditEngine] 📡 Enviando consulta a Gemini (Streaming)...');
            onProgressUpdate?.(40);

            // Use streaming for real-time feedback
            const timeoutMs = 120000; // 120 seconds for audit (larger prompt)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Timeout: La API no respondió en ${timeoutMs / 1000} segundos`)), timeoutMs);
            });

            const streamResult = await Promise.race([
                model.generateContentStream(prompt),
                timeoutPromise
            ]) as any;

            // Accumulate the full response from stream
            let fullText = '';
            let usage: any = null;

            log('[AuditEngine] 📥 Recibiendo respuesta en tiempo real...');
            for await (const chunk of streamResult.stream) {
                const chunkText = chunk.text();
                fullText += chunkText;

                // Update usage metadata if available
                if (chunk.usageMetadata) {
                    usage = chunk.usageMetadata;
                    onUsageUpdate?.(usage); // EMIT USAGE REAL-TIME
                }

                // Log progress every 500 characters
                if (fullText.length % 500 < chunkText.length) {
                    const kbReceived = Math.floor(fullText.length / 1024);
                    log(`[AuditEngine] 📊 Procesando... ${kbReceived}KB recibidos`);

                    // Dynamic progress calculation (40% to 90%)
                    const simulatedProgress = Math.min(90, 40 + (fullText.length / ESTIMATED_TOTAL_TOKENS) * 50);
                    onProgressUpdate?.(simulatedProgress);
                }
            }

            // Create result object compatible with existing code
            result = {
                response: {
                    text: () => fullText,
                    usageMetadata: usage
                }
            };

            log(`[AuditEngine] ✅ Éxito con modelo ${modelName} (${fullText.length} caracteres)`);
            break;

        } catch (error: any) {
            lastError = error;
            const errStr = (error?.toString() || "") + (error?.message || "");
            const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || error?.status === 429 || error?.status === 503;
            const isTimeout = errStr.includes('Timeout');

            if (isTimeout) {
                log(`[AuditEngine] ⏱️ Timeout en ${modelName}. El modelo no respondió a tiempo.`);
                log(`[AuditEngine] 💡 Sugerencia: El prompt puede ser demasiado grande (${promptSizeKB} KB).`);
                throw error; // Don't retry on timeout, it's likely a prompt size issue
            } else if (isQuota) {
                log(`[AuditEngine] ⚠️ Fallo en ${modelName} por Quota/Server (${error.message}). Probando siguiente...`);
                continue;
            } else {
                log(`[AuditEngine] ❌ Error no recuperable en ${modelName}: ${error.message}`);
                throw error; // Si no es quota, fallamos inmediatamente
            }
        }
    }

    if (!result) {
        log(`[AuditEngine] ❌ Todos los modelos fallaron.`);
        throw lastError || new Error("Forensic Audit failed on all models.");
    }

    // --- ROBUST JSON PARSING ---
    try {
        let responseText = result.response.text();

        // 1. Remove Markdown fences
        responseText = responseText.replace(/```json\n?|```/g, '').trim();

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
                log(`[AuditEngine] ❌ Reparación falló. Devolviendo raw text para depuración.`);
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

        // --- POST-PROCESSING: DETERMINISTIC GAP RECONCILIATION ---
        try {
            const pamTotalCopago = pamJson?.global?.totalCopagoDeclarado || pamJson?.resumenTotal?.totalCopago || 0;

            const parseAmount = (val: any) => {
                if (typeof val === 'number') return val;
                if (typeof val === 'string') return parseInt(val.replace(/[^0-9-]/g, ''), 10) || 0;
                return 0;
            };

            const numericTotalCopago = parseAmount(pamTotalCopago);
            const sumFindings = auditResult.hallazgos.reduce((sum: number, h: any) => sum + (h.montoObjetado || 0), 0);

            // NEW LOGIC: Use AI's financial summary if available to deduce Legitimate Copay
            const financialSummary = auditResult.resumenFinanciero || {};
            const legitimadoPorIA = parseAmount(financialSummary.totalCopagoLegitimo || 0);

            // True Gap = TotalCopago - (Legitimate + Objected)
            // If AI says $1.4M is legitimate (30% copay) and $395k is objected, and Total is $1.8M
            // Gap = 1.8M - (1.4M + 0.395M) = ~0.

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
                                        const itemCopago = parseAmount(item.copago);
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
                    log(`[AuditEngine] 🕵️‍♂️ Ítems Huérfanos encontrados: ${orphanedItems.length}`);

                    orphanedItems.forEach(item => {
                        const monto = parseAmount(item.copago);
                        auditResult.hallazgos.push({
                            codigos: item.codigo || "SIN-CODIGO",
                            glosa: item.descripcion || "ÍTEM SIN DESCRIPCION",
                            hallazgo: `
**I. Identificación del ítem cuestionado**
Se cuestiona el cobro de **$${monto.toLocaleString('es-CL')}** asociado a la prestación codificada como "${item.codigo}".

**II. Contexto clínico y administrativo**
Este ítem aparece con copago positivo en el PAM pero no cuenta con bonificación adecuada ni código arancelario estándar (Código Fantasma/0), generando una "fuga de cobertura" silenciosa.

**III. Norma contractual aplicable**
Según Circular IF/N°176 y Art. 33 Ley 18.933, los errores de codificación o el uso de códigos internos (no homologados) por parte del prestador NO pueden traducirse en copagos para el afiliado. La Isapre debe cubrir la prestación al 100% (Plan Pleno) asimilándola al código Fonasa más cercano (ej: Vía Venosa, Insumos de Pabellón).

**IV. Forma en que se materializa la controversia**
Se configura un **Error de Codificación Imputable al Prestador**. La clínica utilizó un código interno (99-XX o 00-00) que la Isapre rechazó o bonificó parcialmente como "No Arancelado", cuando en realidad corresponde a insumos/procedimientos cubiertos.

**VI. Efecto económico concreto**
El afiliado paga $${monto.toLocaleString('es-CL')} indebidamente por un error administrativo de catalogación.

**VII. Conclusión de la impugnación**
Se solicita la re-liquidación total de este ítem bajo el principio de homologación y cobertura integral.

**VIII. Trazabilidad y Origen del Cobro**
Anclaje exacto en PAM: Ítem "${item.descripcion}" (Copago: $${monto}).
                             `,
                            montoObjetado: monto,
                            normaFundamento: "Circular IF/176 (Errores de Codificación) y Ley 18.933",
                            anclajeJson: `PAM_AUTO_DETECT: ${item.codigo}`
                        });
                        auditResult.totalAhorroDetectado = (auditResult.totalAhorroDetectado || 0) + monto;
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
**I. Identificación del ítem cuestionado**
Se detecta un monto residual de **$${gap.toLocaleString('es-CL')}** que no fue cubierto por la Isapre y NO corresponde al copago contractual legítimo.

**II. Contexto clínico y administrativo**
Diferencia aritmética entre Copago Total y la suma de (Copago Legítimo + Hallazgos).

**III. Norma contractual aplicable**
El plan (cobertura preferente) no debería generar copagos residuales salvo Topes Contractuales alcanzados o Exclusiones legítimas.

**IV. Forma en que se materializa la controversia**
Existe un **Déficit de Cobertura Global**. Si este monto de $${gap.toLocaleString('es-CL')} corresponde a prestaciones no aranceladas, debe ser acreditado. De lo contrario, se presume cobro en exceso por falta de bonificación integral.

**VI. Efecto económico concreto**
Costo adicional de $${gap.toLocaleString('es-CL')} sin justificación contractual.

**VII. Conclusión de la impugnación**
Se objeta este remanente por falta de transparencia.

**VIII. Trazabilidad y Origen del Cobro**
| Concepto | Monto |
| :--- | :--- |
| Copago Total PAM | $${numericTotalCopago.toLocaleString('es-CL')} |
| (-) Copago Legítimo (Contrato) | -$${legitimadoPorIA.toLocaleString('es-CL')} |
| (-) Suma Hallazgos | -$${sumFindings.toLocaleString('es-CL')} |
| **= GAP (DIFERENCIA)** | **$${gap.toLocaleString('es-CL')}** |
                        `,
                        montoObjetado: gap,
                        normaFundamento: "Principio de Cobertura Integral y Transparencia (Ley 20.584)",
                        anclajeJson: "CÁLCULO_AUTOMÁTICO_SISTEMA"
                    });
                    auditResult.totalAhorroDetectado = (auditResult.totalAhorroDetectado || 0) + gap;
                    log('[AuditEngine] ✅ GAP GENÉRICO inyectado (no se encontraron ítems huérfanos específicos).');
                }
            }
        } catch (gapError: any) {
            const errMsg = gapError?.message || String(gapError);
            log(`[AuditEngine] ⚠️ Error en cálculo de Gap: ${errMsg}`);
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
        log(`[AuditEngine] ❌ Error en el proceso de auditoría: ${error.message}`);
        throw error;
    }
}
