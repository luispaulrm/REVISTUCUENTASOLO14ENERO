import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Loader2, FileText, Zap, ShieldCheck, X, Search, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

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
    const logEndRef = useRef<HTMLDivElement>(null);

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    useEffect(() => {
        if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile && selectedFile.type === 'application/pdf') {
            setFile(selectedFile);
            startProjection(selectedFile);
        }
    };

    const startProjection = async (selectedFile: File) => {
        setIsProcessing(true);
        setHtmlProjection("");
        setUsage(null);
        setLogs([]);
        addLog(`[SISTEMA] Iniciando proyección de: ${selectedFile.name}`);

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = (e.target?.result as string).split(',')[1];

            try {
                const response = await fetch('/api/project', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64, mimeType: selectedFile.type })
                });

                if (!response.ok) throw new Error('Error en la comunicación con el servidor');

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

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
                                setHtmlProjection(prev => prev + data.text);
                            } else if (data.type === 'usage') {
                                setUsage(data.usage);
                            } else if (data.type === 'log') {
                                addLog(data.text);
                            } else if (data.type === 'error') {
                                addLog(`[ERROR] ${data.error}`);
                            }
                        } catch (e) {
                            // Partial JSON chunk, ignore
                        }
                    }
                }
                addLog('[SISTEMA] ✅ Proyección completada con éxito.');
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
                    <p className="text-slate-500 font-medium">Proyección de alta fidelidad sin persistencia de datos.</p>
                </div>
                {file && (
                    <button
                        onClick={clearSession}
                        className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl text-xs font-bold hover:bg-rose-100 transition-all shadow-sm"
                    >
                        <X size={16} /> NUEVA PROYECCIÓN
                    </button>
                )}
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

                    {/* Stats & Logs */}
                    <div className="space-y-6">
                        {usage && (
                            <div className="bg-slate-950 text-white p-6 rounded-3xl border border-slate-800 shadow-xl">
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Zap size={14} className="text-indigo-400" /> Métricas de Proyección
                                </h4>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center text-xs font-mono">
                                        <span className="text-slate-400">Payload</span>
                                        <span className="font-bold">{(usage.totalTokens / 1000).toFixed(1)}k <span className="text-slate-600">TK</span></span>
                                    </div>
                                    <div className="h-px bg-slate-900" />
                                    <div className="flex justify-between items-end">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Costo Est.</span>
                                        <div className="text-right">
                                            <span className="text-xl font-black block">${usage.estimatedCostCLP} CLP</span>
                                            <span className="text-[9px] text-slate-600 font-mono italic">${usage.estimatedCost.toFixed(4)} USD</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col h-[400px]">
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
        </div>
    );
}
