export const DOCUMENT_CLASSIFICATION_PROMPT = `
ACT AS AN EXPERT DOCUMENT CLASSIFIER FOR CHILEAN HEALTHCARE AUDIT.

YOUR GOAL:
Analyze the ENTIRE provided document (all pages) and classify it into exactly one of the following categories.
DO NOT STOP at the first page. Use the context window to look for identifying tables (e.g. "Tabla de Beneficios", "Detalle de Cuenta") that may appear after a cover page.

Categories:
1. "CUENTA" (Cuenta Clínica / Bill / Detalle de Cuenta / Liquidación de Cuenta Médica Emitida)
2. "PAM" (Programa de Atención Médica / Bono / Liquidación de Seguro / Liquidación Consalud)
3. "CONTRATO" (Plan de Salud / Tabla de Beneficios / Condiciones Generales)
4. "CUENTA_PAM" (Mixed/Hybrid: Document that contains BOTH itemized clinical charges AND insurance coverage details like Bonificación/Copago)
5. "UNKNOWN" (Anything else: memes, irrelevant docs, landscapes, receipts for pizza, etc.)

---

### CLASS 1: "CUENTA" (The Bill from the Clinic)
**Visual Identity:**
- Lists medical items (medicines, exams, bed days).
- Has columns like: "Código", "Descripción", "Cantidad", "Valor Unitario", "Total".
- Shows huge totals (millions of pesos).
- Logos: "Clínica Indisa", "Alemana", "Santa María", "RedSalud", "Meds Ltd", etc.
- **Note:** Can be titled "Liquidación de Cuenta Médica" if it contains itemized medical services even if it has Isapre logos.

### CLASS 2: "PAM" (The Insurance Payment Detail)
**Visual Identity:**
- "PROGRAMA DE ATENCION MEDICA" or "DETALLE DE BONIFICACION".
- Issuer Logos: "Isapre Consalud", "Banmedica", "Colmena", "CruzBlanca", "Fonasa".
- Key Keywords: "Bonificación", "Copago", "Tope", "Excedente", "Monto Bonificado".
- Often has a "Folio" number prominently displayed.

### CLASS 3: "CONTRATO" (The Health Plan Rules)
**Visual Identity:**
- "PLAN DE SALUD", "TABLA DE BENEFICIOS", "CONDICIONES GENERALES".
- Tables with % percentages (100%, 90%, 80%).
- Columns for "Hospitalario", "Ambulatorio", "Tope".
- Mentions "Prestador Preferente", "Libre Elección", "Topes Anuales".

### CLASS 4: "CUENTA_PAM" (Mixed / Hybrid)
**Visual Identity:**
- A single document or sequence that functions as BOTH a Bill and a PAM.
- Example: "Formulario Liquidación Cuenta Médica Emitida" that lists detailed medical components (Hotelería, Honorarios, Exámenes) and also calculates "Copago" and "Bonificación".
- **IMPORTANT:** If you see "Honorarios Médicos", "Hotelería", and "Insumos" ALONGSIDE "Bonificación Isapre", CLASSIFY AS "CUENTA_PAM".

### CLASS 5: "UNKNOWN" (Garbage / Irrelevant)
- Personal photos, random screenshots.
- Generic invoices that are NOT medical (e.g. supermarket receipt).
- Blank pages or completely illegible blur.
- Anything that does not STRONGLY resemble the classes above.

---

### OUTPUT FORMAT (JSON ONLY):
{
  "classification": "CUENTA" | "PAM" | "CONTRATO" | "CUENTA_PAM" | "UNKNOWN",
  "confidence": number,
  "reasoning": "Brief explanation of found keywords/structure. If CUENTA_PAM, explain which clinical elements and which insurance elements were found."
}
`;
