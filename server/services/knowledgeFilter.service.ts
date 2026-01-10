/**
 * BIBLIOTECARIO INTELIGENTE (Mini-RAG)
 * 
 * Servicio que filtra y carga dinámicamente solo el conocimiento legal
 * relevante para cada caso de auditoría.
 * 
 * Reduce el uso de tokens de ~1M a ~30K por auditoría.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge');

// =============================================================================
// CONFIGURACIÓN
// =============================================================================

const MAX_TOKENS_DEFAULT = 50000;  // Aumentado para garantizar carga de jurisprudencia
const CHARS_PER_TOKEN = 4; // Estimación conservadora para español

// Mapeo de documentos disponibles
const KNOWLEDGE_DOCS = {
    jurisprudencia: {
        file: 'JURISPRUDENCIA SIS.txt',
        priority: 1,
        description: 'Jurisprudencia Superintendencia de Salud'
    },
    compendio: {
        file: 'compendio-beneficios-ultima-version-06-11-25.txt',
        priority: 2,
        description: 'Compendio de Normas Administrativas de Beneficios'
    },
    arancel: {
        file: 'Libro Arancel MLE 2025 FONASA.txt',
        priority: 3,
        description: 'Arancel MLE FONASA 2025'
    },
    circular43: {
        file: 'CIRCULAR 43 1998.txt',
        priority: 4,
        description: 'Circular 43/1998 - Normativa de coberturas'
    },
    circularIF19: {
        file: 'CIRCULAR IF19 2018.txt',
        priority: 5,
        description: 'Circular IF-19/2018 - Hotelería e insumos'
    },
    irregularidades: {
        file: 'Informe sobre Prácticas Irregulares en Cuentas Hospitalarias y Clínicas.txt',
        priority: 6,
        description: 'Prácticas Irregulares en Cuentas Hospitalarias'
    },
    boletin: {
        file: 'boletin-n1-2024-reclamos-enero-marzo-2024-1.txt',
        priority: 7,
        description: 'Boletín de Reclamos 2024'
    }
};

// =============================================================================
// MAPA DE RELEVANCIA: Keywords → Documentos
// =============================================================================

type DocKey = keyof typeof KNOWLEDGE_DOCS;

const RELEVANCE_MAP: Record<string, DocKey[]> = {
    // === PROCEDIMIENTOS Y ESPECIALIDADES ===
    'neurocirugía|neurocirugia': ['jurisprudencia', 'arancel', 'compendio'],
    'cardiología|cardiologia|cardiovascular': ['jurisprudencia', 'arancel'],
    'traumatología|traumatologia|ortopedia': ['arancel', 'jurisprudencia'],
    'oncología|oncologia|quimioterapia|radioterapia': ['jurisprudencia', 'compendio', 'arancel'],
    'cirugía|cirugia|quirúrgico|quirurgico': ['arancel', 'circularIF19', 'jurisprudencia'],
    'pabellón|pabellon': ['circularIF19', 'irregularidades', 'jurisprudencia'],

    // === HOSPITALIZACIÓN ===
    'hospitalización|hospitalizacion|internación|internacion': ['compendio', 'jurisprudencia', 'arancel'],
    'día cama|dia cama|day bed': ['arancel', 'compendio'],
    'UCI|UTI|intensivo|intermedio': ['arancel', 'jurisprudencia', 'compendio'],
    'sala cuna|recién nacido|neonatal': ['arancel', 'compendio'],

    // === INSUMOS Y MATERIALES ===
    'insumos|material|materiales': ['circularIF19', 'irregularidades', 'compendio'],
    'hotelería|hoteleria': ['circularIF19', 'irregularidades'],
    'medicamentos|fármacos|farmacos|drogas': ['arancel', 'compendio'],
    'prótesis|protesis|implante|osteosíntesis': ['arancel', 'circularIF19'],

    // === COBERTURAS Y TOPES ===
    'cobertura|bonificación|bonificacion': ['compendio', 'jurisprudencia', 'circular43'],
    'tope|máximo|maximo|límite|limite': ['compendio', 'jurisprudencia'],
    'copago': ['compendio', 'jurisprudencia', 'irregularidades'],
    'preexistencia|preexistente': ['compendio', 'jurisprudencia'],
    'exclusión|exclusion|excluido': ['compendio', 'jurisprudencia'],

    // === PROGRAMAS ESPECIALES ===
    'CAEC|catastrófica|catastrofica': ['compendio', 'jurisprudencia'],
    'GES|AUGE|garantías explícitas': ['compendio', 'jurisprudencia'],
    'urgencia|emergencia|vital': ['jurisprudencia', 'compendio'],
    'Ley de Urgencia': ['jurisprudencia', 'compendio'],

    // === ISAPRE Y FONASA ===
    'ISAPRE|isapre': ['compendio', 'jurisprudencia', 'circular43'],
    'FONASA|fonasa|MLE|libre elección': ['arancel', 'compendio'],
    'plan cerrado|prestador preferente': ['compendio'],
    'contrato de salud': ['compendio', 'jurisprudencia'],

    // === RECLAMOS Y RESOLUCIONES ===
    'reclamo|reclamación|controversia': ['jurisprudencia', 'boletin'],
    'resolución|sentencia|dictamen': ['jurisprudencia'],
    'superintendencia|SS|SIS': ['jurisprudencia', 'compendio'],

    // === FACTURACIÓN Y COBROS ===
    'doble cobro|duplicado': ['irregularidades', 'circularIF19'],
    'desagregación|desagregacion|desglose': ['circularIF19', 'irregularidades'],
    'factura|cuenta|cobro': ['irregularidades', 'compendio'],
    'arancel|valorizado': ['arancel', 'compendio'],

    // === CÓDIGOS FONASA (patrones) ===
    '01\\s?01|0101': ['arancel'], // Consultas
    '02\\s?01|0201': ['arancel'], // Día cama
    '19\\d{2}|grupo.*19': ['arancel'], // Pabellón
    '31\\d{2}|3101': ['arancel'], // Medicamentos hospitalización
};

// =============================================================================
// FUNCIONES PRINCIPALES
// =============================================================================

/**
 * Extrae palabras clave relevantes del caso (cuenta, PAM, contrato)
 */
