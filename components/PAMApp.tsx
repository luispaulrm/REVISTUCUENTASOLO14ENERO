import React, { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, FileText, Trash2, Pill, Timer, Terminal } from 'lucide-react';
import { extractPamData, PamDocument, UsageMetrics } from '../pamService';
import { PAMResults } from './PAMResults';

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

    const timerRef = useRef<number | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

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
                const data = await extractPamData(pureBase64, file.type, addLog, setRealTimeUsage);
                setPamResult(data);
                setStatus(AppStatus.SUCCESS);
            } catch (err: any) {
                setError(err.message || 'Error procesando el documento PAM.');
                setStatus(AppStatus.ERROR);
            }
        };
        reader.readAsDataURL(file);
    };

    const clearSession = () => {
        setStatus(AppStatus.IDLE);
        setPamResult(null);
        setError(null);
        setLogs([]);
        setSeconds(0);
        setProgress(0);
    };

    return (
        <div className="min-h-screen flex flex-col bg-[#f8fafc]">
            <header className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-6">
                <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Pill size={32} />
                        <div>
                            <h1 className="text-2xl font-bold">Análisis de PAM</h1>
                            <p className="text-sm opacity-90">Plan Anual de Medicamentos</p>
                        </div>
                    </div>
                    {status !== AppStatus.IDLE && (
                        <button
                            onClick={clearSession}
                            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                        >
                            <Trash2 size={18} />
                            Nuevo Análisis
                        </button>
                    )}
                </div>
            </header>

            <main className="flex-grow max-w-6xl mx-auto w-full p-8">
                {status === AppStatus.IDLE && (
                    <div className="max-w-2xl mx-auto text-center py-20">
                        <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 mx-auto mb-8">
                            <Upload size={36} />
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 mb-4">Analizar Documento PAM</h2>
                        <p className="text-slate-600 mb-10">Sube un Plan Anual de Medicamentos para extraer la información de prescripciones.</p>

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
                                Extrayendo Medicamentos
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full text-xs font-mono">
                                    <Timer size={12} /> {formatTime(seconds)}
                                </span>
                            </h3>
                            <p className="text-slate-500 mt-2">Analizando prescripciones médicas...</p>
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
                    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <PAMResults data={pamResult} />
                    </div>
                )}
            </main>
        </div>
    );
}
