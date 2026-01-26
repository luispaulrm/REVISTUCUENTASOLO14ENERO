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
      tope?: {                  // Tope específico de esta línea si existe
        unidad: string;
        valor: number;
      };
    }>;
    fuente_textual: string;      // "[p.N] ..."
  }>;
  topes_generales: Array<{       // Topes que aplican a todo el plan o grandes grupos
    ambito: "hospitalario" | "ambulatorio" | "mixto";
    descripcion: string;
    unidad: "UF" | "VAM" | "AC2" | "PESOS" | "VECES_ARANCEL" | "DESCONOCIDO";
    tipo_unidad: "monetaria" | "arancel_base" | "multiplicador"; // Semántica
    valor: number | null;
    tope_existe: boolean;        // FALSE si dice "Sin Tope"
    razon?: "SIN_TOPE_EXPRESO_EN_CONTRATO";
    periodo: "anual" | "evento" | "vida";
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
3.  **Agrupación**: Si ves "Consulta Médica" en Red 1 y luego "Consulta Médica" en Red 2, intenta agruparlas en un solo objeto `cobertura` con múltiples `modalidades` si es posible. Si es muy difícil, crea entradas separadas pero **limpias**.

## Output
Retorna SOLO el objeto JSON válido. Sin markdown de código, sin explicaciones.
