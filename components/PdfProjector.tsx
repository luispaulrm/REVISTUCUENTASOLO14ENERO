import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Loader2, FileText, Zap, ShieldCheck, X, Search, ZoomIn, ZoomOut, Maximize2, Download, FileJson, FileCode, Timer, Coins, ArrowDownLeft, ArrowUpRight, Cpu, RefreshCw } from 'lucide-react';
import { AI_MODEL } from '../version';

interface Usage {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost: number;
    estimatedCostCLP: number;
}

export default function PdfProjector() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [htmlProjection, setHtmlProjection] = useState<string>("");
    const [usage, setUsage] = useState<Usage | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [scale, setScale] = useState(1);
    const [ms, setMs] = useState(0);
    const [progress, setProgress] = useState(0);
    const [currentPass, setCurrentPass] = useState(1);
    const logEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | null>(null);

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const logMsg = `[${timestamp}] ${msg}`;
        setLogs(prev => [...prev, logMsg]);
        console.log(`[PdfProjector] ${logMsg}`);
    };

    useEffect(() => {
        if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        if (isProcessing) {
            if (!timerRef.current) {
                setMs(0);
                timerRef.current = window.setInterval(() => {
                    setMs(prev => prev + 100);
                }, 100);
            }
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (htmlProjection) {
                setProgress(100);
            }
        }
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isProcessing]);

    const formatTime = (totalMs: number) => {
        const totalSeconds = Math.floor(totalMs / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        const tenths = Math.floor((totalMs % 1000) / 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile && selectedFile.type === 'application/pdf') {
            setFile(selectedFile);
            startProjection(selectedFile);
        }
    };

    const startProjection = async (selectedFile: File, isResume: boolean = false) => {
        setIsProcessing(true);
        if (!isResume) {
            // Clear previous session data to avoid context pollution in the Auditor
            localStorage.removeItem('clinic_audit_result');
            localStorage.removeItem('pam_audit_result');
            localStorage.removeItem('contract_audit_result');
            localStorage.removeItem('html_projection_result'); // Clear old projection too

            setHtmlProjection("");
            setUsage(null);
            setLogs([]);
            setCurrentPass(1);
            setProgress(0);
            addLog(`[SISTEMA] 🧹 Contexto anterior limpiado.`);
            addLog(`[SISTEMA] Iniciando proyección de: ${selectedFile.name}`);
        } else {
            addLog(`[SISTEMA] 🔄 Resumiendo proyección de: ${selectedFile.name} (Pase ${currentPass + 1})...`);
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = (e.target?.result as string).split(',')[1];

            try {
                const response = await fetch('/api/project', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image: base64,
                        mimeType: selectedFile.type,
                        // If we had more state to pass back, we could, but the service handles it by analyzing the sequence
                    })
                });

                if (!response.ok) throw new Error('Error en la comunicación con el servidor');

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                let chunkCount = 0;
                let fullHtml = isResume ? htmlProjection : "";

                if (!reader) throw new Error('No se pudo iniciar el stream de datos');

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(l => l.trim());

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'chunk') {
                                chunkCount++;
                                fullHtml += data.text;
                                setHtmlProjection(prev => prev + data.text);
                                if (chunkCount % 20 === 0) {
                                    console.log(`[PdfProjector] 📦 Bloques recibidos: ${chunkCount}`);
                                }
                            } else if (data.type === 'usage') {
                                setUsage(data.usage);
                                // Progress: each pass is 10%. Within a pass, we move from baseline to baseline + 9%
                                const baseline = (currentPass - 1) * 10;
                                setProgress(prev => {
                                    const currentInPass = prev - baseline;
                                    const increment = 1;
                                    return Math.min(baseline + currentInPass + increment, baseline + 9);
                                });
                                addLog(`[IA] Métricas: ${data.usage.totalTokens} tokens | $${data.usage.estimatedCostCLP} CLP`);
                            } else if (data.type === 'log') {
                                addLog(data.text);
                                if (data.text.includes('Iniciando Pase')) {
                                    const match = data.text.match(/Pase (\d+)/);
                                    if (match) {
                                        const p = parseInt(match[1]);
                                        setCurrentPass(p);
                                        setProgress((p - 1) * 10);
                                    }
                                }
                            } else if (data.type === 'error') {
                                addLog(`[ERROR] ${data.error}`);
                            }
                        } catch (e) {
                            // Partial JSON chunk, ignore
                        }
                    }
                }
                addLog(`[SISTEMA] ✅ Proyección binaria completada (${chunkCount} mini-bloques).`);
                addLog('[SISTEMA] Finalización exitosa.');

                // Persist to localStorage for Auditor access
                try {
                    localStorage.setItem('html_projection_result', fullHtml);
                    addLog('[SISTEMA] 📡 Datos sincronizados con el Auditor Forense.');
                } catch (e) {
                    console.error('Error saving to localStorage:', e);
                }
            } catch (err: any) {
                addLog(`[ERROR] ${err.message}`);
            } finally {
                setIsProcessing(false);
            }
        };
        reader.readAsDataURL(selectedFile);
    };

    const clearSession = () => {
        setFile(null);
        setHtmlProjection("");
        setUsage(null);
        setLogs([]);
        setIsProcessing(false);
        try {
            localStorage.removeItem('html_projection_result');
            localStorage.removeItem('clinic_audit_result');
            localStorage.removeItem('pam_audit_result');
            localStorage.removeItem('contract_audit_result');
            addLog('[SISTEMA] 🧹 Sesión reiniciada completamente.');
        } catch (e) { }
    };

    const downloadJson = () => {
        if (!htmlProjection) return;
        const exportData = {
            filename: file?.name,
            timestamp: new Date().toISOString(),
            usage: usage,
            content: htmlProjection
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proyeccion_${file?.name.replace('.pdf', '')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadMarkdown = () => {
        if (!htmlProjection) return;
        // Basic HTML to MD conversion logic for the projection
        let md = `# Proyección: ${file?.name}\n\n`;
        md += `> **Fecha**: ${new Date().toLocaleString()}\n`;
        md += `> **Tokens**: ${usage?.totalTokens || 0}\n\n`;
        md += `---\n\n`;

        // Simple heuristic: strip HTML tags but keep some structure
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = htmlProjection;
        const text = tempDiv.innerText || tempDiv.textContent || "";
        md += text;

        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proyeccion_${file?.name.replace('.pdf', '')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-[1800px] mx-auto p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
                        <Zap className="text-indigo-600 fill-indigo-600" />
                        Proyector Maestro HTML
                    </h2>
                    <p className="text-slate-500 font-medium text-sm">Convertidor de alta fidelidad con inteligencia neural.</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                        <ShieldCheck size={12} className="text-emerald-500" /> CERO PERSISTENCIA
                    </span>
                    <span className="px-3 py-1 bg-slate-900 text-slate-100 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                        <Zap size={12} className="text-indigo-400 fill-indigo-400" /> MULTI-PASS ENABLED
                    </span>
                </div>
            </div>

            {!file ? (
                <div className="max-w-xl mx-auto mt-20">
                    <label className="group relative border-2 border-dashed border-slate-300 bg-white rounded-3xl p-16 transition-all duration-500 cursor-pointer block hover:border-slate-900 hover:bg-slate-50 text-center">
                        <input type="file" className="hidden" accept="application/pdf" onChange={handleFileChange} />
                        <div className="flex flex-col items-center gap-4">
                            <div className="p-4 rounded-2xl bg-slate-100 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                                <UploadCloud size={32} />
                            </div>
                            <div className="space-y-1">
                                <p className="text-lg font-bold text-slate-600 group-hover:text-indigo-600 transition-colors">
                                    Haz clic para proyectar un PDF
                                </p>
                                <p className="text-sm text-slate-400 font-medium">Contratos, Cuentas, Planes de Salud</p>
                            </div>
                        </div>
                    </label>
                    <div className="mt-8 flex justify-center gap-4 opacity-50">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <ShieldCheck size={12} /> Cero Persistencia
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <Maximize2 size={12} /> Alta Fidelidad
                        </span>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Projection View */}
                    <div className="lg:col-span-3 space-y-4">
                        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm relative group min-h-[800px]">
                            {/* Toolbar */}
                            <div className="absolute top-4 right-4 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setScale(s => s + 0.1)} className="p-2 bg-slate-900 text-white rounded-lg hover:bg-black shadow-lg"><ZoomIn size={16} /></button>
                                <button onClick={() => setScale(s => s - 0.1)} className="p-2 bg-slate-900 text-white rounded-lg hover:bg-black shadow-lg"><ZoomOut size={16} /></button>
                            </div>

                            <div className="p-8 md:p-12 overflow-auto custom-scrollbar bg-slate-50" style={{ height: 'calc(100vh - 200px)' }}>
                                <div
                                    className="bg-white shadow-2xl mx-auto origin-top transition-transform p-12 min-h-full"
                                    style={{
                                        width: '210mm',
                                        transform: `scale(${scale})`,
                                        boxShadow: '0 0 50px rgba(0,0,0,0.1)'
                                    }}
                                    dangerouslySetInnerHTML={{ __html: htmlProjection || (isProcessing ? '<div class="flex items-center justify-center h-64 text-slate-400 italic">Generando proyección...</div>' : '') }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Sidebar: Logs & Info */}
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col h-[600px]">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logs de Proceso</span>
                                {isProcessing && <Loader2 size={14} className="animate-spin text-indigo-500" />}
                            </div>
                            <div className="p-4 overflow-y-auto font-mono text-[10px] space-y-1.5 flex-grow custom-scrollbar bg-white">
                                {logs.map((log, i) => (
                                    <div key={i} className="text-slate-500 border-l border-slate-100 pl-2 leading-tight">
                                        {log}
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>

                        <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-3xl">
                            <h4 className="text-xs font-black text-indigo-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <Search size={14} /> Modo Forense
                            </h4>
                            <p className="text-[11px] text-indigo-700 leading-relaxed font-medium">
                                Esta vista utiliza la red neuronal para reconstruir el HTML original.
                                Ideal para verificar fidelidad antes de una auditoría masiva.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* SPACEX FOOTER (ACTION BAR & TELEMETRY) */}
            {file && (
                <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] safe-pb animate-in slide-in-from-bottom duration-500">
                    <div className="max-w-[1800px] mx-auto px-8 h-20 flex items-center justify-between">

                        {/* 1. MISSION TIME */}
                        <div className="flex items-center gap-4 border-r border-slate-800 pr-8 h-full">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Time</span>
                                <div className="font-mono text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                    <Timer size={18} className="text-indigo-500" />
                                    T+{formatTime(ms)}
                                </div>
                            </div>
                        </div>

                        {/* 2. TRAJECTORY (GAUGE) */}
                        <div className="flex items-center gap-4 px-8 border-r border-slate-800 h-full min-w-[200px]">
                            <div className="relative w-12 h-12">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle cx="24" cy="24" r="20" className="text-slate-800 stroke-current" strokeWidth="4" fill="transparent" />
                                    <circle cx="24" cy="24" r="20" className="text-white stroke-current" strokeWidth="4" fill="transparent"
                                        strokeDasharray={125.6} strokeDashoffset={125.6 - (125.6 * (isProcessing ? Math.min(progress + 15, 95) : 100)) / 100} strokeLinecap="round" />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-[10px] font-bold font-mono text-white">{isProcessing ? Math.min(progress + 15, 99) : '100'}%</span>
                                </div>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Progress</span>
                                <span className="text-xs font-bold text-slate-300 truncate max-w-[150px]">
                                    {isProcessing ? 'PROYECTANDO...' : 'READY'}
                                </span>
                            </div>
                        </div>

                        {/* 3. AI MODEL */}
                        <div className="flex items-center gap-4 px-8 border-r border-slate-800 h-full min-w-[250px]">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <Cpu size={10} className="text-indigo-400" /> Neural Engine
                                </span>
                                <div className="text-[10px] font-bold text-slate-200 bg-slate-900 px-2 py-1 rounded border border-slate-800 truncate max-w-[200px]">
                                    {AI_MODEL.split('|').find(m => m.includes('Others'))?.replace('Others:', '').trim() || 'Gemini 2.5 Flash'}
                                </div>
                            </div>
                        </div>

                        {/* 4. METRICS */}
                        <div className="flex items-center gap-8 px-8 flex-1 justify-center h-full">
                            <div className="flex flex-col items-center">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Payload</span>
                                <span className="font-mono text-sm font-bold text-slate-300">
                                    {usage ? (usage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}
                                </span>
                            </div>
                            <div className="w-px h-8 bg-slate-800"></div>
                            <div className="flex flex-col items-center">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Cost Est.</span>
                                <span className="font-mono text-sm font-bold text-emerald-400 tracking-tight">
                                    ${usage ? usage.estimatedCostCLP : '0'} CLP
                                </span>
                            </div>
                        </div>

                        {/* 5. ACTIONS */}
                        <div className="flex items-center gap-4 pl-8 border-l border-slate-800 h-full">
                            {htmlProjection && !isProcessing && (
                                <>
                                    <button
                                        onClick={() => file && startProjection(file, true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all animate-pulse"
                                        title="RESUMIR PROYECCIÓN (FORZAR CONTINUACIÓN)"
                                    >
                                        <Zap size={16} /> CONTINUAR
                                    </button>
                                    <button
                                        onClick={clearSession}
                                        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                                        title="LIMPIAR Y RENOVAR PROYECCIÓN"
                                    >
                                        <RefreshCw size={16} /> RENOVAR
                                    </button>
                                    <button
                                        onClick={downloadJson}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold transition-all"
                                    >
                                        <FileJson size={16} /> JSON
                                    </button>
                                    <button
                                        onClick={downloadMarkdown}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold transition-all"
                                    >
                                        <FileText size={16} /> MD
                                    </button>
                                </>
                            )}
                            <button
                                onClick={clearSession}
                                className="group flex items-center justify-center w-10 h-10 rounded-full bg-rose-950/50 hover:bg-rose-600 border border-rose-900 transition-all text-rose-500 hover:text-white"
                                title="NUEVA PROYECCIÓN"
                            >
                                <X size={18} />
                            </button>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
}
