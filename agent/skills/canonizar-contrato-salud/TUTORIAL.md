# Tutorial: Cómo Canonizar un Contrato

Sigue estos pasos para convertir cualquier contrato PDF en datos puros y estructurados.

## 1. Localiza el Contrato
Asegúrate de tener el archivo PDF a mano o subido al repositorio.

## 2. Pide la Canonización
Escribe en el chat:
> "¿Puedes canonizar este contrato? [Ruta o archivo] Usa el skill de canonización."

## 3. Revisa el Resultado
Yo generaré un JSON que se verá así:
- **`metadata`**: Identidad del plan.
- **`coberturas`**: Porcentajes de bonificación.
- **`topes`**: Límites de gasto (UF, VAM, Pesos).
- **`reglas_aplicacion`**: La "letra chica" lógica.

## 4. ¿Para qué sirve? (Lo Útil)
- **Auditoría**: Comparar este JSON contra una cuenta médica (PAM).
- **Simulador**: Alimentar un simulador de copagos con datos reales.
- **Limpieza**: Olvidarte de si el PDF tiene 3 o 4 columnas; el JSON siempre será igual.

---
**Tip Pro:** Si el contrato es muy largo, puedes decir: "Canoniza solo la sección de maternidad".