export function extractCaseKeywords(
    cuentaJson: any,
    pamJson: any,
    contratoJson: any
): string[] {
    const keywords = new Set<string>();

    // === EXTRAER DE LA CUENTA ===
    if (cuentaJson?.sections) {
        for (const section of cuentaJson.sections) {
            // Nombre de sección
            if (section.name) {
                extractWords(section.name, keywords);
            }
            // Items
            if (section.items) {
                for (const item of section.items) {
                    if (item.description) {
                        extractWords(item.description, keywords);
                    }
                }
            }
        }
    }

    // === EXTRAER DEL PAM ===
    if (pamJson?.folios) {
        for (const folio of pamJson.folios) {
            if (folio.desglosePorPrestador) {
                for (const prestador of folio.desglosePorPrestador) {
                    if (prestador.items) {
                        for (const item of prestador.items) {
                            // Código FONASA
                            if (item.codigo) {
                                keywords.add(item.codigo);
                            }
                            // Descripción
                            if (item.descripcion) {
                                extractWords(item.descripcion, keywords);
                            }
                        }
                    }
                }
            }
        }
    }

    // === EXTRAER DEL CONTRATO ===
    if (contratoJson?.coberturas) {
        for (const cobertura of contratoJson.coberturas) {
            if (cobertura.categoria) {
                extractWords(cobertura.categoria, keywords);
            }
            if (cobertura.item) {
                extractWords(cobertura.item, keywords);
            }
            if (cobertura.nota_restriccion) {
                extractWords(cobertura.nota_restriccion, keywords);
            }
        }
    }

    if (contratoJson?.reglas) {
        for (const regla of contratoJson.reglas) {
            if (regla['SUBCATEGORÍA']) {
                extractWords(regla['SUBCATEGORÍA'], keywords);
            }
        }
    }

    return Array.from(keywords);
}

