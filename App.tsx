

import React, { useState, useEffect, useRef } from 'react';
import {
  FileSearch,
  Upload,
  Loader2,
  AlertCircle,
  FileText,
  X,
  Printer,
  Terminal,
  Trash2,
  FileDown,
  Timer,
  Zap,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  FileJson,
  FileType,
  Pill
} from 'lucide-react';
import { AppStatus, ExtractedAccount, UsageMetrics } from './types';
import { extractBillingData } from './geminiService';
import { extractPamData, PamDocument } from './pamService';
import { AuditSummary } from './components/AuditSummary';
import { ExtractionResults } from './components/ExtractionResults';
import { PAMResults } from './components/PAMResults';
import { VERSION, LAST_MODIFIED } from './version';

type DocumentType = 'bill' | 'pam';

const App: React.FC = () => {
  const [documentType, setDocumentType] = useState<DocumentType>('bill');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedAccount | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
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

  const handleStopAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      addLog('[SISTEMA] ✋ Análisis detenido manualmente por el usuario.');
    }
  };

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
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
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
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
    console.log(formattedMsg);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus(AppStatus.UPLOADING);
    setError(null);
    setResult(null);
    setLogs([]);
    setRealTimeUsage(null);
    addLog(`[SISTEMA] Archivo recibido: ${file.name}`);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      setFilePreview(base64Data);
      const pureBase64 = base64Data.split(',')[1];

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const timeoutId = setTimeout(() => {
        if (status === AppStatus.PROCESSING) {
          addLog('[SYSTEM] ⚠️ Timeout excedido (60s). Cancelando extracción...');
          controller.abort();
        }
      }, 60000);

      try {
        setStatus(AppStatus.PROCESSING);
        const data = await extractBillingData(pureBase64, file.type, addLog, setRealTimeUsage, controller.signal);
        setResult(data);
        setStatus(AppStatus.SUCCESS);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setStatus(AppStatus.IDLE);
          return;
        }
        setError(err.message || 'Error procesando la cuenta clínica.');
        setStatus(AppStatus.ERROR);
      } finally {
        clearTimeout(timeoutId);
        abortControllerRef.current = null;
      }
    };
    reader.readAsDataURL(file);
  };

  const downloadFormat = (format: 'json' | 'md') => {
    if (!result) return;
    let content = '';
    if (format === 'json') {
      content = JSON.stringify(result, null, 2);
    } else {
      content = `# AUDITORÍA CLÍNICA: ${result.clinicName}\n\n`;
      content += `**Paciente:** ${result.patientName}\n`;
      content += `**Factura:** ${result.invoiceNumber}\n`;
      content += `**Fecha:** ${result.date}\n\n`;
      content += `## RESUMEN\n`;
      content += `- Total Declarado: ${result.clinicStatedTotal} ${result.currency}\n`;
      content += `- Total Auditado: ${result.extractedTotal} ${result.currency}\n`;
      content += `- Estado: ${result.isBalanced ? 'CUADRADO' : 'DISCREPANCIA'}\n\n`;
      if (result.usage) {
        content += `## MÉTRICAS DE IA\n`;
        content += `- Tokens: ${result.usage.totalTokens}\n`;
        content += `- Costo Estimado: $${result.usage.estimatedCost.toFixed(5)}\n\n`;
      }
      content += `## DETALLE POR SECCIONES\n\n`;
      result.sections.forEach(s => {
        content += `### ${s.category}\n`;
        content += `| Descripción | Cant | P. Unit | Total |\n`;
        content += `| :--- | :--- | :--- | :--- |\n`;
        s.items.forEach(i => {
          content += `| ${i.description} | ${i.quantity} | ${i.unitPrice} | ${i.total} |\n`;
        });
        content += `**Total Sección:** ${s.sectionTotal}\n\n`;
      });
    }

    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria_${result.invoiceNumber || 'cuenta'}.${format}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  const downloadPdf = async () => {
    if (!reportRef.current || !result) return;

    setIsExporting(true);
    const element = reportRef.current;

    // @ts-ignore
    const html2pdfLib = window.html2pdf;

    if (!html2pdfLib) {
      console.error('Librería html2pdf no cargada, usando impresión nativa.');
      window.print();
      setIsExporting(false);
      return;
    }

    const opt = {
      margin: 10,
      filename: `auditoria_${result.invoiceNumber || 'cuenta'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      await html2pdfLib().set(opt).from(element).save();
    } catch (err) {
      console.error('Error al generar PDF:', err);
      // Fallback a impresión nativa si falla html2pdf
      window.print();
    } finally {
      setIsExporting(false);
    }
  };

  const clearSession = () => {
    localStorage.clear();
    setStatus(AppStatus.IDLE);
    setResult(null);
    setFilePreview(null);
    setError(null);
    setLogs([]);
    setSeconds(0);
    setProgress(0);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 print:hidden shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
              <FileSearch size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                ClinicAudit
                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 font-mono">{VERSION}</span>
                <span className="text-xs text-slate-900 font-black ml-2 uppercase tracking-tight">Actualizado: {LAST_MODIFIED}</span>
              </h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Universal Extractor</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === AppStatus.SUCCESS && (
              <button
                onClick={downloadPdf}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-md disabled:opacity-50"
              >
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

      <main className="flex-grow max-w-6xl mx-auto w-full p-4 md:p-8">
        {status === AppStatus.IDLE && (
          <div className="max-w-2xl mx-auto text-center py-20 animate-in fade-in zoom-in-95">
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 mx-auto mb-8">
              <Upload size={36} />
            </div>
            <h2 className="text-3xl font-black text-slate-900 mb-4">Analizador Universal de Cuentas</h2>
            <p className="text-slate-600 mb-10">Sube cualquier factura o cuenta clínica para extraer y auditar los gastos automáticamente.</p>

            <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-3xl bg-white cursor-pointer hover:bg-indigo-50/50 transition-all">
              <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} />
              <div className="flex flex-col items-center p-6 text-center">
                <div className="p-4 bg-slate-50 rounded-2xl mb-4 text-slate-400">
                  <FileText size={32} />
                </div>
                <p className="text-sm font-bold text-indigo-600">Haz clic para subir la cuenta</p>
                <p className="text-xs text-slate-400 mt-1">Soporta fotos, capturas y PDFs</p>
              </div>
            </label>
          </div>
        )}

        {(status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) && (
          <div className="max-w-4xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">

            {/* SPACEX STYLE TELEMETRY CONTAINER (DARK MODE) */}
            <div className="bg-slate-950 rounded-t-3xl border-x border-t border-slate-800 shadow-2xl shadow-black overflow-hidden relative">

              {/* HEADER STRIP */}
              <div className="bg-black text-white px-6 py-4 flex justify-between items-center border-b border-slate-900">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-100 animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
                  <span className="text-xs font-bold uppercase tracking-[0.25em] font-mono text-slate-100">
                    LIVE TELEMETRY
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-500">
                  ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}
                </div>
              </div>

              {/* MAIN METRICS GRID */}
              <div className="grid grid-cols-2 lg:grid-cols-5 divide-x divide-slate-900 border-b border-slate-900">

                {/* T+ TIMER */}
                <div className="p-4 flex flex-col items-center justify-center bg-slate-950 group hover:bg-slate-900 transition-colors">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 group-hover:text-white transition-colors">
                    Mission Time
                  </span>
                  <div className="font-mono text-4xl font-black text-white tracking-tighter">
                    T+{formatTime(seconds)}
                  </div>
                </div>

                {/* TRAJECTORY (Circular Gauge - Monochrome) */}
                <div className="p-4 flex flex-col items-center justify-center bg-slate-950 group hover:bg-slate-900 transition-colors">
                  <div className="relative w-24 h-24">
                    {/* Outer Ring */}
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="48" cy="48" r="40" className="text-slate-900 stroke-current" strokeWidth="6" fill="transparent" />
                      <circle cx="48" cy="48" r="40" className="text-white stroke-current" strokeWidth="6" fill="transparent"
                        strokeDasharray={251.2} strokeDashoffset={251.2 - (251.2 * progress) / 100} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-black font-mono text-white leading-none">{Math.round(progress)}</span>
                      <span className="text-[10px] font-bold text-slate-500 leading-none">%</span>
                    </div>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-2">Trajectory</span>
                </div>

                {/* TOKEN GAUGES CONTAINER */}
                <div className="col-span-2 grid grid-cols-3 divide-x divide-slate-900">
                  {/* INPUT TOKENS */}
                  <div className="p-4 flex flex-col items-center justify-center bg-slate-950 group hover:bg-slate-900 transition-colors">
                    <div className="relative w-16 h-16">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="32" cy="32" r="28" className="text-slate-900 stroke-current" strokeWidth="4" fill="transparent" />
                        <circle cx="32" cy="32" r="28" className="text-slate-400 stroke-current" strokeWidth="4" fill="transparent"
                          strokeDasharray={175.9} strokeDashoffset={175.9 - (175.9 * (realTimeUsage?.promptTokens || 0) / 100000)} strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xs font-bold font-mono text-slate-300">{realTimeUsage ? (realTimeUsage.promptTokens / 1000).toFixed(1) + 'k' : '-'}</span>
                      </div>
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mt-2">Input</span>
                  </div>

                  {/* OUTPUT TOKENS */}
                  <div className="p-4 flex flex-col items-center justify-center bg-slate-950 group hover:bg-slate-900 transition-colors">
                    <div className="relative w-16 h-16">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="32" cy="32" r="28" className="text-slate-900 stroke-current" strokeWidth="4" fill="transparent" />
                        <circle cx="32" cy="32" r="28" className="text-slate-200 stroke-current" strokeWidth="4" fill="transparent"
                          strokeDasharray={175.9} strokeDashoffset={175.9 - (175.9 * (realTimeUsage?.candidatesTokens || 0) / 20000)} strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xs font-bold font-mono text-slate-300">{realTimeUsage ? (realTimeUsage.candidatesTokens / 1000).toFixed(1) + 'k' : '-'}</span>
                      </div>
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mt-2">Output</span>
                  </div>

                  {/* TOTAL TOKENS */}
                  <div className="p-4 flex flex-col items-center justify-center bg-slate-950 group hover:bg-slate-900 transition-colors">
                    <div className="relative w-16 h-16">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="32" cy="32" r="28" className="text-slate-900 stroke-current" strokeWidth="4" fill="transparent" />
                        <circle cx="32" cy="32" r="28" className="text-white stroke-current" strokeWidth="4" fill="transparent"
                          strokeDasharray={175.9} strokeDashoffset={175.9 - (175.9 * (realTimeUsage?.totalTokens || 0) / 120000)} strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xs font-bold font-mono text-white">{realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '-'}</span>
                      </div>
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mt-2">Total</span>
                  </div>
                </div>

                {/* CURRENT STAGE */}
                <div className="p-4 flex flex-col items-center justify-center bg-slate-950 group hover:bg-slate-900 transition-colors">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 group-hover:text-white transition-colors">
                    Est. Cost
                  </span>
                  <div className="font-mono text-3xl font-black text-white tracking-tighter">
                    {realTimeUsage ? `$${realTimeUsage.estimatedCostCLP}` : '$0'}
                  </div>
                  <span className="text-[9px] font-mono text-slate-500 mt-2">CLP CURRENCY</span>
                </div>
              </div>

              {/* PROGRESS BAR STRIP (Monochrome) */}
              <div className="h-0.5 w-full bg-slate-900 relative overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-white transition-all duration-300 ease-out shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* LOGS WINDOW (Dark Mode) */}
              <div className="bg-black p-0 h-[500px] overflow-hidden relative group border-t border-slate-900">
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none shadow-[inset_0_0_30px_rgba(0,0,0,0.5)] z-10" />

                <div className="px-6 py-3 border-b border-slate-900 bg-slate-950 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-slate-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">System Logs</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                  </div>
                </div>

                <div className="p-6 h-full overflow-y-auto font-mono text-sm space-y-2 pb-20 bg-black">
                  {logs.map((log, i) => {
                    const isWarn = log.includes('[WARN]');
                    const isApi = log.includes('[API]');
                    const isSystem = log.includes('[SISTEMA]');

                    return (
                      <div key={i} className="flex gap-4 items-start py-1 border-l-[3px] border-transparent hover:border-slate-600 hover:bg-slate-900 transition-colors pl-3 -ml-3">
                        <span className="opacity-50 w-20 shrink-0 text-right text-slate-500 font-bold text-xs pt-0.5">
                          {log.match(/\[(.*?)\]/)?.[1] || new Date().toLocaleTimeString()}
                        </span>
                        <span className={`break-words flex-1 leading-snug ${log.includes('Error') ? 'text-rose-500 font-bold' :
                          isWarn ? 'text-amber-500 font-bold' :
                            isApi ? 'text-cyan-400' :
                              isSystem ? 'text-slate-400 italic' :
                                'text-slate-300'
                          }`}>
                          {log.replace(/^\[.*?\]/, '').trim()}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>

            {/* ABORT BUTTON */}
            <div className="mt-8 text-center">
              <button
                onClick={handleStopAnalysis}
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
            <AlertCircle size={64} className="text-rose-500 mx-auto mb-6" />
            <h3 className="text-2xl font-black text-slate-900 mb-2">Error de Extracción</h3>
            <p className="text-slate-500 mb-8">{error}</p>
            <button onClick={clearSession} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-2 mx-auto">
              <X size={18} /> REINTENTAR
            </button>
          </div>
        )}

        {status === AppStatus.SUCCESS && result && (
          <div className="animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-grow">
                <div ref={reportRef} className="bg-white p-4 md:p-8 rounded-3xl border border-slate-200 shadow-sm print:border-none print:shadow-none">
                  <div className="border-b-2 border-slate-900 pb-6 mb-8">
                    <div className="flex justify-between items-end">
                      <div>
                        <h1 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">Reporte de Auditoría Clínica</h1>
                        <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-widest">Verificación Matemática ClinicAudit Engine</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Fecha de Emisión</p>
                        <p className="text-xs font-bold text-slate-900">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
                      </div>
                    </div>
                  </div>

                  <AuditSummary data={result} />

                  {/* METRICAS DE TOKENS EN EL REPORTE (SOLO EN PDF) */}
                  {result.usage && (
                    <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl hidden print:block">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Métricas de Consumo IA</h4>
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Input</p>
                          <p className="text-xs font-mono font-bold text-slate-700">{result.usage.promptTokens}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Output</p>
                          <p className="text-xs font-mono font-bold text-slate-700">{result.usage.candidatesTokens}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Total</p>
                          <p className="text-xs font-mono font-bold text-indigo-600">{result.usage.totalTokens}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Costo Est.</p>
                          <p className="text-xs font-mono font-bold text-emerald-600">
                            ${result.usage.estimatedCostCLP} CLP <span className="text-[9px] text-slate-400">(${result.usage.estimatedCost.toFixed(4)} USD)</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <ExtractionResults data={result} />
                </div>
              </div>

              <aside className="w-full lg:w-80 space-y-6 print:hidden">
                {/* PANEL DE METRICAS DE TOKENS (DARK MODE) */}
                {result.usage && (
                  <div className="bg-slate-950 border border-slate-800 p-6 rounded-3xl shadow-xl">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="p-1.5 bg-slate-900 text-white rounded-lg border border-slate-800">
                        <Zap size={14} />
                      </div>
                      <h4 className="font-bold text-xs uppercase tracking-widest text-slate-400">Audit IA Info</h4>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 flex items-center gap-1.5"><ArrowDownLeft size={12} /> Entrada</span>
                        <span className="font-mono font-bold text-slate-300">{result.usage.promptTokens} <span className="text-[9px] text-slate-600">TK</span></span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 flex items-center gap-1.5"><ArrowUpRight size={12} /> Salida</span>
                        <span className="font-mono font-bold text-slate-300">{result.usage.candidatesTokens} <span className="text-[9px] text-slate-600">TK</span></span>
                      </div>
                      <div className="h-px bg-slate-900"></div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-bold uppercase tracking-tighter">Total Tokens</span>
                        <span className="font-mono font-black text-white">{result.usage.totalTokens}</span>
                      </div>
                      <div className="mt-4 p-3 bg-black border border-slate-900 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Coins size={14} className="text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Costo Análisis</span>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-white text-sm block">${result.usage.estimatedCostCLP} CLP</span>
                          <span className="font-mono text-[9px] text-slate-600 block">${result.usage.estimatedCost.toFixed(4)} USD</span>
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
                      <button onClick={() => downloadFormat('json')} className="flex items-center justify-center gap-2 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-[10px] font-bold transition-colors border border-slate-800">
                        <FileJson size={14} /> JSON
                      </button>
                      <button onClick={() => downloadFormat('md')} className="flex items-center justify-center gap-2 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-[10px] font-bold transition-colors border border-slate-800">
                        <FileType size={14} /> MD
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-3xl border border-slate-800">
                  <h4 className="font-bold text-xs uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                    <FileText size={14} /> Documento Original
                  </h4>
                  <div className="aspect-[3/4] rounded-2xl bg-slate-50 overflow-hidden border border-slate-100 flex items-center justify-center group relative cursor-zoom-in">
                    {filePreview ? (
                      <img src={filePreview} alt="Original" className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform" />
                    ) : (
                      <span className="text-slate-300 text-xs italic">Sin vista previa</span>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>

      <footer className="py-8 bg-white border-t border-slate-200 print:hidden mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            ClinicAudit • IA Audit Engine • © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
