# Deep Dive Técnico: Aplicación de Auditoría de Cuentas Clínicas

## 📋 Índice
1. [Arquitectura del Sistema](#arquitectura)
2. [Frontend: Captura y Preparación](#frontend)
3. [Backend: Servidor Express](#backend)
4. [Interacción con Gemini API](#gemini)
5. [Procesamiento de Datos](#procesamiento)
6. [Validación y Auditoría](#validacion)
7. [Presentación de Resultados](#presentacion)
8. [Deployment y Producción](#deployment)

---

<a name="arquitectura"></a>
## 1. Arquitectura del Sistema

### 1.1 Patrón Arquitectónico

**Tipo:** Cliente-Servidor con IA como Servicio (AIaaS)

```
┌──────────────────────────────────────────────────────┐
│                     USUARIO                          │
│              (Navegador Chrome/Firefox)              │
└───────────────────────┬──────────────────────────────┘
                        │
                        │ HTTP/HTTPS
                        ▼
┌──────────────────────────────────────────────────────┐
│                  CAPA FRONTEND                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  React App (SPA - Single Page Application)    │  │
│  │  - App.tsx: Componente principal               │  │
│  │  - ExtractionResults.tsx: UI de resultados    │  │
│  │  - geminiService.ts: Lógica de comunicación   │  │
│  └────────────────────────────────────────────────┘  │
│           ↓                              ↑           │
│    [FileReader API]              [NDJSON Stream]     │
└───────────┬───────────────────────────────┬──────────┘
            │                               │
            │ POST /api/extract             │
            │ Body: {image, mimeType}       │
            │                               │
┌───────────▼───────────────────────────────┴──────────┐
│                  CAPA BACKEND                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  Node.js + Express Server                     │  │
│  │  - server.ts: Endpoints y lógica              │  │
│  │  - envGet(): Helper para env vars             │  │
│  │  - getApiKey(): Acceso seguro a clave         │  │
│  └────────────────────────────────────────────────┘  │
│           ↓                              ↑           │
│   [Google AI SDK]              [Streaming Response]  │
└───────────┬───────────────────────────────┬──────────┘
            │                               │
            │ generateContentStream()       │
            │ Payload: [prompt, image]      │
            │                               │
┌───────────▼───────────────────────────────┴──────────┐
│              SERVICIO EXTERNO: GEMINI API            │
│  ┌────────────────────────────────────────────────┐  │
│  │  Google Gemini 3 Flash Preview                │  │
│  │  - Multimodal Vision + Text                   │  │
│  │  - OCR integrado                              │  │
│  │  - Generación estructurada                    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 1.2 Tecnologías Stack

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|
| **Frontend** | React | 19.2.3 | Framework UI reactivo |
| | TypeScript | 5.8.2 | Tipado estático |
| | Vite | 6.2.0 | Build tool y dev server |
| | Lucide React | 0.562.0 | Sistema de iconos |
| **Backend** | Node.js | 20+ | Runtime JavaScript |
| | Express | 4.19.2 | Framework HTTP |
| | tsx | 4.7.2 | Ejecución TypeScript directa |
| | Multer | 1.4.5 | Manejo de uploads |
| | CORS | 2.8.5 | Cross-Origin Resource Sharing |
| **IA** | @google/generative-ai | 0.24.1 | SDK oficial de Google |
| | Gemini 3 Flash Preview | Latest | Modelo multimodal |
| **Deploy** | Render.com | - | PaaS hosting |
| | GitHub | - | VCS y CI/CD |

---

<a name="frontend"></a>
## 2. Frontend: Captura y Preparación

### 2.1 Componente Principal: `App.tsx`

#### 2.1.1 Estados de React

```typescript
const [selectedFile, setSelectedFile] = useState<File | null>(null);
// Almacena el archivo seleccionado por el usuario
// File API: https://developer.mozilla.org/en-US/docs/Web/API/File

const [isExtracting, setIsExtracting] = useState(false);
// Boolean que controla el estado de loading/processing
// Desactiva botones, muestra spinners, previene múltiples uploads

const [extractedData, setExtractedData] = useState<ExtractedAccount | null>(null);
// Datos estructurados después de la extracción
// Tipo: ExtractedAccount (definido en types.ts)

const [logs, setLogs] = useState<string[]>([]);
// Array de strings para mostrar progreso en tiempo real
// Ejemplo: ["[SYSTEM] Procesando...", "[API] 3825 tokens", ...]

const [usage, setUsage] = useState<UsageMetrics | null>(null);
// Métricas de tokens y costo estimado
// Se actualiza en streaming mientras Gemini procesa
```

#### 2.1.2 Manejo de Archivos

**Event Handler: `handleFileChange`**

```typescript
const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  
  // Validación básica
  if (!files || files.length === 0) return;
  
  const file = files[0];
  
  // Verificar tipo de archivo
  const validTypes = [
    'application/pdf',      // PDFs
    'image/png',            // Imágenes PNG
    'image/jpeg',           // JPEGs
    'image/jpg'             // JPGs (alias)
  ];
  
  if (!validTypes.includes(file.type)) {
    alert('Formato no soportado. Use PDF o imagen.');
    return;
  }
  
  // Verificar tamaño (máx 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB en bytes
  if (file.size > maxSize) {
    alert('Archivo demasiado grande. Máximo 10MB.');
    return;
  }
  
  setSelectedFile(file);
};
```

**¿Por qué estas validaciones?**
- **Tipo:** Gemini solo acepta imágenes (PNG, JPEG) o PDFs convertidos
- **Tamaño:** Evita saturar la red y costos excesivos en Gemini
- **Frontend:** Validación temprana = mejor UX

#### 2.1.3 Conversión PDF → Imagen

**Función: `convertPdfToImage`**

```typescript
const convertPdfToImage = async (file: File): Promise<string> => {
  // 1. Leer el archivo PDF como ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  
  // 2. Cargar PDF usando PDF.js (implícitamente via Canvas)
  // Nota: En producción, usarías una librería como pdf.js
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  // 3. Obtener primera página (o todas si quieres multi-página)
  const page = await pdf.getPage(1);
  
  // 4. Configurar escala para buena calidad OCR
  const scale = 2.0; // 2x resolución nativa
  const viewport = page.getViewport({ scale });
  
  // 5. Crear canvas HTML5
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  // 6. Renderizar PDF en canvas
  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;
  
  // 7. Convertir canvas a Data URL (base64)
  return canvas.toDataURL('image/png');
  // Retorna: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
};
```

**Detalles técnicos:**
- **Scale 2.0:** Mayor resolución = mejor OCR de Gemini
- **Canvas API:** Renderizado nativo del navegador
- **Data URL:** Formato que puede enviarse directamente vía JSON

---

### 2.2 Servicio de Comunicación: `geminiService.ts`

#### 2.2.1 Función Principal: `extractBillingData`

**Firma:**
```typescript
export async function extractBillingData(
  imageData: string,           // Base64 string
  mimeType: string,             // "image/png" | "image/jpeg"
  onLog?: (msg: string) => void, // Callback para logs
  onUsageUpdate?: (usage: UsageMetrics) => void // Callback para métricas
): Promise<ExtractedAccount>
```

**Flujo de ejecución:**

```typescript
async function extractBillingData(...) {
  // PASO 1: Logging inicial
  onLog?.('[SYSTEM] Iniciando Protocolo de Auditoría vía Streaming.');
  onLog?.('[SYSTEM] Conectando con el motor de IA...');
  
  // PASO 2: HTTP Request al backend
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      image: imageData,    // "data:image/png;base64,..."
      mimeType: mimeType   // "image/png"
    }),
  });
  
  // PASO 3: Validación de respuesta
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Error en el servidor');
  }
  
  // PASO 4: Setup de streaming
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo establecer stream');
  
  const decoder = new TextDecoder();
  let resultData: any = null;
  let partialBuffer = '';
  let latestUsage: UsageMetrics | null = null;
  
  // PASO 5: Leer streaming NDJSON
  while (true) {
    const { done, value } = await reader.read();
    if (done) break; // Stream terminó
    
    // Decodificar chunk de bytes
    partialBuffer += decoder.decode(value, { stream: true });
    
    // Split por líneas (\n es delimitador NDJSON)
    const lines = partialBuffer.split('\n');
    
    // Guardar última línea incompleta
    partialBuffer = lines.pop() || '';
    
    // Procesar cada línea completa
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const update = JSON.parse(line);
        
        // Según el tipo de update, manejar diferente
        switch (update.type) {
          case 'usage':
            // Métricas de tokens
            latestUsage = update.usage;
            onUsageUpdate?.(update.usage);
            onLog?.(`[API] Tokens: ${update.usage.totalTokens}`);
            break;
            
          case 'chunk':
            // Texto extraído por Gemini
            onLog?.(update.text);
            break;
            
          case 'final':
            // Datos estructurados finales
            resultData = update.data;
            break;
            
          case 'error':
            throw new Error(update.message);
        }
      } catch (e) {
        console.error("Error parsing NDJSON:", e);
      }
    }
  }
  
  // PASO 6: Validar que recibimos datos
  if (!resultData) {
    throw new Error('No se recibió resultado final');
  }
  
  // PASO 7: Auditoría matemática (continúa abajo...)
}
```

#### 2.2.2 Streaming NDJSON

**¿Qué es NDJSON?**
- **N**ewline **D**elimited **JSON**
- Cada línea es un JSON válido independiente
- Ideal para streaming porque se puede parsear línea por línea

**Ejemplo de stream recibido:**
```json
{"type":"chunk","text":"CLINIC: CLINICA INDISA\n"}
{"type":"chunk","text":"PATIENT: JUAN PEREZ\n"}
{"type":"usage","usage":{"promptTokens":3825,"candidatesTokens":4353}}
{"type":"chunk","text":"SECTION: PABELLON\n"}
{"type":"final","data":{"clinicName":"CLINICA INDISA",...}}
```

**Ventajas:**
- ✅ Parsing incremental (no necesitas esperar todo)
- ✅ Manejo de errores por línea
- ✅ Feedback inmediato al usuario

---

<a name="backend"></a>
## 3. Backend: Servidor Express

### 3.1 Inicialización del Servidor

#### 3.1.1 Imports y Setup

```typescript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";

