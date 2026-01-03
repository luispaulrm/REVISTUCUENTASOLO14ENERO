import { GoogleGenerativeAI } from "@google/generative-ai";
import { AUDIT_PROMPT, AUDIT_RECONCILIATION_SCHEMA } from '../config/audit.prompts.js';
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
            responseSchema: AUDIT_RECONCILIATION_SCHEMA as any
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

        if (ext === '.txt' || ext === '.md') {
            const content = await fs.readFile(filePath, 'utf-8');
            knowledgeBaseText += `\n\n--- DOCUMENTO: ${file} ---\n${content}`;
        } else if (file === 'hoteleria_sis.json') {
            const content = await fs.readFile(filePath, 'utf-8');
            hoteleriaRules = content;
        }
    }

    log('[AuditEngine] 🧠 Sincronizando datos y analizando hallazgos con Super-Contexto...');

    const prompt = AUDIT_PROMPT
        .replace('{jurisprudencia_text}', '') // Cleaning legacy markers
        .replace('{normas_administrativas_text}', '')
        .replace('{evento_unico_jurisprudencia_text}', '')
        .replace('{knowledge_base_text}', knowledgeBaseText)
        .replace('{hoteleria_json}', hoteleriaRules)
        .replace('{cuenta_json}', JSON.stringify(cuentaJson, null, 2))
        .replace('{pam_json}', JSON.stringify(pamJson, null, 2))
        .replace('{contrato_json}', JSON.stringify(contratoJson, null, 2));

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const auditResult = JSON.parse(responseText);

        log('[AuditEngine] ✅ Auditoría forense completada.');
        return auditResult;
    } catch (error: any) {
        log(`[AuditEngine] ❌ Error en el proceso de auditoría: ${error.message}`);
        throw error;
    }
}
