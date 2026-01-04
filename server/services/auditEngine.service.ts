import { GoogleGenerativeAI } from "@google/generative-ai";
import { AUDIT_PROMPT, FORENSIC_AUDIT_SCHEMA } from '../config/audit.prompts.js';
import { AI_CONFIG, GENERATION_CONFIG } from '../config/ai.config.js';
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
    log: (msg: string) => void
) {
    const modelsToTry = [AI_CONFIG.ACTIVE_MODEL, AI_CONFIG.FALLBACK_MODEL];
    let result;
    let lastError;

    // --- RESTORING LOGIC FOR KNOWLEDGE BASE AND PROMPT ---
    log('[AuditEngine] 📚 Cargando base de conocimiento legal extendida...');

    // Read all files in knowledge directory
    const files = await fs.readdir(KNOWLEDGE_DIR);
    let knowledgeBaseText = '';
    let hoteleriaRules = '';

    for (const file of files) {
        const filePath = path.join(KNOWLEDGE_DIR, file);
        const ext = path.extname(file).toLowerCase();

        // USER REQUEST: ONLY USE 'Prácticas Irregulares' to save tokens.
        // We use the .txt version of the document.
        const isTargetDoc = file === 'Informe sobre Prácticas Irregulares en Cuentas Hospitalarias y Clínicas.txt';

        if (ext === '.txt' && isTargetDoc) {
            const content = await fs.readFile(filePath, 'utf-8');
            knowledgeBaseText += `\n\n--- DOCUMENTO: ${file} ---\n${content}`;
            log(`[AuditEngine] 📑 Cargado (Exclusivo): ${file}`);
        } else if (file === 'hoteleria_sis.json') {
            const content = await fs.readFile(filePath, 'utf-8');
            hoteleriaRules = content;
            log(`[AuditEngine] 🏨 Cargadas reglas de hotelería (IF-319)`);
        }
    }

    log('[AuditEngine] 🧠 Sincronizando datos y analizando hallazgos con Super-Contexto...');

    const prompt = AUDIT_PROMPT
        .replace('{jurisprudencia_text}', '')
        .replace('{normas_administrativas_text}', '')
        .replace('{evento_unico_jurisprudencia_text}', '')
        .replace('{knowledge_base_text}', knowledgeBaseText)
        .replace('{hoteleria_json}', hoteleriaRules)
        .replace('{cuenta_json}', JSON.stringify(cuentaJson, null, 2))
        .replace('{pam_json}', JSON.stringify(pamJson, null, 2))
        .replace('{contrato_json}', JSON.stringify(contratoJson, null, 2));
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
                    temperature: GENERATION_CONFIG.temperature
                }
            });

            log('[AuditEngine] 📡 Enviando consulta a Gemini...');
            result = await model.generateContent(prompt);
            log(`[AuditEngine] ✅ Éxito con modelo ${modelName}`);
            break;

        } catch (error: any) {
            lastError = error;
            const errStr = (error?.toString() || "") + (error?.message || "");
            const isQuota = errStr.includes('429') || errStr.includes('Too Many Requests') || error?.status === 429 || error?.status === 503;

            if (isQuota) {
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