// ES Modules no tienen __dirname, hay que crearlo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar dotenv SOLO en desarrollo
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}
```

**¿Por qué condicional dotenv?**
- En **desarrollo**: Lee `.env` local
- En **producción** (Render): Variables vienen inyectadas por Render
- Si cargas dotenv en producción, puede **sobrescribir** las vars de Render

#### 3.1.2 Helper Crucial: `envGet()`

```typescript
function envGet(k: string) {
    const v = process.env[k];
    return typeof v === "string" ? v : undefined;
}
```

**¿Por qué este helper y no `process.env.KEY` directo?**

**Problema con `Object.keys(process.env)` en Render:**
```javascript
// ❌ Esto retorna [] (array vacío) en algunos runtimes
Object.keys(process.env) // []

// ✅ Pero las variables SÍ existen:
process.env.PORT // "10000"
process.env.GEMINI_API_KEY // "AIzaSy..."
```

**Solución:**
- Usar **bracket notation** (`process.env[k]`)
- NO confiar en `Object.keys()` para enumerar
- Usar `Object.getOwnPropertyNames()` si necesitas listar

#### 3.1.3 Configuración de Express

```typescript
const app = express();
const PORT = Number(envGet("PORT") || 5000);

// Middleware CORS: permite requests desde el frontend
app.use(cors());
// En producción podrías restringir:
// app.use(cors({ origin: 'https://tu-dominio.com' }));

