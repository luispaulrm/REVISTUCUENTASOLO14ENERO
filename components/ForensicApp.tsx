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
    Zap,
    MessageSquare,
    Send,
    Eraser,
    BrainCircuit,
    Calculator,
    Library
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

    // Preview State
    const [previewData, setPreviewData] = useState<{ title: string, content: string } | null>(null);

    // Persisted Data State
    const [hasBill, setHasBill] = useState(false);
    const [hasPam, setHasPam] = useState(false);
    const [hasContract, setHasContract] = useState(false);
    const [hasHtml, setHasHtml] = useState(false);

    const logEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        checkData();
        window.addEventListener('storage', checkData);

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                checkData();
            }
        };

        const intervalId = setInterval(checkData, 2000);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('storage', checkData);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(intervalId);
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
        try {
            setHasBill(!!localStorage.getItem('clinic_audit_result'));
            setHasPam(!!localStorage.getItem('pam_audit_result'));
            setHasContract(!!localStorage.getItem('contract_audit_result'));
            setHasHtml(!!localStorage.getItem('html_projection_result'));
        } catch (e) {
            console.warn('LocalStorage access blocked:', e);
            setHasBill(false);
            setHasPam(false);
            setHasContract(false);
            setHasHtml(false);
        }
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
            const htmlContext = localStorage.getItem('html_projection_result') || '';

            const result = await runForensicAudit(
                cuenta,
                pam,
                contrato,
                addLog,
                (usage) => setRealTimeUsage(usage),
                (prog) => setProgress(prog),
                htmlContext
            );

            setAuditResult(result);
            setStatus('SUCCESS');
        } catch (err: any) {
            setError(err.message || 'Error durante la auditoría forense.');
            setStatus('ERROR');
        }
    };

    const clearAllData = () => {
        const confirmClear = window.confirm(
            '⚠️ ¿Deseas reiniciar TODA la sesión?\n\n' +
            'Aceptar: Borra TODOS los archivos y resultados.\n' +
            'Cancelar: Solo limpia la pantalla (mantiene archivos).'
        );

        if (confirmClear) {
            localStorage.removeItem('clinic_audit_result');
            localStorage.removeItem('pam_audit_result');
            localStorage.removeItem('contract_audit_result');
            localStorage.removeItem('html_projection_result');
            window.location.reload();
        } else {
            setStatus('IDLE');
            setAuditResult(null);
            setLogs([]);
            setRealTimeUsage(null);
            setProgress(0);
            setError(null);
            checkData();
            addLog('[SISTEMA] 🧹 Pantalla limpia. Datos de origen preservados.');
        }
    };

    const handlePreview = (type: 'BILL' | 'PAM' | 'CONTRACT' | 'HTML') => {
        try {
            let content = '';
            let title = '';

            switch (type) {
                case 'BILL':
                    content = localStorage.getItem('clinic_audit_result') || '';
                    title = 'Cuenta Clínica (JSON)';
                    break;
                case 'PAM':
                    content = localStorage.getItem('pam_audit_result') || '';
                    title = 'PAM (JSON)';
                    break;
                case 'CONTRACT':
                    content = localStorage.getItem('contract_audit_result') || '';
                    title = 'Contrato (JSON)';
                    break;
                case 'HTML':
                    const rawHtml = localStorage.getItem('html_projection_result') || '';
                    content = rawHtml.length > 50000
                        ? rawHtml.substring(0, 50000) + '... \n(Truncado por longitud)'
                        : rawHtml;
                    title = 'Proyección HTML (Módulo 5)';
                    break;
            }

            if (content) {
                setPreviewData({ title, content });
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 relative pb-32">
            <header className="bg-white/80 border-b border-slate-200 sticky top-16 z-[40] print:hidden backdrop-blur-sm shadow-sm transition-all duration-300">
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
                            <>
                                <button onClick={() => downloadFormat(auditResult, 'json', 'audit_forense')} className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                                    <FileJson size={16} /> JSON
                                </button>
                                <button onClick={() => downloadFormat(auditResult, 'md', 'audit_forense')} className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                                    <FileType size={16} /> MD
                                </button>
                                <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all shadow-md">
                                    <Printer size={16} /> EXPORTAR REPORTE
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => {
                                if (!auditResult) return;
                                setAuditResult(null);
                                setStatus('IDLE');
                                setLogs([]);
                                setRealTimeUsage(null);
                                setProgress(0);
                                checkData();
                                addLog('[SISTEMA] 🔄 Resultado de auditoría limpiado. Listo para re-iterar.');
                            }}
                            disabled={!auditResult}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-colors mr-2 ${auditResult
                                ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200'
                                : 'bg-slate-100 text-slate-300 border border-slate-100 cursor-not-allowed'
                                }`}
                        >
                            <Eraser size={16} />
                            {auditResult ? 'LIMPIAR RESULTADO' : 'LIMPIAR'}
                        </button>
                        <button onClick={clearAllData} className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                            <Trash2 size={24} />
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-grow max-w-[1800px] mx-auto w-full p-6 sm:p-10">
                {status === 'IDLE' && (
                    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <DataStatusCard title="Cuenta Clínica" icon={<FileText size={24} />} ready={hasBill} desc="Detalle de gastos extraído" />
                            <DataStatusCard title="PAM (Isapre)" icon={<ShieldCheck size={24} />} ready={hasPam} desc="Bonificaciones y copagos" />
                            <DataStatusCard title="Contrato Salud" icon={<Scale size={24} />} ready={hasContract} desc="Reglas y coberturas del plan" />
                            <DataStatusCard title="Proyección HTML" icon={<Zap size={24} />} ready={hasHtml} desc="Contexto visual del Módulo 5" onClick={() => handlePreview('HTML')} />
                        </div>

                        <div className="bg-white rounded-3xl p-10 border border-slate-200 shadow-xl shadow-slate-200/50 text-center space-y-6">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-900 mx-auto border border-slate-200 shadow-inner">
                                <Search size={36} />
                            </div>
                            <div className="space-y-2">
                                <p className="text-slate-500 max-w-xl mx-auto">
                                    Esta herramienta realiza una validación triple para detectar fraudes,
                                    desagregación indebida de insumos y violaciones al principio de evento único.
                                </p>
                                {!hasPam || !hasBill || (!hasContract && !hasHtml) ? (
                                    <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-4 text-left max-w-2xl mx-auto">
                                        <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                                        <div>
                                            <p className="text-sm font-bold text-amber-900">Documentación Insuficiente</p>
                                            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                                                Requisitos para auditar: PAM, Cuenta Clínica y Validación (Contrato o HTML).
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <button onClick={handleExecuteAudit} className="px-10 py-5 bg-slate-900 text-white rounded-2xl font-black text-lg hover:bg-black transition-all hover:scale-105 active:scale-95 shadow-2xl flex items-center gap-3 mx-auto">
                                        <Gavel size={24} /> EJECUTAR ANÁLISIS FORENSE
                                    </button>
                                )}
                            </div>
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
                            </div>
                            <div className="p-6 h-full overflow-y-auto font-mono text-xs space-y-2 pb-20 bg-white">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-4 items-start py-1.5">
                                        <span className="opacity-40 w-24 shrink-0 text-slate-400 font-bold text-[10px]">{log.match(/\[(.*?)\]/)?.[1] || ""}</span>
                                        <span className="text-slate-600">{log.replace(/^\[.*?\]/, '').trim()}</span>
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>
                        {/* FOOTER METRICS */}
                        <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 h-20 flex items-center justify-between px-8">
                            <div className="flex gap-8">
                                <div><p className="text-[9px] text-slate-500 uppercase font-black">Time</p><p className="font-mono text-xl font-black">T+{formatTime(seconds)}</p></div>
                                <div><p className="text-[9px] text-slate-500 uppercase font-black">Payload</p><p className="font-mono text-xl font-black text-slate-300">{realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}</p></div>
                                <div><p className="text-[9px] text-slate-500 uppercase font-black">Est. Cost</p><p className="font-mono text-xl font-black text-emerald-400">${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'} CLP</p></div>
                            </div>
                            <button onClick={() => window.location.reload()} className="w-10 h-10 rounded-full bg-rose-950/50 flex items-center justify-center text-rose-500 hover:bg-rose-600 hover:text-white transition-all"><X size={18} /></button>
                        </div>
                    </div>
                )}

                {status === 'SUCCESS' && auditResult && (
                    <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
                        <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm space-y-10">
                            <div className="flex flex-col md:flex-row justify-between items-start gap-8 border-b border-slate-100 pb-10">
                                <div className="space-y-4 max-w-2xl">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase">
                                        <CheckCircle2 size={12} /> Análisis Forense Completado
                                    </div>
                                    <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Resultados de la Auditoría</h2>
                                    <p className="text-slate-600 font-medium leading-relaxed">{auditResult.resumenEjecutivo}</p>
                                </div>
                                <div className="bg-slate-950 p-6 rounded-2xl text-white min-w-[250px]">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Ahorro Detectado</p>
                                    <div className="text-3xl font-black text-emerald-400">${auditResult.totalAhorroDetectado.toLocaleString('es-CL')}</div>
                                </div>
                            </div>

                            {/* TOKEN METRICS */}
                            {realTimeUsage && (
                                <div className="grid grid-cols-4 gap-4 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                                    {['Entrada', 'Salida', 'Total', 'Costo CLP'].map((label, idx) => (
                                        <div key={label}>
                                            <p className="text-[10px] font-black text-slate-400 uppercase mb-2">{label}</p>
                                            <p className="text-2xl font-black text-slate-900 font-mono">
                                                {idx === 0 ? realTimeUsage.promptTokens?.toLocaleString() :
                                                    idx === 1 ? realTimeUsage.candidatesTokens?.toLocaleString() :
                                                        idx === 2 ? realTimeUsage.totalTokens?.toLocaleString() :
                                                            `$${realTimeUsage.estimatedCostCLP}`}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* BITÁCORA DE ANÁLISIS TÉCNICO */}
                            {auditResult.bitacoraAnalisis && auditResult.bitacoraAnalisis.length > 0 && (
                                <div className="space-y-6">
                                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <BrainCircuit size={16} className="text-indigo-600" /> Bitácora de Análisis Técnico (Razonamiento Forense)
                                    </h3>
                                    <div className="bg-slate-50 border border-slate-200 rounded-3xl overflow-hidden">
                                        <table className="w-full text-left">
                                            <thead className="bg-slate-100 border-b border-slate-200">
                                                <tr>
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase w-1/4">Paso</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase w-1/2">Razonamiento y Cálculo</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase">Evidencia</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200">
                                                {auditResult.bitacoraAnalisis.map((item: any, idx: number) => (
                                                    <tr key={idx} className="hover:bg-white transition-colors">
                                                        <td className="px-6 py-4 text-xs font-bold text-slate-700">{idx + 1}. {item.paso}</td>
                                                        <td className="px-6 py-4 text-xs text-slate-600 font-mono">{item.razonamiento}</td>
                                                        <td className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase">{item.evidencia}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* HALLAZGOS */}
                            <div className="space-y-6">
                                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <ChevronRight size={16} className="text-slate-900" /> Hallazgos y Objeciones ({auditResult.hallazgos.length})
                                </h3>
                                <div className="grid grid-cols-1 gap-4">
                                    {auditResult.hallazgos.map((hallazgo: any, idx: number) => (
                                        <div key={idx} className="p-6 bg-white rounded-2xl border border-slate-200 hover:border-slate-400 transition-all shadow-sm">
                                            <div className="flex justify-between items-center mb-4">
                                                <div className="flex items-center gap-3">
                                                    <span className="px-2 py-1 bg-slate-900 text-white rounded text-[10px] font-mono">{hallazgo.codigos}</span>
                                                    <h4 className="font-bold text-slate-900">{hallazgo.glosa}</h4>
                                                </div>
                                                <div className="text-rose-600 font-black text-lg">-${hallazgo.montoObjetado.toLocaleString()}</div>
                                            </div>
                                            <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap">{hallazgo.hallazgo}</p>
                                            <div className="flex gap-4 text-[10px] font-bold text-slate-400 uppercase">
                                                <span className="flex items-center gap-1"><Scale size={12} /> {hallazgo.normaFundamento}</span>
                                                <span className="flex items-center gap-1"><Search size={12} /> {hallazgo.anclajeJson}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-slate-950 text-slate-100 p-8 md:p-12 rounded-3xl relative">
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-8 border-b border-slate-800 pb-4">Informe Formal del Auditor</h4>
                                <div className="prose prose-invert prose-slate max-w-none whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                                    {auditResult.auditoriaFinalMarkdown}
                                </div>
                            </div>

                            <div className="flex justify-center gap-4 pt-4 print:hidden">
                                <button onClick={() => window.print()} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black flex items-center gap-2 hover:bg-black transition-all shadow-lg active:scale-95"><Printer size={20} /> IMPRIMIR INFORME</button>
                                <button onClick={() => downloadFormat(auditResult, 'json', 'audit_forense')} className="px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center gap-2">JSON</button>
                                <button onClick={() => downloadFormat(auditResult, 'md', 'audit_forense')} className="px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center gap-2">MD</button>
                            </div>
                        </div>
                    </div>
                )}

                {status === 'ERROR' && <div className="max-w-md mx-auto py-20 text-center"><AlertCircle size={64} className="text-rose-500 mx-auto mb-6" /><h3 className="text-2xl font-black text-slate-900 mb-2">Error en Auditoría</h3><p className="text-slate-500 mb-8">{error}</p><button onClick={() => setStatus('IDLE')} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold">VOLVER A INTENTAR</button></div>}

                {(hasHtml || hasContract || hasPam) && <div className="max-w-5xl mx-auto mb-12 px-4"><InterrogationZone auditResult={auditResult} /></div>}

                {previewData && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Search size={18} /> {previewData.title}</h3>
                                <button onClick={() => setPreviewData(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X size={20} className="text-slate-500" /></button>
                            </div>
                            <div className="p-6 overflow-auto bg-slate-50 font-mono text-xs text-slate-600 whitespace-pre-wrap">{previewData.content}</div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function DataStatusCard({ title, icon, ready, desc, onClick }: { title: string, icon: React.ReactNode, ready: boolean, desc: string, onClick?: () => void }) {
    return (
        <div onClick={ready && onClick ? onClick : undefined} className={`p-6 rounded-2xl border transition-all duration-300 ${ready ? 'bg-white border-slate-200 shadow-sm cursor-pointer hover:shadow-md hover:border-slate-300 active:scale-95' : 'bg-slate-50 border-slate-200 opacity-60'} relative group`}>
            <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl ${ready ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400'}`}>{icon}</div>
                {ready ? <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-black uppercase tracking-wider border border-emerald-100">Listo</span> : <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-[10px] font-black uppercase tracking-wider border border-slate-200">Falta</span>}
            </div>
            <h4 className="font-bold text-slate-900 mb-1">{title}</h4>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">{desc}</p>
        </div>
    );
}

