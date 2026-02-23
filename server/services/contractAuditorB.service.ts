import { GeminiService } from './gemini.service.js';
import { LayoutGridDoc, AuditorBResult } from './contractTypes.js';

export class ContractAuditorB {
  private gemini: GeminiService;
  private logCallback?: (msg: string) => void;

  constructor(gemini: GeminiService, logCallback?: (msg: string) => void) {
    this.gemini = gemini;
    this.logCallback = logCallback;
  }

  private log(msg: string) {
    console.log(`[AuditorB] ${msg}`);
    if (this.logCallback) this.logCallback(msg);
  }

  /**
   * Deterministically classifies a page to skip non-coverage tables.
   */
  private classifyTableHard(page: any): "COVERAGE_GRID" | "FACTOR_TABLE" | "ARANCEL_CATALOG" | "WAIT_TIMES_TABLE" | "DEFINITIONS_TEXT" | "UNKNOWN" {
    const text = (page.cells || []).map((c: any) => c.text).join(" ").toLowerCase();

    // 1. FACTOR_TABLE (Ages, quote types)
    if (text.includes("años") && (text.includes("0 a") || text.includes("65 y mas") || text.includes("mayor de"))) {
      return "FACTOR_TABLE";
    }

    // 2. WAIT_TIMES_TABLE (Wait times, days)
    if (text.includes("tiempo máximo") || text.includes("espera") || (text.includes("días") && text.includes("garantía"))) {
      return "WAIT_TIMES_TABLE";
    }

    // 3. ARANCEL_CATALOG (Long lists of codes)
    const codeMatches = text.match(/\b\d{7}\b/g) || [];
    if (codeMatches.length > 10 && !text.includes("libre elección")) {
      return "ARANCEL_CATALOG";
    }

    // 4. COVERAGE_GRID (Percentage signs, UF/VA, Modalidades)
    const hasPercentages = (text.match(/%/g) || []).length > 3;
    const hasModalities = text.includes("preferente") || text.includes("libre elección") || text.includes("bonificación");
    if (hasPercentages && hasModalities) {
      return "COVERAGE_GRID";
    }

    return "UNKNOWN";
  }

  /**
   * Semantically interprets a LayoutGridDoc using iterative page-by-page analysis.
   */
  async auditLayout(
    layoutDoc: LayoutGridDoc,
    anchors: string[] = []
  ): Promise<AuditorBResult> {
    this.log(`Iniciando auditoría semántica iterativa (${layoutDoc.doc.pages.length} páginas)...`);

    if (!layoutDoc || !layoutDoc.doc || !layoutDoc.doc.pages || layoutDoc.doc.pages.length === 0) {
      this.log("⚠️ Error: layoutDoc structure is invalid or missing pages.");
      throw new Error("Invalid layoutDoc structure: doc.pages is missing.");
    }

    const allItems: any[] = [];
    const allWarnings: any[] = [];
    let detectedSchema: any = null;

    // Process each page independently to ensure completeness
    for (const page of layoutDoc.doc.pages) {
      this.log(`Analizando página ${page.page}...`);

      const tableType = this.classifyTableHard(page);
      this.log(`   🔍 Clasificación Determinista: ${tableType}`);

      if (tableType !== "COVERAGE_GRID" && tableType !== "UNKNOWN") {
        this.log(`   ⏭️ Saltando página ${page.page} (Tipo: ${tableType})`);
        continue;
      }

      this.log(`   🚀 Iniciando auditoría semántica en página ${page.page}...`);
      const pageResult = await this.auditSinglePage(page, detectedSchema, anchors);

      if (pageResult.items && pageResult.items.length > 0) {
        allItems.push(...pageResult.items);
        this.log(`   ✅ Página ${page.page}: ${pageResult.items.length} items extraídos.`);
      }

      if (pageResult.detectedSchema && !detectedSchema) {
        detectedSchema = pageResult.detectedSchema;
        this.log(`   📍 Esquema de columnas detectado en página ${page.page}.`);
      }

      if (pageResult.warnings) {
        allWarnings.push(...pageResult.warnings.map((w: any) => ({ ...w, detail: `[Pág ${page.page}] ${w.detail}` })));
      }
    }

    this.log(`✅ Auditoría completada. Total items: ${allItems.length}`);

    return {
      docMeta: {
        docId: layoutDoc.doc.docId,
        source: "contract_audit_topology",
        totalPages: layoutDoc.doc.pages.length
      },
      detectedSchema: detectedSchema || {
        prestacion_col: null,
        preferente_pct_col: null,
        preferente_tope_evento_col: null,
        preferente_tope_anual_col: null,
        libre_pct_col: null,
        libre_tope_evento_col: null,
        libre_tope_anual_col: null
      },
      items: allItems,
      warnings: allWarnings
    };
  }

