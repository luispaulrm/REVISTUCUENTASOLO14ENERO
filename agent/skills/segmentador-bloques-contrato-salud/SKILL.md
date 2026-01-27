---
name: segmentador-bloques-contrato-salud
description: Detecta y segmenta bloques verticales de cobertura (porcentaje, tope o cláusula) en tablas de contratos de salud, asociados a modalidad (preferente / libre elección), preservando trazabilidad completa.
---

# Segmentador de Bloques de Contrato de Salud (v1.0)

## 🎯 OBJETIVO
Transformar un JSON lineal (salida del extractor) en una estructura que:
- Identifique bloques de cobertura verticales
- Distinga modalidades (oferta preferente / libre elección)
- Asigne cada prestación a un bloque sin copiar valores
- Mantenga trazabilidad jurídica total

👉 **Este skill NO decide si algo es válido o ilegal.** Solo modela lo que el contrato dice.

## 🧠 CONCEPTOS CLAVE (OBLIGATORIOS)

### 1️⃣ Modalidad
Eje horizontal de la tabla:
- `preferente`
- `libre_eleccion`
- `institucional` (si aparece explícito)

### 2️⃣ Bloque
Regla vertical que se aplica a múltiples prestaciones:
- Porcentaje + tope
- Porcentaje “Sin Tope”
- Cláusula jurídica (“Solo cobertura libre elección”)

## 🛑 REGLAS DE ORO (NO VIOLAR)
- ❌ **Nunca copiar porcentajes o topes a la prestación**
- ❌ **Nunca fusionar bloques**
- ❌ **Nunca inferir más allá del texto**
- ✅ **Todo se referencia por `bloque_id`**
- ✅ **Un cambio de modalidad cierra cualquier bloque activo**

## 📥 INPUT (OBLIGATORIO)
JSON generado por `extractor-lineal-contrato-salud`

## 📤 OUTPUT (ÚNICO JSON)
Ver estructura en implementación.

## 🧩 FASE INTERMEDIA (FASE B): Descomposición interna de bloques

## 🧠 OBJETIVO DE ESTA FASE
Tomar cada bloque ya detectado y, si su texto contiene múltiples reglas internas (prestadores / porcentajes / condiciones), descomponerlo en `reglas[]` SIN afectar las asignaciones.

## 🧭 PASO A PASO (SIN SALTOS)

### PASO 1 — Marcar bloques candidatos
Itera `bloques[]` y marca como candidato un bloque si cumple **AL MENOS UNA**:
- `texto_fuente` contiene más de un `%`
- `texto_fuente` contiene lista de prestadores
- `texto_fuente` contiene conectores tipo: "en:", "con", "(A.1)", "(A.2)", "Habitación"
- `texto_fuente` coincide con `/\d+\s*%\s*Sin\s*Tope\s*:/i` (Regla del dos puntos)
- **REGLA DURA**: `(\d+%)\s+Sin\s+Tope` (Siempre es inicio de bloque).

### PASO 2 — Convertir bloque simple → bloque compuesto
Si es candidato: `tipo_bloque = "bloque_compuesto"`.

### PASO 3 — Reconstruir el texto extendido del bloque (CRÍTICO)
Para cada bloque candidato, recorre líneas posteriores.
**DETENERSE INMEDIATAMENTE SI:**
1.  Aparece un NUEVO encabezado con patrón `(\d+%)\s+Sin\s+Tope` (Cierre duro).
2.  Cambia la modalidad.
3.  Aparece "Solo cobertura libre elección".
4.  Termina la tabla.

**REGLA DE LIMPIEZA:**
- Si detectas "UF" o "AC2" en un bloque **PREFERENTE**, ignora esa línea/texto. Pertenece a Libre Elección.

### PASO 4 — Detectar reglas internas
Sobre `texto_expandido`, aplica este orden:

#### 4.1 Detectar encabezado de regla
Cada vez que aparezca `(\d{1,3})\s*%\s*Sin\s*Tope` o `(\d{1,3})\s*%`:
👉 **Nueva regla interna**

#### 4.2 Asociar prestadores a la regla
Desde ese encabezado, captura líneas siguientes hasta que aparezca otro porcentaje o termine el bloque.
Extrae nombres propios: `Hospital .*`, `Clínica .*`, Listas separadas por coma.

#### 4.3 Detectar submodalidad / condición
Busca expresiones como `(A.1)`, `(A.2)`, `Habitación Individual`, `Modalidad Institucional`. Asignalas a `modalidad_institucional` o `condicion`.

## CLÁUSULAS DE EXCLUSIÓN
Si el texto es "Solo cobertura libre elección":
- `tipo_bloque`: `"exclusion_modalidad"`
- `excluye`: `"preferente"`

## 🚫 COSAS PROHIBIDAS (FASE B)
- ❌ NO crear un skill nuevo
- ❌ NO mover esta lógica al canonizador
- ❌ NO seleccionar regla correcta
- ❌ NO copiar porcentaje a la prestación
- ❌ **Mezclar topes LE (UF/AC2) en bloques PREFERENTE**.