/**
 * Extrae palabras significativas de un texto
 */
function extractWords(text: string, keywords: Set<string>): void {
    if (!text) return;

    // Palabras a ignorar (stopwords español)
    const stopwords = new Set([
        'de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'del', 'un', 'una',
        'por', 'con', 'para', 'que', 'se', 'al', 'es', 'su', 'o', 'no', 'más',
        'sin', 'sobre', 'este', 'entre', 'cuando', 'todo', 'esta', 'ser', 'son',
        'dos', 'también', 'fue', 'ha', 'desde', 'está', 'ya', 'porque', 'cada',
        'cual', 'día', 'dias', 'etc', 'total', 'valor', 'cantidad'
    ]);

    // Extraer palabras de 4+ caracteres
    const words = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remover acentos para matching
        .split(/[^a-záéíóúñ0-9]+/)
        .filter(w => w.length >= 4 && !stopwords.has(w));

    for (const word of words) {
        keywords.add(word);
    }

    // También agregar el texto original para frases compuestas
    const normalized = text.toLowerCase().trim();
    if (normalized.length > 5 && normalized.length < 50) {
        keywords.add(normalized);
    }
}

/**
 * Determina qué documentos son relevantes basándose en las keywords del caso
 */
function matchDocuments(keywords: string[]): Map<DocKey, number> {
    const docScores = new Map<DocKey, number>();

    for (const keyword of keywords) {
        for (const [pattern, docs] of Object.entries(RELEVANCE_MAP)) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(keyword)) {
                for (const doc of docs) {
                    const currentScore = docScores.get(doc) || 0;
                    docScores.set(doc, currentScore + 1);
                }
            }
        }
    }

    return docScores;
}

/**
 * Obtiene el conocimiento relevante filtrado para un caso específico
 */
export async function getRelevantKnowledge(
    keywords: string[],
    maxTokens: number = MAX_TOKENS_DEFAULT,
    log: (msg: string) => void = console.log
): Promise<{
    text: string;
    sources: string[];
    tokenEstimate: number;
    keywordsMatched: string[];
}> {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    let totalChars = 0;
    let result = '';
    const sources: string[] = [];
    const keywordsMatched: string[] = [];

    // Determinar documentos relevantes y ordenar por score
    const docScores = matchDocuments(keywords);

    // =========================================================================
    // GARANTIZAR DOCUMENTOS LEGALES CRÍTICOS (para fundamentación con citas)
    // Siempre agregar jurisprudencia y compendio con score mínimo si no están
    // =========================================================================
    const CRITICAL_LEGAL_DOCS: DocKey[] = ['jurisprudencia', 'compendio', 'circularIF19'];
    for (const criticalDoc of CRITICAL_LEGAL_DOCS) {
        if (!docScores.has(criticalDoc)) {
            docScores.set(criticalDoc, 1); // Score mínimo para garantizar inclusión
            log(`[KnowledgeFilter] ⚖️ Documento legal crítico agregado: ${criticalDoc}`);
        }
    }

    // Si no hay matches adicionales, usar documentos por defecto
    if (docScores.size === CRITICAL_LEGAL_DOCS.length) {
        log('[KnowledgeFilter] ⚠️ Solo documentos base, agregando irregularidades');
        docScores.set('irregularidades', 1);
    }

    // Ordenar por score (descendente) y luego por prioridad
    const sortedDocs = Array.from(docScores.entries())
        .sort(([docA, scoreA], [docB, scoreB]) => {
            if (scoreB !== scoreA) return scoreB - scoreA;
            return (KNOWLEDGE_DOCS[docA]?.priority || 99) - (KNOWLEDGE_DOCS[docB]?.priority || 99);
        });

    log(`[KnowledgeFilter] 📊 Documentos rankeados: ${sortedDocs.map(([d, s]) => `${d}(${s})`).join(', ')}`);

    // Cargar chunks relevantes de cada documento
    for (const [docKey, score] of sortedDocs) {
        if (totalChars >= maxChars) {
            log(`[KnowledgeFilter] ⚡ Límite de tokens alcanzado (${Math.floor(totalChars / CHARS_PER_TOKEN)})`);
            break;
        }

        const docInfo = KNOWLEDGE_DOCS[docKey];
        if (!docInfo) continue;

        const filePath = path.join(KNOWLEDGE_DIR, docInfo.file);

        try {
            // Verificar que el archivo existe
            await fs.access(filePath);

            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            // Buscar chunks relevantes dentro del documento
            const relevantChunks = findRelevantChunks(lines, keywords, maxChars - totalChars);

            if (relevantChunks.text.length > 0) {
                result += `\n\n--- ${docInfo.description.toUpperCase()} ---\n`;
                result += relevantChunks.text;
                totalChars += relevantChunks.text.length + docInfo.description.length + 10;
                sources.push(docInfo.description);
                keywordsMatched.push(...relevantChunks.matchedKeywords);

                log(`[KnowledgeFilter] 📄 Cargado: ${docInfo.file} (${Math.floor(relevantChunks.text.length / 1024)} KB, ${relevantChunks.matchedKeywords.length} matches)`);
            }
        } catch (error) {
            log(`[KnowledgeFilter] ⚠️ No se pudo cargar ${docInfo.file}: ${error}`);
        }
    }

    return {
        text: result,
        sources: [...new Set(sources)],
        tokenEstimate: Math.floor(totalChars / CHARS_PER_TOKEN),
        keywordsMatched: [...new Set(keywordsMatched)]
    };
}

