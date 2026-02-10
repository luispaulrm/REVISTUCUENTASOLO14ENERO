
import { spawn } from 'child_process';
import { exec } from 'child_process';

// STRICT PAYLOAD MATCHING NEW RawCuentaItem INTERFACE
const SAMPLE_ITEMS = [
    { id: "1", text: "DIA CAMA PIEZA EXCLUSIVA" },
    { id: "2", text: "ATENCION CERRADA" },
    { id: "3", text: "JERINGA 10 CC" },
    { id: "4", text: "GUANTE DE PROCEDIMIENTO" },
    { id: "5", text: "TERMOMETRO DIGITAL" },
    { id: "6", text: "DERECHO DE PABELLON QUIRURGICO" },
    { id: "7", text: "KIT BASICO DE COLECISTECTOMIA" },
    { id: "8", text: "PARACETAMOL 1G EV" },
    { id: "9", text: "SEVORANE LIQUIDO" },
    { id: "10", text: "HONORARIO CIRUJANO PRIMERO" },
    { id: "11", text: "VISITA MEDICA HOSPITALIZADO" }
];

const PORT = 5006; // Use diff port to generate fresh instance

async function startServer() {
    console.log(`Initialising server on port ${PORT}...`);
    const serverProcess = spawn('npx', ['tsx', 'server/server.ts'], {
        shell: true,
        env: { ...process.env, PORT: String(PORT) },
        cwd: process.cwd(),
        stdio: 'pipe'
    });

    return new Promise<any>((resolve, reject) => {
        let started = false;
        serverProcess.stdout.on('data', (data) => {
            const str = data.toString();
            // console.log('[SERVER STDOUT]', str.trim()); 
            if (str.includes(`Backend server running on port ${PORT}`)) {
                if (!started) {
                    started = true;
                    resolve(serverProcess);
                }
            }
        });
        serverProcess.stderr.on('data', (data) => {
            // console.error('[SERVER STDERR]', data.toString());
        });

        serverProcess.on('error', (err) => reject(err));

        // Timeout
        setTimeout(() => {
            if (!started) reject(new Error("Server start timeout."));
        }, 40000);
    });
}

async function runTest() {
    let serverProc: any;
    try {
        serverProc = await startServer();
        console.log("Server started successfully.");

        // UPDATED ENDPOINT URL
        const url = `http://localhost:${PORT}/api/cuenta/taxonomy-phase1`;
        console.log(`Connecting to ${url}...`);

        // UPDATED PAYLOAD STRUCTURE
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ items: SAMPLE_ITEMS })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
        }

        const data = await response.json() as { results: any[], skeleton: any };
        const results = data.results;
        const skeleton = data.skeleton;

        console.log("=== REPORTE DE VERIFICACIÓN TAXONÓMICA (PHASE 1.5 SKELETON) ===");

        if (skeleton) {
            console.log("✅ ESQUELETO DETECTADO:");
            console.log(JSON.stringify(skeleton, null, 2));
        } else {
            console.error("❌ ERROR: No se generó el esqueleto visual.");
        }

        // Verificación 1: Jeringa debe ser INSUMOS / MATERIALES + Flag Inherente
        const jeringa = results.find((r: any) => r.item_original.includes("JERINGA"));

        // CHECK NEW ATTRIBUTES STRUCTURE
        if (jeringa?.grupo === 'INSUMOS' && jeringa?.atributos.potencial_inherente_dia_cama === true) {
            console.log("✅ LÓGICA FORENSE OK: Jeringa detectada como INSUMOS y potencial_inherente_dia_cama=true.");
        } else {
            console.error("❌ FALLO LÓGICA: Jeringa mal clasificada.", JSON.stringify(jeringa, null, 2));
        }

        // Verificación 2: Día Cama debe ser HOTELERA
        const cama = results.find((r: any) => r.item_original.includes("PIEZA EXCLUSIVA"));
        if (cama?.grupo === 'HOTELERA') {
            console.log("✅ GRUPO OK: Día cama identificado correctamente como HOTELERA.");
        } else {
            console.error("❌ FALLO GRUPO: Día cama.", JSON.stringify(cama, null, 2));
        }

        // Verificación 3: Confidence check
        if (cama?.confidence > 0) {
            console.log(`✅ CONFIDENCE OK: ${cama.confidence}`);
        }

        console.log("\nDetalle Completo (First 3):", JSON.stringify(results.slice(0, 3), null, 2));

    } catch (error: any) {
        console.error("Error running test:", error);
    } finally {
        if (serverProc) {
            console.log("Killing server...");
            exec(`taskkill /pid ${serverProc.pid} /T /F`, (err) => {
                process.exit(0);
            });
        } else {
            process.exit(1);
        }
    }
}

runTest();
