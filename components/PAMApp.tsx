import React, { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, FileText, Trash2, ShieldCheck, Timer, Terminal, Download, Printer, FileDown, X } from 'lucide-react';
import { extractPamData, PamDocument, UsageMetrics } from '../pamService';
import { PAMResults } from './PAMResults';
import { VERSION, LAST_MODIFIED } from '../version';

enum AppStatus {
    IDLE = 'idle',
    UPLOADING = 'uploading',
    PROCESSING = 'processing',
    SUCCESS = 'success',
    ERROR = 'error'
}

export default function PAMApp() {
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [error, setError] = useState<string | null>(null);
    const [pamResult, setPamResult] = useState<PamDocument | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [realTimeUsage, setRealTimeUsage] = useState<UsageMetrics | null>(null);

    const [isExporting, setIsExporting] = useState(false);
    const timerRef = useRef<number | null>(null);
    const progressRef = useRef<number | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const reportRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            addLog('[SISTEMA] 🛑 Procesamiento detenido por el usuario.');
        }
    };

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);



    useEffect(() => {
        if (status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) {
            if (!timerRef.current) {
                setSeconds(0);
                timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
            }
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (progressRef.current) {
                clearInterval(progressRef.current);
                progressRef.current = null;
            }
            if (status === AppStatus.SUCCESS) setProgress(100);
        }
    }, [status]);

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const formattedMsg = `[${timestamp}] ${msg}`;
        setLogs(prev => [...prev, formattedMsg]);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setStatus(AppStatus.UPLOADING);
        setError(null);
        setPamResult(null);
        setLogs([]);
        setRealTimeUsage(null);
        addLog(`[SISTEMA] Archivo PAM recibido: ${file.name}`);

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target?.result as string;
            const pureBase64 = base64Data.split(',')[1];

            try {
                setStatus(AppStatus.PROCESSING);

                // Abort Controller Setup
                const controller = new AbortController();
                abortControllerRef.current = controller;

                // Auto-timeout de 60s
                const timeoutId = setTimeout(() => {
                    if (status === AppStatus.PROCESSING) {
                        addLog('[SISTEMA] ⚠️ El tiempo de espera ha expirado (60s). Cancelando...');
                        controller.abort();
                    }
                }, 60000);

                try {
                    const result = await extractPamData(pureBase64, file.type, addLog, setRealTimeUsage, setProgress, controller.signal);
                    setPamResult(result.data);
                    setStatus(AppStatus.SUCCESS);
                } catch (err: any) {
                    if (err.name === 'AbortError') {
                        setStatus(AppStatus.IDLE);
                        return;
                    }
                    throw err;
                } finally {
                    clearTimeout(timeoutId);
                    abortControllerRef.current = null;
                }
            } catch (err: any) {
                setError(err.message || 'Error procesando el documento PAM.');
                setStatus(AppStatus.ERROR);
            }
        };
        reader.readAsDataURL(file);
    };

    const downloadData = (format: 'json' | 'md') => {
        if (!pamResult) return;

        let content = '';
        if (format === 'json') {
            content = JSON.stringify(pamResult, null, 2);
        } else {
            content = `# REPORTE DE COBERTURAS PAM\n\n`;
            pamResult.folios.forEach((folio, idx) => {
                content += `## FOLIO: ${folio.folioPAM} (${idx + 1})\n`;
                content += `- **Prestador Principal:** ${folio.prestadorPrincipal}\n`;
                content += `- **Periodo:** ${folio.periodoCobro}\n`;
                content += `- **Estado Auditoría:** ${folio.resumen.auditoriaStatus}\n\n`;

                folio.desglosePorPrestador.forEach(p => {
                    content += `### Prestador: ${p.nombrePrestador}\n`;
                    content += `| Código | Descripción | Cant | Total | Bonif | Copago |\n`;
                    content += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
                    p.items.forEach(i => {
                        content += `| ${i.codigoGC} | ${i.descripcion} | ${i.cantidad} | ${i.valorTotal} | ${i.bonificacion} | ${i.copago} |\n`;
                    });
                    content += `\n`;
                });
                content += `---\n\n`;
            });
        }

        const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pam_coberturas_${new Date().getTime()}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const downloadPdf = async () => {
        if (!reportRef.current || !pamResult) return;
        setIsExporting(true);
        const element = reportRef.current;
        // @ts-ignore
        const html2pdfLib = window.html2pdf;
        if (!html2pdfLib) {
            window.print();
            setIsExporting(false);
            return;
        }
        const opt = {
            margin: 10,
            filename: `pam_reporte_${new Date().getTime()}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        try {
            await html2pdfLib().set(opt).from(element).save();
        } catch (err) {
            console.error('PDF Error:', err);
            window.print();
        } finally {
            setIsExporting(false);
        }
    };

    const clearSession = () => {
        setStatus(AppStatus.IDLE);
        setPamResult(null);
        setError(null);
        setLogs([]);
        setSeconds(0);
        setProgress(0);
        setRealTimeUsage(null);
    };

    return (
        <div className="min-h-screen flex flex-col bg-[#f8fafc]">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-50 print:hidden shadow-sm">
                <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                                PAM A.I.
                                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 font-mono">{VERSION}</span>
                                <span className="text-xs text-slate-900 font-black ml-2 uppercase tracking-tight">Actualizado: {LAST_MODIFIED}</span>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Isapre Audit Engine</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status === AppStatus.SUCCESS && (
                            <button onClick={downloadPdf} disabled={isExporting} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition-all shadow-md disabled:opacity-50">
                                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                                {isExporting ? 'GENERANDO...' : 'EXPORTAR PDF'}
                            </button>
                        )}
                        {status !== AppStatus.IDLE && (
                            <button
                                onClick={clearSession}
                                className="p-2 text-slate-400 hover:text-rose-500 transition-colors flex items-center gap-2"
                                title="Nueva Auditoría"
                            >
                                <span className="hidden md:inline text-[10px] font-bold uppercase">Nueva Auditoría</span>
                                <Trash2 size={20} />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-grow max-w-6xl mx-auto w-full p-8">
                {status === AppStatus.IDLE && (
                    <div className="max-w-2xl mx-auto text-center py-20">
                        <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 mx-auto mb-8">
                            <Upload size={36} />
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 mb-4">Analizar Documentos PAM</h2>
                        <p className="text-slate-600 mb-10">Sube Programas de Atención Médica para extraer y auditar folios, bonos y copagos.</p>

                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-purple-300 rounded-3xl bg-white cursor-pointer hover:bg-purple-50/50 transition-all">
                            <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} />
                            <div className="flex flex-col items-center p-6">
                                <div className="p-4 bg-purple-50 rounded-2xl mb-4">
                                    <FileText size={32} className="text-purple-600" />
                                </div>
                                <p className="text-sm font-bold text-purple-600">Haz clic para subir PAM</p>
                                <p className="text-xs text-slate-400 mt-1">Soporta fotos, capturas y PDFs</p>
                            </div>
                        </label>
                    </div>
                )}

                {(status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) && (
                    <div className="max-w-4xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        {/* SPACEX STYLE TELEMETRY CONTAINER */}
                        <div className="bg-white rounded-t-3xl border-x border-t border-slate-200 shadow-2xl shadow-slate-200/50 overflow-hidden relative">
                            {/* HEADER STRIP */}
                            <div className="bg-slate-950 text-white px-6 py-4 flex justify-between items-center border-b border-slate-900">
                                <div className="flex items-center gap-3">
                                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_#3b82f6]" />
                                    <span className="text-xs font-bold uppercase tracking-[0.25em] font-mono text-slate-100">
                                        PAM TELEMETRY
                                    </span>
                                </div>
                                <div className="text-[10px] font-mono text-slate-500">
                                    ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}
                                </div>
                            </div>

                            {/* MAIN METRICS GRID */}
                            <div className="grid grid-cols-2 lg:grid-cols-5 divide-x divide-slate-100 border-b border-slate-100">
                                {/* T+ TIMER */}
                                <div className="p-4 flex flex-col items-center justify-center bg-white group hover:bg-slate-50 transition-colors">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 group-hover:text-blue-600 transition-colors">
                                        Mission Time
                                    </span>
                                    <div className="font-mono text-4xl font-black text-slate-900 tracking-tighter">
                                        T+{formatTime(seconds)}
                                    </div>
                                </div>

                                {/* TRAJECTORY (Circular Gauge) */}
                                <div className="p-4 flex flex-col items-center justify-center bg-white group hover:bg-slate-50 transition-colors">
                                    <div className="relative w-24 h-24">
                                        {/* Outer Ring */}
                                        <svg className="w-full h-full transform -rotate-90">
                                            <circle cx="48" cy="48" r="40" className="text-slate-100 stroke-current" strokeWidth="6" fill="transparent" />
                                            <circle cx="48" cy="48" r="40" className="text-blue-600 stroke-current" strokeWidth="6" fill="transparent"
                                                strokeDasharray={251.2} strokeDashoffset={251.2 - (251.2 * progress) / 100} strokeLinecap="round" />
                                        </svg>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                                            <span className="text-2xl font-black font-mono text-slate-900 leading-none">{Math.round(progress)}</span>
                                            <span className="text-[10px] font-bold text-slate-400 leading-none">%</span>
                                        </div>
                                    </div>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-2">Trajectory</span>
                                </div>

                                {/* TOKEN GAUGES CONTAINER */}
                                <div className="col-span-2 grid grid-cols-3 divide-x divide-slate-50">
                                    {/* INPUT TOKENS */}
                                    <div className="p-4 flex flex-col items-center justify-center bg-white group hover:bg-slate-50 transition-colors">
                                        <div className="relative w-16 h-16">
                                            <svg className="w-full h-full transform -rotate-90">
                                                <circle cx="32" cy="32" r="28" className="text-slate-100 stroke-current" strokeWidth="4" fill="transparent" />
                                                <circle cx="32" cy="32" r="28" className="text-cyan-500 stroke-current" strokeWidth="4" fill="transparent"
                                                    strokeDasharray={175.9} strokeDashoffset={175.9 - (175.9 * (realTimeUsage?.promptTokens || 0) / 100000)} strokeLinecap="round" />
                                            </svg>
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <span className="text-xs font-bold font-mono text-slate-700">{realTimeUsage ? (realTimeUsage.promptTokens / 1000).toFixed(1) + 'k' : '-'}</span>
                                            </div>
                                        </div>
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mt-2">Input</span>
                                    </div>

                                    {/* OUTPUT TOKENS */}
                                    <div className="p-4 flex flex-col items-center justify-center bg-white group hover:bg-slate-50 transition-colors">
                                        <div className="relative w-16 h-16">
                                            <svg className="w-full h-full transform -rotate-90">
                                                <circle cx="32" cy="32" r="28" className="text-slate-100 stroke-current" strokeWidth="4" fill="transparent" />
                                                <circle cx="32" cy="32" r="28" className="text-purple-500 stroke-current" strokeWidth="4" fill="transparent"
                                                    strokeDasharray={175.9} strokeDashoffset={175.9 - (175.9 * (realTimeUsage?.candidatesTokens || 0) / 20000)} strokeLinecap="round" />
                                            </svg>
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <span className="text-xs font-bold font-mono text-slate-700">{realTimeUsage ? (realTimeUsage.candidatesTokens / 1000).toFixed(1) + 'k' : '-'}</span>
                                            </div>
                                        </div>
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mt-2">Output</span>
                                    </div>

                                    {/* TOTAL TOKENS */}
                                    <div className="p-4 flex flex-col items-center justify-center bg-white group hover:bg-slate-50 transition-colors">
                                        <div className="relative w-16 h-16">
                                            <svg className="w-full h-full transform -rotate-90">
                                                <circle cx="32" cy="32" r="28" className="text-slate-100 stroke-current" strokeWidth="4" fill="transparent" />
                                                <circle cx="32" cy="32" r="28" className="text-blue-600 stroke-current" strokeWidth="4" fill="transparent"
                                                    strokeDasharray={175.9} strokeDashoffset={175.9 - (175.9 * (realTimeUsage?.totalTokens || 0) / 120000)} strokeLinecap="round" />
                                            </svg>
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <span className="text-xs font-bold font-mono text-slate-900">{realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '-'}</span>
                                            </div>
                                        </div>
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mt-2">Total</span>
                                    </div>
                                </div>

                                {/* COST */}
                                <div className="p-4 flex flex-col items-center justify-center bg-white group hover:bg-slate-50 transition-colors">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 group-hover:text-blue-600 transition-colors">
                                        Est. Cost
                                    </span>
                                    <div className="font-mono text-3xl font-black text-slate-900 tracking-tighter">
                                        {realTimeUsage ? `$${realTimeUsage.estimatedCostCLP}` : '$0'}
                                    </div>
                                    <span className="text-[9px] font-mono text-slate-400 mt-2">CLP CURRENCY</span>
                                </div>
                            </div>

                            {/* PROGRESS BAR STRIP */}
                            <div className="h-1.5 w-full bg-slate-100 relative overflow-hidden">
                                <div
                                    className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-300 ease-out shadow-[0_0_15px_rgba(37,99,235,0.6)]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>

                            {/* LOGS WINDOW */}
                            <div className="bg-slate-50 p-0 h-[500px] overflow-hidden relative group border-t border-slate-200">
                                <div className="absolute top-0 left-0 w-full h-full pointer-events-none shadow-[inset_0_0_30px_rgba(0,0,0,0.03)] z-10" />

                                <div className="px-6 py-3 border-b border-slate-200 bg-white flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <Terminal size={14} className="text-blue-500" />
                                        <span className="text-xs font-bold uppercase tracking-widest text-slate-600">System Logs</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="w-2 h-2 rounded-full bg-slate-200" />
                                        <div className="w-2 h-2 rounded-full bg-slate-200" />
                                        <div className="w-2 h-2 rounded-full bg-slate-200" />
                                    </div>
                                </div>

                                <div className="p-6 h-full overflow-y-auto font-mono text-sm space-y-2 pb-20">
                                    {logs.map((log, i) => (
                                        <div key={i} className="flex gap-4 items-start py-1 border-l-[3px] border-transparent hover:border-blue-200 hover:bg-white transition-colors pl-3 -ml-3">
                                            <span className="opacity-50 w-20 shrink-0 text-right text-slate-400 font-bold text-xs pt-0.5">
                                                {new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                                            </span>
                                            <span className="text-slate-700 break-words flex-1 leading-snug">
                                                {log.replace(/^\[.*?\]/, '').trim()}
                                            </span>
                                        </div>
                                    ))}
                                    <div ref={logEndRef} />
                                </div>
                            </div>
                        </div>

                        {/* ABORT BUTTON */}
                        <div className="mt-8 text-center">
                            <button
                                onClick={handleStop}
                                className="group relative inline-flex items-center justify-center overflow-hidden rounded-lg px-8 py-3 font-medium text-slate-600 transition duration-300 hover:text-rose-600"
                            >
                                <span className="absolute inset-0 flex items-center justify-center">
                                    <span className="absolute inset-0 h-full w-full rounded-lg opacity-0 transition duration-300 group-hover:bg-rose-50 group-hover:opacity-100"></span>
                                </span>
                                <span className="relative flex items-center gap-2 text-xs font-black uppercase tracking-widest">
                                    <X size={14} strokeWidth={3} /> Abort Sequence
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {status === AppStatus.ERROR && (
                    <div className="max-w-md mx-auto py-20 text-center">
                        <div className="text-rose-500 text-6xl mb-6">⚠️</div>
                        <h3 className="text-2xl font-black text-slate-900 mb-2">Error de Extracción</h3>
                        <p className="text-slate-500 mb-8">{error}</p>
                        <button onClick={clearSession} className="px-6 py-3 bg-purple-600 text-white rounded-xl font-bold">
                            REINTENTAR
                        </button>
                    </div>
                )}

                {status === AppStatus.SUCCESS && pamResult && (
                    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <div className="flex flex-col lg:flex-row gap-8">
                            <div className="flex-grow">
                                <div ref={reportRef}>
                                    <PAMResults data={pamResult} />
                                </div>
                            </div>

                            <aside className="w-full lg:w-80 space-y-6 print:hidden">
                                {/* PANEL DE METRICAS DE TOKENS */}
                                {realTimeUsage && (
                                    <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg">
                                                <Timer size={14} />
                                            </div>
                                            <h4 className="font-bold text-xs uppercase tracking-widest text-slate-600">Audit IA Info</h4>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-400 flex items-center gap-1.5"><Download size={12} /> Entrada</span>
                                                <span className="font-mono font-bold text-slate-700">{realTimeUsage.promptTokens} <span className="text-[9px] text-slate-300">TK</span></span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-400 flex items-center gap-1.5"><Upload size={12} /> Salida</span>
                                                <span className="font-mono font-bold text-slate-700">{realTimeUsage.candidatesTokens} <span className="text-[9px] text-slate-300">TK</span></span>
                                            </div>
                                            <div className="h-px bg-slate-100"></div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-600 font-bold uppercase tracking-tighter">Total Tokens</span>
                                                <span className="font-mono font-black text-purple-600">{realTimeUsage.totalTokens}</span>
                                            </div>
                                            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <ShieldCheck size={14} className="text-emerald-600" />
                                                    <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-tighter">Costo Análisis</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="font-mono font-bold text-emerald-700 text-sm block">${realTimeUsage.estimatedCostCLP} CLP</span>
                                                    <span className="font-mono text-[9px] text-emerald-600/60 block">${realTimeUsage.estimatedCost.toFixed(4)} USD</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl">
                                    <h4 className="font-bold text-sm uppercase tracking-widest mb-4">Exportar Resultados</h4>
                                    <div className="space-y-3">
                                        <button
                                            onClick={downloadPdf}
                                            disabled={isExporting}
                                            className="w-full flex items-center justify-center gap-3 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                                        >
                                            {isExporting ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />}
                                            {isExporting ? 'DESCARGAR PDF' : 'DESCARGAR PDF'}
                                        </button>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => downloadData('json')} className="flex items-center justify-center gap-2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[10px] font-bold transition-colors">
                                                <FileText size={14} /> JSON
                                            </button>
                                            <button onClick={() => downloadData('md')} className="flex items-center justify-center gap-2 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[10px] font-bold transition-colors">
                                                <FileText size={14} /> MD
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </aside>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
