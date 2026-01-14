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
        .replace('{hoteleria_json}', hoteleriaRules)
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
    htmlContext: string = '',
    onUsageUpdate?: (usage: any) => void,
    onProgressUpdate?: (progress: number) => void
) {
    log('[SINGLE-PASS] 🚀 Iniciando Sistema de Auditoría de Tiro Único (Modo Optimizado)...');

    try {
        // ===== RONDA ÚNICA: AUDITORÍA FORENSE INTEGRAL =====
        log('[SINGLE-PASS] 🔍 Ejecutando Auditoría Forense (Fases A y B)...');
        const ronda1 = await performForensicAudit(
            cuentaJson, pamJson, contratoJson, apiKey,
            (msg) => log(`${msg}`), htmlContext,
            onUsageUpdate,
            onProgressUpdate
        );

        const numHallazgos = ronda1.data?.hallazgos?.length || 0;
        const ahorro = ronda1.data?.totalAhorroDetectado || 0;
        log(`[SINGLE-PASS] ✅ Auditoría completada: ${numHallazgos} hallazgos, $${ahorro.toLocaleString('es-CL')}`);

        // Retornamos el formato esperado por el frontend, pero basado en la Ronda 1
        return {
            data: {
                ...ronda1.data,
                // Mantenemos metadatos mínimos para compatibilidad
                metadataMultiPass: {
                    ronda1: { hallazgos: numHallazgos, ahorro: ahorro },
                    modo: 'SINGLE_PASS'
                },
                bitacoraCompleta: {
                    ronda1: ronda1.data?.bitacoraAnalisis || []
                }
            },
            usage: ronda1.usage
        };

    } catch (error: any) {
        log(`[SINGLE-PASS] ❌ Error en auditoría: ${error.message}`);
        throw error;
    }
}

