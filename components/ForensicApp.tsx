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
    CheckCircle2,
    Timer,
    X,
    FileType,
    FileJson,
    DollarSign,
    Zap
} from 'lucide-react';
import { runForensicAudit } from '../auditService';
import { VERSION, LAST_MODIFIED, AI_MODEL } from '../version';

export default function ForensicApp() {
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('IDLE');
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [auditResult, setAuditResult] = useState<any>(null);

    // Telemetry State
    const [progress, setProgress] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [realTimeUsage, setRealTimeUsage] = useState<any>(null);

    // Persisted Data State
    const [hasBill, setHasBill] = useState(false);
    const [hasPam, setHasPam] = useState(false);
    const [hasContract, setHasContract] = useState(false);

    const logEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        checkData();
        window.addEventListener('storage', checkData);

        // Re-check data when user returns to this tab/window
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                checkData();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('storage', checkData);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        if (status === 'PROCESSING') {
            if (!timerRef.current) {
                setSeconds(0);
                timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
            }
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (status === 'SUCCESS') setProgress(100);
        }
    }, [status]);

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const checkData = () => {
        setHasBill(!!localStorage.getItem('clinic_audit_result'));
        setHasPam(!!localStorage.getItem('pam_audit_result'));
        setHasContract(!!localStorage.getItem('contract_audit_result'));
    };

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    const downloadFormat = (data: any, format: 'json' | 'md', filename: string) => {
        const content = format === 'json' ? JSON.stringify(data, null, 2) : data.auditoriaFinalMarkdown;
        const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().getTime()}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleExecuteAudit = async () => {
        setStatus('PROCESSING');
        setError(null);
        setLogs([]);
        setAuditResult(null);
        setProgress(0);
        setRealTimeUsage(null);

        addLog('[SISTEMA] 🚀 Iniciando Auditoría Forense Consolidada...');

        try {
            const cuenta = JSON.parse(localStorage.getItem('clinic_audit_result') || '{}');
            const pam = JSON.parse(localStorage.getItem('pam_audit_result') || '{}');
            const contrato = JSON.parse(localStorage.getItem('contract_audit_result') || '{}');

            const result = await runForensicAudit(
                cuenta,
                pam,
                contrato,
                addLog,
                (usage) => setRealTimeUsage(usage),
                (prog) => setProgress(prog)
            );

            setAuditResult(result);
            setStatus('SUCCESS');
        } catch (err: any) {
            setError(err.message || 'Error durante la auditoría forense.');
            setStatus('ERROR');
        }
    };

    const clearAllData = () => {
        if (window.confirm('¿Borrar el resultado de la auditoría forense? (Los análisis de Cuenta, PAM y Contrato se mantendrán)')) {
            // Only clear audit results, keep base analyses for iteration
            setStatus('IDLE');
            setAuditResult(null);
            setLogs([]);
            setRealTimeUsage(null);
            setProgress(0);
            setError(null);
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
                                <span className="text-xs text-slate-900 font-black ml-2 uppercase tracking-tight">Actualizado: {LAST_MODIFIED}</span>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                                {AI_MODEL} <span className="w-1 h-1 rounded-full bg-slate-300 inline-block mx-1"></span> Cross-Validation Engine (v9)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status === 'SUCCESS' && (
                            <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all shadow-md">
                                <Printer size={16} /> EXPORTAR REPORTE
                            </button>
                        )}
                        <button onClick={clearAllData} className="p-2 text-slate-400 hover:text-amber-500 transition-colors" title="Limpiar auditoría (mantiene datos base)">
                            <Trash2 size={20} />
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-grow max-w-[1800px] mx-auto w-full p-6 sm:p-10">
                {status === 'IDLE' && (
                    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
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
                    </div>
                )}

                {status === 'PROCESSING' && (
                    <div className="max-w-4xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden h-[600px] flex flex-col relative">
                            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Terminal size={16} className="text-slate-400" />
                                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Forensic Engine Logs</span>
                                </div>
                                <div className="flex gap-2">
                                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                                </div>
                            </div>
                            <div className="p-6 h-full overflow-y-auto font-mono text-xs space-y-2 pb-20 bg-white custom-scrollbar">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-4 items-start py-1.5 border-l-2 border-transparent hover:border-slate-300 hover:bg-slate-50 transition-colors pl-3 -ml-3">
                                        <span className="opacity-40 w-24 shrink-0 text-right text-slate-400 font-bold text-[10px] pt-0.5 font-sans">
                                            {log.match(/\[(.*?)\]/)?.[1] || ""}
                                        </span>
                                        <span className={`break-words flex-1 leading-relaxed ${log.includes('[SISTEMA]') ? 'text-slate-400 italic' : 'text-slate-600'}`}>
                                            {log.replace(/^\[.*?\]/, '').trim()}
                                        </span>
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                            <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
                                <p className="text-xs font-bold text-slate-400 uppercase animate-pulse">Analizando jurisprudencia y cruzando datos...</p>
                            </div>
                        </div>

                        {/* SPACE X FOOTER for Forensic */}
                        <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] safe-pb">
                            <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between">
                                <div className="flex items-center gap-4 border-r border-slate-800 pr-8 h-full">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Time</span>
                                        <div className="font-mono text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                            <Timer size={18} className="text-slate-500" />
                                            T+{formatTime(seconds)}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 px-8 border-r border-slate-800 h-full min-w-[200px]">
                                    <div className="relative w-12 h-12">
                                        <svg className="w-full h-full transform -rotate-90">
                                            <circle cx="24" cy="24" r="20" className="text-slate-800 stroke-current" strokeWidth="4" fill="transparent" />
                                            <circle cx="24" cy="24" r="20" className="text-white stroke-current" strokeWidth="4" fill="transparent"
                                                strokeDasharray={125.6} strokeDashoffset={125.6 - (125.6 * progress) / 100} strokeLinecap="round" />
                                        </svg>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-[10px] font-bold font-mono text-white">{Math.round(progress)}%</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Progress</span>
                                        <span className="text-xs font-bold text-slate-300">Audit Mode</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-8 px-8 flex-1 justify-center h-full">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Payload</span>
                                        <span className="font-mono text-sm font-bold text-slate-300">
                                            {realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                        </span>
                                    </div>
                                    <div className="w-px h-8 bg-slate-800"></div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Est. Cost</span>
                                        <span className="font-mono text-sm font-bold text-white tracking-tight">
                                            ${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'} CLP
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 pl-8 border-l border-slate-800 h-full">
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="group flex items-center justify-center w-10 h-10 rounded-full bg-rose-950/50 hover:bg-rose-600 border border-rose-900 transition-all text-rose-500 hover:text-white"
                                        title="STOP ANALYSIS"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
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
                            <div className="flex flex-col md:flex-row justify-between items-start gap-8 border-b border-slate-100 pb-10">
                                <div className="space-y-4 max-w-2xl">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 text-[10px] font-black uppercase tracking-wider">
                                        <CheckCircle2 size={12} /> Análisis Forense Completado
                                    </div>
                                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Resultados de la Auditoría</h2>
                                    <p className="text-slate-600 font-medium leading-relaxed">{auditResult.resumenEjecutivo}</p>
                                </div>
                                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 min-w-[250px] text-white">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Ahorro Detectado</p>
                                    <div className="text-3xl font-black text-emerald-400">
                                        ${auditResult.totalAhorroDetectado.toLocaleString('es-CL')}
                                    </div>
                                    {auditResult.requiereRevisionHumana && (
                                        <div className="mt-4 text-[10px] font-bold text-amber-400 flex items-center gap-1.5 bg-amber-950/50 px-2 py-1 rounded border border-amber-900">
                                            <AlertCircle size={12} /> REQUIERE REVISIÓN HUMANA
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <ChevronRight size={16} className="text-slate-900" /> Hallazgos y Objeciones ({auditResult.hallazgos.length})
                                </h3>
                                <div className="grid grid-cols-1 gap-4">
                                    {auditResult.hallazgos.map((hallazgo: any, idx: number) => (
                                        <div key={idx} className="p-6 bg-white rounded-2xl border border-slate-200 hover:border-slate-400 transition-all shadow-sm group">
                                            <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                                                <div className="flex items-center gap-3">
                                                    <span className="px-2 py-1 bg-slate-900 text-white rounded text-[10px] font-mono font-bold">{hallazgo.codigos}</span>
                                                    <h4 className="font-bold text-slate-900">{hallazgo.glosa}</h4>
                                                </div>
                                                <div className="text-rose-600 font-black text-lg">
                                                    -${hallazgo.montoObjetado.toLocaleString('es-CL')}
                                                </div>
                                            </div>
                                            <p className="text-sm text-slate-600 mb-4 leading-relaxed whitespace-pre-wrap">{hallazgo.hallazgo}</p>
                                            <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                                                <span className="flex items-center gap-1.5 text-slate-900 bg-slate-100 px-2 py-1 rounded">
                                                    <Scale size={12} /> {hallazgo.normaFundamento}
                                                </span>
                                                <span className="flex items-center gap-1.5">
                                                    <Search size={12} /> {hallazgo.anclajeJson}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-slate-950 text-slate-100 p-8 md:p-12 rounded-3xl overflow-hidden shadow-2xl relative">
                                <div className="absolute top-0 right-0 p-8 opacity-10">
                                    <FileText size={120} />
                                </div>
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-8 border-b border-slate-800 pb-4 flex items-center gap-2">
                                    <FileType size={14} /> Informe Formal del Auditor
                                </h4>
                                <div className="prose prose-invert prose-slate max-w-none whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                                    {auditResult.auditoriaFinalMarkdown}
                                </div>
                            </div>

                            <div className="flex justify-center flex-wrap gap-4 pt-4 print:hidden">
                                <button onClick={() => window.print()} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black flex items-center gap-2 hover:bg-black transition-all shadow-lg active:scale-95">
                                    <Printer size={20} /> IMPRIMIR INFORME
                                </button>
                                <div className="flex gap-2">
                                    <button onClick={() => downloadFormat(auditResult, 'json', 'audit_forense')} className="px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                                        <FileJson size={18} /> JSON
                                    </button>
                                    <button onClick={() => downloadFormat(auditResult, 'md', 'audit_forense')} className="px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                                        <FileType size={18} /> MD
                                    </button>
                                </div>
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
