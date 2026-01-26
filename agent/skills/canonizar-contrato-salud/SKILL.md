---
name: canonizar-contrato-salud
description: Lee contratos de salud en PDF y los convierte a un JSON canónico estable, independiente del layout, para auditoría financiera y legal.
---

# Skill: Canonización de Contratos de Salud (v1.5 Final)

## Objetivo
Transformar contratos de salud heterogéneos (Isapre/Fonasa) en una representación **JSON canónica, semántica y estable**. Este esquema actúa como el "esperanto" de los contratos de salud, permitiendo que cualquier motor de auditoría o simulación trabaje sobre datos normalizados e independientes del diseño visual del PDF.

---

## Repositorio de Aprendizaje (Asistente Semántico)

### Principio Rector (Obligatorio)
👉 **El esquema canónico es inmutable.**
👉 **El aprendizaje ocurre solo en reglas, sinónimos y patrones.**
👉 **Nada aprendido puede alterar el output JSON estructural.**

### Objetivo del Repositorio de Aprendizaje
Construir y mantener un **Diccionario Semántico** que permita:
1.  **Reconocer sinónimos contractuales** (ej: "Día Cama" vs "Estadía Diaria").
2.  **Afinar reglas de clasificación**.
3.  **Reducir `items_no_clasificados`**.
4.  **Aumentar consistencia** entre contratos de distintas Isapres.

*Este repositorio asiste al canonizador, pero no lo reemplaza.*

---

Este skill NO audita, NO interpreta cobros y NO proyecta HTML.
Solo traduce lenguaje contractual a estructura lógica.

---

## Cuándo usar este Skill
- Cuando se cargue un contrato de salud en PDF.
- Antes de cualquier auditoría financiera.
- Antes de cualquier proyección visual.
- Cada vez que el contrato sea la “fuente de verdad”.

---

---

## Esquema Canónico Final (Blueprint v1.7)

El output debe ser un único objeto JSON que cumpla estrictamente con la siguiente interfaz:

```typescript
interface CanonicalContract {
  metadata: {
    origen: "contrato_pdf";
    fuente: string;          // Nombre de la Isapre y Plan
    vigencia: string;        // Fecha de inicio de vigencia o periodo
    tipo_contrato: "ISAPRE" | "FONASA" | "COMPLEMENTARIO" | "DENTAL" | "DESCONOCIDO";
    codigo_arancel?: string; // Nombre/Código del arancel (ej: AC2, V20)
  };
  coberturas: Array<{
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    descripcion_textual: string;
    porcentaje: number | null; // 0 a 100
    red_especifica: string;    // Ej: "Clínica Alemana", "Red UC Christus", "Todas", "desconocido"
    tipo_modalidad: "preferente" | "libre_eleccion" | "restringida" | "ampliada" | "desconocido";
    fuente_textual: string;    // Convención: "[p.N] ...texto literal..."
  }>;
  topes: Array<{
    ambito: "hospitalario" | "ambulatorio" | "mixto" | "desconocido";
    unidad: "UF" | "VAM" | "PESOS" | "DESCONOCIDO";
    valor: number | null;
    aplicacion: "anual" | "por_evento" | "por_prestacion" | "desconocido";
    tipo_modalidad?: "preferente" | "libre_eleccion" | "desconocido";
    fuente_textual: string;    // Convención: "[p.N] ...texto literal..."
  }>;
  deducibles: Array<{
    unidad: "UF" | "VAM" | "PESOS" | "DESCONOCIDO";
    valor: number | null;
    aplicacion: "anual" | "evento" | "desconocido";
    fuente_textual: string;    // Convención: "[p.N] ...texto literal..."
  }>;
  copagos: Array<{
    descripcion: string;
    valor: number;
    unidad: "UF" | "VAM" | "PESOS";
    fuente_textual: string;    // Convención: "[p.N] ...texto literal..."
  }>;
  exclusiones: Array<{
    descripcion: string;
    fuente_textual: string;    // Convención: "[p.N] ...texto literal..."
  }>;
  reglas_aplicacion: Array<{
    condicion: string;
    efecto: string;
    fuente_textual: string;    // Convención: "[p.N] ...texto literal..."
  }>;
  observaciones: string[];
  items_no_clasificados: string[];
}
```