  private async auditSinglePage(
    page: any,
    suggestedSchema: any,
    anchors: string[]
  ): Promise<any> {
    // OPTIMIZATION: Remove tokens to save context window
    const optimizedPage = {
      ...page,
      cells: (page.cells || []).map((cell: any) => {
        const { tokens, ...rest } = cell;
        return rest;
      }),
      grid: {
        ...(page.grid || {}),
        rectangles: page.grid?.rectangles || []
      }
    };

    const prompt = `
YOU ARE A CONTRACT AUDITOR.
You are processing PAGE ${page.page} of a medical contract.
Your task: Extract EVERY single row from the provided table topology into structured JSON.

DEFINITIONS:
- V.A / VA = "Número de veces el valor asignado a cada prestación en el arancel".
- UF = Unidad de Fomento.
- "Sin Tope" ONLY exists if explicitly stated.
- "Tope por evento" = item ceiling.
- "Tope anual" = max ceiling per year.

CONTEXT:
${suggestedSchema ? `Suggested Column Schema (use these IDs if they match): ${JSON.stringify(suggestedSchema)}` : "No schema suggested yet. Identify headers first."}
Anchors: ${JSON.stringify(anchors)}

TASK:
1) Identify the role of each column (Item, %, Ceiling, etc.).
2) For EVERY row that represents a medical service, extract its data.
3) Inclusion Rule: DO NOT SKIP ROWS. If the page has 50 rows, return 50 items.
4) Response MUST be valid JSON matching this schema:
{
  "detectedSchema": {
    "prestacion_col": "string|null",
    "preferente_pct_col": "string|null",
    "preferente_tope_evento_col": "string|null",
    "preferente_tope_anual_col": "string|null",
    "libre_pct_col": "string|null",
    "libre_tope_evento_col": "string|null",
    "libre_tope_anual_col": "string|null"
  },
  "items": [
    {
      "ambito": "HOSPITALARIO|AMBULATORIO|URGENCIA|OTROS",
      "item": "string",
      "preferente": {
        "rules": [
          {
            "porcentaje": number|null,
            "clinicas": ["string"],
            "tope_evento": { "valor": number|null, "unidad": "UF|VA|SIN_TOPE|UNKNOWN", "tipo": "TOPE_BONIFICACION|COPAGO_FIJO" },
            "tope_anual": { "valor": number|null, "unidad": "UF|VA|SIN_TOPE|UNKNOWN" },
            "copago_fijo": { "valor": number, "unidad": "UF|CLP" } | null,
            "evidence": { "page": ${page.page}, "cells": [ { "cellId": "string", "text": "string" } ] }
          }
        ]
      },
      "libre_eleccion": {
        "rules": [
          {
            "porcentaje": number|null,
            "clinicas": ["string"],
            "tope_evento": { "valor": number|null, "unidad": "UF|VA|SIN_TOPE|UNKNOWN", "tipo": "TOPE_BONIFICACION|COPAGO_FIJO" },
            "tope_anual": { "valor": number|null, "unidad": "UF|VA|SIN_TOPE|UNKNOWN" },
            "copago_fijo": { "valor": number, "unidad": "UF|CLP" } | null,
            "evidence": { "page": ${page.page}, "cells": [ { "cellId": "string", "text": "string" } ] }
          }
        ]
      }
    }
  ],
  "warnings": []
}

SPECIAL RULES:
- V.A / VA / Veces Arancel -> NORMALIZAR SIEMPRE A "VA".
- Copago Fijo (Urgencia) -> Mapear a "copago_fijo" y poner "tipo": "COPAGO_FIJO" en el tope.
- Empty Cells (-) -> "UNKNOWN", nunca "SIN_TOPE".
- Merged Cells & Spatial Index -> Use "spatialIndex" to see which row range a merged cell spans. If a cell spans rows 5-10, APPLY ITS RULES TO ALL ITEMS IN ROWS 5-10.
- Multi-Percentage Blocks -> If a preferente block contains "100% Dávila, 90% Indisa", create TWO rules in the "rules" array.
- Row-Band Projection -> To find the Libre Elección limits (often on the far right), track the y0-y1 coordinates (the "Row Band") of the service item. Look for cells intersecting this Y-band on the right side.
- DETECTED SCHEMA -> "preferente_pct_col" and "preferente_tope_evento_col" MUST NOT BE THE SAME CELL. If a merged cell contains both % and Tope, leave the column identifiers as null.

INPUT TOPOLOGY (PAGE ${page.page}):
(Note: Use "spatialIndex" to resolve which cells belong to which rows and columns deterministically)
${JSON.stringify(optimizedPage)}
`;

    try {
      const responseText = await this.gemini.extractText(prompt, {
        responseMimeType: "application/json",
        temperature: 0.0,
        topP: 0.01
      });

      let parsed = JSON.parse(responseText);

      // 1. Mandatory Header Anchoring & Anti-Collapse Check
      const schema = parsed.detectedSchema || {};
      const hasBasicCols = schema.prestacion_col && (schema.preferente_pct_col || schema.libre_pct_col);
      const isCollapsed = schema.preferente_pct_col && schema.preferente_pct_col === schema.preferente_tope_evento_col;

      // Strict validation: Does the prestacion_col cell actually exist in the page geometry?
      const prestacionCelExists = page.cells && page.cells.some((c: any) => c.cellId === schema.prestacion_col);

      if (!hasBasicCols || (schema.prestacion_col && !prestacionCelExists)) {
        this.log(`   ⚠️ Error: Cabeceras insuficientes o inválidas en página ${page.page}.`);
        return {
          items: [],
          warnings: [{ type: "MISSING_HEADERS", detail: "Falló anclaje estricto de cabeceras o la celda inventada por el LLM no existe en la geometría." }],
          detectedSchema: null
        };
      }

      if (isCollapsed) {
        this.log(`   ⚠️ Warning: Schema Collapse detectado en página ${page.page}. Corrigiendo a nulo.`);
        // If col collapsed, the LLM confused a merged data cell with a column header. Set to null.
        schema.preferente_pct_col = null;
        schema.preferente_tope_evento_col = null;
        parsed.detectedSchema = schema; // Push the fixed schema back to the parsed object tracking
        parsed.warnings = parsed.warnings || [];
        parsed.warnings.push({ type: "SCHEMA_COLLAPSE_FIXED", detail: "Columnas % y Tope apuntaban a la misma celda. Se corrigió a null." });
      }

      // 2. Fix Warning Serialization
      if (parsed.warnings && !Array.isArray(parsed.warnings)) {
        // If it's the "string-as-object" bug, convert to a single warning
        if (typeof parsed.warnings === 'object') {
          const vals = Object.values(parsed.warnings).join("");
          parsed.warnings = [{ type: "SERIALIZATION_FIX", detail: vals }];
        } else {
          parsed.warnings = [{ type: "GENERIC", detail: String(parsed.warnings) }];
        }
      }

      return parsed;

    } catch (err) {
      this.log(`   ⚠️ Error auditing page ${page.page}: ${err}`);
      return { items: [], warnings: [{ type: "PAGE_FAILURE", detail: String(err) }] };
    }
  }
}
