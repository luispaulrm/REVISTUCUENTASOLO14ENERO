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
    const [status, setStatus] = useState<AppStatus>(() => {
        try {
            return (localStorage.getItem('pam_audit_status') as AppStatus) || AppStatus.IDLE;
        } catch { return AppStatus.IDLE; }
    });
    const [error, setError] = useState<string | null>(null);
    const [pamResult, setPamResult] = useState<PamDocument | null>(() => {
        try {
            const saved = localStorage.getItem('pam_audit_result');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    });
    const [logs, setLogs] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('pam_audit_logs');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [progress, setProgress] = useState(() => {
        try {
            return Number(localStorage.getItem('pam_audit_progress')) || 0;
        } catch { return 0; }
    });
    const [seconds, setSeconds] = useState(() => {
        try {
            return Number(localStorage.getItem('pam_audit_seconds')) || 0;
        } catch { return 0; }
    });
    const [realTimeUsage, setRealTimeUsage] = useState<UsageMetrics | null>(() => {
        try {
            const saved = localStorage.getItem('pam_audit_usage');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    });

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
        try {
            localStorage.setItem('pam_audit_status', status);
            if (pamResult) localStorage.setItem('pam_audit_result', JSON.stringify(pamResult));
            localStorage.setItem('pam_audit_logs', JSON.stringify(logs));
            localStorage.setItem('pam_audit_progress', progress.toString());
            localStorage.setItem('pam_audit_seconds', seconds.toString());
            if (realTimeUsage) localStorage.setItem('pam_audit_usage', JSON.stringify(realTimeUsage));
        } catch (e) { }
    }, [status, pamResult, logs, progress, seconds, realTimeUsage]);

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
            if (!progressRef.current) {
                setProgress(0);
                progressRef.current = window.setInterval(() => {
                    setProgress(p => (p < 98 ? p + 0.3 : p));
                }, 200);
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
                    const result = await extractPamData(pureBase64, file.type, addLog, setRealTimeUsage, controller.signal);
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
            <header className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-6">
                <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldCheck size={32} />
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                Análisis de PAM
                                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded border border-white/20 font-mono">{VERSION}</span>
                            </h1>
                            <p className="text-xs opacity-90 font-medium">Actualizado: {LAST_MODIFIED} — Coberturas Isapre</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {status === AppStatus.SUCCESS && (
                            <div className="flex items-center gap-2 mr-4 border-r border-white/20 pr-4">
                                <button onClick={() => downloadData('json')} className="p-2 hover:bg-white/10 rounded-lg text-white/80 transition-colors" title="Exportar JSON">
                                    <Download size={20} />
                                </button>
                                <button onClick={() => downloadData('md')} className="p-2 hover:bg-white/10 rounded-lg text-white/80 transition-colors" title="Exportar Markdown">
                                    <FileDown size={20} />
                                </button>
                                <button onClick={downloadPdf} disabled={isExporting} className="flex items-center gap-2 px-4 py-2 bg-white text-purple-700 rounded-lg text-xs font-black hover:bg-white/90 transition-all shadow-lg active:scale-95 disabled:opacity-50">
                                    {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                                    {isExporting ? 'GENERANDO...' : 'REPORTES PDF'}
                                </button>
                            </div>
                        )}
                        {status !== AppStatus.IDLE && (
                            <button
                                onClick={clearSession}
                                className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors border border-white/10"
                            >
                                <Trash2 size={18} />
                                Nuevo
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
                    <div className="max-w-xl mx-auto py-10">
                        <div className="text-center mb-10">
                            <Loader2 size={64} className="text-purple-600 animate-spin mx-auto mb-6" />
                            <h3 className="text-2xl font-black text-slate-900 flex items-center justify-center gap-3">
                                Analizando Coberturas Isapre
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full text-xs font-mono">
                                    <Timer size={12} /> {formatTime(seconds)}
                                </span>
                            </h3>
                            <p className="text-slate-500 mt-2">Extrayendo desgloses de bonificación y copagos...</p>

                            <button
                                onClick={handleStop}
                                className="mt-8 px-6 py-2.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-sm active:scale-95 flex items-center gap-2 mx-auto"
                            >
                                <X size={14} strokeWidth={3} /> Detener Análisis
                            </button>
                        </div>

                        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-6">
                            {realTimeUsage && (
                                <div className="grid grid-cols-3 gap-4 p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                                    <div className="text-center">
                                        <p className="text-xs font-bold text-purple-400 uppercase">Entrada</p>
                                        <p className="text-sm font-mono font-bold text-purple-600">{realTimeUsage.promptTokens}</p>
                                    </div>
                                    <div className="text-center border-x border-purple-100">
                                        <p className="text-xs font-bold text-purple-400 uppercase">Salida</p>
                                        <p className="text-sm font-mono font-bold text-purple-700">{realTimeUsage.candidatesTokens}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs font-bold text-purple-400 uppercase">Costo</p>
                                        <p className="text-sm font-mono font-bold text-emerald-600">${realTimeUsage.estimatedCostCLP} CLP</p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    <span>Procesamiento IA</span>
                                    <span>{Math.round(progress)}% completado</span>
                                </div>
                                <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden border border-slate-200 p-0.5">
                                    <div
                                        className="bg-purple-600 h-full rounded-full transition-all duration-300 flex items-center justify-end px-2"
                                        style={{ width: `${progress}%` }}
                                    >
                                        {progress > 15 && <div className="w-1 h-1 bg-white/50 rounded-full animate-pulse"></div>}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
                                <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                                    <Terminal size={12} className="text-slate-500" />
                                    <span className="text-xs font-mono font-bold text-slate-500 uppercase">Log de Ejecución</span>
                                </div>
                                <div className="p-4 h-64 overflow-y-auto font-mono text-xs space-y-1.5 bg-black/50">
                                    {logs.map((log, i) => (
                                        <div key={i} className="text-slate-300">{log}</div>
                                    ))}
                                    <div ref={logEndRef} />
                                </div>
                            </div>
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
                    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500" ref={reportRef}>
                        <PAMResults data={pamResult} />
                    </div>
                )}
            </main>
        </div>
    );
}
