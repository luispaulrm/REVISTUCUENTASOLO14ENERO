import React, { useState, useEffect, useRef } from 'react';
import {
    Gavel,
    FileText,
    ShieldCheck,
    Scale,
    AlertCircle,
    Loader2,
    Trash2,
    Download,
    Printer,
    Terminal,
    ChevronRight,
    Search,
    CheckCircle2
} from 'lucide-react';
import { runForensicAudit } from '../auditService';
import { VERSION, LAST_MODIFIED } from '../version';

export default function ForensicApp() {
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('IDLE');
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [auditResult, setAuditResult] = useState<any>(null);

    // Persisted Data State
    const [hasBill, setHasBill] = useState(false);
    const [hasPam, setHasPam] = useState(false);
    const [hasContract, setHasContract] = useState(false);

    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        checkData();
        // Listen for storage changes to update status if user processes docs in other tabs
        window.addEventListener('storage', checkData);
        return () => window.removeEventListener('storage', checkData);
    }, []);

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const checkData = () => {
        setHasBill(!!localStorage.getItem('clinic_audit_result'));
        setHasPam(!!localStorage.getItem('pam_audit_result'));
        setHasContract(!!localStorage.getItem('contract_audit_result'));
    };

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    const handleExecuteAudit = async () => {
        setStatus('PROCESSING');
        setError(null);
        setLogs([]);
        setAuditResult(null);

        addLog('[SISTEMA] 🚀 Iniciando Auditoría Forense Consolidada...');

        try {
            const cuenta = JSON.parse(localStorage.getItem('clinic_audit_result') || '{}');
            const pam = JSON.parse(localStorage.getItem('pam_audit_result') || '{}');
            const contrato = JSON.parse(localStorage.getItem('contract_audit_result') || '{}');

            const result = await runForensicAudit(cuenta, pam, contrato, addLog);
            setAuditResult(result);
            setStatus('SUCCESS');
        } catch (err: any) {
            setError(err.message || 'Error durante la auditoría forense.');
            setStatus('ERROR');
        }
    };

    const clearAllData = () => {
        if (window.confirm('¿Estás seguro de que quieres borrar todos los datos de la sesión (Cuenta, PAM y Contrato)?')) {
            localStorage.clear();
            checkData();
            setStatus('IDLE');
            setAuditResult(null);
            setLogs([]);
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 relative pb-32">
            <header className="bg-transparent border-b border-slate-200 sticky top-0 z-50 print:hidden backdrop-blur-sm">
                <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg">
                            <Gavel size={22} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                                AUDITORÍA FORENSE
                                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 font-mono">{VERSION}</span>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Cross-Validation Engine (v9)</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status === 'SUCCESS' && (
                            <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all shadow-md">
                                <Printer size={16} /> EXPORTAR REPORTE
                            </button>
                        )}
                        <button onClick={clearAllData} className="p-2 text-slate-400 hover:text-rose-500 transition-colors" title="Borrar todo">
                            <Trash2 size={20} />
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-grow max-w-[1800px] mx-auto w-full p-6 sm:p-10">
                {status === 'IDLE' && (
                    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
                        {/* Status Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <DataStatusCard
                                title="Cuenta Clínica"
                                icon={<FileText size={24} />}
                                ready={hasBill}
                                desc="Detalle de gastos extraído"
                            />
                            <DataStatusCard
                                title="PAM (Isapre)"
                                icon={<ShieldCheck size={24} />}
                                ready={hasPam}
                                desc="Bonificaciones y copagos"
                            />
                            <DataStatusCard
                                title="Contrato Salud"
                                icon={<Scale size={24} />}
                                ready={hasContract}
                                desc="Reglas y coberturas del plan"
                            />
                        </div>

                        <div className="bg-white rounded-3xl p-10 border border-slate-200 shadow-xl shadow-slate-200/50 text-center space-y-6">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-900 mx-auto border border-slate-200 shadow-inner">
                                <Search size={36} />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black text-slate-900 tracking-tight">Cruce Forense Consolidado</h2>
                                <p className="text-slate-500 max-w-xl mx-auto">
                                    Esta herramienta realiza una validación triple para detectar fraudes,
                                    desagregación indebida de insumos y violaciones al principio de evento único.
                                </p>
                            </div>

                            {!hasBill || !hasPam || !hasContract ? (
                                <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-4 text-left max-w-2xl mx-auto">
                                    <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                                    <div>
                                        <p className="text-sm font-bold text-amber-900">Documentación Incompleta</p>
                                        <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                                            Para una auditoría forense efectiva, debes procesar primero la
                                            <strong> Cuenta</strong>, el <strong>PAM</strong> y el <strong>Contrato</strong> en sus
                                            respectivas pestañas.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={handleExecuteAudit}
                                    className="px-10 py-5 bg-slate-900 text-white rounded-2xl font-black text-lg hover:bg-black transition-all hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-3 mx-auto"
                                >
                                    <Gavel size={24} /> EJECUTAR ANÁLISIS FORENSE
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-60">
                            <div className="bg-white p-6 rounded-2xl border border-slate-200">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Normativa Aplicada</h4>
                                <ul className="text-xs space-y-2 text-slate-600 font-medium">
                                    <li className="flex items-center gap-2"><div className="w-1 h-1 bg-slate-300 rounded-full" /> Circular IF-319 (Hotelería/Insumos)</li>
                                    <li className="flex items-center gap-2"><div className="w-1 h-1 bg-slate-300 rounded-full" /> Dictamen SS N°12.287 (Evento Único)</li>
                                    <li className="flex items-center gap-2"><div className="w-1 h-1 bg-slate-300 rounded-full" /> Ley 20.584 (Transparencia Médica)</li>
                                </ul>
                            </div>
                            <div className="bg-white p-6 rounded-2xl border border-slate-200">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Objetivos Forenses</h4>
                                <ul className="text-xs space-y-2 text-slate-600 font-medium">
                                    <li className="flex items-center gap-2"><div className="w-1 h-1 bg-slate-300 rounded-full" /> Identificación de doble cobro</li>
                                    <li className="flex items-center gap-2"><div className="w-1 h-1 bg-slate-300 rounded-full" /> Prorrateo determinístico de fámacos</li>
                                    <li className="flex items-center gap-2"><div className="w-1 h-1 bg-slate-300 rounded-full" /> Validación de red preferente vs libre</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {status === 'PROCESSING' && (
                    <div className="max-w-4xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden h-[600px] flex flex-col relative">
                            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Terminal size={16} className="text-slate-400" />
                                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Forensic Engine Logs</span>
                                </div>
                                <Loader2 size={16} className="text-slate-400 animate-spin" />
                            </div>
                            <div className="p-6 h-full overflow-y-auto font-mono text-[11px] space-y-2 bg-white">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-4 items-start py-1 border-l-2 border-transparent pl-3">
                                        <span className="text-slate-600">{log}</span>
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                            <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
                                <p className="text-xs font-bold text-slate-400 uppercase animate-pulse">Analizando jurisprudencia y cruzando datos...</p>
                            </div>
                        </div>
                    </div>
                )}

                {status === 'ERROR' && (
                    <div className="max-w-md mx-auto py-20 text-center">
                        <AlertCircle size={64} className="text-rose-500 mx-auto mb-6" />
                        <h3 className="text-2xl font-black text-slate-900 mb-2">Error en Auditoría</h3>
                        <p className="text-slate-500 mb-8">{error}</p>
                        <button onClick={() => setStatus('IDLE')} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold">
                            VOLVER A INTENTAR
                        </button>
                    </div>
                )}

                {status === 'SUCCESS' && auditResult && (
                    <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-6 duration-700">
                        <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm space-y-10">
                            {/* Summary Header */}
                            <div className="flex flex-col md:flex-row justify-between items-start gap-8 border-b border-slate-100 pb-10">
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 text-[10px] font-black uppercase tracking-wider">
                                        <CheckCircle2 size={12} /> Análisis Forense Completado
                                    </div>
                                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Resultados de la Auditoría</h2>
                                    <p className="text-slate-500 font-medium">Motivo: {auditResult.motivo}</p>
                                </div>
                                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 min-w-[250px]">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Decisión del Motor</p>
                                    <div className="text-2xl font-black text-slate-900 uppercase">
                                        {auditResult.decision.replace('_', ' ')}
                                    </div>
                                    {auditResult.requiereRevisionHumana && (
                                        <div className="mt-2 text-[10px] font-bold text-amber-600 flex items-center gap-1.5 bg-amber-50 px-2 py-1 rounded">
                                            <AlertCircle size={12} /> REQUIERE REVISIÓN HUMANA
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Key Changes / Findings */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <ChevronRight size={16} className="text-slate-900" /> Hallazgos Críticos ({auditResult.cambiosClave.length})
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {auditResult.cambiosClave.map((cambio: any, idx: number) => (
                                        <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 border-l-4 border-l-slate-900">
                                            <div className="text-[10px] font-black text-slate-400 uppercase mb-1">{cambio.codigoPrestacion} - {cambio.tipoCambio}</div>
                                            <p className="text-sm text-slate-700 font-medium leading-relaxed">{cambio.detalle}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Report Markdown Rendering */}
                            <div className="bg-slate-900 text-slate-100 p-1 md:p-10 rounded-3xl overflow-hidden shadow-2xl">
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-8 border-b border-slate-800 pb-4">Informe Completo (Markdown format)</h4>
                                <div className="prose prose-invert prose-slate max-w-none whitespace-pre-wrap font-mono text-xs leading-loose">
                                    {auditResult.auditoriaFinalMarkdown}
                                </div>
                            </div>

                            <div className="flex justify-center gap-4 pt-4 print:hidden">
                                <button onClick={() => window.print()} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black flex items-center gap-2 hover:bg-black transition-all">
                                    <Printer size={20} /> IMPRIMIR INFORME TÉCNICO
                                </button>
                                <button className="px-8 py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center gap-2 hover:bg-slate-50 transition-all">
                                    <Download size={20} /> DESCARGAR PDF
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function DataStatusCard({ title, icon, ready, desc }: { title: string, icon: React.ReactNode, ready: boolean, desc: string }) {
    return (
        <div className={`p-6 rounded-2xl border transition-all duration-300 ${ready ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
            <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl ${ready ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {icon}
                </div>
                {ready ? (
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-black uppercase tracking-wider border border-emerald-100">Listo</span>
                ) : (
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-[10px] font-black uppercase tracking-wider border border-slate-200">Falta</span>
                )}
            </div>
            <h4 className="font-bold text-slate-900 mb-1">{title}</h4>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">{desc}</p>
        </div>
    );
}
