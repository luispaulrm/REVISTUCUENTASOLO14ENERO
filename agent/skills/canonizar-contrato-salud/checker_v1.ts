import fs from 'fs';
import path from 'path';

// --- Types adapted to canonical_contract.json schema ---

interface Tope {
    tipo: "SIN_TOPE" | "UF" | "AC2" | "VECES_ARANCEL" | "VARIABLE" | "REGLA_FINANCIERA" | "NFE" | null;
    valor?: number | null;
    factor?: number;
    sin_tope_adicional?: boolean;
}

interface Opcion {
    modalidad: "preferente" | "libre_eleccion";
    grupo_decisional: string;
    subtipo?: string;
    prestadores: string[] | string;
    porcentaje: number | null;
    tope: Tope | string;
    estado_opcion: "ACTIVA" | "LATENTE";
    fuente: string[];
}

interface NfeResumen {
    aplica: boolean;
    valor: number | null;
    razon: string;
    clausula_activa?: boolean;
}

interface PrestacionConsolidada {
    nombre: string;
    opciones: Opcion[];
    nfe_resumen: NfeResumen;
    topes_activos: any[]; // We use nfe_resumen for the check
    operadores_aplicados: any[];
}

interface ContractData {
    prestaciones_consolidadas: PrestacionConsolidada[];
}

// --- Reporting Types ---

export interface Issue {
    id: "E1" | "E2" | "E3" | "E4";
    severity: "CRITICAL" | "MAJOR" | "MINOR";
    message: string;
    evidence?: any;
}

export interface CheckReport {
    ok: boolean;
    score_0_10: number;
    issues: Issue[];
}

// --- Helper Functions ---

const norm = (s: string) =>
    (s ?? "")
        .toUpperCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s+/g, " ")
        .trim();

function ceilingEquals(contractTope: Tope | string | null, expectedKind: string, expectedValue?: number): boolean {
    if (!contractTope) return false;

    // Normalize input
    let kind = "";
    let value: number | undefined;

    if (typeof contractTope === 'string') {
        if (contractTope === 'SIN_TOPE' || contractTope === 'VARIABLE') kind = 'SIN_TOPE'; // Variable in pref usually means resolved by provider/no explicit cap in grid
        else kind = "RAW";
    } else {
        kind = contractTope.tipo || "RAW";
        if (kind === "AC2") value = contractTope.factor;
        if (kind === "UF") value = contractTope.valor || 0;
    }

    if (expectedKind === "SIN_TOPE") {
        return kind === "SIN_TOPE" || kind === "SIN_TOPE_EXPRESO" || (kind === "NFE" && value === null);
    }

    if (expectedKind === "MULTIPLO") {
        return kind === "AC2" && value === expectedValue;
    }

    return false;
}

function scoreFromIssues(issues: Issue[]): number {
    let score = 10;
    for (const it of issues) {
        if (it.severity === "CRITICAL") score -= 3.5;
        if (it.severity === "MAJOR") score -= 2.0;
        if (it.severity === "MINOR") score -= 0.8;
    }
    return Math.max(0, Math.min(10, score));
}

// --- The Checker ---