// Parser de JSON con límite de 50MB
app.use(express.json({ limit: '50mb' }));
// ¿Por qué 50MB? Imágenes base64 pueden ser grandes
// Una imagen de 5MP en base64 ≈ 6-7MB

// Multer para uploads en memoria (no disk)
const upload = multer({ storage: multer.memoryStorage() });
```

---

### 3.2 Endpoint Principal: `POST /api/extract`

#### 3.2.1 Setup de Streaming Response

```typescript
app.post('/api/extract', async (req, res) => {
    console.log('[REQUEST] New extraction request (Streaming)');

    // CONFIG 1: Headers para streaming NDJSON
    res.setHeader('Content-Type', 'application/x-ndjson');
    // MIME type específico para NDJSON
    
    res.setHeader('Transfer-Encoding', 'chunked');
    // HTTP chunked encoding = permite enviar sin Content-Length
    
    // CONFIG 2: Helper para enviar actualizaciones
    const sendUpdate = (data: any) => {
        res.write(JSON.stringify(data) + '\n');
        // Cada JSON + \n = una línea NDJSON
    };
    
    // ... código continúa
});
```

**¿Por qué chunked encoding?**
- No sabes de antemano cuántos bytes enviars
- Gemini procesa y genera en tiempo real
- Evitas buffering innecesario

#### 3.2.2 Validación y Extracción de Datos

```typescript
try {
    // PASO 1: Extraer payload del request
    const { image, mimeType } = req.body;
    console.log(`[REQUEST] Processing ${mimeType}`);
    
    // PASO 2: Obtener API key con helper seguro
    const apiKey = getApiKey();
    console.log(`[AUTH] API Key: ${apiKey ? 'Found' : 'MISSING'}`);
    
    // PASO 3: Validaciones
    if (!image || !mimeType) {
        console.error('[ERROR] Missing payload');
        return res.status(400).json({ 
            error: 'Missing image data or mimeType' 
        });
    }
    
    if (!apiKey) {
        console.error('[CRITICAL] No API Key');
        return res.status(500).json({ 
            error: 'Server configuration error' 
        });
    }
    
    // PASO 4: Inicializar cliente de Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview",
        generationConfig: {
            maxOutputTokens: 30000
            // Límite de tokens que puede generar
            // 30K es suficiente para cuentas de 1500+ ítems
        }
    });
