import React, { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, FileText, Trash2, Terminal, Timer, X, Zap, FileJson, Copy, Check, ShieldCheck } from 'lucide-react';
import { AppStatus, UsageMetrics } from '../types';

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

    const timerRef = useRef<number | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

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

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setStatus(AppStatus.UPLOADING);
        setError(null);
        setCanonicalResult(null);
        setFileName(file.name);
        setLogs([]);
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
                        if (update.type === 'final') {
                            setCanonicalResult(update.data);
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
                {status !== AppStatus.IDLE && (
                    <button onClick={() => setStatus(AppStatus.IDLE)} className="text-slate-400 hover:text-rose-500 transition-colors">
                        <Trash2 size={20} />
                    </button>
                )}
            </header>

            <main className="max-w-[1400px] mx-auto p-6">
                {status === AppStatus.IDLE && (
                    <div className="max-w-2xl mx-auto text-center py-20">
                        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-indigo-600 mx-auto mb-8 border border-slate-200 shadow-xl">
                            <Upload size={36} />
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 mb-2">Generador de JSON Canónico</h2>
                        <p className="text-slate-500 mb-10">Sube un contrato para obtener su representación semántica purificada en formato JSON.</p>

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
                )}

                {(status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) && (
                    <div className="grid grid-cols-1 gap-6 max-w-4xl mx-auto">
                        <div className="bg-slate-900 rounded-2xl overflow-hidden shadow-2xl h-[500px] flex flex-col border border-slate-800">
                            <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Terminal size={14} className="text-indigo-400" />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Execution Log</span>
                                </div>
                                <div className="font-mono text-xs text-slate-400">T+{seconds}s</div>
                            </div>
                            <div className="p-4 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-1">
                                {logs.map((log, i) => (
                                    <div key={i} className="opacity-80 hover:opacity-100">{log}</div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>
                    </div>
                )}

                {status === AppStatus.SUCCESS && canonicalResult && (
                    <div className="grid grid-cols-1 gap-6">
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col h-[700px]">
                            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck size={18} className="text-emerald-500" />
                                    <h3 className="font-bold text-slate-900 uppercase tracking-tight">Resultado Canónico: {fileName}</h3>
                                </div>
                                <button
                                    onClick={copyToClipboard}
                                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all"
                                >
                                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                    {copied ? 'COPIADO' : 'COPIAR JSON'}
                                </button>
                            </div>
                            <div className="flex-grow p-6 overflow-hidden">
                                <pre className="w-full h-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-xs overflow-auto text-slate-700">
                                    {JSON.stringify(canonicalResult, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