export function checkExamLab_4Errors(contract: ContractData): CheckReport {
    const issues: Issue[] = [];
    const targetName = "EXAMENES LABORATORIO"; // Simplified for matching

    const row = contract.prestaciones_consolidadas.find(p => norm(p.nombre).includes(targetName));

    if (!row) {
        issues.push({
            id: "E1",
            severity: "CRITICAL",
            message: `No se encontró la fila '${targetName}' en el JSON resuelto.`,
        });
        return { ok: false, score_0_10: 0, issues };
    }

    console.log(`Analyzing: ${row.nombre}`);

    // -----------------------
    // E1: Oferta Preferente debe ser un BLOQUE vertical
    // We check for the existence of the 3 expected paths
    // -----------------------
    const preferenteOptions = row.opciones.filter(o => o.modalidad === "preferente");

    const has80SinTope = preferenteOptions.some(p => p.porcentaje === 80 && (p.tope === "SIN_TOPE" || p.tope === "VARIABLE" /* Treated as such if ACTIVA */));
    const has90SinTope = preferenteOptions.some(p => p.porcentaje === 90 && (p.tope === "SIN_TOPE" || p.tope === "VARIABLE"));

    // E1: Strict Check - Require Santa Maria AND Tabancura AND Indisa in the same 80% path
    const ucPath = preferenteOptions.find(p => p.porcentaje === 80 && Array.isArray(p.prestadores) && p.prestadores.some(pr => norm(pr).includes("UC") || norm(pr).includes("CHRISTUS")));

    const strictGroup2Path = preferenteOptions.find(p =>
        p.porcentaje === 80 &&
        Array.isArray(p.prestadores) &&
        p.prestadores.some(pr => norm(pr).includes("INDISA")) &&
        p.prestadores.some(pr => norm(pr).includes("SANTA MARIA")) &&
        p.prestadores.some(pr => norm(pr).includes("TABANCURA"))
    );

    const davilaPath = preferenteOptions.find(p => p.porcentaje === 90 && Array.isArray(p.prestadores) && p.prestadores.some(pr => norm(pr).includes("DAVILA")));

    if (!ucPath || !strictGroup2Path || !davilaPath) {
        issues.push({
            id: "E1",
            severity: "MAJOR",
            message: "Oferta Preferente incompleta: Faltan clínicas clave en el bloque 80% (Se requiere Indisa + Santa María + Tabancura juntas).",
            evidence: {
                foundUC: !!ucPath,
                foundStrictGroup2: !!strictGroup2Path,
                foundDavila: !!davilaPath
            },
        });
    }

    // -----------------------
    // E2: Libre Elección tope = 1,0 × AC2
    // -----------------------
    const leOption = row.opciones.find(o => o.modalidad === "libre_eleccion");
    if (!leOption) {
        issues.push({ id: "E2", severity: "CRITICAL", message: "No existe opción Libre Elección." });
    } else {
        const is1xAC2 = typeof leOption.tope === 'object' && leOption.tope?.tipo === 'AC2' && leOption.tope.factor === 1;
        if (!is1xAC2) {
            issues.push({
                id: "E2",
                severity: "CRITICAL",
                message: "Libre Elección: el TOPE debe ser 1,0 × AC2.",
                evidence: { tope: leOption.tope },
            });
        }
    }

    // -----------------------
    // E3: NFE (tope anual beneficiario) = SIN TOPE
    // -----------------------
    // In our model, this is checked via nfe_resumen.razon === "SIN_TOPE_EXPRESO" or operators
    const isSinTopeNfe = row.nfe_resumen.razon === "SIN_TOPE_EXPRESO" || row.nfe_resumen.valor === null;

    if (!isSinTopeNfe) {
        issues.push({
            id: "E3",
            severity: "CRITICAL",
            message: "NFE (Tope Máx Año por Beneficiario) debe ser 'SIN TOPE'.",
            evidence: { nfe: row.nfe_resumen },
        });
    }

    // -----------------------
    // E4: “Solo cobertura libre elección” Flag
    // In our model, we check if preferente options exist and are "ACTIVA"
    // -----------------------
    const hasActivePreferente = preferenteOptions.some(o => o.estado_opcion === "ACTIVA");
    if (!hasActivePreferente) {
        issues.push({
            id: "E4",
            severity: "MAJOR",
            message: "Marcado erróneamente como 'Solo cobertura libre elección' (no hay opciones preferentes activas).",
            evidence: { optionsCount: preferenteOptions.length },
        });
    }

    const score = scoreFromIssues(issues);
    return { ok: issues.length === 0, score_0_10: score, issues };

}

// --- Execute ---
const CONTRACT_PATH = path.join(process.cwd(), 'canonical_contract.json');
const rawData = fs.readFileSync(CONTRACT_PATH, 'utf-8');
const contractData = JSON.parse(rawData);

const report = checkExamLab_4Errors(contractData);
console.log(JSON.stringify(report, null, 2));
