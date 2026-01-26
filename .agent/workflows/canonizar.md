---
description: Cómo ejecutar la canonización de un contrato de salud usando el skill
---

# Workflow: Canonización de Contratos

Este workflow describe cómo utilizar el skill `canonizar-contrato-salud` para transformar un PDF en un JSON canónico.

## Pasos para el Usuario

1. **Subir el PDF**: Adjunta el archivo del contrato de salud (Isapre o Fonasa) a la conversación.
2. **Invocar el Skill**: Escribe una instrucción clara como:
   > "Usa el skill 'canonizar-contrato-salud' para procesar este contrato."
3. **Proporcionar Contexto**: Si lo tienes, indica el tipo de contrato (ej: "Es un plan de Isapre Consalud de 2023").

## Pasos para el Agente (Antigravity)

1. **Lectura**: El agente leerá el contenido del PDF usando las herramientas de OCR disponibles.
2. **Extracción**: Siguiendo el **Paso 1 y 2** del skill, identificará coberturas, topes y reglas.
3. **Mapeo**: Transformará la información al esquema JSON definido en el skill (Metadatos, Coberturas, Topes, etc.).
4. **Validación**: Verificará que no haya campos inventados y que todo esté respaldado por el texto.
5. **Entrega**: El agente responderá únicamente con el objeto JSON resultante.

## Ejemplo de Prompt
"Canoniza el contrato adjunto. Es Isapre Colmena. Aplica rigor formal y entrega solo el JSON."
