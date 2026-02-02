import React, { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, FileText, Trash2, Terminal, Timer, X, Zap, FileJson, Copy, Check, ShieldCheck, Brain, LayoutTemplate, Download } from 'lucide-react';
import { AppStatus, UsageMetrics } from '../types';
import MentalMapApp from './MentalMapApp';

export default function CanonicalGeneratorApp() {
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [error, setError] = useState<string | null>(null);
    const [canonicalResult, setCanonicalResult] = useState<any | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [realTimeUsage, setRealTimeUsage] = useState<UsageMetrics | null>(null);
    const [fileName, setFileName] = useState<string>('');
    const [copied, setCopied] = useState(false);
    const [isLearning, setIsLearning] = useState(false);
    const [learned, setLearned] = useState(false);
    const [contractCount, setContractCount] = useState<number>(0);
    const [reportMetrics, setReportMetrics] = useState<any | null>(null);
    const [viewMode, setViewMode] = useState<'json' | 'map'>('json');

    const timerRef = useRef<number | null>(null);
    const progressRef = useRef<number | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        fetch('/api/contract-count')
            .then(res => res.json())
            .then(data => setContractCount(data.count))
            .catch(err => console.error('Error fetching contract count:', err));
    }, []);

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

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStopAnalysis = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            addLog('[SISTEMA] ✋ Análisis detenido manualmente por el usuario.');
        }
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setStatus(AppStatus.UPLOADING);
        setError(null);
        setCanonicalResult(null);
        setReportMetrics(null);
        setFileName(file.name);
        setLogs([]);
        localStorage.removeItem('canonical_contract_result'); // Fix: Force clear storage to prevent stale mix
        addLog(`[SISTEMA] Iniciando canonización de: ${file.name}`);

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target?.result as string;
            const pureBase64 = base64Data.split(',')[1];

            try {
                setStatus(AppStatus.PROCESSING);
                const controller = new AbortController();
                abortControllerRef.current = controller;

                const response = await fetch('/api/extract-canonical', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: pureBase64, mimeType: file.type, originalname: file.name }),
                    signal: controller.signal
                });

                if (!response.ok) throw new Error('Error en el servidor');

                const reader = response.body?.getReader();
                if (!reader) throw new Error('No se pudo establecer stream');

                const decoder = new TextDecoder();
                let partialBuffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    partialBuffer += decoder.decode(value, { stream: true });
                    const lines = partialBuffer.split('\n');
                    partialBuffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const update = JSON.parse(line);
                        if (update.type === 'chunk') addLog(update.text);
                        if (update.type === 'metrics') {
                            setRealTimeUsage(prev => ({
                                promptTokens: (prev?.promptTokens || 0) + (update.metrics.input || 0),
                                candidatesTokens: (prev?.candidatesTokens || 0) + (update.metrics.output || 0),
                                totalTokens: (prev?.totalTokens || 0) + (update.metrics.input || 0) + (update.metrics.output || 0),
                                estimatedCost: (prev?.estimatedCost || 0) + (update.metrics.cost / 900), // Approx USD
                                estimatedCostCLP: (prev?.estimatedCostCLP || 0) + (update.metrics.cost || 0)
                            }));
                        }
                        if (update.type === 'final') {
                            setCanonicalResult(update.data);
                            if (update.data.cached) {
                                addLog('[SISTEMA] 🚀 CACHE HIT! Recuperado de memoria local.');
                                setProgress(100);
                            }
                            if (update.metrics) setReportMetrics(update.metrics);
                            if (update.totalCount) setContractCount(update.totalCount);
                            // PERSISTENCE FOR AUDITOR INTEGRATION (v2.2)
                            localStorage.setItem('canonical_contract_result', JSON.stringify(update.data));
                            setStatus(AppStatus.SUCCESS);
                        }
                        if (update.type === 'error') throw new Error(update.message);
                    }
                }
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    setError(err.message);
                    setStatus(AppStatus.ERROR);
                }
            }
        };
        reader.readAsDataURL(file);
    };

    const copyToClipboard = () => {
        if (!canonicalResult) return;
        navigator.clipboard.writeText(JSON.stringify(canonicalResult, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const downloadJson = () => {
        if (!canonicalResult) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(canonicalResult, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `canonical_${fileName.replace(/\.[^/.]+$/, "")}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleLearn = async () => {
        if (!canonicalResult) return;
        setIsLearning(true);
        try {
            const response = await fetch('/api/learn-contract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(canonicalResult)
            });
            if (response.ok) {
                setLearned(true);
                setTimeout(() => setLearned(false), 3000);
                addLog('[APRENDIZAJE] 🧠 He aprendido los nuevos patrones y sinónimos de este contrato.');
            }
        } catch (err) {
            console.error('Learning failed', err);
        } finally {
            setIsLearning(false);
        }
    };

    const handleClearCache = async () => {
        if (!confirm('¿Estás seguro de BORRAR LA MEMORIA del canonizador? Esto eliminará todos los análisis guardados.')) return;

        try {
            const res = await fetch('/api/contracts/clear-cache', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                addLog(`[SISTEMA] 🗑️ Memoria borrada. ${data.deletedCount} registros eliminados.`);
                setStatus(AppStatus.IDLE);
                setContractCount(0);
                setCanonicalResult(null);
            }
        } catch (err) {
            console.error('Error clearing cache:', err);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 h-16 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <FileJson size={22} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 leading-none">CANONIZADOR JSON</h1>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Generador de Estructuras Canónicas</p>
                    </div>
                </div>
                <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Bases de Conocimiento</span>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-600">{contractCount} Contratos Canonizados</span>
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        </div>
                    </div>
                    {contractCount > 0 && (
                        <button onClick={handleClearCache} title="Borrar Memoria (Cache)" className="text-slate-400 hover:text-rose-500 transition-colors">
                            <Trash2 size={20} />
                        </button>
                    )}
                </div>
            </header>

            <main className={`${viewMode === 'map' && status === AppStatus.SUCCESS ? 'max-w-full' : 'max-w-[1400px]'} mx-auto p-4 transition-all duration-500`}>
                {status === AppStatus.IDLE && (
                    <div className="max-w-2xl mx-auto text-center py-20">
                        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-indigo-600 mx-auto mb-8 border border-slate-200 shadow-xl">
                            <Upload size={36} />
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 mb-2">Generador de JSON Canónico</h2>
                        <p className="text-slate-500 mb-10">Sube un contrato para obtener su representación semántica purificada en formato JSON.</p>

                        <div className="flex items-center justify-between mb-8">
                            {/* Header Text */}
                            <div>
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                                    <Zap className="text-indigo-600" fill="currentColor" />
                                    Canonizador de Contratos
                                </h1>
                                <p className="text-slate-500 font-medium mt-1">Transforma contratos PDF en estructuras de verdad JSON deterministas.</p>
                            </div>

                        </div>
                        {/* END HEADER */}

                        <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-3xl bg-white cursor-pointer hover:bg-slate-50 hover:border-indigo-500 transition-all group">
                            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={handleFileUpload} />
                            <div className="flex flex-col items-center p-6">
                                <div className="p-4 bg-slate-50 rounded-2xl mb-4 text-slate-400 group-hover:text-indigo-600 transition-colors">
                                    <FileText size={32} />
                                </div>
                                <p className="text-sm font-bold text-slate-600 group-hover:text-indigo-600 transition-colors">Cargar Contrato para Canonización</p>
                                <p className="text-xs text-slate-400 mt-1">Formato PDF o Imagen</p>
                            </div>
                        </label>
                    </div>
                )
                }

                {
                    (status === AppStatus.PROCESSING || status === AppStatus.UPLOADING || (status === AppStatus.SUCCESS && reportMetrics)) && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                            <div className="lg:col-span-2 bg-slate-900 rounded-2xl overflow-hidden shadow-2xl h-[500px] flex flex-col border border-slate-800">
                                <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Terminal size={14} className="text-indigo-400" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Execution Log</span>
                                    </div>
                                    <div className="font-mono text-xs text-slate-400">T+{seconds}s</div>
                                </div>
                                <div className="p-4 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-1 bg-slate-950">
                                    {logs.map((log, i) => (
                                        <div key={i} className="opacity-80 hover:opacity-100 leading-relaxed border-l border-slate-800 pl-2 mb-0.5">{log}</div>
                                    ))}
                                    <div ref={logEndRef} />
                                </div>
                            </div>

                            {/* REPORT DASHBOARD (v2.3) */}
                            <div className="flex flex-col gap-6">
                                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 flex flex-col justify-between h-[240px]">
                                    <div>
                                        <div className="flex items-center justify-between mb-6">
                                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado de la Misión</h3>
                                            <div className={`px-2 py-1 rounded text-[9px] font-black uppercase ${status === AppStatus.SUCCESS ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600 animate-pulse'}`}>
                                                {status}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                <span className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Páginas</span>
                                                <span className="text-2xl font-black text-slate-900">
                                                    {reportMetrics?.tokenUsage?.totalPages || '--'}
                                                </span>
                                            </div>
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                <span className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Precisión</span>
                                                <span className="text-2xl font-black text-indigo-600">
                                                    {reportMetrics?.tokenUsage?.phaseSuccess ?
                                                        Math.round((Object.values(reportMetrics.tokenUsage.phaseSuccess).filter(Boolean).length / Object.values(reportMetrics.tokenUsage.phaseSuccess).length) * 100)
                                                        : '0'}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-slate-100">
                                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                                            <span>Items Extraídos</span>
                                            <span className="text-slate-900">{reportMetrics?.extractionBreakdown?.totalItems || 0}</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                                            <div
                                                className="bg-indigo-500 h-full transition-all duration-1000"
                                                style={{ width: `${Math.min(100, (reportMetrics?.extractionBreakdown?.totalItems || 0) * 2)}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl p-6 flex-grow">
                                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Pipeline Status</h3>
                                    <div className="space-y-3">
                                        {reportMetrics?.tokenUsage?.phaseSuccess ? Object.entries(reportMetrics.tokenUsage.phaseSuccess).map(([phase, success]) => (
                                            <div key={phase} className="flex items-center justify-between">
                                                <span className="text-[9px] font-mono text-slate-400">{phase}</span>
                                                {success ?
                                                    <Check size={12} className="text-emerald-500" /> :
                                                    <X size={12} className="text-slate-600" />
                                                }
                                            </div>
                                        )) : (
                                            <div className="flex items-center gap-2 text-slate-600 italic text-[10px]">
                                                <Loader2 size={12} className="animate-spin" />
                                                Analizando capas...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }
                {/* RESULT AREA */}
                {
                    status === AppStatus.SUCCESS && canonicalResult && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <div className={`bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col ${viewMode === 'map' ? 'h-[85vh]' : 'h-[700px]'} transition-all duration-500`}>
                                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck size={18} className="text-emerald-500" />
                                            <h3 className="font-bold text-slate-900 uppercase tracking-tight">Result: {fileName}</h3>
                                        </div>
                                        <div className="flex bg-slate-200 p-1 rounded-lg">
                                            <button
                                                onClick={() => setViewMode('json')}
                                                className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${viewMode === 'json' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                                    }`}
                                            >
                                                <FileJson size={12} />
                                                JSON
                                            </button>
                                            <button
                                                onClick={() => setViewMode('map')}
                                                className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${viewMode === 'map' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                                    }`}
                                            >
                                                <Brain size={12} />
                                                Mapa
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={copyToClipboard}
                                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all text-slate-700"
                                        >
                                            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                            {copied ? 'COPIADO' : 'COPIAR'}
                                        </button>
                                        <button
                                            onClick={downloadJson}
                                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white border border-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-sm"
                                        >
                                            <Download size={14} />
                                            DESCARGAR
                                        </button>
                                        <button
                                            onClick={handleLearn}
                                            disabled={isLearning}
                                            className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-xs font-bold transition-all ${learned
                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                                : 'bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100'
                                                }`}
                                        >
                                            {isLearning ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                                            {learned ? 'APRENDIDO' : 'APRENDER'}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-grow overflow-hidden relative bg-slate-50">
                                    {/* Fix: Do not pass raw canonicalResult as initialData because it lacks 'root' structure. 
                                        Let MentalMapApp fetch the official mental model or handle its logic. 
                                        If we want to show the map of the UPLOADED contract, we would need a backend transformation first.
                                    */}
                                    {viewMode === 'map' ? (
                                        <div className="absolute inset-0 flex flex-col">
                                            {/* We rely on the internal fetch of the default mental model for now, 
                                                or we could trigger a specific generation endpoint here.
                                                Passing raw canonicalResult causes a crash.
                                             */}
                                            <MentalMapApp isActive={true} />
                                        </div>
                                    ) : (
                                        <div className="absolute inset-0 p-6 overflow-auto custom-scrollbar">
                                            <pre className="font-mono text-xs text-slate-700 whitespace-pre-wrap">
                                                {JSON.stringify(canonicalResult, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }
                {
                    status === AppStatus.ERROR && (
                        <div className="max-w-2xl mx-auto text-center py-20">
                            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mx-auto mb-8 border border-rose-100 shadow-xl">
                                <X size={36} />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-4">Error de Validación</h2>
                            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 mb-8 text-rose-700 text-sm font-medium leading-relaxed">
                                {error || 'Ocurrió un error inesperado al procesar el documento.'}
                            </div>
                            <button
                                onClick={() => setStatus(AppStatus.IDLE)}
                                className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg"
                            >
                                SUBIR OTRO ARCHIVO
                            </button>
                        </div>
                    )
                }

                {
                    (status === AppStatus.PROCESSING || status === AppStatus.UPLOADING || status === AppStatus.SUCCESS) && (
                        <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] safe-pb animate-in slide-in-from-bottom duration-500">
                            <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between">
                                {/* 1. MISSION TIME */}
                                <div className="flex items-center gap-4 border-r border-slate-800 pr-8 h-full">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Mission Time</span>
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
                                        <span className="text-xs font-bold text-slate-300 italic">
                                            {status === AppStatus.SUCCESS ? 'Mission Finalized' : 'Canonization Phase'}
                                        </span>
                                    </div>
                                </div>

                                {/* 3. TOKEN METRICS */}
                                <div className="flex items-center gap-8 px-8 flex-1 justify-center h-full">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Input Tokens</span>
                                        <span className="font-mono text-sm font-bold text-slate-300">
                                            {realTimeUsage ? (realTimeUsage.promptTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                        </span>
                                    </div>
                                    <div className="w-px h-8 bg-slate-800"></div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Output Tokens</span>
                                        <span className="font-mono text-sm font-bold text-white">
                                            {realTimeUsage ? (realTimeUsage.candidatesTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                        </span>
                                    </div>
                                    <div className="w-px h-8 bg-slate-800"></div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Payload</span>
                                        <span className="font-mono text-sm font-bold text-indigo-400">
                                            {realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                        </span>
                                    </div>
                                    {canonicalResult?.cached && (
                                        <>
                                            <div className="w-px h-8 bg-slate-800"></div>
                                            <div className="flex flex-col items-center animate-pulse">
                                                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Power Status</span>
                                                <div className="flex items-center gap-1 text-emerald-400">
                                                    <Zap size={14} fill="currentColor" />
                                                    <span className="font-mono text-xs font-bold">CACHED</span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* 4. COST & ABORT / SUCCESS */}
                                <div className="flex items-center gap-6 pl-8 border-l border-slate-800 h-full">
                                    <div className="flex flex-col items-end">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Est. Cost</span>
                                        <span className="font-mono text-xl font-black text-white tracking-tight">
                                            ${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'} <span className="text-[10px] text-slate-600 font-sans">CLP</span>
                                        </span>
                                        <div className="flex items-center gap-1 mt-1">
                                            <ShieldCheck size={10} className="text-emerald-500" />
                                            <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-tight">
                                                {status === AppStatus.SUCCESS ? 'Verification Complete' : 'Smart Mapping Mode'}
                                            </span>
                                        </div>
                                    </div>
                                    {status !== AppStatus.SUCCESS ? (
                                        <button
                                            onClick={handleStopAnalysis}
                                            className="group flex items-center justify-center w-10 h-10 rounded-full bg-rose-950/50 hover:bg-rose-600 border border-rose-900 transition-all text-rose-500 hover:text-white"
                                            title="ABORT ANALYSIS"
                                        >
                                            <X size={18} />
                                        </button>
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-emerald-950/50 flex items-center justify-center border border-emerald-900 text-emerald-500">
                                            <Check size={18} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }
            </main>
        </div>
    );
}