---

## Transformaciones y Normalizaciones Permitidas

Para evitar bugs y facilitar la tokenización, se permiten las siguientes normalizaciones:
1.  **Unidades de Arancel**: Los términos "Veces Arancel", "Veces Arancel Modalidad", "Arancel Convenido", "AC2", "V20", "VA", "VAM" deben mapearse a **`unidad: "VAM"`** (sin alterar el valor numérico).
2.  **Traza de Origen**: Todas las `fuente_textual` deben comenzar con el prefijo de página **`[p.N]`** (ej: `[p.3] 100% de bonificación...`).
3.  **Alcance de Topes**: Cuando el contrato especifique el alcance de un tope (ej: "por grupo familiar", "por beneficiario individual"), capturar esta distinción en un objeto dentro de `reglas_aplicacion` con una descripción clara.
4.  **No Clasificados**: Si una prestación no puede ser categorizada o su unidad es ambigua, usar `ambito: "desconocido"`, `unidad: "DESCONOCIDO"`, y `porcentaje: null`. Si no entra en ninguna entidad, llevar a `items_no_clasificados`.

---

## Reglas de Oro para el Agente

- [ ] Toda inferencia está respaldada por texto.
- [ ] Los no clasificados están explícitos.

---

## 🛑 PROTOCOLO DE VERDAD (ANTI-ALUCINACIÓN)

Para combatir invenciones del modelo, debes seguir estas reglas de extracción **sin excepción**:

1.  **CITA LITERAL O NADA**:
    *   Si el campo es `valor` o `tope`, **DEBES** ser capaz de seleccionar ese número exacto en el PDF.
    *   Si la imagen es borrosa o ambigua, usa `valor: null`. **JAMÁS ADIVINES**.
    
2.  **TEST DE LA LUPA**:
    *   Inválido: PDF dice "1.0 veces" -> JSON dice `2.0 veces`. (Alucinación grave).
    *   Válido: PDF dice "1.0 veces" -> JSON dice `1.0 veces`.
    
3.  **PROHIBICIÓN DE "RELLENO"**:
    *   Si no encuentras el tope de laboratorio en la tabla, **NO COPIES** el de Kinesiología "por si acaso". Déjalo vacío.

Cumplir este protocolo es más importante que llenar todos los campos. Preferimos un JSON incompleto pero VERDADERO a uno completo pero FALSO.

---

## Ejemplo de Salida (Fragmento)

```json
{
  "metadata": {
    "origen": "contrato_pdf",
    "fuente": "Isapre Colmena - Plan Integral 2024",
    "vigencia": "01-01-2024",
    "tipo_contrato": "ISAPRE"
  },
  "coberturas": [
    {
      "ambito": "hospitalario",
      "descripcion_textual": "Día Cama Integral",
      "porcentaje": 100,
      "fuente_textual": "Sección 1: 100% Sin Tope en Red Preferente"
    }
  ],
  "topes": [
    {
      "ambito": "mixto",
      "unidad": "UF",
      "valor": 5000,
      "aplicacion": "anual",
      "fuente_textual": "Tope General Anual por Beneficiario: 5.000 UF"
    }
  ],
  "items_no_clasificados": [
    "Tabla de factores de riesgo 603"
  ]
}
```

---

## Proceso de Validación
Antes de entregar el JSON, el agente debe verificar:
- [ ] ¿El porcentaje es un número entre 0 y 100?
- [ ] ¿La fuente textual es literal?
- [ ] ¿Se capturaron las exclusiones de las páginas finales?
- [ ] ¿Están todos los topes de libre elección?

---

## Output (formato exacto)
El resultado final DEBE ser:
1. Un único objeto JSON
2. Cumpliendo el esquema canónico
3. Sin comentarios
4. Sin texto adicional