/**
 * Encuentra chunks relevantes dentro de un documento
 */
function findRelevantChunks(
    lines: string[],
    keywords: string[],
    maxChars: number,
    chunkSize: number = 100 // Líneas por chunk
): { text: string; matchedKeywords: string[] } {
    const chunks: { startLine: number; score: number; text: string; keywords: string[] }[] = [];

    // Dividir en chunks y puntuar cada uno
    for (let i = 0; i < lines.length; i += chunkSize) {
        const chunkLines = lines.slice(i, i + chunkSize);
        const chunkText = chunkLines.join('\n');
        const chunkLower = chunkText.toLowerCase();

        let score = 0;
        const matchedKeywords: string[] = [];

        for (const keyword of keywords) {
            const keywordLower = keyword.toLowerCase();
            if (chunkLower.includes(keywordLower)) {
                score++;
                matchedKeywords.push(keyword);
            }
        }

        if (score > 0) {
            chunks.push({
                startLine: i,
                score,
                text: chunkText,
                keywords: matchedKeywords
            });
        }
    }

    // Ordenar chunks por score
    chunks.sort((a, b) => b.score - a.score);

    // Seleccionar mejores chunks hasta el límite
    let result = '';
    let totalChars = 0;
    const allKeywords: string[] = [];

    for (const chunk of chunks) {
        if (totalChars + chunk.text.length > maxChars) {
            // Intentar agregar porción del chunk
            const remaining = maxChars - totalChars;
            if (remaining > 500) { // Solo si hay espacio significativo
                result += chunk.text.substring(0, remaining) + '...\n';
                allKeywords.push(...chunk.keywords);
            }
            break;
        }

        result += chunk.text + '\n\n';
        totalChars += chunk.text.length;
        allKeywords.push(...chunk.keywords);
    }

    return {
        text: result,
        matchedKeywords: allKeywords
    };
}

/**
 * Carga el archivo de hotelería (JSON estructurado)
 */
export async function loadHoteleriaRules(): Promise<string> {
    try {
        const filePath = path.join(KNOWLEDGE_DIR, 'hoteleria_sis.json');
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch {
        return '';
    }
}

/**
 * Info del servicio para logs
 */
export function getKnowledgeFilterInfo(): string {
    const docCount = Object.keys(KNOWLEDGE_DOCS).length;
    const patternCount = Object.keys(RELEVANCE_MAP).length;
    return `KnowledgeFilter v1.0: ${docCount} documentos, ${patternCount} patrones de relevancia`;
}
