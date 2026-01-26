---
name: canonizar-contrato-salud
description: Lee contratos de salud en PDF y los convierte a un JSON canónico estable, independiente del layout, para auditoría financiera y legal.
---

# Skill: Canonización de Contratos de Salud

## Objetivo
Transformar contratos de salud heterogéneos (Isapre/Fonasa) en una representación
JSON canónica, semántica y estable, sin depender de tablas, posiciones ni diseño visual.

Este skill NO audita, NO interpreta cobros y NO proyecta HTML.
Solo traduce lenguaje contractual a estructura lógica.

---

## Cuándo usar este Skill
- Cuando se cargue un contrato de salud en PDF.
- Antes de cualquier auditoría financiera.
- Antes de cualquier proyección visual.
- Cada vez que el contrato sea la “fuente de verdad”.

---

## Inputs necesarios (obligatorios)
1) Archivo PDF del contrato de salud.
2) Contexto mínimo:
   - Tipo de contrato: Isapre / Fonasa / Complementario (si se conoce).
   - Año o vigencia aproximada (si está disponible).

Si falta algún input crítico, el skill DEBE preguntar antes de continuar.

---

## Principio rector (regla absoluta)
👉 **No inferir estructura nueva.**
👉 **No crear campos fuera del esquema canónico.**
👉 **Si algo no calza, se marca como `NO_CLASIFICADO`.**

---

## Esquema Canónico Base (inmutable)

El output DEBE ajustarse a esta estructura mínima:

```json
{
  "metadata": {
    "origen": "contrato_pdf",
    "fuente": "",
    "vigencia": "",
    "tipo_contrato": ""
  },
  "coberturas": [],
  "topes": [],
  "deducibles": [],
  "copagos": [],
  "exclusiones": [],
  "reglas_aplicacion": [],
  "observaciones": [],
  "items_no_clasificados": []
}
```

Ningún otro campo está permitido.

## Definiciones Canónicas

### Cobertura
Elemento que indica porcentaje o forma de financiamiento de una prestación.

Campos mínimos:
```json
{
  "ambito": "hospitalario | ambulatorio | mixto | desconocido",
  "descripcion_textual": "",
  "porcentaje": null,
  "fuente_textual": ""
}
```

### Tope
Límite máximo de financiamiento.

Campos mínimos:
```json
{
  "ambito": "hospitalario | ambulatorio | mixto | desconocido",
  "unidad": "UF | VAM | PESOS | DESCONOCIDO",
  "valor": null,
  "aplicacion": "anual | por_evento | por_prestacion | desconocido",
  "fuente_textual": ""
}
```

### Deducible
Monto que debe pagar el afiliado antes de activar cobertura.

```json
{
  "unidad": "UF | VAM | PESOS | DESCONOCIDO",
  "valor": null,
  "aplicacion": "anual | evento | desconocido",
  "fuente_textual": ""
}
```

### Exclusión
Prestación o situación expresamente no cubierta.

```json
{
  "descripcion": "",
  "fuente_textual": ""
}
```

### Regla de aplicación
Condición que modifica cómo se aplican coberturas o topes.

```json
{
  "condicion": "",
  "efecto": "",
  "fuente_textual": ""
}
```

---

## Workflow del Skill

### Paso 1 — Lectura semántica
- Leer el contrato completo.
- Ignorar tablas, diseño y geometría.
- Trabajar solo con significado del texto.

### Paso 2 — Detección de candidatos
- Identificar frases que correspondan a:
  - Coberturas
  - Topes
  - Deducibles
  - Exclusiones
  - Reglas
- Cada fragmento debe conservar su fuente textual literal.

### Paso 3 — Canonización
Para cada candidato:
- Mapearlo a una entidad canónica.
- Completar SOLO los campos definidos.
- Si falta información → usar null o desconocido.
- Nunca inventar valores.

### Paso 4 — Control de errores
- Si un fragmento no puede clasificarse → items_no_clasificados.
- Nunca forzar una clasificación incorrecta.

### Paso 5 — Validación final
Checklist obligatoria:
- [ ] El JSON cumple exactamente el esquema.
- [ ] No hay campos inventados.
- [ ] Toda inferencia está respaldada por texto.
- [ ] Los no clasificados están explícitos.

---

## Output (formato exacto)
El resultado final DEBE ser:
1. Un único objeto JSON
2. Cumpliendo el esquema canónico
3. Sin comentarios
4. Sin texto adicional