function InterrogationZone({ auditResult }: { auditResult?: any }) {
    const [question, setQuestion] = useState('');
    const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentStreamingAnswer, setCurrentStreamingAnswer] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [history, currentStreamingAnswer]);

    const handleAsk = async () => {
        if (!question.trim() || isLoading) return;
        const currentQuestion = question;
        setQuestion('');
        setIsLoading(true);
        setCurrentStreamingAnswer('');
        try {
            const response = await fetch('/api/audit/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: currentQuestion,
                    context: {
                        htmlContext: localStorage.getItem('html_projection_result') || '',
                        billJson: JSON.parse(localStorage.getItem('clinic_audit_result') || '{}'),
                        pamJson: JSON.parse(localStorage.getItem('pam_audit_result') || '{}'),
                        contractJson: JSON.parse(localStorage.getItem('contract_audit_result') || '{}'),
                        auditResult
                    }
                })
            });
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = '';
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    accumulatedText += decoder.decode(value);
                    setCurrentStreamingAnswer(accumulatedText);
                }
            }
            setHistory(prev => [...prev, { question: currentQuestion, answer: accumulatedText }]);
            setCurrentStreamingAnswer('');
        } catch (err: any) {
            setHistory(prev => [...prev, { question: currentQuestion, answer: `Error: ${err.message}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl space-y-4 mt-8 flex flex-col max-h-[600px]">
            <div className="flex items-center gap-3 mb-2 shrink-0">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white"><MessageSquare size={20} /></div>
                <div><h3 className="font-bold text-slate-900">Interrogar al Auditor</h3><p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">Verificar contexto cargado</p></div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-6 p-4 border border-slate-100 rounded-xl bg-slate-50/50 min-h-[200px]">
                {history.length === 0 && !currentStreamingAnswer && <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60"><MessageSquare size={48} className="mb-2" /><p className="text-sm font-medium">Haz una pregunta para comenzar...</p></div>}
                {history.map((item, index) => (
                    <div key={index} className="space-y-2">
                        <div className="flex justify-end"><div className="bg-slate-200 text-slate-800 px-4 py-2 rounded-2xl rounded-tr-sm max-w-[80%] text-sm font-medium">{item.question}</div></div>
                        <div className="flex justify-start"><div className="bg-white border border-slate-200 text-slate-700 px-5 py-3 rounded-2xl rounded-tl-sm max-w-[90%] text-sm shadow-sm whitespace-pre-wrap">{item.answer}</div></div>
                    </div>
                ))}
                {(isLoading) && (
                    <div className="space-y-2">
                        <div className="flex justify-start"><div className="bg-white border border-slate-200 text-slate-700 px-5 py-3 rounded-2xl rounded-tl-sm max-w-[90%] text-sm shadow-sm whitespace-pre-wrap">{currentStreamingAnswer || <Loader2 size={16} className="animate-spin text-indigo-600" />}</div></div>
                    </div>
                )}
            </div>
            <div className="flex gap-2 shrink-0 pt-2">
                <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAsk()} placeholder="Ej: ¿Qué cobertura tiene el plan para días cama?" className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none" />
                <button onClick={handleAsk} disabled={isLoading || !question.trim()} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm flex items-center gap-2">{isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{isLoading ? 'Pensando' : 'Preguntar'}</button>
            </div>
        </div>
    );
}
