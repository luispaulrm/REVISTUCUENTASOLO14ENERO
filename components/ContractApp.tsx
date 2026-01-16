import React, { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, FileText, Trash2, ShieldCheck, Timer, Terminal, Printer, X, Scale, Zap, Info, AlertTriangle } from 'lucide-react';
import { extractContractData } from '../contractService';
import { Contract, UsageMetrics, AppStatus } from '../types';
import { ContractResults } from './ContractResults';
import { VERSION, LAST_MODIFIED, AI_MODEL } from '../version';
import { CONSALUD_EJEMPLO } from '../mocks';

export default function ContractApp() {
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [error, setError] = useState<string | null>(null);
    const [contractResult, setContractResult] = useState<Contract | null>(CONSALUD_EJEMPLO as any);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [heartbeat, setHeartbeat] = useState(0);
    const [realTimeUsage, setRealTimeUsage] = useState<UsageMetrics | null>(null);
    const [fileName, setFileName] = useState<string>('');

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
            addLog('[SISTEMA] 🛑 Análisis cancelado por el usuario.');
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
            if (status === AppStatus.SUCCESS) setProgress(100);
        }
    }, [status]);

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const addLog = (msg: string) => {
        console.log(msg); // Enable F12 console viewing
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const formattedMsg = `[${timestamp}] ${msg}`;
        setLogs(prev => [...prev, formattedMsg]);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Smart Cache Check
        try {
            const cached = JSON.parse(localStorage.getItem('contract_audit_result') || 'null');
            const cachedFingerprint = localStorage.getItem('contract_audit_file_fingerprint'); // { name, size }

            if (cached && cachedFingerprint) {
                const fingerprint = JSON.parse(cachedFingerprint);
                if (fingerprint.name === file.name && fingerprint.size === file.size) {
                    addLog(`[SISTEMA] ⚡ Contrato '${file.name}' ya encontrado en memoria. Carga instantánea.`);
                    setContractResult(cached);
                    setFileName(file.name);
                    setStatus(AppStatus.SUCCESS);

                    // Asegurar métricas visuales si existen en caché
                    if (cached.usage) {
                        setRealTimeUsage(cached.usage);
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('Cache check failed', e);
        }

        setStatus(AppStatus.UPLOADING);
        setError(null);
        setContractResult(null);
        setFileName(file.name);
        setLogs([]);
        setRealTimeUsage(null);
        addLog(`[SISTEMA] Contrato recibido: ${file.name}`);

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target?.result as string;
            const pureBase64 = base64Data.split(',')[1];

            try {
                setStatus(AppStatus.PROCESSING);
                const controller = new AbortController();
                abortControllerRef.current = controller;

                const timeoutId = setTimeout(() => {
                    if (status === AppStatus.PROCESSING) {
                        addLog('[SISTEMA] ⚠️ AVISO: El análisis lleva 10 minutos. Es posible que el servidor haya terminado pero la conexión se haya degradado. Verifica si los resultados aparecen pronto.');
                        controller.abort();
                    }
                }, 600000);


                try {
                    const result = await extractContractData(
                        pureBase64,
                        file.type,
                        addLog,
                        (phaseUsage: any) => {
                            setRealTimeUsage(prev => {
                                const phases = prev?.phases || [];
                                const existingIndex = phases.findIndex(p => p.phase === phaseUsage.phase);

                                let newPhases = [...phases];
                                if (existingIndex >= 0) {
                                    newPhases[existingIndex] = phaseUsage;
                                } else {
                                    newPhases.push(phaseUsage);
                                }

                                const totalInput = newPhases.reduce((acc, p) => acc + p.promptTokens, 0);
                                const totalOutput = newPhases.reduce((acc, p) => acc + p.candidatesTokens, 0);
                                const totalCost = newPhases.reduce((acc, p) => acc + p.estimatedCostCLP, 0);

                                return {
                                    promptTokens: totalInput,
                                    candidatesTokens: totalOutput,
                                    totalTokens: totalInput + totalOutput,
                                    estimatedCost: totalCost / 980,
                                    estimatedCostCLP: totalCost,
                                    phases: newPhases
                                };
                            });
                        },
                        setProgress,
                        controller.signal
                    );

                    // Asegurar que las métricas finales se incluyan en el objeto
                    const finalData = {
                        ...result.data,
                        usage: result.usage || (result.data as any).metrics?.tokenUsage || realTimeUsage // Fallback to accumulated usage
                    };

                    setContractResult(finalData);
                    setStatus(AppStatus.SUCCESS);

                    // Persistir el contrato para auditoría cruzada (con protección de cuota)
                    try {
                        localStorage.setItem('contract_audit_result', JSON.stringify(finalData));
                        // SAVE FINGERPRINT
                        localStorage.setItem('contract_audit_file_fingerprint', JSON.stringify({ name: file.name, size: file.size }));
                        addLog('[SISTEMA] ✅ Contrato persistido localmente para auditoría cruzada.');
                    } catch (storageErr) {
                        addLog('[SISTEMA] ⚠️ No se pudo persistir en localStorage (posible límite excedido), pero el análisis es válido.');
                        console.warn('LocalStorage error:', storageErr);
                    }

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
                setError(err.message || 'Error procesando el contrato.');
                setStatus(AppStatus.ERROR);
            }
        };
        reader.readAsDataURL(file);
    };

    const clearSession = () => {
        setStatus(AppStatus.IDLE);
        setContractResult(null);
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
                        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                            <Scale size={22} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                                LEGAL FORENSIC
                                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 font-mono">{VERSION}</span>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Contract Analysis Module</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status !== AppStatus.IDLE && (
                            <button
                                onClick={clearSession}
                                className="p-2 text-slate-400 hover:text-rose-500 transition-colors flex items-center gap-2"
                            >
                                <span className="hidden md:inline text-[10px] font-bold uppercase">Nuevo Contrato</span>
                                <Trash2 size={20} />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-grow max-w-[1800px] mx-auto w-full p-6 sm:p-10">
                {status === AppStatus.IDLE && (
                    <div className="max-w-2xl mx-auto text-center py-20">
                        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-indigo-600 mx-auto mb-8 border border-slate-200 shadow-xl">
                            <Upload size={36} />
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tight underline decoration-indigo-500 underline-offset-8">Módulo de Contratos</h2>
                        <div className="flex items-center justify-center gap-2 mb-6">
                            <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1.5">
                                <Zap size={10} /> Engine: {AI_MODEL}
                            </span>
                        </div>
                        <p className="text-slate-500 mb-10">Sube tu Plan de Salud Isapre para extraer términos legales y coberturas de forma forense.</p>

                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-3xl bg-white cursor-pointer hover:bg-slate-50 hover:border-indigo-500 transition-all group">
                            <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} />
                            <div className="flex flex-col items-center p-6">
                                <div className="p-4 bg-slate-50 rounded-2xl mb-4 text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-colors">
                                    <FileText size={32} />
                                </div>
                                <p className="text-sm font-bold text-slate-600 group-hover:text-indigo-600 transition-colors">Cargar Contrato (PDF/Imagen)</p>
                                <p className="text-xs text-slate-400 mt-1">Análisis por Mandato Imperativo</p>
                            </div>
                        </label>
                    </div>
                )}

                {(status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) && (
                    <div className="max-w-4xl mx-auto py-12">
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden h-[600px] flex flex-col relative">
                            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Terminal size={16} className="text-slate-400" />
                                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Forensic Execution Log</span>
                                </div>
                            </div>
                            <div className="p-6 h-full overflow-y-auto font-mono text-[11px] space-y-2 bg-white scrollbar-thin">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-4 items-start py-1 transition-colors pl-3 hover:bg-slate-50 border-l-2 border-transparent">
                                        <span className={`break-words flex-1 ${log.includes('[SISTEMA]') ? 'text-indigo-500 font-bold' : 'text-slate-600'}`}>
                                            {log}
                                        </span>
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>

                        {/* SPACEX FOOTER (CONTRACT EDITION) */}
                        <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] safe-pb">
                            <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between">

                                {/* 1. MISSION TIME */}
                                <div className="flex items-center gap-4 border-r border-slate-800 pr-8 h-full">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Elapsed Time</span>
                                        <div className="font-mono text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                            <Timer size={18} className="text-indigo-500" />
                                            T+{formatTime(seconds)}
                                        </div>
                                    </div>
                                </div>

                                {/* 2. TRAJECTORY (GAUGE) */}
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
                                        <span className="text-xs font-bold text-slate-300 truncate max-w-[200px]" title={fileName}>
                                            {fileName || "Forensic Scan"}
                                        </span>
                                    </div>
                                </div>

                                {/* 3. TOKEN METRICS (ACCUMULATED BY PHASE) */}
                                <div className="flex items-center gap-6 px-8 flex-1 justify-center h-full overflow-hidden">
                                    {realTimeUsage?.phases && realTimeUsage.phases.length > 0 ? (
                                        <div className="flex items-center gap-4 animate-in fade-in duration-500 overflow-x-auto no-scrollbar py-2">
                                            {realTimeUsage.phases.map((p, idx) => (
                                                <div key={idx} className="flex flex-col items-center min-w-[80px] border-r border-slate-800 last:border-0 pr-4">
                                                    <span className="text-[7px] font-bold text-indigo-400 uppercase tracking-tighter mb-1 truncate max-w-[70px]">
                                                        {String(p.phase || '').replace(/_/g, ' ')}
                                                    </span>
                                                    <span className="font-mono text-[10px] font-bold text-slate-400">
                                                        {(p.totalTokens / 1000).toFixed(1)}k
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}

                                    <div className="w-px h-8 bg-slate-800 shrink-0 mx-4"></div>

                                    <div className="flex items-center gap-6">
                                        <div className="flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Payload</span>
                                            <span className="font-mono text-sm font-bold text-indigo-400">
                                                {realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Cost</span>
                                            <span className="font-mono text-sm font-bold text-emerald-400">
                                                ${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'}
                                            </span>
                                        </div>
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
                    </div>
                )}

                {status === AppStatus.ERROR && (
                    <div className="max-w-md mx-auto py-20 text-center">
                        <AlertTriangle className="text-rose-500 mx-auto mb-6" size={64} />
                        <h3 className="text-2xl font-black text-slate-900 mb-2">Error Forense</h3>
                        <p className="text-slate-500 mb-8">{error}</p>
                        <button onClick={clearSession} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-black transition-all">
                            VOLVER A INTENTAR
                        </button>
                    </div>
                )}

                {status === AppStatus.SUCCESS && contractResult && (
                    <div className="animate-in fade-in duration-700">
                        <ContractResults data={contractResult} />
                    </div>
                )}
            </main>
        </div>
    );
}