```

---

<a name="gemini"></a>
## 4. Interacción con Gemini API

### 4.1 Construcción del Prompt

El prompt es **lo más importante** - define TODO el comportamiento de Gemini.

#### 4.1.1 Anatomía del Prompt

```typescript
const CSV_PROMPT = `
ACTÚA COMO UN AUDITOR FORENSE DE CUENTAS CLÍNICAS CHILENAS.

CONTEXTO DE "CAJA NEGRA":
Las clínicas en Chile usan formatos confusos para ocultar el costo real.
A menudo presentan una columna "Valor" (Neto) y mucho después 
una columna "Valor ISA" (Bruto con IVA).

REGLA DE ORO DE TRAZABILIDAD:
- NUMERA LOS ÍTEMS: Cada ítem debe tener un campo 'index' 
  comenzando desde 1 para toda la cuenta. Esto permite al usuario 
  verificar si se saltó algún ítem.
  
- NO AGRUPES SECCIONES. Si la cuenta lista "Materiales 1", 
  "Materiales 2" y "Farmacia" por separado con sus propios subtotales, 
  DEBES extraerlos como secciones independientes.
  
- unitPrice: Debe ser el valor de la columna 'Precio' (VALOR NETO).
- total: Debe ser el valor de la columna 'Valor Isa' (VALOR CON IVA).
- La diferencia corresponde a IVA, Impuestos Específicos o Recargos.

INSTRUCCIONES DE EXTRACCIÓN EXHAUSTIVA:
1. Identifica las cabeceras de sección y sus subtotales declarados.
2. EXTRAE CADA LÍNEA DEL DESGLOSE SIN EXCEPCIÓN.
3. ESTÁ PROHIBIDO RESUMIR, AGRUPAR O SIMPLIFICAR DATOS.
4. No omitas información por ser repetitiva o de bajo valor.
5. Convierte puntos de miles (.) a nada y comas decimales (,) a puntos.
6. Si un ítem tiene valor 0, extráelo también.

INSTRUCCIONES DE FORMATO SALIDA (JERÁRQUICO):
1. Al principio, extrae estos metadatos:
   CLINIC: [Nombre de la Clínica/Institución]
   PATIENT: [Nombre del Paciente]
   INVOICE: [Número de Cuenta/Folio]
   DATE: [Fecha de la Cuenta]
   GRAND_TOTAL: [Valor Total Final]
   
2. NO repitas el nombre de la sección en cada línea.

3. Estructura:
   CLINIC: ...
   PATIENT: ...
   INVOICE: ...
   DATE: ...
   GRAND_TOTAL: ...
   SECTION: [Nombre Exacto Sección]
   [Index]|[Código]|[Descripción]|[Cant]|[PrecioUnit]|[Total]
   SECTION: [Siguiente Sección...]
   ...
`;
```

#### 4.1.2 Desglose de Instrucciones

**1. "ACTÚA COMO..."**
- **Purpose:** Establece el rol y contexto
- **Effect:** Gemini ajusta su tono, precisión y enfoque
- **Sin esto:** Gemini podría resumir o simplificar datos

**2. "CONTEXTO DE CAJA NEGRA"**
- **Purpose:** Explica por qué existe ambigüedad
- **Effect:** Gemini entiende que debe buscar "Valor ISA" vs "Valor"
- **Crítico:** Cuentas chilenas tienen esta particularidad

**3. "NUMERA LOS ÍTEMS"**
- **Purpose:** Trazabilidad total
- **Effect:** Cada ítem tiene índice único (1, 2, 3...)
- **Beneficio:** Usuario puede verificar que no falta nada

**4. "NO AGRUPES SECCIONES"**
- **Purpose:** Preservar estructura original
- **Effect:** Sección "Farmacia 1" ≠ "Farmacia 2"
- **Por qué:** Auditoría requiere granularidad exacta

**5. "unitPrice vs total"**
- **Purpose:** Distinguir neto de bruto
- **Effect:** `unitPrice` = Precio sin IVA, `total` = Valor ISA
- **Validación:** Permite detectar errores de IVA

**6. "EXTRAE CADA LÍNEA"**
- **Purpose:** Exhaustividad absoluta
- **Effect:** Cuentas de 1500 ítems → 1500 ítems en JSON
- **Sin esto:** Gemini podría resumir "y 200 ítems más..."

**7. Formato de Output**
- **Purpose:** Parsing predecible
- **Effect:** Backend puede parsear automáticamente
- **Estructura:** Metadata + Secciones + Items

---

### 4.2 Llamada a Gemini con Streaming

#### 4.2.1 Código de Invocación

```typescript
const resultStream = await model.generateContentStream([
    { text: CSV_PROMPT },        // El prompt como texto
    {
        inlineData: {
            data: image,          // Base64 sin prefijo "data:..."
            mimeType: mimeType    // "image/png" o "image/jpeg"
        }
    }
]);
```

**¿Qué pasa internamente?**

1. **Serialización:**
   ```javascript
   {
     "contents": [
       {
         "parts": [
           { "text": "ACTÚA COMO UN AUDITOR..." },
           { 
             "inline_data": {
               "mime_type": "image/png",
               "data": "iVBORw0KGgo..." // base64
             }
           }
         ]
       }
     ],
     "generationConfig": {
       "maxOutputTokens": 30000
     }
   }
   ```

2. **Envío a Google Cloud:**
   - HTTPS POST a `generativelanguage.googleapis.com`
   - Autenticación con API key
   - Payload puede ser varios MB

3. **Procesamiento en Gemini:**
   - **Vision model:** Lee la imagen pixel por pixel
   - **OCR:** Extrae texto, detecta tablas
   - **Language model:** Entiende contexto, sigue prompt
   - **Generation:** Produce output estructurado

4. **Streaming Response:**
   - Gemini envía chunks apenas los genera
   - No espera a completar toda la respuesta
   - Server-Sent Events (SSE) bajo el capó

#### 4.2.2 Procesamiento del Stream

```typescript
let fullText = "";

for await (const chunk of resultStream.stream) {
    const chunkText = chunk.text();
    fullText += chunkText;
    
    console.log(`[CHUNK] Received: ${chunkText.length} chars`);
    
    // ENVÍO 1: Texto crudo al frontend
    sendUpdate({ type: 'chunk', text: chunkText });
    
    // ENVÍO 2: Métricas si están disponibles
    const usage = chunk.usageMetadata;
    if (usage) {
        const promptTokens = usage.promptTokenCount || 0;
        const candidatesTokens = usage.candidatesTokenCount || 0;
        const totalTokens = usage.totalTokenCount || 0;
        
        // Cálculo de costos
        // Gemini Flash: $0.10/1M input, $0.40/1M output
        const inputCost = (promptTokens / 1000000) * 0.10;
        const outputCost = (candidatesTokens / 1000000) * 0.40;
        const estimatedCost = inputCost + outputCost;
        
        sendUpdate({
            type: 'usage',
            usage: {
                promptTokens,
                candidatesTokens,
                totalTokens,
                estimatedCost,
                estimatedCostCLP: Math.round(estimatedCost * 980)
                // 1 USD ≈ 980 CLP (aproximado)
            }
        });
    } else {
        // Si no hay métricas, al menos enviar progreso
        sendUpdate({ 
            type: 'progress', 
            length: fullText.length 
        });
    }
}

