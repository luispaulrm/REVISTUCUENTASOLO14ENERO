---
name: canonizar-contrato-salud
description: Lee contratos de salud en PDF y los convierte a un JSON canónico semántico y limpio, discriminando coberturas reales de metadatos y topes.
---

# Skill: Canonización de Contratos de Salud (v2.0 Semántica)

## Objetivo
Transformar contratos de salud heterogéneos (Isapre/Fonasa) en una representación **JSON canónica, semántica y limpia**. El objetivo es auditar financieramente, por lo que la precisión en **topes, unidades y ámbitos** es crítica.

---

## 🛑 REGLAS DE ORO ANTIRUIDO (CRÍTICO)

### 1. Limpieza de Coberturas
El array `coberturas` debe contener **SOLO prestaciones clínicas**.
- **PROHIBIDO** incluir en `coberturas`:
  - Rangos etarios ("0 a menos de 2 años", "80 y más años").
  - Factores o primas (GES, CAEC).
  - Títulos de tablas ("TABLA DE BENEFICIOS", "MODALIDAD INSTITUCIONAL").
  - Textos vacíos o símbolos sueltos ("%", "*").
  - Metadatos del plan ("TIPO DE PLAN", "USO DEL PLAN").

### 2. Clasificación de Ámbito (Keywords)
No usar "desconocido" perezosamente. Aplicar estas reglas de inferencia:
- **HOSPITALARIO**: Si contiene `pabellón`, `quirúrgic`, `anestesia`, `día cama`, `hospital`, `UCI`, `UTI`, `medicamentos en hospitalización`.
- **AMBULATORIO**: Si contiene `consulta médica`, `exámenes`, `imagenología`, `procedimientos ambulatorios`.
- **MIXTO**: Solo si explícitamente aplica a ambos o es un tope global.

### 3. Porcentajes vs Factores (No confundir)
- **Porcentaje**: Valor entre 0 y 100.
- **Factor/Tope**:
  - Si valor > 1.0 (ej: 1.2, 2.0) -> Es un FACTOR o TOPE, **nunca** un porcentaje.
  - Si valor <= 1.0 pero la unidad es AC2, UF, VAM -> Es un TOPE/FACTOR.

### 4. Semántica de "SIN TOPE"
"SIN TOPE" **NO** es "DESCONOCIDO". Es información jurídica positiva.
- Mapear a: `{ "tope_existe": false, "razon": "SIN_TOPE_EXPRESO_EN_CONTRATO", "valor": null, "unidad": null }`.

---

## Esquema Canónico Final (v2.0)

El output debe ser un único objeto JSON que cumpla estrictamente con la siguiente interfaz:

```typescript
interface CanonicalContract {
  metadata: {
    origen: "contrato_pdf";
    fuente: string;          // Nombre de la Isapre y Plan
    vigencia: string;        // Fecha inicio
    tipo_contrato: "ISAPRE" | "FONASA" | "COMPLEMENTARIO";
  };
  coberturas: Array<{
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    descripcion_textual: string; // Nombre limpio de la prestación (ej: "Día Cama")
    porcentaje: number | null;   // 0-100. NULL si no es % de cobertura directa.
    modalidades: Array<{        // Agrupar aquí las variantes
      tipo: "preferente" | "libre_eleccion" | "institucional";
      red?: string;
      porcentaje?: number;
      tope?: {                  // JOÍN LÓGICO ESTRICTO: Si hay tope específico, VA AQUÍ.
        unidad: string;
        valor: number;
        // -- CAMPOS DE VALORIZACIÓN (CAPA 2) --
        // El agente deja estos en null, el código auditor los llenará.
        valor_clp?: number | null; 
        fecha_valorizacion?: string | null;
        fuente_valorizacion?: string | null;
      };
    }>;
    fuente_textual: string;      // "[p.N] ..."
  }>;
  topes_generales: Array<{
    ambito: "hospitalario" | "ambulatorio" | "mixto";
    descripcion: string;
    
    // --- OONTOLOGÍA UCA v1.0 ---
    unidad: "UF" | "PESOS" | "VA" | "VAM" | "AC" | "AC2" | "V20" | "AM" | "UCR" | "SIN_TOPE" | "DESCONOCIDO";
    familia: "monetaria_publica" | "arancelaria_privada" | "clausula_juridica" | "indeterminada"; 
    tipo_logico: "valor_absoluto" | "multiplicador" | "ausencia_limite" | "indeterminada";
    riesgo_juridico?: "Alto" | "Medio" | "Bajo" | "Muy Alto";
    // ---------------------------

    valor: number | null;
    tope_existe: boolean;
    razon?: "SIN_TOPE_EXPRESO_EN_CONTRATO";
    periodo: "anual" | "evento" | "vida";
    fuente_textual: string;
  }>;

... (rest of schema)

### 📌 Referencia: Tabla Ontológica de Unidades (UCA v1.0)
Usa esta tabla para llenar `familia`, `tipo_logico` y `riesgo_juridico`:

| Sigla | Familia | Tipo Lógico | Riesgo |
| :--- | :--- | :--- | :--- |
| **UF / PESOS** | `monetaria_publica` | `valor_absoluto` | Bajo |
| **VA / VAM / AC / AC2 / V20** | `arancelaria_privada` | `multiplicador` | Alto |
| **SIN_TOPE** | `clausula_juridica` | `ausencia_limite` | Bajo |
| **DESCONOCIDO** | `indeterminada` | `indeterminada` | Muy Alto |
  glosario_unidades: Array<{     // NUEVO: Definiciones explícitas encontradas en el texto
    sigla: string;               // Ej: "AC2", "VAM"
    descripcion_contrato: string;// Ej: "Arancel Colmena 2.0 reajustable..."
    valor_referencia?: number;   // Si el contrato dice "valor referencial $35.000"
    fuente_textual: string;
  }>;
  items_no_clasificados: string[]; // Todo lo que no sea prestación clínica ni tope claro
}
```

### Detalle de Tipos de Unidad Arancelaria
Si encuentras siglas como **AC2, VA, VAM**:
- `unidad`: Mantener la sigla original ("AC2", "VAM").
- `tipo_unidad`: **"arancel_base"**.
- `interpretable_como`: "multiplicador".

### Ejemplo de Mapeo Semántico

**(A) Caso "Sin Tope"**
 Texto PDF: *"Día Cama: 100% Sin Tope"*
 ```json
 {
   "descripcion_textual": "Día Cama",
   "porcentaje": 100,
   "modalidades": [{ "tipo": "libre_eleccion", "tope": { "tope_existe": false, "razon": "SIN_TOPE_EXPRESO_EN_CONTRATO" } }]
 }
 ```

**(B) Caso Arancel AC2**
 Texto PDF: *"Honorarios: Tope 2.2 AC2"*
 ```json
 {
   "unidad": "AC2",
   "tipo_unidad": "arancel_base",
   "valor": 2.2
 }
 ```

---

## Instrucciones de Procesamiento

1.  **Lectura Secuencial**: Lee página por página. Mantén el contexto de la tabla actual (cabeceras).
2.  **Filtrado Activo**: Antes de agregar algo a `coberturas`, pregúntate: *¿Es esto una prestación médica?* Si es una edad, un precio en pesos o una cabecera, **IGÑÓRALO** o ponlo en metadata si corresponde.
3.  **FASE DE NORMALIZACIÓN OBLIGATORIA (GroupBy)**:
    Antes de generar el JSON final, debes ejecutar mentalmente un proceso de agrupación:
    ```javascript
    groupBy(prestacion_normalizada, ambito)
    ```
    - Si tienes 3 entradas para "Consulta Médica" (una por cada red/clínica), **FUSIÓNALAS** en un solo objeto `cobertura`.
    - Mueve las diferencias (porcentaje, tope, red) al array `modalidades`.
    - **Resultado esperado**: Una lista limpia de prestaciones únicas, donde cada una contiene todas sus variantes de cobertura. NO REPETIR la misma prestación 3 veces.

## Output
Retorna SOLO el objeto JSON válido. Sin markdown de código, sin explicaciones.
