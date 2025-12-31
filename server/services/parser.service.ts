export interface ParserConfig {
    metadataKeys: string[];
    sectionKeyword: string;
    itemDelimiter: string;
}

export interface ParsedMetadata {
    [key: string]: string;
}

export interface ParsedSection {
    category: string;
    items: any[];
    sectionTotal: number;
}

export interface ParseResult {
    metadata: ParsedMetadata;
    sections: ParsedSection[];
}

export class ParserService {
    parse(text: string, config: ParserConfig): ParseResult {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        const metadata = this.extractMetadata(lines, config.metadataKeys);
        const sections = this.extractSections(lines, config.sectionKeyword, config.itemDelimiter);

        return { metadata, sections };
    }

    private extractMetadata(lines: string[], keys: string[]): ParsedMetadata {
        const metadata: ParsedMetadata = {};

        for (const line of lines) {
            for (const key of keys) {
                if (line.startsWith(`${key}:`)) {
                    metadata[key.toLowerCase()] = line.replace(`${key}:`, '').trim();
                }
            }
        }

        return metadata;
    }

    private extractSections(
        lines: string[],
        sectionKeyword: string,
        delimiter: string
    ): ParsedSection[] {
        const sectionsMap = new Map<string, ParsedSection>();
        let currentSectionName = "SECCION_DESCONOCIDA";
        let globalIndex = 1;

        for (const line of lines) {
            // Detectar nueva sección
            if (line.startsWith(`${sectionKeyword}:`)) {
                currentSectionName = line.replace(`${sectionKeyword}:`, '').trim();

                if (!sectionsMap.has(currentSectionName)) {
                    sectionsMap.set(currentSectionName, {
                        category: currentSectionName,
                        items: [],
                        sectionTotal: 0
                    });
                }
                continue;
            }

            // Detectar líneas de datos (con delimiter)
            if (!line.includes(delimiter)) continue;

            const cols = line.split(delimiter).map(c => c.trim());
            if (cols.length < 4) continue;

            let sectionObj = sectionsMap.get(currentSectionName);
            if (!sectionObj) {
                sectionsMap.set("GENERAL", {
                    category: "GENERAL",
                    items: [],
                    sectionTotal: 0
                });
                sectionObj = sectionsMap.get("GENERAL")!;
            }

            // Parseo genérico de ítem (se puede sobrescribir por tipo)
            sectionObj.items.push({
                index: globalIndex++,
                raw: cols
            });
        }

        return Array.from(sectionsMap.values());
    }
}