console.log(`[DEBUG] Extraction complete: ${fullText.length} chars`);
```

**Tipos de Chunks:**

1. **Text Chunks:**
   ```
   "CLINIC: CLINICA INDISA\n"
   "PATIENT: JUAN PEREZ\n"
   "SECTION: PABELLON\n"
   "1|PAB001|Pabellón Mayor|..."
   ```

2. **Usage Metadata:**
   ```javascript
   {
     promptTokenCount: 3825,
     candidatesTokenCount: 4353,
     totalTokenCount: 8178
   }
   ```

---

<a name="procesamiento"></a>
## 5. Procesamiento de Datos

### 5.1 Parsing del Texto CSV Jerárquico

Una vez que Gemini termina, el backend tiene un string grande:

```
CLINIC: CLINICA INDISA
PATIENT: JUAN PEREZ
INVOICE: 12345678
DATE: 30/12/2024
GRAND_TOTAL: 1500000
SECTION: PABELLÓN
1|PAB001|Pabellón Mayor|1|800000|952000
2|INS001|Insumos Quirúrgicos|1|150000|178500
SECTION: FARMACIA
3|MED001|Antibiótico|2|50000|119000
```

#### 5.1.1 Código de Parseo

```typescript
const lines = fullText.split('\n')
    .map(l => l.trim())
    .filter(l => l); // Eliminar líneas vacías

const sectionsMap = new Map();
let currentSectionName = "SECCION_DESCONOCIDA";
let globalIndex = 1;

// Variables de metadata
let clinicGrandTotalField = 0;
let clinicName = "CLINICA INDISA";
let patientName = "PACIENTE AUDITORIA";
let invoiceNumber = "000000";
let billingDate = new Date().toLocaleDateString('es-CL');

for (const line of lines) {
    // METADATA: GRAND_TOTAL
    if (line.startsWith('GRAND_TOTAL:')) {
        const rawValue = line.replace('GRAND_TOTAL:', '').trim();
        // Remover separadores de miles
        clinicGrandTotalField = parseInt(rawValue.replace(/\./g, '')) || 0;
        continue;
    }
    
    // METADATA: CLINIC
    if (line.startsWith('CLINIC:')) {
        clinicName = line.replace('CLINIC:', '').trim();
        continue;
    }
    
    // METADATA: PATIENT
    if (line.startsWith('PATIENT:')) {
        patientName = line.replace('PATIENT:', '').trim();
        continue;
    }
    
    // METADATA: INVOICE
    if (line.startsWith('INVOICE:')) {
        invoiceNumber = line.replace('INVOICE:', '').trim();
        continue;
    }
    
    // METADATA: DATE
    if (line.startsWith('DATE:')) {
        billingDate = line.replace('DATE:', '').trim();
        continue;
    }
    
    // SECCIONES
    if (line.startsWith('SECTION:')) {
        currentSectionName = line.replace('SECTION:', '').trim();
        
        // Crear nueva sección en el mapa
        if (!sectionsMap.has(currentSectionName)) {
            sectionsMap.set(currentSectionName, {
                category: currentSectionName,
                items: [],
                sectionTotal: 0
            });
        }
        continue;
    }
    
    // ÍTEMS (líneas con pipe |)
    if (!line.includes('|')) continue;
    
    const cols = line.split('|').map(c => c.trim());
    if (cols.length < 4) continue; // Línea malformada
    
    // Extraer columnas
    const idxStr = cols[0];          // "1"
    const code = cols[1];            // "PAB001"
    const desc = cols[2];            // "Pabellón Mayor"
    const qtyStr = cols[3];          // "1"
    const unitPriceStr = cols[4];    // "800000"
    const totalStr = cols[5];        // "952000"
    
    // Detectar si es línea de total de sección
    const isClinicTotalLine = 
        desc?.toUpperCase().includes("TOTAL SECCIÓN") || 
        desc?.toUpperCase().includes("SUBTOTAL");
    
    // Parsear números
    const total = parseInt((totalStr || "0").replace(/\./g, '')) || 0;
    const quantity = parseFloat((qtyStr || "1").replace(',', '.')) || 1;
    const unitPrice = parseInt((unitPriceStr || "0").replace(/\./g, '')) || 0;
    
    // Descripción completa incluye código
    const fullDescription = code ? `${desc} ${code}` : desc;
    
    // Obtener sección actual
    let sectionObj = sectionsMap.get(currentSectionName);
    if (!sectionObj) {
        // Si no hay sección, crear una genérica
        sectionsMap.set("SECCIONES_GENERALES", {
            category: "SECCIONES_GENERALES",
            items: [],
            sectionTotal: 0
        });
        sectionObj = sectionsMap.get("SECCIONES_GENERALES");
    }
    
    // Agregar ítem o total de sección
    if (isClinicTotalLine) {
        sectionObj.sectionTotal = total;
    } else {
        sectionObj.items.push({
            index: parseInt(idxStr) || globalIndex++,
            description: fullDescription,
            quantity: quantity,
            unitPrice: unitPrice,
            total: total,
            calculatedTotal: total,
            hasCalculationError: false
        });
    }
}
```

#### 5.1.2 Post-Procesamiento de Secciones

```typescript
// Calcular totales de secciones que no tienen subtotal declarado
for (const sec of sectionsMap.values()) {
    if (sec.sectionTotal === 0 && sec.items.length > 0) {
        sec.sectionTotal = sec.items.reduce(
            (sum: number, item: any) => sum + item.total, 
            0
        );
    }
}

