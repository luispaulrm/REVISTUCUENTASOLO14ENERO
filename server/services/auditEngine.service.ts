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
    htmlContext: string = ''
) {
    // AUDIT-SPECIFIC: Gemini 3 Flash primary, 2.5 Flash fallback
    const modelsToTry = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
    let result;
    let lastError;

    // =========================================================================
    // MINI-RAG: BIBLIOTECARIO INTELIGENTE
    // Carga dinámica de conocimiento legal relevante para este caso específico
    // =========================================================================
    log('[AuditEngine] 📚 Activando Bibliotecario Inteligente (Mini-RAG)...');
    log(`[AuditEngine] ℹ️ ${getKnowledgeFilterInfo()}`);

    // Paso 1: Extraer keywords del caso (cuenta, PAM, contrato)
    const caseKeywords = extractCaseKeywords(cuentaJson, pamJson, contratoJson);
    log(`[AuditEngine] 🔑 Keywords extraídas: ${caseKeywords.length} términos`);
    log(`[AuditEngine] 🔑 Muestra: ${caseKeywords.slice(0, 8).join(', ')}...`);

    // Paso 2: Filtrar y cargar solo conocimiento relevante (máx 30K tokens)
    const MAX_KNOWLEDGE_TOKENS = 50000;  // Aumentado para garantizar carga de jurisprudencia
    const { text: knowledgeBaseText, sources, tokenEstimate, keywordsMatched } =
        await getRelevantKnowledge(caseKeywords, MAX_KNOWLEDGE_TOKENS, log);

    log(`[AuditEngine] 📊 Conocimiento inyectado: ${sources.length} fuentes (~${tokenEstimate} tokens)`);
    log(`[AuditEngine] 📚 Fuentes: ${sources.join(' | ')}`);

    // Paso 3: Cargar reglas de hotelería (siempre, es pequeño)
    const hoteleriaRules = await loadHoteleriaRules();
    if (hoteleriaRules) {
        log('[AuditEngine] 🏨 Cargadas reglas de hotelería (IF-319)');
    }

    log('[AuditEngine] 🧠 Sincronizando datos y analizando hallazgos con Super-Contexto...');

    // ============================================================================
    // TOKEN OPTIMIZATION: Reduce input costs by 30-40%
    // ============================================================================

    // 1. Clean Cuenta JSON - Remove non-essential fields (Handle empty cuenta)
    const hasStructuredCuenta = cuentaJson && Object.keys(cuentaJson).length > 0 && (cuentaJson.sections || cuentaJson.items);

    const cleanedCuenta = hasStructuredCuenta ? {
        ...cuentaJson,
        sections: cuentaJson.sections?.map((section: any) => ({
            ...section,
            items: section.items?.map((item: any) => ({
                index: item.index,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total
                // Removed: calculatedTotal, hasCalculationError, isIVAApplied
            }))
        }))
    } : { info: "No structured bill provided. Use HTML context if available." };

    // 2. Clean PAM JSON - Remove zero-value items and non-essential fields
    const cleanedPam = {
        ...pamJson,
        folios: pamJson.folios?.map((folio: any) => ({
            ...folio,
            desglosePorPrestador: folio.desglosePorPrestador?.map((prestador: any) => ({
                ...prestador,
                items: prestador.items
                    ?.filter((item: any) => item.bonificacion > 0 || item.copago > 0) // Remove $0 items
                    ?.map((item: any) => ({
                        codigo: item.codigo,
                        descripcion: item.descripcion,
                        cantidad: item.cantidad,
                        valorTotal: item.valorTotal,
                        bonificacion: item.bonificacion,
                        copago: item.copago
                        // Removed: other metadata fields
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
    const prompt = AUDIT_PROMPT
        .replace('{jurisprudencia_text}', '')
        .replace('{normas_administrativas_text}', '')
        .replace('{evento_unico_jurisprudencia_text}', '')
        .replace('{knowledge_base_text}', knowledgeBaseText)
        .replace('{hoteleria_json}', hoteleriaRules)
        .replace('{cuenta_json}', JSON.stringify(cleanedCuenta))      // Minified
        .replace('{pam_json}', JSON.stringify(cleanedPam))            // Minified
        .replace('{contrato_json}', JSON.stringify(cleanedContrato))  // Minified
        .replace('{html_context}', htmlContext || 'No HTML context provided.'); // New context

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
                }

                // Log progress every 1000 characters
                if (fullText.length % 1000 < chunkText.length) {
                    log(`[AuditEngine] 📊 Procesando... ${Math.floor(fullText.length / 1000)}KB recibidos`);
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

// ============================================================================
// MULTI-PASS AUDIT SYSTEM (3 RONDAS DE VERIFICACIÓN CRUZADA)
// ============================================================================

import {
    buildVerificationPrompt,
    buildConsolidationPrompt,
    VERIFICATION_SCHEMA,
    CONSOLIDATION_SCHEMA
} from '../config/audit.prompts.js';

export async function performMultiPassAudit(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any,
    apiKey: string,
    log: (msg: string) => void,
    htmlContext: string = ''
) {
    log('[MULTI-PASS] 🔄 Iniciando Sistema de Auditoría Multi-Pasada (3 Rondas)...');

    try {
        // ===== RONDA 1: AUDITORÍA PRIMARIA =====
        log('[MULTI-PASS] 🔍 RONDA 1: Auditoría Primaria - Detección Máxima...');
        const ronda1 = await performForensicAudit(
            cuentaJson, pamJson, contratoJson, apiKey,
            (msg) => log(`[R1] ${msg}`), htmlContext
        );

        const numHallazgosR1 = ronda1.data?.hallazgos?.length || 0;
        const ahorroR1 = ronda1.data?.totalAhorroDetectado || 0;
        log(`[MULTI-PASS] ✅ Ronda 1 completada: ${numHallazgosR1} hallazgos, $${ahorroR1.toLocaleString('es-CL')}`);

        // ===== RONDA 2: VERIFICACIÓN CRUZADA =====
        log('[MULTI-PASS] 🔎 RONDA 2: Verificación Cruzada - Validación de Hallazgos...');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: AI_CONFIG.ACTIVE_MODEL,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: VERIFICATION_SCHEMA as any,
                maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                temperature: 0.1  // Lower for more deterministic verification
            }
        });

        // Minify JSON for R2/R3 (reducir tokens)
        const minifiedCuenta = JSON.stringify(cuentaJson);
        const minifiedPam = JSON.stringify(pamJson);
        const minifiedContrato = JSON.stringify(contratoJson);
        log(`[MULTI-PASS] 📦 Contexto minificado: Cuenta=${(minifiedCuenta.length / 1024).toFixed(1)}KB, PAM=${(minifiedPam.length / 1024).toFixed(1)}KB`);

        // Timeout wrapper for R2
        const ROUND_TIMEOUT_MS = 60000; // 60 seconds
        const withTimeout = <T>(promise: Promise<T>, ms: number, roundName: string): Promise<T> => {
            return Promise.race([
                promise,
                new Promise<T>((_, reject) =>
                    setTimeout(() => reject(new Error(`${roundName} timeout after ${ms / 1000}s`)), ms)
                )
            ]);
        };

        const verificationPrompt = buildVerificationPrompt(ronda1.data);
        let ronda2Data;
        try {
            const ronda2Result = await withTimeout(
                model.generateContent([
                    { text: verificationPrompt },
                    { text: `CUENTA: ${minifiedCuenta}` },
                    { text: `PAM: ${minifiedPam}` },
                    { text: `CONTRATO: ${minifiedContrato}` }
                ]),
                ROUND_TIMEOUT_MS,
                'Ronda 2'
            );
            ronda2Data = JSON.parse(ronda2Result.response.text());
        } catch (error: any) {
            log(`[MULTI-PASS] ⚠️ Ronda 2 falló (${error.message}), saltando a consolidación directa`);
            ronda2Data = {
                hallazgosConfirmados: ronda1.data?.hallazgos || [],
                hallazgosRefutados: [],
                hallazgosNuevos: []
            };
        }

        const confirmados = ronda2Data.hallazgosConfirmados?.length || 0;
        const refutados = ronda2Data.hallazgosRefutados?.length || 0;
        const nuevos = ronda2Data.hallazgosNuevos?.length || 0;
        log(`[MULTI-PASS] ✅ Ronda 2 completada: ${confirmados} confirmados, ${refutados} refutados, ${nuevos} nuevos`);

        // ===== RONDA 3: CONSOLIDACIÓN FINAL =====
        log('[MULTI-PASS] ⚖️  RONDA 3: Consolidación Final - Consenso...');

        const consolidationModel = genAI.getGenerativeModel({
            model: AI_CONFIG.ACTIVE_MODEL,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: CONSOLIDATION_SCHEMA as any,
                maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
                temperature: 0.1
            }
        });

        const consolidationPrompt = buildConsolidationPrompt(ronda1.data, ronda2Data);
        let ronda3Result;
        try {
            ronda3Result = await withTimeout(
                consolidationModel.generateContent([
                    { text: consolidationPrompt },
                    { text: `CUENTA: ${minifiedCuenta}` },
                    { text: `PAM: ${minifiedPam}` },
                    { text: `CONTRATO: ${minifiedContrato}` }
                ]),
                ROUND_TIMEOUT_MS,
                'Ronda 3'
            );
        } catch (error: any) {
            log(`[MULTI-PASS] ⚠️ Ronda 3 falló (${error.message}), usando resultado de Ronda 1`);
            // Fallback: return R1 data directly
            return {
                data: {
                    ...ronda1.data,
                    metadataMultiPass: {
                        ronda1: { hallazgos: numHallazgosR1, ahorro: ahorroR1 },
                        ronda2: { confirmados, refutados, nuevos },
                        ronda3: { finales: 0, descartados: 0, fallback: true }
                    }
                },
                usage: ronda1.usage
            };
        }

        let ronda3Data;
        try {
            ronda3Data = JSON.parse(ronda3Result.response.text());
        } catch {
            log('[MULTI-PASS] ⚠️ Error parseando Ronda 3, consolidando manualmente');
            // Fallback: use confirmed from R2 + new from R2
            ronda3Data = {
                hallazgosFinales: [
                    ...(ronda2Data.hallazgosConfirmados || []),
                    ...(ronda2Data.hallazgosNuevos || [])
                ],
                hallazgosDescartados: ronda2Data.hallazgosRefutados || [],
                totalAhorroFinal: 0,
                auditoriaFinalMarkdown: ronda1.data?.auditoriaFinalMarkdown || ''
            };
        }

        const finales = ronda3Data.hallazgosFinales?.length || 0;
        const descartados = ronda3Data.hallazgosDescartados?.length || 0;
        const ahorroFinal = ronda3Data.totalAhorroFinal || 0;
        log(`[MULTI-PASS] ✅✅✅ AUDITORÍA MULTI-PASADA COMPLETADA`);
        log(`[MULTI-PASS] 📊 Resumen: ${finales} hallazgos finales (${descartados} descartados), Ahorro: $${ahorroFinal.toLocaleString('es-CL')}`);

        // Calculate total usage across all rounds (R2 doesn't expose usage due to try-catch)
        const totalUsage = {
            promptTokens: (ronda1.usage?.promptTokens || 0) +
                (ronda3Result.response.usageMetadata?.promptTokenCount || 0),
            candidatesTokens: (ronda1.usage?.candidatesTokens || 0) +
                (ronda3Result.response.usageMetadata?.candidatesTokenCount || 0),
            totalTokens: 0
        };
        totalUsage.totalTokens = totalUsage.promptTokens + totalUsage.candidatesTokens;

        return {
            data: {
                ...ronda3Data,
                hallazgos: ronda3Data.hallazgosFinales,
                totalAhorroDetectado: ronda3Data.totalAhorroFinal,
                metadataMultiPass: {
                    ronda1: { hallazgos: numHallazgosR1, ahorro: ahorroR1 },
                    ronda2: { confirmados, refutados, nuevos },
                    ronda3: { finales, descartados }
                },
                bitacoraCompleta: {
                    ronda1: ronda1.data?.bitacoraAnalisis || [],
                    ronda2: ronda2Data.bitacoraVerificacion || [],
                    ronda3: ronda3Data.bitacoraConsolidacion || []
                }
            },
            usage: totalUsage
        };

    } catch (error: any) {
        log(`[MULTI-PASS] ❌ Error en auditoría multi-pasada: ${error.message}`);
        throw error;
    }
}
