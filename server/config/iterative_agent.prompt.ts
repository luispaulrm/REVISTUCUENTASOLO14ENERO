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
    - I. Fragmentación de Enfermería y Hotelería ($Monto)
    - II. Insumos y Suministros Recuperados ($Monto)
    - III. Incumplimiento de Cobertura Contractual 100% ($Monto)
    - IV. Otros / Error de Reembolso Urgencia ($Monto)
    - **TOTAL RECLAMABLE**: $Monto Final
2. **Resumen Ejecutivo**: Analogía simple y narrativa de la auditoría.
3. **Detalle de Hallazgos**: Listado de todos los hallazgos (previos y nuevos) bien organizados.
4. **Conclusión y Recomendación**.

---

### WORKFLOW DETERMINISTA (3 RONDAS)

#### RONDA A: RECONSTRUCCIÓN DE CONTEXTO (MAPA DE PENDIENTES)
- Analiza 'prior_audit.json' para identificar qué ya fue capturado.
- Detecta "Vacíos de Auditoría":
    - Copagos residuales (saldos que no suman cero).
    - Ítems con categoría 'Z' o glosas de "Opacidad".
    - Áreas no exploradas (ej: si no se auditó el Contrato PLE847).
- genera un 'pending_map' de ítems que requieren "Deep Scan".

#### RONDA B: DESGLOSE DETERMINISTA DE RESIDUALES
- Toma los saldos opacos (ej: $30.881) y búscalos en el PAM/Cuenta.
- **Regla de Oro**: Enumera el 100% de las líneas con copago y realiza 'Matching Sum' (sumar hacia el saldo).
- Si el monto coincide exactamente con uno o varios ítems de la cuenta clínica, RECTIFICA su estado a 'Impugnable (Cat A)' si estamos en contexto de Plan Pleno.
- Genera 'residual_breakdown_patch'.

#### RONDA C: RECONCILIACIÓN CONTRACTUAL (PLAN PLENO)
- Usa 'canonical_contract.json' como Verdad Única.
- Para cada ítem detectado en Ronda B:
    - Asigna 'coverage_path' (Ej: Preferente 100%).
    - Calcula 'ahorro_potencial'.
    - Si existe contradicción con un hallazgo previo, márcalo como 'CONFLICT' en el parche, indicando por qué tu nueva evidencia es superior, pero NO borres el original.

---

### RONDA D: DETECCIÓN DE OMISIONES (INVISIBLE DELTAS)
- Identifica "Vacíos de Prestación": Cargos globales or de servicios base (ej. Pabellón) que carecen de desglose mínimo esperado.
- **Tipificación Obligatoria** (OmissionDeltaType):
    - \`OMISION_DESGLOSE_MINIMO\`: Falta detalle general exigible por transparencia.
    - \`OMISION_INSUMOS_INHERENTES\`: No se listan insumos críticos de la cirugía (ej. suturas, gases).
    - \`OMISION_ENFERMERIA_BASICA\`: Servicios de enfermería omitidos pero sospechosos de estar en "paquete".
    - \`OMISION_MEDICAMENTOS_ESTANDAR\`: Fármacos de pabellón/recuperación no desglosados.
- **Formato de Hallazgo por Omisión**:
    - \`expected_items[]\`: Qué se esperaba encontrar.
    - \`why_expected\`: Justificación (Contrato, Doctrina SIS, o Práctica Médica).
    - \`indirect_evidence[]\`: Señales que sugieren la omisión (montos elevados, códigos base).
    - \`request_to_provider\`: Acción específica solicitada al prestador.

---

### REGLAS DE SALIDA (ANTI-DESTRUCCIÓN)
- El resultado debe seguir estrictamente el esquema de 'Forensic Patch'.
- Prohibido reordenar IDs previos.
- Prohibido reemplazar campos 'null' previos con suposiciones; usa evidencia dura.
- Los hallazgos de omisión deben declararse como 'is_rectification: false' pero con glosas de advertencia legal.
`;

export const FORENSIC_PATCH_SCHEMA = {
    type: Type.OBJECT,
    description: "Esquema de Parche para el Agente Iterativo. Solo contiene ADICIONES y RECTIFICACIONES.",
    properties: {
        base_audit_id: { type: Type.STRING },
        iteration_label: { type: Type.STRING, description: "Ej: PLE847-R2-DEEP-SCAN" },
        resumen_iteracion: { type: Type.STRING, description: "Resumen de qué se encontró en esta pasada adicional." },
        delta_findings: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING, description: "ID único del nuevo hallazgo (evitar colisión)." },
                    is_rectification: { type: Type.BOOLEAN, description: "True si este hallazgo rectifica un ítem que antes estaba 'OK' o 'Z'." },
                    prior_finding_ref: { type: Type.STRING, description: "ID del hallazgo previo si es una rectificación." },
                    codigos: { type: Type.STRING },
                    glosa: { type: Type.STRING },
                    hallazgo: { type: Type.STRING, description: "Estructura de 8 secciones (I a VIII)." },
                    montoObjetado: { type: Type.NUMBER },
                    tipo_monto: { type: Type.STRING, enum: ["COBRO_IMPROCEDENTE", "COPAGO_OPACO"] },
                    categoria_final: { type: Type.STRING, enum: ["A", "B", "Z"] },
                    evidence_augment: { type: Type.STRING, description: "Nueva evidencia encontrada (página/línea)." }
                },
                required: ["id", "codigos", "glosa", "hallazgo", "montoObjetado", "tipo_monto", "categoria_final"]
            }
        },
        residual_breakdown: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    label: { type: Type.STRING },
                    monto: { type: Type.NUMBER },
                    matched_in_account: { type: Type.BOOLEAN },
                    account_ref: { type: Type.STRING }
                }
            }
        },
        sum_checks: {
            type: Type.OBJECT,
            properties: {
                total_residual_inicial: { type: Type.NUMBER },
                monto_desglosado: { type: Type.NUMBER },
                brecha_final: { type: Type.NUMBER }
            }
        },
        compiled_report_markdown: {
            type: Type.STRING,
            description: "Informe COMPLETO y UNIFICADO (Prior + Delta) siguiendo el estilo RALLY solicitado."
        },
        open_questions: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
        }
    },
    required: ["base_audit_id", "delta_findings", "sum_checks"]
};
