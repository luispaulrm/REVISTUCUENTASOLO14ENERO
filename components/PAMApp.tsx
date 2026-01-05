import React, { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, FileText, Trash2, ShieldCheck, Timer, Terminal, Download, Printer, FileDown, X, ArrowDownLeft, ArrowUpRight, Zap, Coins } from 'lucide-react';
import { extractPamData, PamDocument, UsageMetrics } from '../pamService';
import { PAMResults } from './PAMResults';
import { VERSION, LAST_MODIFIED, AI_MODEL } from '../version';

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

    // Multi-file batch processing state
    const [fileQueue, setFileQueue] = useState<Array<{ file: File, preview: string, status: 'pending' | 'processing' | 'done' | 'error', result?: PamDocument, error?: string }>>([]);
    const [resultsHistory, setResultsHistory] = useState<Array<{ fileName: string, result: PamDocument }>>([]);
    const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
    const timerRef = useRef<number | null>(null);
    const progressRef = useRef<number | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const reportRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const processingLockRef = useRef<boolean>(false);

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
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        // Limit to 2 files
        const filesToProcess = files.slice(0, 2);
        if (files.length > 2) {
            addLog('[SISTEMA] ⚠️ Solo se pueden procesar 2 archivos PAM a la vez. Se tomarán los primeros 2.');
        }

        // Reset state
        setStatus(AppStatus.UPLOADING);
        setError(null);
        setPamResult(null);
        setLogs([]);
        setRealTimeUsage(null);
        setFileQueue([]);
        setResultsHistory([]);
        setCurrentFileIndex(0);

        addLog(`[SISTEMA] ${filesToProcess.length} archivo(s) PAM en cola.`);

        // Create queue with previews
        const queue = await Promise.all(
            filesToProcess.map(async (file) => {
                const preview = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.readAsDataURL(file);
                });
                return { file, preview, status: 'pending' as const };
            })
        );

        setFileQueue(queue);
        processQueue(queue);
    };

    const processQueue = async (queue: typeof fileQueue) => {
        // Prevent duplicate processing
        if (processingLockRef.current) {
            console.log('[PAM] Processing already in progress, skipping duplicate call');
            return;
        }
        processingLockRef.current = true;
        for (let i = 0; i < queue.length; i++) {
            const queueItem = queue[i];
            setCurrentFileIndex(i);
            setFileQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'processing' } : item));

            addLog(`[SISTEMA] Procesando archivo ${i + 1} de ${queue.length}: ${queueItem.file.name}`);

            const pureBase64 = queueItem.preview.split(',')[1];
            const controller = new AbortController();
            abortControllerRef.current = controller;

            const timeoutId = setTimeout(() => {
                addLog('[SISTEMA] ⚠️ Timeout excedido (5 minutos). Cancelando...');
                controller.abort();
            }, 300000);

            try {
                setStatus(AppStatus.PROCESSING);
                const result = await extractPamData(pureBase64, queueItem.file.type, addLog, setRealTimeUsage, setProgress, controller.signal);

                setFileQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'done', result: result.data } : item));
                setPamResult(result.data);
                setResultsHistory(prev => [...prev, { fileName: queueItem.file.name, result: result.data }]);

                // Save last result for cross-audit
                localStorage.setItem('pam_audit_result', JSON.stringify(result.data));
                addLog('[SISTEMA] ✅ Análisis completado.');
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    setFileQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', error: 'Cancelado' } : item));
                    processingLockRef.current = false;
                    setStatus(AppStatus.IDLE);
                    return;
                }
                const errorMsg = err.message || 'Error procesando PAM';
                setFileQueue(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', error: errorMsg } : item));
                addLog(`[ERROR] ${errorMsg}`);
            } finally {
                clearTimeout(timeoutId);
                abortControllerRef.current = null;
            }
        }

        processingLockRef.current = false;
        setStatus(AppStatus.SUCCESS);
        addLog('[SISTEMA] 🎉 Todos los archivos PAM procesados.');
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
        <div className="min-h-screen flex flex-col bg-slate-50 relative pb-32">
            <header className="bg-transparent border-b border-slate-200 sticky top-0 z-50 print:hidden backdrop-blur-sm">
                <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg">
                            <ShieldCheck size={22} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                                PAM A.I.
                                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 font-mono">{VERSION}</span>
                                <span className="text-xs text-slate-900 font-black ml-2 uppercase tracking-tight">Actualizado: {LAST_MODIFIED}</span>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Isapre Audit Engine</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status === AppStatus.SUCCESS && (
                            <button onClick={downloadPdf} disabled={isExporting} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all shadow-md disabled:opacity-50">
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

            <main className="flex-grow max-w-[1800px] mx-auto w-full p-6 sm:p-10">
                {status === AppStatus.IDLE && (
                    <div className="max-w-2xl mx-auto text-center py-20">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-900 mx-auto mb-8 border border-slate-100 shadow-xl">
                            <Upload size={36} />
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">Analizar Documentos PAM</h2>
                        <p className="text-slate-500 mb-10">Sube Programas de Atención Médica para extraer y auditar folios, bonos y copagos.</p>

                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-3xl bg-white cursor-pointer hover:bg-slate-50 hover:border-slate-900 transition-all group">
                            <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} multiple />
                            <div className="flex flex-col items-center p-6">
                                <div className="p-4 bg-slate-50 rounded-2xl mb-4 text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-200 transition-colors">
                                    <FileText size={32} />
                                </div>
                                <p className="text-sm font-bold text-slate-600 group-hover:text-slate-900 transition-colors">Haz clic para subir PAM</p>
                                <p className="text-xs text-slate-400 mt-1">Soporta fotos, capturas y PDFs</p>
                            </div>
                        </label>
                    </div>
                )}

                {(status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) && (<>
                    <div className="max-w-4xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        {/* LOGS WINDOW (Light Mode) */}
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden h-[600px] flex flex-col relative group">
                            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Terminal size={16} className="text-slate-400" />
                                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">PAM Logs</span>
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
                                            {new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                                        </span>
                                        <span className={`break-words flex-1 leading-relaxed ${log.includes('[SISTEMA]') ? 'text-slate-400 italic' : 'text-slate-600'
                                            }`}>
                                            {log.replace(/^\[.*?\]/, '').trim()}
                                        </span>
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>
                    </div>

                    {/* SPACEX FOOTER (PAM EDITION) */}
                    <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] safe-pb">
                        <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between">

                            {/* 1. MISSION TIME */}
                            <div className="flex items-center gap-4 border-r border-slate-800 pr-8 h-full">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Time</span>
                                    <div className="font-mono text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                        <Timer size={18} className="text-slate-500" />
                                        T+{formatTime(seconds)}
                                    </div>
                                </div>
                            </div>

                            {/* 2. TRAJECTORY */}
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
                                    <span className="text-xs font-bold text-slate-300">Analysis Mode</span>
                                </div>
                            </div>

                            {/* 3. TOKEN METRICS */}
                            <div className="flex items-center gap-8 px-8 flex-1 justify-center h-full">
                                <div className="flex flex-col items-center">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Input</span>
                                    <span className="font-mono text-sm font-bold text-slate-300">
                                        {realTimeUsage ? (realTimeUsage.promptTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                    </span>
                                </div>
                                <div className="w-px h-8 bg-slate-800"></div>
                                <div className="flex flex-col items-center">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Output</span>
                                    <span className="font-mono text-sm font-bold text-white">
                                        {realTimeUsage ? (realTimeUsage.candidatesTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                    </span>
                                </div>
                                <div className="w-px h-8 bg-slate-800"></div>
                                <div className="flex flex-col items-center">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Payload</span>
                                    <span className="font-mono text-sm font-bold text-slate-400">
                                        {realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                    </span>
                                </div>
                            </div>

                            {/* 4. COST & ABORT */}
                            <div className="flex items-center gap-6 pl-8 border-l border-slate-800 h-full">
                                <div className="flex flex-col items-end">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Est. Cost</span>
                                    <span className="font-mono text-xl font-black text-white tracking-tight">
                                        ${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'} <span className="text-[10px] text-slate-600 font-sans">CLP</span>
                                    </span>
                                    <div className="flex items-center gap-1 mt-1">
                                        <ShieldCheck size={10} className="text-emerald-500" />
                                        <span className="text-[9px] font-bold text-emerald-500 uppercase">Conciliado: {AI_MODEL}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={handleStop}
                                    className="group flex items-center justify-center w-10 h-10 rounded-full bg-rose-950/50 hover:bg-rose-600 border border-rose-900 transition-all text-rose-500 hover:text-white"
                                    title="ABORT SEQUENCE"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </>)}

                {status === AppStatus.ERROR && (
                    <div className="max-w-md mx-auto py-20 text-center">
                        <div className="text-rose-500 text-6xl mb-6">⚠️</div>
                        <h3 className="text-2xl font-black text-slate-900 mb-2">Error de Extracción</h3>
                        <p className="text-slate-500 mb-8">{error}</p>
                        <button onClick={clearSession} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold">
                            REINTENTAR
                        </button>
                    </div>
                )}

                {status === AppStatus.SUCCESS && pamResult && (
                    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <div className="flex flex-col lg:flex-row gap-8">
                            <div className="flex-grow">
                                <div ref={reportRef}>
                                    <ErrorBoundary>
                                        <PAMResults data={pamResult} />
                                    </ErrorBoundary>
                                </div>
                            </div>

                            <aside className="w-full lg:w-80 space-y-6 print:hidden">
                                {/* PANEL DE METRICAS DE TOKENS (DARK MODE) */}
                                {realTimeUsage && (
                                    <div className="bg-slate-950 border border-slate-800 p-6 rounded-3xl shadow-xl">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-slate-900 text-white rounded-lg border border-slate-800">
                                                <Timer size={14} />
                                            </div>
                                            <h4 className="font-bold text-xs uppercase tracking-widest text-slate-400">Audit IA Info</h4>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-500 flex items-center gap-1.5"><Download size={12} /> Entrada</span>
                                                <span className="font-mono font-bold text-slate-300">{realTimeUsage.promptTokens} <span className="text-[9px] text-slate-600">TK</span></span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-500 flex items-center gap-1.5"><Upload size={12} /> Salida</span>
                                                <span className="font-mono font-bold text-slate-300">{realTimeUsage.candidatesTokens} <span className="text-[9px] text-slate-600">TK</span></span>
                                            </div>
                                            <div className="h-px bg-slate-900"></div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-slate-500 font-bold uppercase tracking-tighter">Total Tokens</span>
                                                <span className="font-mono font-black text-white">{realTimeUsage.totalTokens}</span>
                                            </div>
                                            <div className="mt-4 p-3 bg-black border border-slate-900 rounded-xl flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <ShieldCheck size={14} className="text-slate-400" />
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Costo Análisis</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="font-mono font-bold text-white text-sm block">${realTimeUsage.estimatedCostCLP} CLP</span>
                                                    <span className="font-mono text-[9px] text-slate-600 block">${realTimeUsage.estimatedCost.toFixed(4)} USD</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="bg-black text-white p-6 rounded-3xl shadow-xl border border-slate-900">
                                    <h4 className="font-bold text-sm uppercase tracking-widest mb-4 text-slate-400">Exportar Resultados</h4>
                                    <div className="space-y-3">
                                        <button
                                            onClick={downloadPdf}
                                            disabled={isExporting}
                                            className="w-full flex items-center justify-center gap-3 py-3 bg-white hover:bg-slate-200 text-black rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                                        >
                                            {isExporting ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />}
                                            {isExporting ? 'DESCARGAR PDF' : 'DESCARGAR PDF'}
                                        </button>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => downloadData('json')} className="flex items-center justify-center gap-2 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-[10px] font-bold transition-colors border border-slate-800">
                                                <FileText size={14} /> JSON
                                            </button>
                                            <button onClick={() => downloadData('md')} className="flex items-center justify-center gap-2 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-[10px] font-bold transition-colors border border-slate-800">
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

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("PAM Error Boundary caught:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 bg-rose-50 border border-rose-200 rounded-3xl text-center">
                    <h3 className="text-xl font-black text-rose-600 mb-2">Error de Renderizado</h3>
                    <p className="text-slate-600 text-sm mb-4">Ocurrió un problema visualizando los resultados PAM.</p>
                    <pre className="text-left bg-white p-4 rounded-xl border border-rose-100 text-[10px] text-rose-500 overflow-auto max-h-40">
                        {this.state.error?.message}
                    </pre>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })} // Reset
                        onClickCapture={() => window.location.reload()} // Hard reset option
                        className="mt-4 px-6 py-2 bg-rose-600 text-white rounded-xl font-bold text-xs uppercase"
                    >
                        Recargar Página
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
