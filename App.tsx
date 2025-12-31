

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
  Pill,
  UploadCloud,
  ShieldCheck,
  Code2,
  Settings,
  Key
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
        // Save to localStorage for cross-audit with PAM
        localStorage.setItem('clinic_audit_result', JSON.stringify(data));
        addLog('[SISTEMA] 💾 Resultados guardados para auditoría cruzada con PAM.');
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
    <div className="min-h-screen flex flex-col bg-slate-50 relative pb-32">
      <header className="bg-transparent border-b border-slate-900/50 sticky top-0 z-50 print:hidden backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-slate-200">
              <FileSearch size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                ClinicAudit
                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 font-mono">{VERSION}</span>
                <span className="text-xs text-slate-400 font-black ml-2 uppercase tracking-tight">Actualizado: {LAST_MODIFIED}</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Universal Extractor</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === AppStatus.SUCCESS && (
              <button
                onClick={downloadPdf}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all shadow-md disabled:opacity-50"
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
          <div className="max-w-2xl mx-auto mt-20 text-center space-y-12 animate-in fade-in zoom-in-95 duration-700">

            <div className="space-y-4">
              <div className="inline-flex items-center justify-center p-4 bg-slate-50 rounded-full mb-6 border border-slate-200 shadow-2xl shadow-black/5 hover:scale-105 transition-transform duration-500">
                <UploadCloud size={48} className="text-slate-900" />
              </div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter">
                Analizador Universal de Cuentas
              </h2>
              <p className="text-slate-500 text-lg max-w-lg mx-auto leading-relaxed">
                Sube cualquier factura o cuenta clínica para extraer y auditar los gastos automáticamente.
              </p>
            </div>

            <label
              className="group relative border-2 border-dashed border-slate-300 bg-white rounded-3xl p-16 transition-all duration-500 cursor-pointer block hover:border-slate-900 hover:bg-slate-50"
            >
              <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} />
              <div className="relative z-10 flex flex-col items-center gap-4">
                <div className="p-4 rounded-2xl transition-all duration-300 bg-slate-100 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white">
                  <FileText size={32} />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-bold text-slate-600 group-hover:text-indigo-600 transition-colors">
                    Haz clic para subir la cuenta
                  </p>
                  <p className="text-sm text-slate-400 font-medium">Soporta fotos, capturas y PDFs</p>
                </div>
              </div>

              {/* Decorative Elements */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-center gap-3 opacity-60">
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
                <ShieldCheck size={12} /> Privacy First
              </span>
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
                <Zap size={12} /> Gemini 2.0 Flash
              </span>
              <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
                <Code2 size={12} /> High Speed
              </span>
            </div>
          </div>
        )}

        {(status === AppStatus.PROCESSING || status === AppStatus.UPLOADING) && (<>
          <div className="max-w-4xl mx-auto py-12 animate-in fade-in slide-in-from-bottom-8 duration-700">

            {/* SPACEX STYLE TELEMETRY CONTAINER (DARK MODE) */}
            {/* LOGS WINDOW (Light Mode) */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden h-[600px] flex flex-col relative group">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Terminal size={16} className="text-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500">System Logs</span>
                </div>
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-slate-200" />
                  <div className="w-2 h-2 rounded-full bg-slate-200" />
                  <div className="w-2 h-2 rounded-full bg-slate-200" />
                </div>
              </div>

              <div className="p-6 h-full overflow-y-auto font-mono text-xs space-y-2 pb-20 bg-white custom-scrollbar">
                {logs.map((log, i) => {
                  const isWarn = log.includes('[WARN]');
                  const isApi = log.includes('[API]');
                  const isSystem = log.includes('[SISTEMA]');

                  return (
                    <div key={i} className="flex gap-4 items-start py-1.5 border-l-2 border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors pl-3 -ml-3">
                      <span className="opacity-40 w-24 shrink-0 text-right text-slate-400 font-bold text-[10px] pt-0.5 font-sans">
                        {log.match(/\[(.*?)\]/)?.[1] || new Date().toLocaleTimeString()}
                      </span>
                      <span className={`break-words flex-1 leading-relaxed ${log.includes('Error') ? 'text-rose-600 font-bold' :
                        isWarn ? 'text-amber-600 font-bold' :
                          isApi ? 'text-cyan-600' :
                            isSystem ? 'text-slate-400 italic' :
                              'text-slate-600'
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

          {/* SPACEX FOOTER (FIXED TELEMETRY) */}
          <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] safe-pb">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">

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
                  <span className="text-xs font-bold text-slate-300">Trajectory Mode</span>
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
              </div>

              {/* 4. COST & ABORT */}
              <div className="flex items-center gap-6 pl-8 border-l border-slate-800 h-full">
                <div className="flex flex-col items-end">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Est. Cost</span>
                  <span className="font-mono text-xl font-black text-white tracking-tight">
                    ${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'} <span className="text-[10px] text-slate-600 font-sans">CLP</span>
                  </span>
                </div>
                <button
                  onClick={handleStopAnalysis}
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

                <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200">
                  <h4 className="font-bold text-xs uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                    <FileText size={14} /> Documento Original
                  </h4>
                  <div className="aspect-[3/4] rounded-2xl bg-white overflow-hidden border border-slate-200 flex items-center justify-center group relative cursor-zoom-in">
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
    </div>
  );
};

export default App;
