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

**OBJETIVO: MÁXIMA DETECCIÓN DE COBROS INDEBIDOS**
Suma CADA ítem individual detectado que esté bien fundado en:
1. Circular IF/N°319 (Insumos en Día Cama/Pabellón)
2. Ley 20.584 (Glosas Genéricas / Transparencia)
3. Evento Único (Urgencia → Hospitalización)
4. Desagregación Indebida de Pabellón (IF-319: INSUMOS COMUNES/HOTELERÍA, NO MEDICAMENTOS)
5. Incumplimiento de Cobertura Contractual (PAM vs CONTRATO)

Prioriza impactos a copago paciente. Verifica suma ≤ copago PAM total.

**REGLA DE ORO: TRIPLE ANCLAJE OBLIGATORIO (FACT → CONTRACT → LAW)**
Para cada hallazgo en la tabla, el campo \`hallazgo\` DEBE ser una narrativa exhaustiva que concatene:
1. **EL HECHO (CUENTA/PAM):** "Se detectó que el ítem X fue cobrado como Y por $Z..."
2. **EL CONTRATO (PLAN):** "Esto contraviene la cobertura de [%] prometida en el contrato (ver coberturas[n])..."
3. **LA LEY (CONOCIMIENTO):** "Vulnerando lo establecido en [Citar Documento del Conocimiento/Norma], el cual indica que [Explicación de la norma]."

**INSTRUCCIONES DE USO DEL CONOCIMIENTO:**
Utiliza el texto provisto en \`knowledge_base_text\` (jurisprudencia, dictámenes SS, Ley 20.584, DFL 1, Circular 43) para fundamentar tus objeciones.

---

## LISTA DE VERIFICACIÓN DE FRAUDE (ZERO-TOLERANCE PATTERNS)
Debes buscar activamente estos códigos y situaciones. Si los encuentras, **IMPUGNAR ES OBLIGATORIO** solo si impacta copago paciente.

### 1. CÓDIGOS 3201001 y 3201002 (GLOSAS GENÉRICAS)
- Si encuentras glosas como "GASTOS NO CUBIERTOS", "INSUMOS VARIOS", "PRESTACION NO ARANCELADA".
- **ACCIÓN:** Objetar el 100% por falta de transparencia (Ley 20.584) si copago > 0 en PAM.
- *Ejemplo real:* "Instalación de Vía Venosa" o "Fleboclisis" cobrada como genérico. Son inherentes al Día Cama.

### 2. CÓDIGOS DE INSUMOS DE HOTELERÍA (CIRCULAR IF-319)
- Busca palabras clave: "TERMOMETRO", "SET DE ASEO", "SABANAS", "ROPA", "KIT DE ASEO", etc.
- Estos insumos de hotelería deben estar incluidos en el Día Cama.
- **ACCIÓN:** Objetar el 100% del copago por Desagregación Indebida si copago > 0 en PAM.
  Si el ítem está completamente bonificado (copago = 0), clasificar como 'ajuste Isapre' (no suma al monto objetado paciente).

### 3. PRINCIPIO DE EVENTO ÚNICO (URGENCIA → HOSPITALIZACIÓN) - REGLA DURA
**SI** existe EVENTO HOSPITALARIO **Y** aparece una prestación de URGENCIA:
- código = "0101031" **O** descripción contiene "URGENCIA"
- **Y** su fecha es el mismo día que \`CUENTA.encabezado.fechaIngreso\` o el día previo (D-1),

**ENTONCES:**
1. Está **PROHIBIDO** clasificarla como "no_impugnar" por "condición ambulatoria".
2. Debes clasificar ese ítem como:
   - "impugnar" si el ítem existe en el UNIVERSO PAM con copago > 0 (monto objetado = copago exacto del PAM).
   - "zona_gris" si NO puedes anclarlo al PAM o NO puedes determinar fecha (monto = 0; requiereRevisionHumana = true; causaInseguridad indicando qué falta).
3. Fundamento mínimo obligatorio cuando sea "impugnar":
   - Citar "Principio de Evento Único" + Dictamen SS N°12.287/2016.
   - Explicar que la urgencia que deriva a hospitalización se reliquida con reglas/cobertura del evento hospitalario.

**EXCEPCIÓN (ÚNICA):**
- Solo puedes dejar 0101031 como "no_impugnar" si encuentras una CLÁUSULA CONTRACTUAL explícita que autorice copago fijo/bonificación distinta para urgencia aun cuando deriva en hospitalización, y la citas (anclaje al contrato).
- Si no encuentras esa cláusula, NO puedes validarla.

### 4. DESAGREGACIÓN INDEBIDA DE PABELLÓN (IF-319: INSUMOS COMUNES/HOTELERÍA, NO MEDICAMENTOS) [ALTA PRIORIDAD]

**ALGORITMO DE DETECCIÓN (EJECUTAR EN ORDEN):**

1. **¿Existe Pabellón en la CUENTA?** Revisa si existe algún código de "Derecho de Pabellón" o Cirugía Mayor (ej. **311013**, **311011**, **311012** o glosa "PABELLON").

2. **¿Existen INSUMOS/MATERIALES/HOTELERÍA en el PAM?** Busca en el PAM ítems con códigos **3101*** o descripciones como "MATERIALES", "INSUMOS", "HOTELERIA" y glosas tipo gasas/guantes/jeringas/campos/mascarillas/catéteres/sueros genéricos/insumos de aseo.
   **NO** uses **3218*** ni "MEDICAMENTOS"/"FARMACIA" para disparar IF-319.

3. **FILTRO DE EXCLUSIONES (WHITELIST):** Verifica si la descripción de esos ítems contiene alguna de estas palabras clave (son las únicas permitidas para cobro aparte):
   - "PRÓTESIS", "PROTESIS"
   - "STENT"
   - "MALLA"
   - "PLACA"
   - "TORNILLO"
   - "OSTEOSINTESIS"
   - "MARCAPASOS"
   - "VÁLVULA", "VALVULA"

**REGLA DE OBJECIÓN AUTOMÁTICA:**
**SI** (Pabellón presente) **Y** (Ítem es insumo/material/hotelería) **Y** (Descripción NO contiene palabras de la Whitelist):
**ENTONCES:** Marca el ítem como "Insumos comunes de pabellón" y **OBJETA EL 100% DEL COPAGO**.

**IMPORTANTE:** Insumos comunes/materiales/hotelería desagregados en contexto de cargo integral; medicamentos se auditan por reglas clínicas/duplicidad/precio, NO por IF-319.

**ACCIÓN:** Suma los copagos de todos los ítems que cumplan esta regla. El derecho de pabellón ya paga los insumos comunes.

**MEDICAMENTOS (NO IF-319):** Se auditan por duplicidad/cantidad/precio/no-correlación; si faltan datos, clasifica como \`zona_gris\` (no objetar automático por IF-319).

### 5. MEDICAMENTOS E INSUMOS EN HOSPITALIZACIÓN (CONTRATO)
- Lee el CONTRATO y detecta reglas sobre "Medicamentos, Materiales e Insumos Clínicos" en hospitalización (ej. porcentajes especiales, topes por evento o por año, coberturas sin tope, etc.).
- Si el contrato indica una cobertura mayor (o 100% sin tope) para medicamentos/insumos hospitalarios y el PAM muestra copago >0 en ítems de medicamentos/insumos (códigos 3101***, 3218*** u otros equivalentes),
- **ACCIÓN:** Impugnar la diferencia entre lo cobrado al paciente y lo que debió ser cubierto, como "Incumplimiento de cobertura contractual".

### 6. EXÁMENES E INSUMOS CLÍNICOS EN EVENTO HOSPITALARIO (e.g., 08xxxx)
- Revisa el contrato por menciones a "Medicamentos, Materiales e Insumos Clínicos", "Evento Hospitalario", "Prestaciones Hospitalarias", "Día Cama Estándar", etc.
- Si hay exámenes o procedimientos claramente inherentes a la cirugía o a la hospitalización (ej. biopsias, estudios histopatológicos, apoyo fluoroscópico intraoperatorio, etc.) con copago >0 en PAM,
- **ACCIÓN:** Impugnar la diferencia como "Desagregación indebida" o "Incumplimiento contractual", según corresponda.

### 7. DETERMINACIÓN DE MODALIDAD (CRÍTICO - ANTES DE AUDITAR)
**PASO 1:** Identifica el PRESTADOR PRINCIPAL en el PAM (ej. "Clinica Santa Maria", "Hospital UC", "Clínica Las Condes").

**PASO 2:** Busca ese nombre en el array \`CONTRATO.coberturas\` dentro de la columna \`MODALIDAD/RED\`.

**PASO 3 - CLASIFICACIÓN:**
- **CASO A (PREFERENTE):** Si el prestador aparece explícitamente en una fila "Preferente", ESA es la cobertura que rige (ej. "100%", "Sin Tope").
- **CASO B (LIBRE ELECCIÓN):** Si el prestador NO aparece en ninguna red preferente, u opera fuera de la red cerrada del plan, APLICA OBLIGATORIAMENTE las reglas de "Libre Elección" (ej. "90% con Tope 5 UF").

**ESTA DETERMINACIÓN ES LA BASE DE TU AUDITORÍA.** No asumas "Preferente" si el prestador no está listado.

### 8. VERIFICACIÓN DE COBERTURA Y TOPES (BASE DE CÁLCULO)
**OBJETIVO:** Detectar si la Isapre pagó MENOS de lo que obligaba la modalidad detectada en el Paso 7.

**LÓGICA:**
1. Toma el ítem del PAM con Copago > 0.
2. Usa la cobertura de la modalidad detectada (Preferente o Libre Elección).
3. Calcula: Bonificación Mínima Contractual.
4. Si (Bonificación Real < Bonificación Mínima) → **OBJETAR LA DIFERENCIA**.

**ZONA GRIS:** Si el contrato es ambiguo sobre el prestador o faltan tablas de Libre Elección, marca como \`zona_gris\`.

---

## SISTEMA DE CONTENCIÓN ANTI-ALUCINACIÓN (SCAA)

**Checkpoint Anti-Alucinación 1 – Anclaje obligatorio:**
Para cada hallazgo:
- Ancla SIEMPRE a referencias JSON explícitas (ej: "CUENTA.secciones[2].items[5]" y "PAM[0].desglosePorPrestador[1].items[3]").
- Nunca objetes más que el **copago** de ese ítem en el PAM.
- Rechaza todo hallazgo que no tenga anclaje claro.

**Checkpoint Anti-Alucinación 2 – Totales vs PAM:**
- Verifica que la suma de todos tus montos objetados sea **<= totalCopago** del PAM correspondiente.
- Si detectas exceso, reduce tus montos y anótalo en el texto del hallazgo ("ajuste por exceso detectado").

---

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

---

**OBLIGATORIO: sección "PRORRATEO COPAGO (si aplica)"**
Si existe copago agregado en PAM sin desglose (ej. 3101001), incluye una sección "PRORRATEO COPAGO (si aplica)" que cierre exacto siguiendo la REGLA CANÓNICA (6) del Apéndice.

**SALIDA REQUERIDA:**
Genera el JSON estructurado según el esquema. En \`auditoriaFinalMarkdown\`, incluye la sección "II. TABLA DE HALLAZGOS Y OBJECIONES FINALES" con el formato:

| Código(s) | Glosa | Hallazgo | Monto Objetado | Norma / Fundamento | Anclaje (JSON ref) |
|---|---|---|---|---|---|

${V9_AUDIT_RULES_APPENDIX}
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
