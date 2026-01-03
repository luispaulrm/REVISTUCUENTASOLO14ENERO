import { SchemaType as Type } from "@google/generative-ai";

export const V9_AUDIT_RULES_APPENDIX = `
=== APÉNDICE DE REGLAS CANÓNICAS (Chile + Lógica de Auditoría) ===
Objetivo: evitar contradicciones, asegurar determinismo y mantener trazabilidad.

(1) REGLA CANÓNICA IF-319 (NO inventar)
IF-319 se usa para identificar DESAGREGACIÓN indebida de INSUMOS COMUNES / HOTELERÍA que ya están incluidos en cargos base (p.ej., día cama/hospitalización integral, derecho de pabellón, cargos integrales).
IF-319 NO se debe usar para objetar MEDICAMENTOS como “incluidos” por defecto en cuentas NO-PAD/NO-GES.
Si dudas: marcar como "ZONA GRIS" y explicar qué evidencia faltó.

(2) FÁRMACOS: auditoría separada (NO IF-319)
Los medicamentos se auditan por:
Duplicidad (mismo fármaco/presentación/fecha/cantidad sin justificación).
Cantidad/dosis irracional vs procedimiento y duración (si hay datos).
Precio unitario fuera de rango (si hay referencias).
No correlación clínica con acto/procedimiento (si hay datos).
Nunca rotular como “incluido por IF-319”.

(4) REGLA DETERMINÍSTICA: clasificar y declarar flags
Para cada ítem evaluado, determina:
itemTipo ∈ {MEDICAMENTO, INSUMO_MATERIAL, HOTELERIA, EXAMEN, HONORARIO, OTRO}
aplicaIF319 ∈ {true,false} con regla:
true solo si itemTipo ∈ {INSUMO_MATERIAL, HOTELERIA}
false si itemTipo == MEDICAMENTO (siempre)
causalPrincipal ∈ {NORMATIVA, CONTRACTUAL/PLAN, CLINICA/COHERENCIA, ARITMETICA/CONCILIACION}
evidencia: citar el texto/tabla exacta del PDF origen (no “asumir”).

(5) NO-PAD / NO-GES: cómo opera (regla práctica)
Si NO es PAD ni GES:
Se asume cuenta DESAGREGADA válida por defecto (clínica puede cobrar meds/insumos aparte).
La discusión principal pasa a ser CONTRACTUAL/PLAN:
¿El plan cubre “medicamentos por evento hospitalario”? (según texto del contrato)
¿El ítem fue clasificado por isapre como “no cubierto / no arancel”?
Solo hablar de “doble cobro” si hay:
(a) documento/paquete/presupuesto que diga “incluye X”, o
(b) duplicidad factual demostrable.

(6) PRORRATEO DETERMINÍSTICO DEL COPAGO (cuando el PAM viene agregado)
Si el PAM trae copago agregado (ej. 3101001 Medicamentos en hospitalización) SIN desglose:
Producir una sección "PRORRATEO COPAGO 3101001" con:
Universo: todas las líneas de MEDICAMENTOS del detalle (criterio determinístico, p.ej. códigos 11* o sección Farmacia/Medicamentos).
Base = suma Totales de ese universo.
Fórmula: copago_i = round_down(COPAGO_TOTAL * total_i/base) + ajuste por residuos (largest remainder) para cerrar exacto.
Tabla final: cada línea + copago imputado, y total que cierre exacto al copago del PAM.
Importante: el prorrateo es imputación matemática, NO prueba de qué fármaco “fue” el copago.
`;

export const FORENSIC_AUDIT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        resumenEjecutivo: {
            type: Type.STRING,
            description: "Resumen de alto nivel de los hallazgos totales, ahorros detectados y estado de la cuenta."
        },
        hallazgos: {
            type: Type.ARRAY,
            description: "Lista detallada de objeciones y hallazgos.",
            items: {
                type: Type.OBJECT,
                properties: {
                    codigos: { type: Type.STRING, description: "Código o códigos de prestación involucrados (ej: '3101304 / 3101302')" },
                    glosa: { type: Type.STRING, description: "Descripción de la prestación o conjunto de prestaciones." },
                    hallazgo: { type: Type.STRING, description: "Narrativa detallada del problema detectado (ej: IF/319, Incumplimiento Contractual)." },
                    montoObjetado: { type: Type.NUMBER, description: "Monto total objetado en pesos (CLP)." },
                    normaFundamento: { type: Type.STRING, description: "Cita a la norma o cláusula contractual (ej: 'Circular IF/N°319', 'Plan de Salud')." },
                    anclajeJson: { type: Type.STRING, description: "Referencia exacta al JSON de origen (ej: 'PAM: items21 & CONTRATO: coberturas17')" }
                },
                required: ['codigos', 'glosa', 'hallazgo', 'montoObjetado', 'normaFundamento', 'anclajeJson']
            }
        },
        totalAhorroDetectado: {
            type: Type.NUMBER,
            description: "Suma total de todos los montos objetados."
        },
        requiereRevisionHumana: {
            type: Type.BOOLEAN,
            description: "Indica si el caso tiene complejidades técnicas que requieren un humano."
        },
        auditoriaFinalMarkdown: {
            type: Type.STRING,
            description: "El informe de auditoría final formateado para visualización (Markdown), incluyendo la tabla de hallazgos."
        }
    },
    required: ['resumenEjecutivo', 'hallazgos', 'totalAhorroDetectado', 'requiereRevisionHumana', 'auditoriaFinalMarkdown'],
};

