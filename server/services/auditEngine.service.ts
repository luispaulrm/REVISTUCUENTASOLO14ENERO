import { GoogleGenerativeAI } from "@google/generative-ai";
import { AUDIT_PROMPT, FORENSIC_AUDIT_SCHEMA } from '../config/audit.prompts.js';
import { AI_CONFIG } from '../config/ai.config.js';
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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: AI_CONFIG.ACTIVE_MODEL,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: FORENSIC_AUDIT_SCHEMA as any
        }
    });

    log('[AuditEngine] 📚 Cargando base de conocimiento legal extendida...');

    // Read all files in knowledge directory
    const files = await fs.readdir(KNOWLEDGE_DIR);
    let knowledgeBaseText = '';
    let hoteleriaRules = '';

    for (const file of files) {
        const filePath = path.join(KNOWLEDGE_DIR, file);
        const ext = path.extname(file).toLowerCase();

        // ONLY LOAD .TXT FILES AS REQUESTED BY USER
        // This ignores PDFs and explicitly ignores .md (unless desired, but user said "forget pdfs, only txt")
        // Actually user said "solo lee los txt... olvida los pdf".
        // Current code also loaded .md. I will restrict to ONLY .txt per specific request.
        if (ext === '.txt') {
            const content = await fs.readFile(filePath, 'utf-8');
            knowledgeBaseText += `\n\n--- DOCUMENTO: ${file} ---\n${content}`;
            log(`[AuditEngine] 📑 Cargado: ${file}`);
        } else if (file === 'hoteleria_sis.json') {
            const content = await fs.readFile(filePath, 'utf-8');
            hoteleriaRules = content;
            log(`[AuditEngine] 🏨 Cargadas reglas de hotelería (IF-319)`);
        } else {
            // Ignoring everything else explicitly
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

    try {
        log('[AuditEngine] 📡 Enviando consulta a Gemini 3 Flash...');
        const result = await model.generateContent(prompt);
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
