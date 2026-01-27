---
name: block-expander-cleaner
description: Fase Intermedia (Normalización Semántica). Toma bloques segmentados y los expande verticalmente, limpia ruido y estructura semánticamente las reglas.
---

# Block Expander Cleaner (v2.0 - Strict)

## 0️⃣ Rol del skill
Tomar bloques ya segmentados y convertirlos en bloques jurídicamente completos, limpios y auditables.

## 1️⃣ Posición en la pipeline
OCR -> Segmentador -> **BlockExpanderCleaner (v2.0)** -> Auditor

## 🚫 Prohibiciones
- ❌ NO crear nuevos bloques
- ❌ NO cambiar `bloque_id`
- ❌ NO inferir coberturas
- ❌ NO tocar asignaciones
- ❌ NO inventar prestadores

## 2️⃣ Inputs
- `segmentation_result.json`
- `extraction_result.json`

## 3️⃣ Correcciones Obligatorias (Reglas v2.0)

### 🔹 1. Estado INVALIDO (Nuevo)
Si un bloque dice "Sin Tope en:" y `prestadores.length === 0`:
- `estado_semantico = "INVALIDO"`
- `razon = "BLOQUE_REQUIERE_PRESTADOR_EXPLICITO"`
- Impacto: Se descarta del canonizador.

### 🔹 2. Cierre por Encabezado de Sección (Hardware Stop)
El escáner vertical se detiene INMEDIATAMENTE si detecta:
- `TOPES DE BONIFICACION`
- `VALORIZACION TOPES`
- `PRESTACIONES DENTALES`
- `NOTAS EXPLICATIVAS`
- `(*)`
- `AMBULATORIAS`

### 🔹 3. Limpieza Dura de Prestadores
Reglas de descarte:
- Longitud < 10 caracteres -> Descartar.
- No coincide con `/Cl[ií]nica|Hospital/i` -> Descartar.
- Se recomienda validar contra una lista blanca (KNOWN_PRESTADORES).

### 🔹 4. Exclusión Automática de Ruido (AC2/UF)
Si `texto` contiene `AC2` | `UF` | `veces`:
- Se marca como RUIDO_ARANCELARIO.
- **NO** se agrega a la lista de prestadores.

### 🔹 5. Libre Elección = REFERENCIAL
Si `modalidad === "libre_eleccion"`:
- `rol = "REFERENCIAL"`
- `excludeFromCanonizador = true`

### 🔹 6. Elegibilidad Canonizador
Un bloque es elegible SI Y SOLO SI:
- `estado_semantico === "LIMPIO"`
- `modalidad === "preferente"`
- `tipo_bloque !== "exclusion_modalidad"`

## Flujo de Estados
- **LIMPIO:** Tiene prestadores válidos (>=2 o explícitos conocidos).
- **PARCIAL:** Tiene prestadores insuficientes o dudas.
- **CONTAMINADO:** Texto sucio irrecuperable.
- **INVALIDO:** Estructura rota (ej: "En:" vacío).
