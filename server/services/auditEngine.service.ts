import { GoogleGenerativeAI } from "@google/generative-ai";
import { AUDIT_PROMPT, FORENSIC_AUDIT_SCHEMA } from '../config/audit.prompts.js';
import { AI_CONFIG, GENERATION_CONFIG } from '../config/ai.config.js';
import { loadJurisprudencia, getJurisprudenciaInfo } from '../prompts/jurisprudencia.prompt.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge');

export async function performForensicAudit(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any,
    apiKey: string,
    log: (msg: string) => void,
    htmlContext: string = ''
) {
    // AUDIT-SPECIFIC: Use economical model to reduce costs
    // Bill/PAM/Contract extraction uses AI_CONFIG.ACTIVE_MODEL
    // Audit uses gemini-2.5-flash for 80% cost reduction
    const modelsToTry = ['gemini-2.5-flash'];
    let result;
    let lastError;

    // --- LOADING KNOWLEDGE BASE (JURISPRUDENCIA DISABLED TO SAVE TOKENS) ---
    log('[AuditEngine] 📚 Cargando base de conocimiento legal...');

    // Read all files in knowledge directory
    const files = await fs.readdir(KNOWLEDGE_DIR);
    let knowledgeBaseText = '';
    let hoteleriaRules = '';

    // Load jurisprudencia first (DISABLED TEMPORARILY)
    // try {
    //     const jurisprudenciaContent = await loadJurisprudencia();
    //     if (jurisprudenciaContent) {
    //         knowledgeBaseText += `\n\n--- JURISPRUDENCIA SUPERINTENDENCIA DE SALUD ---\n${jurisprudenciaContent}`;
    //         log(`[AuditEngine] ⚖️ Cargada: ${getJurisprudenciaInfo()}`);
    //     }
    // } catch (error) {
    //     log(`[AuditEngine] ⚠️ No se pudo cargar jurisprudencia: ${error}`);
    // }

    for (const file of files) {
        const filePath = path.join(KNOWLEDGE_DIR, file);
        const ext = path.extname(file).toLowerCase();

        // Load additional knowledge documents
        const allowedDocs = [
            'Informe sobre Prácticas Irregulares en Cuentas Hospitalarias y Clínicas.txt'
        ];
        const isTargetDoc = allowedDocs.includes(file);

        if (ext === '.txt' && isTargetDoc) {
            const content = await fs.readFile(filePath, 'utf-8');
            knowledgeBaseText += `\n\n--- DOCUMENTO: ${file} ---\n${content}`;
            log(`[AuditEngine] 📑 Cargado (Contexto Legal): ${file}`);
        } else if (file === 'hoteleria_sis.json') {
            const content = await fs.readFile(filePath, 'utf-8');
            hoteleriaRules = content;
            log(`[AuditEngine] 🏨 Cargadas reglas de hotelería (IF-319)`);
        }
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

    try {
        const responseText = result.response.text();
        const auditResult = JSON.parse(responseText);

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
