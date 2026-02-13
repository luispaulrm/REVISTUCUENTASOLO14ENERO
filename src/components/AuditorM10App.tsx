import React, { useState, useEffect } from 'react';
import { Brain, Database, FileText, Activity, Layers, Zap, CheckCircle2, AlertCircle, Play, Loader2, FileJson, Copy, Check, Info } from 'lucide-react';
import { runSkill } from '../m10/engine';
import { SkillInput, SkillOutput, CanonicalContractRule, ContractDomain } from '../m10/types';

export default function AuditorM10App() {
    const [dataStatus, setDataStatus] = useState({
        canonical: false,
        pam: false,
        account: false
    });
    const [auditResult, setAuditResult] = useState<SkillOutput | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const checkData = () => {
            const canonical = localStorage.getItem('canonical_contract_result');
            const pam = localStorage.getItem('pam_audit_result');
            const account = localStorage.getItem('clinic_audit_result');

            setDataStatus({
                canonical: !!canonical,
                pam: !!pam,
                account: !!account
            });
        };

        checkData();
        const interval = setInterval(checkData, 2000);
        return () => clearInterval(interval);
    }, []);

    const handleRunAudit = () => {
        setIsProcessing(true);
        setTimeout(() => {
            try {
                const canonicalStr = localStorage.getItem('canonical_contract_result');
                const pamStr = localStorage.getItem('pam_audit_result');
                const accountStr = localStorage.getItem('clinic_audit_result');

                if (!canonicalStr || !pamStr || !accountStr) {
                    alert('Faltan datos para ejecutar la auditoría.');
                    setIsProcessing(false);
                    return;
                }

                const rawContract = JSON.parse(canonicalStr);
                const rawPam = JSON.parse(pamStr);
                const rawBill = JSON.parse(accountStr);

                const input = adaptToM10Input(rawContract, rawPam, rawBill);

                // DIAGNOSTIC START
                if (input.contract.rules.length === 0 || input.pam.folios.length === 0 || input.bill.items.length === 0) {
                    const missing = [];
                    if (input.contract.rules.length === 0) missing.push("Contrato (Rules=0)");
                    if (input.pam.folios.length === 0) missing.push("PAM (Folios=0)");
                    if (input.bill.items.length === 0) missing.push("Cuenta (Items=0)");

                    const debugMsg = `SC-1 ERROR DIAGNÓSTICO:\n${missing.join(', ')}\n\nKeys RAW:\nContract: ${Object.keys(rawContract).join(',')}\nPAM: ${Object.keys(rawPam).join(',')}\nBill: ${Object.keys(rawBill).join(',')}`;

                    setAuditResult({
                        summary: { totalCopagoAnalizado: 0, totalImpactoFragmentacion: 0, opacidadGlobal: { applies: false, maxIOP: 0 }, patternSystemic: { m1Count: 0, m2Count: 0, m3CopagoPct: 0, isSystemic: false } },
                        eventModel: { notes: "Error de Datos", paquetesDetectados: [] },
                        matrix: [],
                        pamRows: [],
                        reportText: debugMsg,
                        complaintText: ''
                    });
                    setIsProcessing(false);
                    return;
                }
                // DIAGNOSTIC END

                const result = runSkill(input);
                setAuditResult(result);
            } catch (error: any) {
                console.error("Error executing M10 Audit:", error);
                alert(`Error al ejecutar el motor M10: ${error.message}`);
                // Optional: Set a dummy error result to show in UI
                setAuditResult({
                    summary: { totalCopagoAnalizado: 0, totalImpactoFragmentacion: 0, opacidadGlobal: { applies: false, maxIOP: 0 }, patternSystemic: { m1Count: 0, m2Count: 0, m3CopagoPct: 0, isSystemic: false } },
                    eventModel: { notes: `Error Critico: ${error.message}`, paquetesDetectados: [] },
                    matrix: [],
                    pamRows: [],
                    reportText: `ERROR CRÍTICO DEL SISTEMA:\n${error.message}`,
                    complaintText: ''
                });
            } finally {
                setIsProcessing(false);
            }
        }, 500);
    };

    const copyComplaint = () => {
        if (!auditResult) return;
        navigator.clipboard.writeText(auditResult.complaintText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const allDataReady = dataStatus.canonical && dataStatus.pam && dataStatus.account;

    return (
        <div className="min-h-[calc(100vh-64px)] bg-[#f8fafc] p-8 animate-in fade-in duration-700 pb-32">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-200">
                                <Brain className="text-white" size={24} />
                            </div>
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Advanced Forensic Layer v1.3</span>
                        </div>
                        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">
                            Módulo 10 <span className="text-indigo-600">Auditor</span>
                        </h1>
                        <p className="mt-2 text-slate-500 max-w-2xl text-lg">
                            Motor Maestro: Triple Cruce + Fragmentación M1/M2/M3 + Opacidad IOP.
                        </p>
                    </div>

                    <div className="flex gap-4">
                        <div className="px-6 py-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${allDataReady ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
                            <span className="text-sm font-semibold text-slate-700">
                                {allDataReady ? 'Fuentes Listas' : 'Esperando Conexiones'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Connection Status Grid - Valid for both states */}
                {!auditResult && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            { title: 'JSON Canónico', icon: <Database className={dataStatus.canonical ? "text-blue-500" : "text-slate-400"} />, label: 'Contrato Estructurado', ready: dataStatus.canonical },
                            { title: 'PAM Data', icon: <FileText className={dataStatus.pam ? "text-purple-500" : "text-slate-400"} />, label: 'Coberturas Reales', ready: dataStatus.pam },
                            { title: 'Cuenta Clínica', icon: <Activity className={dataStatus.account ? "text-rose-500" : "text-slate-400"} />, label: 'Gastos Médicos', ready: dataStatus.account }
                        ].map((card, idx) => (
                            <div key={idx} className={`group relative bg-white p-6 rounded-3xl border transition-all duration-500 ${card.ready ? 'border-indigo-100 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5' : 'border-slate-200 opacity-70'}`}>
                                <div className="flex items-start justify-between mb-4">
                                    <div className={`p-3 rounded-2xl transition-all duration-500 ${card.ready ? 'bg-slate-50 group-hover:bg-white group-hover:scale-110' : 'bg-slate-100'}`}>
                                        {card.icon}
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Source Connection</div>
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-1">{card.title}</h3>
                                <div className="flex items-center gap-2">
                                    <span className={`w-1.5 h-1.5 rounded-full ${card.ready ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                    <span className={`text-xs font-medium ${card.ready ? 'text-emerald-600' : 'text-slate-400'}`}>{card.ready ? 'Linked' : 'Disconnected'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Action Area */}
                {!auditResult && (
                    <div className="relative overflow-hidden bg-slate-900 rounded-[2.5rem] p-12 text-center shadow-2xl">
                        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600" />
                            <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
                        </div>
                        <div className="relative z-10 flex flex-col items-center">
                            <div className="p-4 bg-white/10 rounded-full backdrop-blur-xl mb-6">
                                <Zap className={allDataReady ? "text-indigo-400" : "text-slate-500"} size={48} />
                            </div>
                            <h2 className="text-3xl font-bold text-white mb-4">
                                {allDataReady ? 'Listo para Auditoría M10 v1.3' : 'Fuentes Incompletas'}
                            </h2>
                            <button
                                onClick={handleRunAudit}
                                disabled={!allDataReady || isProcessing}
                                className={`px-10 py-4 font-bold rounded-2xl shadow-lg transition-all duration-300 flex items-center gap-3 ${allDataReady && !isProcessing ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30 hover:scale-105 active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                            >
                                {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
                                {isProcessing ? 'Ejecutando Pipeline Maestro...' : 'Iniciar Procesamiento M10'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Results View */}
                {auditResult && (
                    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 space-y-8">
                        {/* Summary Metrics */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Evento Inferido</div>
                                <div className="text-xl font-black text-slate-900 truncate">{auditResult.eventModel.actoPrincipal}</div>
                                <div className="text-xs text-slate-500 mt-1">{auditResult.eventModel.paquetesDetectados.join(', ') || 'Sin paquetes'}</div>
                            </div>
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Copago Analizado</div>
                                <div className="text-2xl font-black text-slate-900">${auditResult.summary.totalCopagoAnalizado.toLocaleString()}</div>
                            </div>
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Impacto Fragmentación</div>
                                <div className="text-2xl font-black text-rose-600">${auditResult.summary.totalImpactoFragmentacion.toLocaleString()}</div>
                                {auditResult.summary.patternSystemic.isSystemic && <div className="text-xs font-bold text-rose-500 mt-1 uppercase">Patrón Sistémico Detectado</div>}
                            </div>
                            <div className={`p-6 rounded-2xl border shadow-sm ${auditResult.summary.opacidadGlobal.applies ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
                                <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${auditResult.summary.opacidadGlobal.applies ? 'text-rose-500' : 'text-emerald-600'}`}>Opacidad Liquidatoria</div>
                                <div className={`text-2xl font-black ${auditResult.summary.opacidadGlobal.applies ? 'text-rose-700' : 'text-emerald-700'}`}>
                                    {auditResult.summary.opacidadGlobal.applies ? 'DETECTADA' : 'NORMAL'}
                                </div>
                                {auditResult.summary.opacidadGlobal.applies && (
                                    <div className="text-xs text-rose-600 mt-1 font-bold">Max IOP: {auditResult.summary.opacidadGlobal.maxIOP} / 100</div>
                                )}
                            </div>
                        </div>

                        {/* Findings Matrix */}
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                    <Layers className="text-indigo-600" size={20} />
                                    Matriz de Hallazgos (Maestro v1.3)
                                </h3>
                                <button onClick={() => setAuditResult(null)} className="text-xs font-bold text-slate-500 hover:text-indigo-600">NUEVA AUDITORÍA</button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                                        <tr>
                                            <th className="px-8 py-4">Item Evaluado</th>
                                            <th className="px-8 py-4">Clasificación</th>
                                            <th className="px-8 py-4">Motor</th>
                                            <th className="px-8 py-4">Fundamento Técnico & IOP</th>
                                            <th className="px-8 py-4 text-right">Impacto ($)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {auditResult.matrix.length === 0 ? (
                                            <tr><td colSpan={5} className="px-8 py-12 text-center text-slate-400 italic">No se detectaron irregularidades estructurales.</td></tr>
                                        ) : (
                                            auditResult.matrix.map((row, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-8 py-4 font-medium text-slate-900">{row.itemLabel}</td>
                                                    <td className="px-8 py-4">
                                                        <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase ${row.classification === 'CORRECTO' ? 'bg-emerald-100 text-emerald-700' :
                                                            row.classification === 'FRAGMENTACION_ESTRUCTURAL' ? 'bg-rose-100 text-rose-700' :
                                                                'bg-amber-100 text-amber-700'
                                                            }`}>{row.classification.replace('_', ' ')}</span>
                                                    </td>
                                                    <td className="px-8 py-4 font-mono text-xs font-bold text-slate-500">{row.motor}</td>
                                                    <td className="px-8 py-4 text-slate-600 max-w-md">
                                                        <div>{row.fundamento.split('[OPACIDAD')[0]}</div>
                                                        {row.iop && row.iop >= 60 && (
                                                            <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full w-fit">
                                                                <AlertCircle size={10} /> IOP CRÍTICO: {row.iop}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-8 py-4 text-right font-mono font-bold text-slate-900">${row.impacto.toLocaleString()}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Report & Complaint Tabs */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col h-[500px]">
                                <div className="flex items-center gap-2 mb-4">
                                    <FileText className="text-slate-400" size={18} />
                                    <h4 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Informe Forense Estructurado</h4>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-4 font-mono text-xs text-slate-700 whitespace-pre-wrap flex-grow overflow-y-auto border border-slate-100">
                                    {auditResult.reportText}
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col h-[500px]">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle className="text-rose-500" size={18} />
                                        <h4 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Texto de Reclamo (Automático)</h4>
                                    </div>
                                    <button onClick={copyComplaint} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-600 text-xs font-bold hover:bg-indigo-100 transition-colors">
                                        {copied ? <Check size={14} /> : <Copy size={14} />}
                                        {copied ? 'COPIADO' : 'COPIAR TEXTO'}
                                    </button>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-4 font-mono text-xs text-slate-700 whitespace-pre-wrap flex-grow overflow-y-auto border border-slate-100">
                                    {auditResult.complaintText || "No hay hallazgos que generen reclamo."}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------- ADAPTER LOGIC ----------

function adaptToM10Input(rawContract: any, rawPam: any, rawBill: any): SkillInput {
    // 1. Adapt CONTRACT
    let rules: CanonicalContractRule[] = [];
    let sourceArray: any[] = [];

    if (Array.isArray(rawContract)) {
        sourceArray = rawContract;
    } else if (Array.isArray(rawContract.rules)) {
        sourceArray = rawContract.rules;
    } else if (Array.isArray(rawContract.coberturas)) {
        sourceArray = rawContract.coberturas;
    } else if (rawContract.data && Array.isArray(rawContract.data.coberturas)) {
        sourceArray = rawContract.data.coberturas;
    }

    rules = sourceArray.map((c: any) => ({
        id: c.item || c.id || 'rule_' + Math.random().toString(36).substr(2, 9),
        domain: mapCategoryToDomain(c.categoria || c.seccion || c.ambito || '', c.descripcion_textual || c.item || ''),
        coberturaPct: c.porcentaje || (c.modalidades?.[0]?.porcentaje) || null,
        tope: {
            kind: c.tope ? 'VARIABLE' : 'SIN_TOPE_EXPRESO',
            value: null,
            currency: c.tope,
        },
        textLiteral: `${c.item || ''} ${c.descripcion_textual || ''}`.trim()
    }));

    // 2. Adapt PAM
    let pamFolios = [];
    if (rawPam.folios && Array.isArray(rawPam.folios)) {
        pamFolios = rawPam.folios;
    } else if (rawPam.data && rawPam.data.folios) {
        pamFolios = rawPam.data.folios;
    } else if (Array.isArray(rawPam)) {
        // Assume array of items, wrap in single folio
        pamFolios = [{ folioPAM: 'UNKNOWN', items: rawPam }];
    }

    // 3. Adapt BILL
    let billItems = [];
    // Handle wrapped content (common in ForensicApp saves)
    let actualBill = rawBill.content || rawBill;
    if (typeof actualBill === 'string') {
        try { actualBill = JSON.parse(actualBill); } catch (e) { }
    }

    if (actualBill.items && Array.isArray(actualBill.items)) {
        billItems = actualBill.items;
    } else if (Array.isArray(actualBill)) {
        billItems = actualBill;
    } else if (actualBill.data && Array.isArray(actualBill.data)) {
        billItems = actualBill.data;
    }

    return {
        contract: { rules },
        pam: { folios: pamFolios },
        bill: { items: billItems }
    };
}

function mapCategoryToDomain(cat: string, desc: string = ''): ContractDomain {
    const lowerCat = (cat || '').toLowerCase();
    const lowerDesc = (desc || '').toLowerCase();
    const combined = `${lowerCat} ${lowerDesc}`;

    if (lowerCat.includes('hospital') || lowerCat.includes('dias cama')) return 'HOSPITALIZACION';
    if (lowerCat.includes('pabellon') || lowerCat.includes('quirofano')) return 'PABELLON';
    if (lowerCat.includes('honorario') || lowerCat.includes('medico')) return 'HONORARIOS';
    if (lowerCat.includes('medicamento')) return 'MEDICAMENTOS_HOSP';
    if (lowerCat.includes('material')) return 'MATERIALES_CLINICOS';
    if (lowerCat.includes('examen') || lowerCat.includes('laboratorio') || lowerCat.includes('imagen')) return 'EXAMENES';
    if (lowerCat.includes('protesis') || lowerCat.includes('ortesis')) return 'PROTESIS_ORTESIS';
    if (lowerCat.includes('consulta')) return 'CONSULTA';
    if (lowerCat.includes('kinesi')) return 'KINESIOLOGIA';
    if (lowerCat.includes('traslado')) return 'TRASLADOS';

    // Heuristics if Category is generic
    if (combined.includes('dia cama') || combined.includes('habitacion')) return 'HOSPITALIZACION';
    if (combined.includes('pabellon') || combined.includes('quirofano')) return 'PABELLON';
    if (combined.includes('cirujano') || combined.includes('anestesia')) return 'HONORARIOS';

    return 'OTROS';
}
