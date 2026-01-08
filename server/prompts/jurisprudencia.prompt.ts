import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Metadata sobre el documento de jurisprudencia
 */
export const JURISPRUDENCIA_METADATA = {
    fuente: "Superintendencia de Salud de Chile",
    documento: "Jurisprudencia Judicial y Administrativa Destacada",
    descripcion: "Compilación de precedentes legales y administrativos de la Superintendencia de Salud",
    temas: [
        "Ley de Urgencia",
        "Coberturas y Bonificaciones",
        "Insuficiencia de Red",
        "Preexistencias",
        "GES y CAEC",
        "Término de Contrato",
        "Suscripción de Contrato",
        "Precio del Plan de Salud"
    ],
    lineas: 8258,
    caracteres: 814115,
    palabras: 125661
};

/**
 * Carga el contenido completo del archivo de jurisprudencia
 * @returns Contenido del archivo JURISPRUDENCIA SIS.txt
 */
export async function loadJurisprudencia(): Promise<string> {
    const filePath = path.join(__dirname, '../knowledge/JURISPRUDENCIA SIS.txt');
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch (error) {
        console.error('[Jurisprudencia] Error al cargar archivo:', error);
        return '';
    }
}

/**
 * Obtiene un resumen de la jurisprudencia para logging
 */
export function getJurisprudenciaInfo(): string {
    return `${JURISPRUDENCIA_METADATA.documento} - ${JURISPRUDENCIA_METADATA.fuente} (${JURISPRUDENCIA_METADATA.lineas} líneas, ${Math.round(JURISPRUDENCIA_METADATA.caracteres / 1024)} KB)`;
}