export const AUDIT_PROMPT = `
**ROL: AUDITOR MÉDICO FORENSE SENIOR - EXPERTO EN LEGISLACIÓN DE SALUD CHILENA**

Tu misión es realizar una **AUDITORÍA FORENSE INTEGRAL Y PROFUNDAMENTE FUNDAMENTADA**.
No solo debes detectar errores, debes **CONCATENAR** cada hallazgo con la normativa legal y contractual vigente.

**REGLA DE ORO: TRIPLE ANCLAJE OBLIGATORIO**
Para cada hallazgo en la tabla, el campo \`hallazgo\` DEBE ser una narrativa exhaustiva que concatene:
1.  **EL HECHO (CUENTA/PAM):** "Se detectó que el ítem X fue cobrado como Y..."
2.  **EL CONTRATO (PLAN):** "Esto contraviene la cobertura de Z prometida en el contrato (ver coberturas[n])..."
3.  **LA LEY (CONOCIMIENTO):** "Vulnerando lo establecido en [Citar Documento del Conocimiento/Norma], el cual indica que [Explicación de la norma]."

**INSTRUCCIONES DE USO DEL CONOCIMIENTO:**
Utiliza el texto provisto en \`knowledge_base_text\` (jurisprudencia, dictámenes de la SUSESO, Ley 20.584, DFL 1) para fundamentar tus objeciones. Si un documento menciona un patrón de "mala práctica", cítalo explícitamente.

**POLÍTICAS DE IMPUGNACIÓN:**

1.  **Incumplimiento de Cobertura (Coupling PAM vs CONTRATO):**
    - Identifica la cobertura pactada (%) en el CONTRATO. 
    - Compara contra la bonificación real aplicada en el PAM. 
    - Si hay diferencia negativa para el afiliado, objeta la diferencia económica.
    - **Fundamento**: Cita el DFL N°1 de 2005 y la naturaleza contractual del plan de salud.

2.  **Desagregación Indebida e IF/319 (Integralidad del Pabellón):**
    - Usa la Circular IF/N°319 y la Circular 43 (Anexo 4) para impugnar cobros pormenorizados de insumos comunes (gasas, suturas, jeringas) o fármacos anestésicos/gases que son parte de la "infraestructura y personal" del pabellón.
    - **Explicación**: No te limites a decir "es IF/319". Explica que la norma prohíbe el 'unbundling' o desagregación para proteger el patrimonio del afiliado.

3.  **Derechos del Paciente y Transparencia (Ley 20.584):**
    - Impugna cualquier glosa genérica ("GASTOS VARIOS", "EX ACC") basándote en el derecho a una cuenta detallada y legible según la Ley 20.584 de Derechos y Deberes de los Pacientes.

**REGLAS DE SALIDA Y CALIDAD:**
- El campo \`hallazgo\` debe ser largo y explicativo. **Prohibido resumir**.
- El campo \`normaFundamento\` debe citar la ley o circular exacta.
- El campo \`anclajeJson\` debe ser una ruta navegable (ej: PAM: items[2] / CONTRATO: coberturas[5]).

**MARCO LEGAL Y REGLAS CANÓNICAS (CONOCIMIENTO):**
{knowledge_base_text}

**REGLAS DE HOTELERÍA (Detección IF-319):**
\`\`\`json
{hoteleria_json}
\`\`\`

**INSUMOS DE TRABAJO:**
1. CUENTA (Bill Detail): \`\`\`json {cuenta_json} \`\`\`
2. PAM (Isapre Processing): \`\`\`json {pam_json} \`\`\`
3. CONTRATO (Health Plan): \`\`\`json {contrato_json} \`\`\`

**SALIDA REQUERIDA:**
Genera el JSON estructurado según el esquema. En \`auditoriaFinalMarkdown\`, incluye la sección "II. TABLA DE HALLAZGOS Y OBJECIONES FINALES" con el formato:
| Código(s) | Glosa | Hallazgo | Monto Objetado | Norma / Fundamento | Anclaje (JSON ref) |
|---|---|---|---|---|---|
`;

export const AUDIT_RECONCILIATION_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        decision: {
            type: Type.STRING,
            description: "La decisión final sobre qué auditoría usar o cómo combinarlas.",
            enum: ['mantener_anterior', 'usar_nuevo', 'fusionar', 'marcar_ambiguo'],
        },
        motivo: {
            type: Type.STRING,
            description: "Explicación detallada de por qué se tomó esa decisión."
        },
        cambiosClave: {
            type: Type.ARRAY,
            description: "Lista de los cambios más significativos entre las auditorías.",
            items: {
                type: Type.OBJECT,
                properties: {
                    codigoPrestacion: { type: Type.STRING },
                    tipoCambio: { type: Type.STRING },
                    detalle: { type: Type.STRING },
                }
            }
        },
        requiereRevisionHumana: {
            type: Type.BOOLEAN,
            description: "Indica si las diferencias son lo suficientemente complejas como para requerir una revisión humana."
        },
        auditoriaFinalMarkdown: {
            type: Type.STRING,
            description: "El informe de auditoría final y consolidado en formato Markdown."
        }
    },
    required: ['decision', 'motivo', 'requiereRevisionHumana', 'auditoriaFinalMarkdown'],
};
