import { Zap, ShieldCheck, UploadCloud, Loader2, ZoomIn, ZoomOut, Timer, Cpu, FileJson, FileText, X, Maximize2, Search, Filter, LayoutGrid, CheckCircle2, Save, Trash2 } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
import { AI_MODEL } from '../version';

interface Usage {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    estimatedCost: number;
    estimatedCostCLP: number;
}

export default function AccountProjectorV7() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [htmlProjection, setHtmlProjection] = useState<string>("");
    const [billOnly, setBillOnly] = useState(true);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [scale, setScale] = useState(1);
    const [ms, setMs] = useState(0);
    const [progress, setProgress] = useState(0);
    const [currentPass, setCurrentPass] = useState(1);
    const [hasCache, setHasCache] = useState(false);
    const [projectionFormat, setProjectionFormat] = useState<'html' | 'json'>('html');

    const logEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const checkCache = () => {
            setHasCache(!!localStorage.getItem('clinic_audit_result'));
        };
        checkCache();
        const interval = setInterval(checkCache, 1000);
        return () => clearInterval(interval);
    }, []);

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const logMsg = `[${timestamp}] ${msg}`;
        setLogs(prev => [...prev, logMsg]);
        console.log(`[AccountProjectorV7] ${logMsg}`);
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
            setHtmlProjection("");
            setUsage(null);
            setLogs([]);
            setCurrentPass(1);
            setProgress(0);
            addLog(`[SISTEMA] Iniciando proyección (${billOnly ? 'SOLO CUENTA' : 'FULL'}): ${selectedFile.name}`);
        } else {
            // NOTE: Current server implementation restarts from beginning if a new request is made.
            // We clear the output to avoid duplication, effectively restarting the process.
            setHtmlProjection("");
            addLog(`[SISTEMA] 🔄 Reiniciando proyección: ${selectedFile.name} (Forzado)...`);
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
                        mode: billOnly ? 'BILL_ONLY' : 'FULL',
                        format: projectionFormat
                    })

                });

                if (!response.ok) throw new Error('Error en la comunicación con el servidor');

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                if (!reader) throw new Error('No se pudo iniciar el stream de datos');

                let chunkCount = 0;
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
                                setHtmlProjection(prev => prev + data.text);
                            } else if (data.type === 'usage') {
                                setUsage(data.usage);
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
                                    const match = data.text.match(/Pase (\d+)\/(\d+)/);
                                    if (match) {
                                        const p = parseInt(match[1]);
                                        const total = parseInt(match[2]);
                                        setCurrentPass(p);
                                        const passSize = 100 / total;
                                        setProgress((p - 1) * passSize);
                                    }
                                }
                            } else if (data.type === 'error') {
                                addLog(`[ERROR] ${data.error}`);
                            }
                        } catch (e) {
                            // Partial JSON chunk
                        }
                    }
                }
                addLog(`[SISTEMA] ✅ Proyección binaria completada (${chunkCount} mini-bloques).`);
                addLog('[SISTEMA] Finalización exitosa.');
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
        setProgress(0);
        setScale(1);
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
        a.download = `proyeccion_m7_${file?.name.replace('.pdf', '')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadMarkdown = () => {
        if (!htmlProjection) return;
        let md = `# Proyección Módulo 7: ${file?.name}\n\n`;
        md += `> **Fecha**: ${new Date().toLocaleString()}\n`;
        md += `> **Tokens**: ${usage?.totalTokens || 0}\n`;
        md += `> **Formato**: ${projectionFormat}\n\n`;
        md += `---\n\n`;

        if (projectionFormat === 'json') {
            md += "```json\n" + htmlProjection + "\n```";
        } else {
            // Heuristic to keep tables somewhat readable in plain text
            const formattedHtml = htmlProjection
                .replace(/<\/tr>/g, '\n')
                .replace(/<\/td>/g, ' | ')
                .replace(/<th[^>]*>/g, ' [ ')
                .replace(/<\/th>/g, ' ] | ')
                .replace(/<[^>]+>/g, '');
            md += formattedHtml;
        }

        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proyeccion_m7_${file?.name.replace('.pdf', '')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const saveToCache = () => {
        if (!htmlProjection) return;
        const exportData = {
            filename: file?.name,
            timestamp: new Date().toISOString(),
            usage: usage,
            content: htmlProjection
        };
        try {
            localStorage.setItem('clinic_audit_result', JSON.stringify(exportData));
            setHasCache(true);
            addLog(`[SISTEMA] ✅ DATOS GUARDADOS EN MEMORIA FORENSE. Listo para auditoría.`);
            alert("✅ Cuenta Clínica guardada exitosamente en memoria forense.");
        } catch (e) {
            addLog(`[ERROR] No se pudo guardar en caché: ${String(e)}`);
        }
    };

    const clearCache = () => {
        localStorage.removeItem('clinic_audit_result');
        setHasCache(false);
        addLog('[SISTEMA] 🗑️ Memoria forense de Cuenta Clínica eliminada.');
        alert("🗑️ Memoria forense limpiada.");
    };

    return (
        <div className="max-w-[1800px] mx-auto p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header Area */}
            {/* Header Area */}
            <div className="flex items-center justify-between mb-8 px-2 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
                        <FileText className="text-indigo-600" />
                        CUENTA MODULO 7
                    </h2>
                    <p className="text-slate-500 font-medium text-sm">Proyección de alta fidelidad optimizada para auditorías (V7).</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* NEW EXPLICIT CONTROLS */}
                    {hasCache && (
                        <button
                            onClick={clearCache}
                            className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold hover:bg-rose-100 transition-all"
                        >
                            <Trash2 size={16} /> BORRAR MEMORIA
                        </button>
                    )}

                    {htmlProjection && !isProcessing && (
                        <button
                            onClick={saveToCache}
                            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black transition-all shadow-lg shadow-emerald-200 animate-pulse active:scale-95"
                            title="Incorporar a memoria forense"
                        >
                            <Save size={16} /> GUARDAR EN MEMORIA
                        </button>
                    )}

                    <div className="w-px h-8 bg-slate-200 mx-2"></div>

                    <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                        <ShieldCheck size={12} className="text-emerald-500" /> CERO PERSISTENCIA
                    </span>
                    <span className="px-3 py-1 bg-slate-900 text-slate-100 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                        <Zap size={12} className="text-indigo-400 fill-indigo-400" /> M7 STABLE
                    </span>
                </div>
            </div>

            {!file && (
                <div className="flex justify-center mb-4">
                    <button
                        onClick={() => setBillOnly(!billOnly)}
                        className={`flex items-center gap-3 px-6 py-3 rounded-2xl border transition-all duration-300 ${billOnly
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                    >
                        <div className={`p-1.5 rounded-lg transition-colors ${billOnly ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                            <Filter size={14} />
                        </div>
                        <div className="text-left">
                            <p className="text-xs font-black uppercase tracking-tight">Proyectar Solo Cuenta</p>
                            <p className="text-[10px] font-medium opacity-70">{billOnly ? 'Optimizado: Ignora registros médicos' : 'Modo Full: Procesa todo el PDF'}</p>
                        </div>
                        <div className={`ml-4 w-10 h-5 rounded-full relative transition-colors ${billOnly ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${billOnly ? 'left-6' : 'left-1'}`} />
                        </div>
                    </button>

                    <button
                        onClick={() => setProjectionFormat(projectionFormat === 'html' ? 'json' : 'html')}
                        className={`flex items-center gap-3 px-6 py-3 rounded-2xl border transition-all duration-300 ${projectionFormat === 'json'
                            ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                    >
                        <div className={`p-1.5 rounded-lg transition-colors ${projectionFormat === 'json' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                            <FileJson size={14} />
                        </div>
                        <div className="text-left">
                            <p className="text-xs font-black uppercase tracking-tight">Modo de Salida</p>
                            <p className="text-[10px] font-medium opacity-70">{projectionFormat === 'json' ? 'Datos Estructurados (JSON)' : 'Fidelidad Visual (HTML)'}</p>
                        </div>
                        <div className={`ml-4 w-10 h-5 rounded-full relative transition-colors ${projectionFormat === 'json' ? 'bg-amber-600' : 'bg-slate-200'}`}>
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${projectionFormat === 'json' ? 'left-6' : 'left-1'}`} />
                        </div>
                    </button>
                </div>

            )}

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
                                    Haz clic para proyectar en Módulo 7
                                </p>
                                <p className="text-sm text-slate-400 font-medium">Contratos, Cuentas, Planes de Salud (V7)</p>
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
                    <div className="lg:col-span-3 space-y-4">
                        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm relative group min-h-[800px]">
                            <div className="absolute top-4 right-4 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setScale(s => s + 0.1)} className="p-2 bg-slate-900 text-white rounded-lg hover:bg-black shadow-lg"><ZoomIn size={16} /></button>
                                <button onClick={() => setScale(s => s - 0.1)} className="p-2 bg-slate-900 text-white rounded-lg hover:bg-black shadow-lg"><ZoomOut size={16} /></button>
                            </div>
                            <div className="p-4 md:p-8 overflow-x-auto custom-scrollbar bg-slate-50" style={{ height: 'calc(100vh - 200px)' }}>
                                <div
                                    className="projection-surface bg-white shadow-2xl mx-auto origin-top transition-all duration-700 p-4 md:p-12 min-h-full w-full max-w-[1800px]"
                                    style={{
                                        transform: `scale(${scale})`,
                                        boxShadow: '0 0 50px rgba(0,0,0,0.1)',
                                    }}
                                >
                                    <style>{`
                                        td[data-tope="verified"] {
                                            position: relative;
                                            background-color: #f0fdf4 !important; /* Subtle green to indicate verification */
                                            font-weight: 600 !important;
                                        }
                                        td[data-tope="verified"]::after {
                                            content: "➤";
                                            position: absolute;
                                            right: 2px;
                                            top: 50%;
                                            transform: translateY(-50%);
                                            color: #16a34a;
                                            font-size: 8px;
                                        }
                                    `}</style>
                                    {projectionFormat === 'json' ? (

                                        <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap bg-slate-50 p-6 rounded-xl border border-slate-200">
                                            {htmlProjection || (isProcessing ? 'Analizando datos...' : '')}
                                        </pre>
                                    ) : (
                                        <div dangerouslySetInnerHTML={{ __html: htmlProjection || (isProcessing ? '<div class="flex items-center justify-center h-64 text-slate-400 italic font-medium">Generando proyección M7...</div>' : '') }} />
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>

                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col h-[600px]">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logs Módulo 7</span>
                                {isProcessing && <Loader2 size={14} className="animate-spin text-amber-500" />}
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
                            <h4 className="text-[10px] font-black text-indigo-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <LayoutGrid size={14} className="text-indigo-600" /> Tecnología de Alineación Forense
                            </h4>
                            <p className="text-[11px] text-indigo-700 leading-relaxed font-bold">
                                Cada línea del PDF se transforma en una fila de una hoja de cálculo interna virtual.
                            </p>
                            <div className="mt-3 space-y-1.5 border-t border-indigo-100 pt-3">
                                <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-500 uppercase">
                                    <CheckCircle2 size={10} /> Precios Normalizados
                                </div>
                                <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-500 uppercase">
                                    <CheckCircle2 size={10} /> Códigos Trazables
                                </div>
                                <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-500 uppercase">
                                    <CheckCircle2 size={10} /> Descripciones Limpias
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl">
                            <h4 className="text-xs font-black text-amber-900 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <Search size={14} /> Módulo 7: Enfoque Clínico
                            </h4>
                            <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                                Esta versión cuenta con la inteligencia neural corregida para procesar anexos, notas y factores de tabla sin truncamientos "perezosos".
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {file && (
                <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] h-20 animate-in slide-in-from-bottom duration-500">
                    <div className="max-w-[1800px] mx-auto px-8 h-full flex items-center justify-between">
                        <div className="flex items-center gap-4 border-r border-slate-800 pr-8 h-full">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Time</span>
                                <div className="font-mono text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                    <Timer size={18} className="text-amber-500" />
                                    T+{formatTime(ms)}
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
                                <span className="text-xs font-bold text-slate-300">
                                    {isProcessing ? 'PROYECTANDO...' : 'READY'}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 px-8 border-r border-slate-800 h-full min-w-[250px]">
                            <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <Cpu size={10} className="text-amber-400" /> V7 Neural Engine
                                </span>
                                <div className="text-[10px] font-bold text-slate-200 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                                    {AI_MODEL.split('|').find(m => m.includes('Others'))?.replace('Others:', '').trim() || 'Gemini 2.5 Flash'}
                                </div>
                            </div>
                        </div>

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
                                <span className="font-mono text-sm font-bold text-amber-500 tracking-tight">
                                    ${usage ? usage.estimatedCostCLP : '0'} CLP
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 pl-8 border-l border-slate-800 h-full">
                            {htmlProjection && !isProcessing && (
                                <>
                                    <button
                                        onClick={() => file && startProjection(file, true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all"
                                        title="FORZAR REINICIO DE PROYECCIÓN"
                                    >
                                        <Zap size={16} /> REINTENTAR
                                    </button>
                                    <button
                                        onClick={saveToCache}
                                        className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-emerald-200 animate-pulse active:scale-95"
                                        title="Incorporar a memoria forense para auditoría"
                                    >
                                        <Save size={16} /> GUARDAR EN MEMORIA
                                    </button>
                                    <button onClick={downloadJson} className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold transition-all"><FileJson size={16} /> JSON</button>
                                    <button onClick={downloadMarkdown} className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold transition-all"><FileText size={16} /> MD</button>
                                </>
                            )}
                            <button onClick={clearSession} className="w-10 h-10 rounded-full bg-rose-950/50 hover:bg-rose-600 border border-rose-900 text-rose-500 hover:text-white flex items-center justify-center transition-all"><X size={18} /></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
