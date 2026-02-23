import { GeminiService } from './gemini.service.js';
import { LayoutGridDoc, LayoutGridPage } from './contractTypes.js';

export class ContractLayoutExtractorA {
  private gemini: GeminiService;
  private logCallback?: (msg: string) => void;

  constructor(gemini: GeminiService, logCallback?: (msg: string) => void) {
    this.gemini = gemini;
    this.logCallback = logCallback;
  }

  private log(msg: string) {
    console.log(`[ExtractorA] ${msg}`);
    if (this.logCallback) this.logCallback(msg);
  }

  /**
   * Extracts layout grid info from a PDF page using geometry-first approach.
   */
  async extractPageLayout(
    pageImage: string, // base64
    mimeType: string,
    pageNumber: number,
    docId: string,
    filename: string
  ): Promise<LayoutGridPage> {
    const prompt = `
MODULE: CONTRACT_LAYOUT_EXTRACTOR_A (Grid-from-Geometry v1.0)
# Purpose: Produce a deterministic, geometry-first JSON from PDF pages that contain “rectangle/box” grid layouts.
# INSTRUCTION: You are receiving a document (or image). Extract data exclusively from PAGE ${pageNumber}.
# HARD RULES
# - Do NOT infer medical meaning, categories, or coverage rules.
# - Do NOT “propagate” values.
# - Do NOT guess missing values. Empty remains empty.
# - Always preserve page number (${pageNumber}), coordinates (TOP_LEFT), and raw text exactly as observed.
# - IMPORTANT: All cellId and rectId MUST be prefixed with "p${pageNumber}_" (e.g., "p${pageNumber}_c_0_0"). This is mandatory to prevent collisions across pages.
# - If unsure about a cell boundary, return it as an issue and keep raw tokens.
# - Output MUST be valid JSON matching the LayoutGridPage schema.

EXTRACTION ALGORITHM:
Step 1 — Page segmentation: Detect grid-like regions.
Step 2 — Geometry detection: Detect table lines or box borders.
Step 3 — Rectangle → cell decomposition: Convert detected lines/rectangles into cell candidates. Resolve merged cells (rowSpan/colSpan).
Step 4 — Text assignment: Assign tokens to cells by bbox intersection. Preserve line breaks.
Step 5 — No propagation: Do not fill empty cells.
Step 6 — Confidence: Provide confidence per cell (0.0-1.0).

Return exactly the JSON for a single page matching the schema:
{
  "page": ${pageNumber},
  "coordSystem": "TOP_LEFT",
  "pageSize": { "width": number, "height": number, "unit": "px" },
  "dpi": number|null,
  "grid": {
    "verticalLines": [number...],
    "horizontalLines": [number...],
    "rectangles": [
      {
        "rectId": "string",
        "bbox": { "x0": number, "y0": number, "x1": number, "y1": number },
        "kind": "CELL" | "RULE_BOX" | "HEADER" | "FOOTER" | "UNKNOWN",
        "strokeDetected": boolean,
        "fillDetected": boolean
      }
    ]
  },
  "cells": [
    {
      "cellId": "string",
      "bbox": { "x0": number, "y0": number, "x1": number, "y1": number },
      "row": number|null,
      "col": number|null,
      "rowSpan": number,
      "colSpan": number,
      "kind": "CELL" | "RULE_BOX" | "COLUMN_BLOCK" | "ROW_BLOCK" | "UNKNOWN",
      "text": "string",
      "tokens": [ { "text": "string", "bbox": { "x0": number, "y0": number, "x1": number, "y1": number } } ],
      "empty": boolean,
      "emptyReason": "NONE" | "BORDER_ONLY" | "OCR_MISS" | "NOT_IN_IMAGE",
      "confidence": number
    }
  ],
  "issues": [
    {
      "code": "NO_GRID_LINES" | "AMBIGUOUS_CELL_BOUNDARY" | "OVERLAPPING_CELLS" | "TOKEN_OUTSIDE_ANY_CELL" | "PARTIAL_PAGE_RENDER" | "LOW_CONFIDENCE_PAGE",
      "severity": "info" | "warn" | "error",
      "message": "string",
      "debug": { "any": "json" }
    }
  ]
}
`;

    const responseText = await this.gemini.extract(pageImage, mimeType, prompt, {
      responseMimeType: "application/json"
    });

    try {
      const pageData = JSON.parse(responseText);
      // Defensive: Ensure the page number property exists as expected by Auditor B
      if (pageData && typeof pageData === 'object') {
        pageData.page = pageData.page || pageNumber;
        pageData.spatialIndex = this.computeSpatialIndex(pageData.cells);
      }
      return pageData;
    } catch (err) {
      this.log(`❌ Error parseando JSON para página ${pageNumber}: ${err}`);
      throw new Error(`Failed to parse layout JSON for page ${pageNumber}`);
    }
  }

  private computeSpatialIndex(cells: any[]): { cellsByRow: Record<number, string[]>, cellsByCol: Record<number, string[]> } {
    const cellsByRow: Record<number, string[]> = {};
    const cellsByCol: Record<number, string[]> = {};

    (cells || []).forEach(cell => {
      if (cell.row !== null && cell.row !== undefined) {
        // Handle rowSpan
        for (let r = cell.row; r < cell.row + (cell.rowSpan || 1); r++) {
          if (!cellsByRow[r]) cellsByRow[r] = [];
          cellsByRow[r].push(cell.cellId);
        }
      }
      if (cell.col !== null && cell.col !== undefined) {
        // Handle colSpan
        for (let c = cell.col; c < cell.col + (cell.colSpan || 1); c++) {
          if (!cellsByCol[c]) cellsByCol[c] = [];
          cellsByCol[c].push(cell.cellId);
        }
      }
    });

    return { cellsByRow, cellsByCol };
  }

  async extractDocLayout(
    pages: { image: string, mimeType: string }[],
    docId: string,
    filename: string
  ): Promise<LayoutGridDoc> {
    const layoutPages: LayoutGridPage[] = [];

    for (let i = 0; i < pages.length; i++) {
      this.log(`Procesando página ${i + 1}/${pages.length}...`);
      const pageLayout = await this.extractPageLayout(
        pages[i].image,
        pages[i].mimeType,
        i + 1,
        docId,
        filename
      );
      this.log(`✅ Página ${i + 1} completada.`);
      layoutPages.push(pageLayout);
    }

    return {
      module: "CONTRACT_LAYOUT_EXTRACTOR_A",
      version: "1.0",
      doc: {
        docId,
        source: { filename },
        pages: layoutPages
      }
    };
  }
}