// Calcular total general sumando secciones
const sumOfSections = Array.from(sectionsMap.values())
    .reduce((acc: number, s: any) => acc + s.sectionTotal, 0);

// Construir objeto final
const auditData = {
    clinicName: clinicName,
    patientName: patientName,
    invoiceNumber: invoiceNumber,
    date: billingDate,
    currency: "CLP",
    sections: Array.from(sectionsMap.values()),
    clinicStatedTotal: clinicGrandTotalField || sumOfSections
};

console.log(`[SUCCESS] Parsed ${sectionsMap.size} sections`);
console.log(`[SUCCESS] Total: ${auditData.clinicStatedTotal}`);

// Enviar al frontend
sendUpdate({
    type: 'final',
    data: auditData
});

res.end(); // Cerrar stream HTTP
```

---

<a name="validacion"></a>
## 6. Validación y Auditoría

### 6.1 Auditoría Matemática en Frontend

**Ubicación:** `geminiService.ts` → después de recibir `final` data

```typescript
let finalExtractedTotal = 0;
onLog?.('[AUDIT] Analizando discrepancias por sección...');

const auditedSections: BillingSection[] = resultData.sections.map((section: any) => {
    let sectionRunningTotal = 0;
    
    // AUDITORÍA DE ÍTEMS
    const auditedItems: BillingItem[] = section.items.map((item: any) => {
        const qty = item.quantity || 1;
        const statedTotal = Number(item.total);
        const up = item.unitPrice || (statedTotal / qty);
        
        // CÁLCULO ESPERADO
        const calcTotal = Number((qty * up).toFixed(2));
        
        // COMPARACIÓN CON TOLERANCIA DE $5
        const hasCalculationError = Math.abs(calcTotal - statedTotal) > 5;
        
        if (hasCalculationError) {
            onLog?.(`[WARN] Diferencia en "${item.description}"`);
            onLog?.(`       ${qty} x ${up} = ${calcTotal}`);
            onLog?.(`       Extracto indica: ${statedTotal}`);
        }
        
        sectionRunningTotal += statedTotal;
        
        return {
            ...item,
            quantity: qty,
            unitPrice: up,
            total: statedTotal,
            calculatedTotal: calcTotal,
            hasCalculationError
        };
    });
    
    // AUDITORÍA DE SECCIÓN
    const sectionDeclaredTotal = Number(section.sectionTotal || 0);
    const diff = sectionDeclaredTotal - sectionRunningTotal;
    const hasSectionError = Math.abs(diff) > 5;
    
    // HIPÓTESIS DE ERROR
    let isTaxConfusion = false;
    let isUnjustifiedCharge = false;
    
    if (hasSectionError) {
        onLog?.(`[WARN] Descuadre en ${section.category}: $${diff}`);
        
        // ¿Es confusión de IVA?
        const expectedGross = sectionRunningTotal * 1.19; // +19% IVA
        if (Math.abs(expectedGross - sectionDeclaredTotal) < (sectionDeclaredTotal * 0.05)) {
            isTaxConfusion = true;
            onLog?.(`[AUDIT] Posible confusión de IVA en ${section.category}`);
        } 
        // ¿Es cargo extra sin justificar?
        else if (sectionDeclaredTotal > sectionRunningTotal) {
            isUnjustifiedCharge = true;
            onLog?.(`[WARN] ALERTA: Cargo no justificado en ${section.category}`);
        }
    }
    
    finalExtractedTotal += sectionRunningTotal;
    
    return {
        category: section.category,
        items: auditedItems,
        sectionTotal: sectionDeclaredTotal,
        calculatedSectionTotal: Number(sectionRunningTotal.toFixed(2)),
        hasSectionError,
        isTaxConfusion,
        isUnjustifiedCharge
    };
});
```

### 6.2 Tipos de Errores Detectados

#### 6.2.1 Error de Cálculo de Ítem

**Ejemplo:**
```
Descripción: Antibiótico
Cantidad: 2
Precio Unitario: 50,000
Total Declarado: 150,000

Cálculo: 2 × 50,000 = 100,000
Error: 150,000 - 100,000 = 50,000 ❌
```

**Posibles causas:**
- Error de digitación
- Precio cambió y no se actualizó
- Cargo extra oculto

#### 6.2.2 Confusión de IVA

**Ejemplo:**
```
Suma de ítems: 1,000,000 (netos)
Subtotal declarado: 1,190,000

