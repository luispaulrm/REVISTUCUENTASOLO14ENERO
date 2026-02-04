import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge');
const CONTRACTS_DIR = path.join(KNOWLEDGE_DIR, 'contracts');

export class PersistentMemoryService {
    private static async ensureDir() {
        try {
            await fs.mkdir(CONTRACTS_DIR, { recursive: true });
        } catch (err) {
            // Ignore if exists
        }
    }

    /**
     * Saves a contract's canonical data as a text file for RAG consumption.
     */
    static async saveContract(contractId: string, data: any): Promise<string | null> {
        await this.ensureDir();

        // Clean ID for filename
        const safeId = contractId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filePath = path.join(CONTRACTS_DIR, `${safeId}.txt`);

        try {
            // Transform JSON to a readable text format for better LLM retrieval
            const content = this.formatContractToText(data);
            await fs.writeFile(filePath, content, 'utf-8');
            console.log(`[MEMORY] Contract saved to persistent memory: ${safeId}`);
            return filePath;
        } catch (err) {
            console.error('[MEMORY] Error saving contract to memory:', err);
            return null;
        }
    }

    /**
     * Formats canonical JSON into a structured text document.
     */
    private static formatContractToText(data: any): string {
        let text = `--- DOCUMENTO DE CONTRATO CANONIZADO ---\n`;
        text += `FUENTE: ${data.metadata?.fuente || 'Desconocida'}\n`;
        text += `TIPO: ${data.metadata?.tipo_contrato || 'General'}\n`;
        text += `CÓDIGO: ${data.metadata?.codigo || 'S/N'}\n\n`;

        if (data.coberturas) {
            text += `=== COBERTURAS Y BONIFICACIONES ===\n`;
            data.coberturas.forEach((cob: any) => {
                text += `- ${cob.item || cob.descripcion_textual}: `;
                if (cob.modalidades) {
                    cob.modalidades.forEach((m: any) => {
                        text += `[${m.modalidad || m.tipo}: ${m.porcentaje}%`;
                        if (m.tope) text += `, Tope: ${m.tope} ${m.unidad || ''}`;
                        text += `] `;
                    });
                } else {
                    text += `${cob.porcentaje || 'Ver detalle'}%`;
                    if (cob.tope) text += ` (Tope: ${cob.tope})`;
                }
                text += `\n`;
            });
            text += `\n`;
        }

        if (data.topes) {
            text += `=== LÍMITES Y TOPES GENERALES ===\n`;
            data.topes.forEach((t: any) => {
                text += `- ${t.fuente_textual || 'Tope'}: ${t.valor} ${t.unidad || ''} (${t.tipo_modalidad || 'General'})\n`;
            });
            text += `\n`;
        }

        if (data.reglas_aplicacion) {
            text += `=== REGLAS DE NEGOCIO ===\n`;
            data.reglas_aplicacion.forEach((r: any) => {
                text += `- SI ${r.condicion} ENTONCES ${r.efecto}\n`;
            });
        }

        // Include raw JSON fingerprint if needed
        text += `\n[FINGERPRINT]: ${data.metadata?.fingerprint || 'N/A'}\n`;

        return text;
    }

    /**
     * Deletes all memorized contracts.
     */
    static async clearAll(): Promise<void> {
        await this.ensureDir();
        try {
            const files = await fs.readdir(CONTRACTS_DIR);
            for (const file of files) {
                await fs.unlink(path.join(CONTRACTS_DIR, file));
            }
            console.log(`[MEMORY] Cleared ${files.length} memorized contracts.`);
        } catch (err) {
            console.error('[MEMORY] Error clearing memory:', err);
        }
    }
}
