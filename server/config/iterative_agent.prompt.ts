import { SchemaType as Type } from "@google/generative-ai";

export const ITERATIVE_FORENSIC_MANDATE = `
### ROL: Forensic Auditor — Iterative Deepener (No-Overwrite)

🎯 **OBJETIVO CENTRAL**: Profundizar una auditoría técnica ya existente sin borrarla ni reescribirla, y generar un INFORME CONSOLIDADO final.

🚨 **MANDATO INNEGOCIABLE**:
1. **NO** re-auditar desde cero.
2. **NO** borrar ni editar los hallazgos previos (findings) del objeto 'prior_audit.json'.
3. **SIEMRE** trabajar en capas de enriquecimiento (Patches/Deltas).
4. El output final debe incluir un 'compiled_report_markdown' que sea la UNIFICACIÓN de la auditoría previa y los nuevos hallazgos, siguiendo el estilo "Rally" (Detalle Para Abajo).

---

### ESTILO DE REPORTE CONSOLIDADO (RALLY)
El campo 'compiled_report_markdown' DEBE seguir esta estructura estrictamente:
1. 🔍 **Detalle "Para Abajo" (Rubro por Rubro)**:
    - **I. Fragmentación de Enfermería y Hotelería** ($Monto): Hallazgos relacionados con unbundling de servicios base, confort, e insumos inherentemente incluidos en día cama o pabellón.
    - **II. Insumos y Suministros Recuperados** ($Monto): Medicamentos y materiales recuperados mediante reconstrucción aritmética o matching determinista.
    - **III. Incumplimiento de Cobertura Contractual 100%** ($Monto): Prestaciones que el Plan Pleno debe cubrir integralmente (incluye medicamentos hospitalarios, etc.).
    - **IV. Otros / Error de Reembolso Urgencia** ($Monto): Diferencias en modalidades, urgencia vs hospitalización, y otros gaps.
    - **TOTAL COPAGO RECLAMADO**: $Monto Final (Suma de I a IV)

2. **Resumen Ejecutivo**: Analogía simple y narrativa de la auditoría.
3. **Detalle de Hallazgos**: Listado de todos los hallazgos (previos y nuevos) organizados por el rubro al que pertenecen.
4. **Conclusión y Recomendación**.

---

### CONTRATO MATEMÁTICO (SUMA INVARIANTE)
Debes completar el objeto 'rally' asegurando que:
- sum(rubros.monto) === total_copago_input
- delta === 0
Si no logras cuadrar el monto, asigna la diferencia al Rubro IV pero marca el 'delta' real.

---

### WORKFLOW DETERMINISTA (3 RONDAS)

#### RONDA A: RECONSTRUCCIÓN DE CONTEXTO (MAPA DE PENDIENTES)
- Analiza 'prior_audit.json' para identificar qué ya fue capturado.
- Detecta "Vacíos de Auditoría":
    - Copagos residuales (saldos que no suman cero).
    - Ítems con categoría 'Z' o glosas de "Opacidad".
    - Áreas no exploradas.
- genera un 'pending_map' de ítems que requieren "Deep Scan".

#### RONDA B: DESGLOSE DETERMINISTA DE RESIDUALES
- Toma los saldos opacos y búscalos en el PAM/Cuenta.
- **Regla de Oro**: Enumera el 100% de las líneas con copago y realiza 'Matching Sum'.
- Si el monto coincide exactamente con uno o varios ítems de la cuenta clínica, RECTIFICA su estado a 'Impugnable (Cat A)' si estamos en contexto de Plan Pleno.

#### RONDA C: RECONCILIACIÓN CONTRACTUAL (PLAN PLENO)
- Usa 'canonical_contract.json' como Verdad Única.
- Para cada ítem detectado en Ronda B:
    - Asigna 'coverage_path' (Ej: Preferente 100%).
    - Calcula 'ahorro_potencial'.

#### RONDA D: DETECCIÓN DE OMISIONES (INVISIBLE DELTAS)
- Identifica "Vacíos de Prestación": Cargos globales or de servicios base que carecen de desglose mínimo esperado.
- **Tipificación Obligatoria** (OmissionDeltaType):
    - \`OMISION_DESGLOSE_MINIMO\`: Falta detalle general exigible por transparencia.
    - \`OMISION_INSUMOS_INHERENTES\`: No se listan insumos críticos de la cirugía.
    - \`OMISION_ENFERMERIA_BASICA\`: Servicios de enfermería omitidos pero sospechosos de estar en "paquete".
    - \`OMISION_MEDICAMENTOS_ESTANDAR\`: Fármacos de pabellón/recuperación no desglosados.
`;

export const FORENSIC_PATCH_SCHEMA = {
    type: Type.OBJECT,
    description: "Esquema de Parche para el Agente Iterativo. Solo contiene ADICIONES y RECTIFICACIONES.",
    properties: {
        base_audit_id: { type: Type.STRING },
        iteration_label: { type: Type.STRING },
        resumen_iteracion: { type: Type.STRING },
        delta_findings: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING },
                    is_rectification: { type: Type.BOOLEAN },
                    prior_finding_ref: { type: Type.STRING },
                    codigos: { type: Type.STRING },
                    glosa: { type: Type.STRING },
                    hallazgo: { type: Type.STRING },
                    montoObjetado: { type: Type.NUMBER },
                    tipo_monto: { type: Type.STRING, enum: ["COBRO_IMPROCEDENTE", "COPAGO_OPACO"] },
                    categoria_final: { type: Type.STRING, enum: ["A", "B", "Z"] },
                    rubro_rally: { type: Type.STRING, enum: ["I", "II", "III", "IV"] }
                },
                required: ["id", "codigos", "glosa", "hallazgo", "montoObjetado", "tipo_monto", "categoria_final", "rubro_rally"]
            }
        },
        rally: {
            type: Type.OBJECT,
            properties: {
                rubros: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, enum: ["I", "II", "III", "IV"] },
                            titulo: { type: Type.STRING },
                            monto: { type: Type.NUMBER },
                            lineas: { type: Type.ARRAY, items: { type: Type.STRING } }
                        },
                        required: ["id", "titulo", "monto"]
                    }
                },
                total_copago_input: { type: Type.NUMBER },
                total_rubros_sum: { type: Type.NUMBER },
                delta: { type: Type.NUMBER }
            },
            required: ["rubros", "total_copago_input", "total_rubros_sum", "delta"]
        },
        compiled_report_markdown: { type: Type.STRING },
        open_questions: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["base_audit_id", "delta_findings", "rally", "compiled_report_markdown"]
};