1,000,000 × 1.19 = 1,190,000 ✅
Conclusión: La clínica sumó valores brutos en vez de netos
```

#### 6.2.3 Cargo No Justificado

**Ejemplo:**
```
Suma de ítems: 1,000,000
Subtotal declarado: 1,350,000

Diferencia: 350,000
No explica por IVA (sería 1,190,000)
Conclusión: Cargo extra sin detallar ⚠️
```

---

### 6.3 Balance Final

```typescript
const clinicStatedTotal = Number(resultData.clinicStatedTotal || 0);
const isBalanced = Math.abs(finalExtractedTotal - clinicStatedTotal) < 10;

onLog?.(`[SYSTEM] Cuadratura Final:`);
onLog?.(`         ${finalExtractedTotal} CLP (Auditor)`);
onLog?.(`         ${clinicStatedTotal} CLP (Documento)`);

if (isBalanced) {
    onLog?.(`[SYSTEM] ✅ Auditoría completada con éxito.`);
} else {
    const discrepancy = finalExtractedTotal - clinicStatedTotal;
    onLog?.(`[WARN] ⚠️ Discrepancia detectada: ${discrepancy} CLP`);
}

return {
    ...resultData,
    sections: auditedSections,
    clinicStatedTotal,
    extractedTotal: Number(finalExtractedTotal.toFixed(2)),
    isBalanced,
    discrepancy: Number((finalExtractedTotal - clinicStatedTotal).toFixed(2)),
    currency: resultData.currency || 'CLP',
    usage: latestUsage
};
```

---

<a name="presentacion"></a>
## 7. Presentación de Resultados

### 7.1 Componente: `ExtractionResults.tsx`

Este componente recibe el objeto `ExtractedAccount` y lo renderiza.

#### 7.1.1 Estructura de Datos

```typescript
interface ExtractedAccount {
  clinicName: string;
  patientName: string;
  invoiceNumber: string;
  date: string;
  currency: string;
  sections: BillingSection[];
  clinicStatedTotal: number;
  extractedTotal: number;
  isBalanced: boolean;
  discrepancy: number;
  usage?: UsageMetrics;
}

interface BillingSection {
  category: string;
  items: BillingItem[];
  sectionTotal: number;
  calculatedSectionTotal: number;
  hasSectionError: boolean;
  isTaxConfusion: boolean;
  isUnjustifiedCharge: boolean;
}

interface BillingItem {
  index: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  calculatedTotal: number;
  hasCalculationError: boolean;
}

