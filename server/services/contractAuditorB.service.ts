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

  private classifyTableHard(page: any): "COVERAGE_GRID" | "FACTOR_TABLE" | "ARANCEL_CATALOG" | "WAIT_TIMES_TABLE" | "DEFINITIONS_TEXT" | "SERVICE_LEVEL" | "UNKNOWN" {
    const text = (page.cells || []).map((c: any) => c.text).join(" ").toLowerCase();

    // 1. FACTOR_TABLE (Ages, quote types)
    if (text.includes("años") && (text.includes("0 a") || text.includes("65 y mas") || text.includes("mayor de") || text.includes("beneficiario"))) {
      if (!text.includes("hospitalario") && !text.includes("ambulatorio")) {
        return "FACTOR_TABLE";
      }
    }

    // 2. WAIT_TIMES_TABLE (Wait times, days)
    if (text.includes("tiempo máximo") || text.includes("espera") || (text.includes("días") && text.includes("garantía"))) {
      return "WAIT_TIMES_TABLE";
    }

    // 3. ARANCEL_CATALOG (Long lists of codes — even without "código" header)
    const codeMatches = text.match(/\b\d{7}\b/g) || [];
    if (codeMatches.length > 5) {
      return "ARANCEL_CATALOG";
    }

    // 4. DEFINITIONS_TEXT (Footnotes, glossaries, conditions — broad detection)
    const definitionSignals = ["definición", "glosario", "condiciones generales", "nota:", "artículo", "circular",
      "en virtud de", "se entenderá por", "el presente", "se excluye", "exclusion", "restriccion"];
    const hasDefinitions = definitionSignals.some(s => text.includes(s));
    const hasPercentages = (text.match(/%/g) || []).length;
    if (hasDefinitions && hasPercentages < 2) {
      return "DEFINITIONS_TEXT";
    }

    // 5. COVERAGE_GRID (Percentage signs, UF/VA, Modalidades)
    if (hasPercentages < 2) {
      return "UNKNOWN";
    }

    const hasModalities = text.includes("preferente") || text.includes("libre elección") || text.includes("bonificación") || text.includes("tope");
    if (hasPercentages >= 2 && hasModalities) {
      return "COVERAGE_GRID";
    }

    // 6. SERVICE_LEVEL (SLA, Response times, Days for delivery)
    if (text.includes("tiempo") && text.includes("máximo") && (text.includes("entrega") || text.includes("respuesta") || text.includes("plazo") || text.includes("días hábiles"))) {
      return "SERVICE_LEVEL";
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
    const allServiceLevels: any[] = [];
    const detectedSchemaByPage: Record<number, any> = {};

    // Process each page independently to ensure completeness
    for (const page of layoutDoc.doc.pages) {
      this.log(`Analizando página ${page.page}...`);

      const tableType = this.classifyTableHard(page);
      this.log(`   🔍 Clasificación Determinista: ${tableType}`);

      if (tableType !== "COVERAGE_GRID" && tableType !== "UNKNOWN" && tableType !== "SERVICE_LEVEL") {
        this.log(`   ⏭️ Saltando página ${page.page} (Tipo: ${tableType})`);
        continue;
      }

      this.log(`   🚀 Iniciando auditoría semántica en página ${page.page}...`);
      // Do not pass global detectedSchema. Force each page to identify its own schema to prevent cross-page contamination.
      const pageResult = await this.auditSinglePage(page, null, anchors);

      if (pageResult.items && pageResult.items.length > 0) {
        allItems.push(...pageResult.items);
        this.log(`   ✅ Página ${page.page}: ${pageResult.items.length} items extraídos.`);
      }

      if (pageResult.service_levels && pageResult.service_levels.length > 0) {
        allServiceLevels.push(...pageResult.service_levels);
        this.log(`   ✅ Página ${page.page}: ${pageResult.service_levels.length} niveles de servicio extraídos.`);
      }

      if (pageResult.detectedSchema && !detectedSchemaByPage[page.page]) {
        detectedSchemaByPage[page.page] = pageResult.detectedSchema;
        this.log(`   📍 Esquema de columnas detectado en página ${page.page}.`);
      }

      if (pageResult.warnings) {
        allWarnings.push(...pageResult.warnings.map((w: any) => ({ ...w, detail: `[Pág ${page.page}] ${w.detail}` })));
      }
    }

    this.log(`✅ Auditoría completada. Total items: ${allItems.length}`);

    // --- POST-PROCESSING ---
    // A1: Rule Backfilling (Vertical Spans)
    // If an item has rules but no 'item' name, and it follows an item with the same 'ambito',
    // attach its rules to that predecessor.
    let lastValidItem: any = null;
    const itemsToKeep: any[] = [];

    for (const item of allItems) {
      const isOrphan = !item.item || item.item.trim() === "" || item.item.toLowerCase() === "unknown" || item.item.toLowerCase() === "item";
      if (isOrphan) {
        if (lastValidItem && item.ambito === lastValidItem.ambito) {
          this.log(`   🔗 Backfilling reglas para "${lastValidItem.item}" desde bloque huérfano.`);
          // Merge rules
          if (item.preferente?.rules) {
            item.preferente.rules.forEach((r: any) => {
              lastValidItem.preferente.rules.push({
                ...r,
                attached_by: "BLOCK_SPAN_BACKFILL"
              });
            });
          }
          if (item.libre_eleccion?.rules) {
            item.libre_eleccion.rules.forEach((r: any) => {
              lastValidItem.libre_eleccion.rules.push({
                ...r,
                attached_by: "BLOCK_SPAN_BACKFILL"
              });
            });
          }
          continue; // Don't add orphans to main list
        }
      } else {
        lastValidItem = item;
      }
      itemsToKeep.push(item);
    }

    return {
      docMeta: {
        docId: layoutDoc.doc.docId,
        source: "contract_audit_topology",
        totalPages: layoutDoc.doc.pages.length
      },
      detectedSchema: Object.keys(detectedSchemaByPage).length > 0 ? detectedSchemaByPage : null,
      service_levels: allServiceLevels,
      items: itemsToKeep,
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

    // Pre-compute explicit cellId whitelist for anti-hallucination
    const validCellIds = (page.cells || []).map((c: any) => c.cellId).filter(Boolean);

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
    "item_col": "EXTRACT EXACT cellId FROM TOPOLOGY (e.g. p1_c_0_0) | null",
    "preferente_pct_col": "EXTRACT EXACT cellId FROM TOPOLOGY | null",
    "preferente_tope_evento_col": "EXTRACT EXACT cellId FROM TOPOLOGY | null",
    "preferente_tope_anual_col": "EXTRACT EXACT cellId FROM TOPOLOGY | null",
    "libre_pct_col": "EXTRACT EXACT cellId FROM TOPOLOGY | null",
    "libre_tope_evento_col": "EXTRACT EXACT cellId FROM TOPOLOGY | null",
    "libre_tope_anual_col": "EXTRACT EXACT cellId FROM TOPOLOGY | null"
  },
  "items": [
    {
      "ambito": "DIA_CAMA|PABELLON|HONORARIOS|MEDICAMENTOS|MATERIALES|EXAMENES|PROTESIS|QUIMIOTERAPIA|URGENCIA|AMBULATORIO|OTROS",
      "item": "string",
      "preferente": {
        "rules": [
          {
            "subred_id": "PREF_TIER_1|PREF_TIER_2|LIBRE_ELECCION|string",
            "condiciones": ["MEDICOS_STAFF", "VENTA_BONO", "INSTITUCIONAL", "string"],
            "porcentaje": number|null,
            "clinicas": ["string"],
            "tope_evento": { 
                "estado": "CON_TOPE|SIN_TOPE_ITEM|SUB_LIMITE", 
                "valor": number|null, 
                "unidad": "UF|VA|SIN_TOPE|UNKNOWN", 
                "tipo": "TOPE_BONIFICACION|COPAGO_FIJO",
                "sujeto_tope_general_anual": boolean 
            },
            "tope_anual": { 
                "estado": "CON_TOPE|SIN_TOPE_ITEM|UNKNOWN", 
                "valor": number|null, 
                "unidad": "UF|VA|SIN_TOPE|UNKNOWN" 
            },
            "copago_fijo": { "valor": number, "unidad": "UF|CLP" } | null,
            "evidence": { "page": ${page.page}, "cells": [ { "cellId": "string", "text": "string" } ] }
          }
        ]
      },
      "libre_eleccion": {
        "rules": [
          {
            "subred_id": "LIBRE_ELECCION",
            "condiciones": [],
            "porcentaje": number|null,
            "clinicas": ["string"],
            "tope_evento": { 
                "estado": "CON_TOPE|SIN_TOPE_ITEM", 
                "valor": number|null, 
                "unidad": "UF|VA|SIN_TOPE|UNKNOWN", 
                "tipo": "TOPE_BONIFICACION",
                "sujeto_tope_general_anual": boolean 
            },
            "tope_anual": { 
                "estado": "CON_TOPE|SIN_TOPE_ITEM|UNKNOWN", 
                "valor": number|null, 
                "unidad": "UF|VA|SIN_TOPE|UNKNOWN" 
            },
            "copago_fijo": { "valor": number, "unidad": "UF|CLP" } | null,
            "evidence": { "page": ${page.page}, "cells": [ { "cellId": "string", "text": "string" } ] }
          }
        ]
      }
    }
  ],
  "service_levels": [
    {
      "item": "string",
      "valor": number,
      "unidad": "DIAS|HORAS|PERCENT",
      "evidence": { "page": ${page.page}, "cells": [ { "cellId": "string", "text": "string" } ] }
    }
  ],
  "warnings": [
    {
      "type": "string",
      "detail": "string"
    }
  ]
}

CRITICAL HARD CONSTRAINTS:
1. DO NOT INVENT cellIds under any circumstances.
2. The ONLY VALID cellIds for this page are EXACTLY: [${validCellIds.join(', ')}]. ANY cellId NOT in this list is FORBIDDEN.
3. Search the 'text' of the cells to find the headers, then use the EXACT 'cellId' corresponding to that text.
4. If a column header does not exist, use null.
5. The 'warnings' array must strictly contain objects with 'type' and 'detail' string properties. Do not return arrays of characters or strings.
6. For "ambito", use the MOST SPECIFIC value: DIA_CAMA for beds, PABELLON for surgical rooms, HONORARIOS for doctor fees, MEDICAMENTOS for drugs, MATERIALES for clinical supplies, EXAMENES for lab/imaging, PROTESIS for prosthetics, QUIMIOTERAPIA for chemo, URGENCIA for emergency, AMBULATORIO for outpatient. Use OTROS only if no specific match.

SPECIAL RULES:
- V.A / VA / Veces Arancel -> NORMALIZAR SIEMPRE A "VA".
- Copago Fijo (Urgencia) -> Mapear a "copago_fijo" y poner "tipo": "COPAGO_FIJO" en el tope.
- Empty Cells (-) -> "UNKNOWN", nunca "SIN_TOPE".
- Merged Cells & Spatial Index -> Use "spatialIndex" to see which row range a merged cell spans. If a cell spans rows 5-10, APPLY ITS RULES TO ALL ITEMS IN ROWS 5-10.
- Multi-Percentage Blocks -> If a preferente block contains "100% Dávila, 90% Indisa", create TWO rules in the "rules" array.
- Rule Conditions extraction -> MUST look for text patterns in the cells:
    * "(Médicos Staff)" or "(Staff)" -> Add "MEDICOS_STAFF" to condiciones.
    * "(Sólo con Bonos)" or "(Bono)" -> Add "VENTA_BONO" to condiciones.
    * "(Sólo Institucional)" or "(En Institución)" -> Add "INSTITUCIONAL" to condiciones.
- Subred Identification -> Assign subred_id like "PREF_TIER_1" for the highest coverage group, "PREF_TIER_2" for the next, and "LIBRE_ELECCION" for LE rules.
- "Sin Tope" Normalization ->
    * If cell says "Sin Tope", set estado: "SIN_TOPE_ITEM", valor: null, unidad: "SIN_TOPE".
    * If cell has a value (e.g., "5 UF"), set estado: "CON_TOPE", valor: 5, unidad: "UF".
    * TOPE ANUAL INFERENCE (A2): If tope_evento.estado is "SIN_TOPE_ITEM" and no specific annual limit/number is shown for that item, SET tope_anual.estado: "SIN_TOPE_ITEM" and unidad: "SIN_TOPE" by default.
    * sujeto_tope_general_anual: ALMOST ALWAYS TRUE for Isapre contracts, unless item explicitly says "No sujeto a tope general".
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
      const anchorCol = schema.item_col || schema.prestacion_col; // Fallback in case LLM uses the old name
      const hasBasicCols = !!anchorCol; // We only strictly need item_col to anchor the rows. % cols can be null if merged.
      const isCollapsed = schema.preferente_pct_col && schema.preferente_pct_col === schema.preferente_tope_evento_col;

      // Strict validation: Does the anchor cell actually exist in the page geometry?
      const anchorCellExists = page.cells && page.cells.some((c: any) => c.cellId === anchorCol);

      if (!hasBasicCols) {
        this.log(`   ⚠️ Error: Falló anclaje en pág ${page.page}. El LLM no identificó 'item_col'.`);
        return {
          items: [],
          warnings: [{ type: "MISSING_HEADERS", detail: `No se identificó la celda cabecera de la columna de prestaciones. Schema devuelto: ${JSON.stringify(schema)}` }],
          detectedSchema: null
        };
      }

      if (anchorCol && !anchorCellExists) {
        this.log(`   ⚠️ Error: Falló anclaje en pág ${page.page}. Celda '${anchorCol}' no existe en geometría.`);
        return {
          items: [],
          warnings: [{ type: "INVALID_HEADERS", detail: `El LLM inventó un ID de celda (${anchorCol}) que no existe en el Input Topology.` }],
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