interface UsageMetrics {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCost: number;
  estimatedCostCLP: number;
}
```

#### 7.1.2 Renderizado de Secciones

```tsx
{data.sections.map((section, sIdx) => (
  <div key={sIdx} className="section-card">
    {/* Header de Sección */}
    <div className="section-header">
      <h3>{section.category}</h3>
      
      {/* Indicador de Error */}
      {section.hasSectionError && (
        <div className="error-badge">
          {section.isTaxConfusion && "⚠️ Confusión IVA"}
          {section.isUnjustifiedCharge && "🚨 Cargo Extra"}
        </div>
      )}
    </div>
    
    {/* Tabla de Ítems */}
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Descripción</th>
          <th>Cant</th>
          <th>P. Unit</th>
          <th>Total</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        {section.items.map((item, iIdx) => (
          <tr 
            key={iIdx}
            className={item.hasCalculationError ? 'error-row' : ''}
          >
            <td>{item.index}</td>
            <td>{item.description}</td>
            <td>{item.quantity}</td>
            <td>${item.unitPrice.toLocaleString('es-CL')}</td>
            <td>${item.total.toLocaleString('es-CL')}</td>
            <td>
              {item.hasCalculationError ? (
                <span className="text-red-600">
                  ❌ Esperado: ${item.calculatedTotal.toLocaleString('es-CL')}
                </span>
              ) : (
                <span className="text-green-600">✅</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      
      {/* Footer con Totales */}
      <tfoot>
        <tr>
          <td colSpan={4}>Subtotal</td>
          <td>${section.sectionTotal.toLocaleString('es-CL')}</td>
          <td>
            {section.hasSectionError ? (
              <span className="text-red-600">
                Calc: ${section.calculatedSectionTotal.toLocaleString('es-CL')}
              </span>
            ) : (
              <span className="text-green-600">✅</span>
            )}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
))}
```

#### 7.1.3 Panel de Métricas

```tsx
<div className="metrics-panel">
  <h4>📊 AUDIT IA INFO</h4>
  
  <div className="metric">
    <span>← Entrada</span>
    <span>{usage.promptTokens} tokens</span>
  </div>
  
  <div className="metric">
    <span>→ Salida</span>
    <span>{usage.candidatesTokens} tokens</span>
  </div>
  
  <div className="metric-total">
    <span>TOTAL TOKENS</span>
    <span>{usage.totalTokens}</span>
  </div>
  
  <div className="cost-display">
    <span className="currency">$</span>
    <span className="amount">{usage.estimatedCostCLP}</span>
    <span className="unit">CLP</span>
  </div>
  
  <div className="cost-usd">
    ${usage.estimatedCost.toFixed(4)} USD
  </div>
</div>
```

#### 7.1.4 Exportación

```tsx
<div className="export-section">
  <h3>EXPORTAR RESULTADOS</h3>
  
  <button onClick={downloadPDF}>
    DESCARGAR PDF
  </button>
  
  <button onClick={downloadJSON}>
    JSON
  </button>
  
  <button onClick={downloadMarkdown}>
    MD
  </button>
</div>
```

**Funciones de exportación:**

```typescript
const downloadJSON = () => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auditoria_${data.invoiceNumber}.json`;
  a.click();
};

const downloadMarkdown = () => {
  let md = `# Auditoría ${data.clinicName}\n\n`;
  md += `**Paciente:** ${data.patientName}\n`;
  md += `**Factura:** ${data.invoiceNumber}\n`;
  md += `**Fecha:** ${data.date}\n\n`;
  
  data.sections.forEach(sec => {
    md += `## ${sec.category}\n\n`;
    md += `| # | Descripción | Cant | P.Unit | Total |\n`;
    md += `|---|-------------|------|--------|-------|\n`;
    
    sec.items.forEach(item => {
      md += `| ${item.index} | ${item.description} | ${item.quantity} | ${item.unitPrice} | ${item.total} |\n`;
    });
    
    md += `\n**Subtotal:** $${sec.sectionTotal}\n\n`;
  });
  
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auditoria_${data.invoiceNumber}.md`;
  a.click();
};
```

---

<a name="deployment"></a>
## 8. Deployment y Producción

### 8.1 Render.com Configuration

#### 8.1.1 `render.yaml`

```yaml
services:
  - type: web
    name: revisatucuentasolo
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: GEMINI_API_KEY
        sync: false
```

**Explicación:**

- **`type: web`**: Servicio HTTP (no worker o cron)
- **`env: node`**: Runtime Node.js (Render detecta versión de `package.json`)
- **`buildCommand`**: 
  - `npm install`: Instala dependencias
  - `npm run build`: Ejecuta `vite build` para generar `dist/`
- **`startCommand`**: Ejecuta `npm start` = `tsx server/server.ts`
- **`envVars`**: 
  - `NODE_ENV=production`: Automático
  - `GEMINI_API_KEY`: Usuario debe configurar en dashboard

#### 8.1.2 Build Process

**Paso 1: Install**
```bash
npm install
# Instala:
# - Dependencias de producción (dependencies)
# - DevDependencies (para el build)
```

**Paso 2: Build**
```bash
npm run build
# Ejecuta: "vite build && npm run build:server"

# vite build:
# - Lee src/
# - Transpila TS → JS
# - Bundlea React
# - Minifica código
# - Genera /dist/index.html y assets

# build:server:
# - Echo "Server uses TypeScript"
# - No compilación necesaria (tsx ejecuta .ts directo)
```

**Paso 3: Start**
```bash
npm start
# Ejecuta: tsx server/server.ts

# tsx:
# - Transpila TypeScript on-the-fly
# - Ejecuta sin necesidad de compilar
# - Similar a ts-node pero más rápido
```

#### 8.1.3 Environment Variables en Render

**Configuración en dashboard:**
1. Variables → Add Environment Variable
2. Key: `GEMINI_API_KEY`
3. Value: `AIzaSyBnWFxXzB...`
4. Save

**Inyección en runtime:**
```javascript
// Render expone variables así:
process.env.GEMINI_API_KEY // "AIzaSy..."
process.env.PORT           // "10000" (asignado por Render)
process.env.NODE_ENV       // "production"
```

**Acceso seguro con `envGet()`:**
```typescript
const key = envGet("GEMINI_API_KEY");
// Retorna: "AIzaSy..." o undefined
```

---

### 8.2 Serving Static Files

**Backend sirve el frontend compilado:**

```typescript
// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '../dist')));

// Catch-all route para SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});
```

**¿Cómo funciona?**

1. Usuario visita `https://revisatucuentasolo1.onrender.com/`
2. Request llega a Express
3. Express busca `/dist/index.html`
4. Sirve el HTML con todo el bundle JS
5. React toma control del routing client-side

**Assets:**
- `/dist/index.html` → HTML principal
- `/dist/assets/index-XYZ.js` → Bundle JavaScript
- `/dist/assets/index-ABC.css` → Estilos

---

### 8.3 Render Free Tier

#### 8.3.1 Limitaciones

- **Sleep después de 15 min inactividad**
- **Cold start:** 30-60 segundos al despertar
- **750 horas/mes gratis** (suficiente para 1 servicio 24/7)
- **No custom domains** (usa `.onrender.com`)

#### 8.3.2 Cold Start Behavior

**Primera request después de sleep:**
```
User → Render
Render: "Oh, este servicio está dormido, voy a despertarlo"
(30-60 seg)
Render: Inicia container
Render: npm start
Server: Arranca en puerto 10000
Render → User: 200 OK
```

**Requests subsecuentes:**
```
User → Render → Server (inmediato)
```

---

## 🎯 Conclusión

Esta aplicación es un **sistema completo de auditoría automatizada** que:

1. ✅ Usa IA multimodal para leer cuentas clínicas
2. ✅ Extrae datos estructurados con precisión
3. ✅ Valida matemáticamente cada ítem
4. ✅ Detecta errores, confusiones de IVA y cargos ocultos
5. ✅ Presenta resultados claros y exportables
6. ✅ Cuesta ~$2 CLP por análisis

**Stack tecnológico moderno, escalable y económico.** 🚀
