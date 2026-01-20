import '../print.css';
import React, { useState, useEffect, useRef } from 'react';
import {
    Gavel,
    FileText,
    ShieldCheck,
    Scale,
    AlertCircle,
    Loader2,
    Trash2,
    Download,
    Printer,
    Terminal,
    ChevronRight,
    Search,
    CheckCircle2,
    Timer,
    X,
    FileType,
    FileJson,
    DollarSign,
    Zap,
    MessageSquare,
    Send,
    Eraser,
    BrainCircuit,
    Calculator,
    Library,
    Image as ImageIcon,
    Paperclip,
    Maximize2,
    Minimize2
} from 'lucide-react';
import { AuditTablesSection } from './tables/AuditTablesSection';
import { runForensicAudit } from '../auditService';
import { VERSION, LAST_MODIFIED, AI_MODEL } from '../version';

export default function ForensicApp() {
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('IDLE');
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [auditResult, setAuditResult] = useState<any>(null);
    const [preCheckResult, setPreCheckResult] = useState<any>(null);
    const [isPreChecking, setIsPreChecking] = useState(false);

    // Telemetry State
    const [progress, setProgress] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [realTimeUsage, setRealTimeUsage] = useState<any>(null);

    // Preview State
    const [previewData, setPreviewData] = useState<{ title: string, content: string } | null>(null);

    // Persisted Data State
    const [hasBill, setHasBill] = useState(false);
    const [hasPam, setHasPam] = useState(false);
    const [hasContract, setHasContract] = useState(false);
    const [hasHtml, setHasHtml] = useState(false);

    const logEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        checkData();
        window.addEventListener('storage', checkData);

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                checkData();
            }
        };

        const intervalId = setInterval(checkData, 2000);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('storage', checkData);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        if (status === 'PROCESSING') {
            if (!timerRef.current) {
                setSeconds(0);
                timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
            }
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (status === 'SUCCESS') setProgress(100);
        }
    }, [status]);

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const checkData = () => {
        try {
            setHasBill(!!localStorage.getItem('clinic_audit_result'));
            setHasPam(!!localStorage.getItem('pam_audit_result'));
            setHasContract(!!localStorage.getItem('contract_audit_result'));
            setHasHtml(!!localStorage.getItem('html_projection_result'));
        } catch (e) {
            console.warn('LocalStorage access blocked:', e);
            setHasBill(false);
            setHasPam(false);
            setHasContract(false);
            setHasHtml(false);
        }
    };

    const addLog = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
    };

    const downloadFormat = (data: any, format: 'json' | 'md', filename: string) => {
        const content = format === 'json' ? JSON.stringify(data, null, 2) : data.auditoriaFinalMarkdown;
        const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().getTime()}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownloadPDF = async () => {
        const element = document.getElementById('audit-report-content');
        if (!element) return;

        const originalButton = document.getElementById('btn-download-pdf');
        if (originalButton) originalButton.innerText = 'GENERANDO PDF...';

        try {
            // 1. CLONE & FLATTEN STYLES
            // We need to clone the node and explicitly set all computed styles as inline styles
            // This forces the browser to resolve variables (like oklch) to RGB before html2canvas sees them.
            const clone = element.cloneNode(true) as HTMLElement;
            clone.style.width = `${element.offsetWidth}px`;

            // Container for the clone (hidden)
            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '0';
            document.body.appendChild(container);
            container.appendChild(clone);

            // Recursive function to flatten computed styles
            const ctx = document.createElement('canvas').getContext('2d');
            const safeColor = (value: string) => {
                if (!value || !value.includes('oklch')) return value;
                if (!ctx) return value;

                const old = ctx.fillStyle;
                try {
                    ctx.fillStyle = value;
                    return ctx.fillStyle; // Browser converts to hex/rgb
                } catch (e) {
                    return value;
                }
            };

            const flattenStyles = (source: Element, target: Element) => {
                const computed = window.getComputedStyle(source);

                // Explicitly copy all CSS properties to inline styles
                // This converts modern color formats (oklch) to standard RGB/RGBA
                // and disconnects the element from the Tailwind stylesheet
                const properties = [
                    'color', 'background-color', 'border-color',
                    'font-size', 'font-weight', 'font-family', 'font-style', 'letter-spacing', 'line-height',
                    'display', 'flex-direction', 'align-items', 'justify-content', 'flex-wrap', 'gap',
                    'margin', 'padding', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
                    'text-align', 'text-transform', 'position', 'left', 'top', 'right', 'bottom', 'z-index',
                    'overflow', 'white-space', 'vertical-align',
                    'box-shadow', 'opacity', 'visibility',
                    'list-style-type', 'list-style-position', 'list-style-image'
                ];

                // Also copy specific border sides and corners
                ['top', 'right', 'bottom', 'left'].forEach(side => {
                    properties.push(`border-${side}-width`);
                    properties.push(`border-${side}-style`);
                    properties.push(`border-${side}-color`);
                });
                ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach(corner => {
                    properties.push(`border-${corner}-radius`);
                });

                if (target instanceof HTMLElement) {
                    for (const prop of properties) {
                        let val = computed.getPropertyValue(prop);

                        // Sanitize colors using Canvas API to get Hex/RGB
                        if (val && val.includes('oklch')) {
                            val = safeColor(val);
                        }

                        target.style.setProperty(prop, val);
                    }

                    // CRITICAL: Remove class and id to stop html2canvas from trying to match 
                    // and parse the Tailwind stylesheet (which contains the raw oklch rules).
                    target.removeAttribute('class');
                    target.removeAttribute('id');
                }

                // Recurse for children
                for (let i = 0; i < source.children.length; i++) {
                    if (target.children[i]) {
                        flattenStyles(source.children[i], target.children[i]);
                    }
                }
            };

            // Run flattening
            flattenStyles(element, clone);

            // @ts-ignore
            const html2pdf = (await import('html2pdf.js')).default;
            const opt = {
                margin: 10,
                filename: `Auditoria_Forense_${new Date().toISOString().slice(0, 10)}.pdf`,
                image: { type: 'jpeg' as const, quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
            };

            // Generate from the CLONE, not the original
            await html2pdf().set(opt).from(clone).save();

            // Cleanup
            document.body.removeChild(container);

        } catch (error: any) {
            console.error('PDF Generation Error:', error);
            alert(`Error al generar PDF: ${error.message}`);
        } finally {
            if (originalButton) originalButton.innerText = 'DESCARGAR PDF';
        }
    };

    const isRunningRef = useRef(false);

    const handleExecuteAudit = async () => {
        if (isRunningRef.current) return; // Prevent double execution
        isRunningRef.current = true;

        setStatus('PROCESSING');
        setError(null);
        setLogs([]);
        setAuditResult(null);
        setProgress(0);
        setRealTimeUsage(null);

        addLog('[SISTEMA] 🚀 Iniciando Auditoría Forense Consolidada...');

        try {
            const cuenta = JSON.parse(localStorage.getItem('clinic_audit_result') || '{}');
            const pam = JSON.parse(localStorage.getItem('pam_audit_result') || '{}');
            const contrato = JSON.parse(localStorage.getItem('contract_audit_result') || '{}');
            const htmlContext = localStorage.getItem('html_projection_result') || '';

            const result = await runForensicAudit(
                cuenta,
                pam,
                contrato,
                addLog,
                (usage) => setRealTimeUsage(usage),
                (prog) => setProgress(prog),
                htmlContext
            );

            setAuditResult(result);
            setStatus('SUCCESS');

            // Store raw data for table builders
            (result as any)._rawCuenta = cuenta;
            (result as any)._rawPam = pam;
        } catch (err: any) {
            setError(err.message || 'Error durante la auditoría forense.');
            setStatus('ERROR');
        } finally {
            isRunningRef.current = false;
        }
    };

    const clearAllData = () => {
        const confirmClear = window.confirm(
            '⚠️ ¿Deseas reiniciar TODA la sesión?\n\n' +
            'Aceptar: Borra TODOS los archivos y resultados.\n' +
            'Cancelar: Solo limpia la pantalla (mantiene archivos).'
        );

        if (confirmClear) {
            localStorage.removeItem('clinic_audit_result');
            localStorage.removeItem('pam_audit_result');
            localStorage.removeItem('contract_audit_result');
            localStorage.removeItem('html_projection_result');
            window.location.reload();
        } else {
            setStatus('IDLE');
            setAuditResult(null);
            setLogs([]);
            setRealTimeUsage(null);
            setProgress(0);
            setError(null);
            checkData();
            addLog('[SISTEMA] 🧹 Pantalla limpia. Datos de origen preservados.');
            setPreCheckResult(null);
        }
    };

    const performPreCheck = async () => {
        if (!hasBill || !hasPam || (!hasContract && !hasHtml)) return;
        if (isPreChecking || preCheckResult) return;

        setIsPreChecking(true);
        addLog('[SISTEMA] 🔍 Iniciando Pre-chequeo determinístico de V.A/VAM...');

        try {
            const pamString = localStorage.getItem('pam_audit_result');
            const contratoString = localStorage.getItem('contract_audit_result');

            if (!pamString || !contratoString) return;

            const pamJson = JSON.parse(pamString);
            const contratoJson = JSON.parse(contratoString);

            const response = await fetch('/api/audit/pre-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pamJson, contratoJson })
            });

            if (!response.ok) throw new Error('Pre-check failed');

            const data = await response.json();
            if (data.success) {
                setPreCheckResult(data);
                addLog(`[SISTEMA] ✅ Pre-chequeo completado. ${data.v_a_deducido.tipo}: $${data.v_a_deducido.valor.toLocaleString('es-CL')}`);
            }
        } catch (e) {
            console.error('[PRE-CHECK ERROR]', e);
            addLog('[SISTEMA] ⚠️ Error en pre-chequeo. Se intentará de nuevo o se usará fallback.');
        } finally {
            setIsPreChecking(false);
        }
    };

    useEffect(() => {
        if (hasBill && hasPam && (hasContract || hasHtml) && !preCheckResult && !isPreChecking && status === 'IDLE') {
            const timer = setTimeout(() => performPreCheck(), 1000);
            return () => clearTimeout(timer);
        }
    }, [hasBill, hasPam, hasContract, hasHtml, preCheckResult, isPreChecking, status]);

    const handlePreview = (type: 'BILL' | 'PAM' | 'CONTRACT' | 'HTML') => {
        try {
            let content = '';
            let title = '';

            switch (type) {
                case 'BILL':
                    content = localStorage.getItem('clinic_audit_result') || '';
                    title = 'Cuenta Clínica (JSON)';
                    break;
                case 'PAM':
                    content = localStorage.getItem('pam_audit_result') || '';
                    title = 'PAM (JSON)';
                    break;
                case 'CONTRACT':
                    content = localStorage.getItem('contract_audit_result') || '';
                    title = 'Contrato (JSON)';
                    break;
                case 'HTML':
                    const rawHtml = localStorage.getItem('html_projection_result') || '';
                    content = rawHtml.length > 50000
                        ? rawHtml.substring(0, 50000) + '... \n(Truncado por longitud)'
                        : rawHtml;
                    title = 'Proyección HTML (Módulo 5)';
                    break;
            }

            if (content) {
                setPreviewData({ title, content });
            }
        } catch (e) {
            console.error(e);
        }
    };

    const clearBill = () => {
        localStorage.removeItem('clinic_audit_result');
        setHasBill(false);
        addLog('[SISTEMA] 🗑️ Cuenta Clínica eliminada de caché.');
    };

    const clearPam = () => {
        localStorage.removeItem('pam_audit_result');
        setHasPam(false);
        addLog('[SISTEMA] 🗑️ PAM eliminado de caché.');
    };

    const clearContract = () => {
        localStorage.removeItem('contract_audit_result');
        setHasContract(false);
        addLog('[SISTEMA] 🗑️ Reglas de Contrato eliminadas de caché.');
    };

    const clearHtml = () => {
        localStorage.removeItem('html_projection_result');
        setHasHtml(false);
        addLog('[SISTEMA] 🗑️ Proyección HTML eliminada de caché.');
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 relative pb-32">
            {/* ... header ... */}
            <header className="bg-white/80 border-b border-slate-200 sticky top-16 z-[40] print:hidden backdrop-blur-sm shadow-sm transition-all duration-300">
                <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg">
                            <Gavel size={22} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 leading-none flex items-center gap-2">
                                AUDITORÍA FORENSE
                                <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 font-mono">{VERSION}</span>
                                <span className="text-xs text-slate-900 font-black ml-2 uppercase tracking-tight">Actualizado: {LAST_MODIFIED}</span>
                            </h1>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                                {AI_MODEL} <span className="w-1 h-1 rounded-full bg-slate-300 inline-block mx-1"></span> Cross-Validation Engine (v9)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {status === 'SUCCESS' && (
                            <>
                                <button onClick={() => downloadFormat(auditResult, 'json', 'audit_forense')} className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                                    <FileJson size={16} /> JSON
                                </button>
                                <button onClick={() => downloadFormat(auditResult, 'md', 'audit_forense')} className="flex items-center gap-2 px-3 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                                    <FileType size={16} /> MD
                                </button>
                                <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-black transition-all shadow-md">
                                    <Printer size={16} /> EXPORTAR REPORTE
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => {
                                if (!auditResult) return;
                                setAuditResult(null);
                                setStatus('IDLE');
                                setLogs([]);
                                setRealTimeUsage(null);
                                setProgress(0);
                                checkData();
                                addLog('[SISTEMA] 🔄 Resultado de auditoría limpiado. Listo para re-iterar.');
                            }}
                            disabled={!auditResult}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-colors mr-2 ${auditResult
                                ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200'
                                : 'bg-slate-100 text-slate-300 border border-slate-100 cursor-not-allowed'
                                }`}
                        >
                            <Eraser size={16} />
                            {auditResult ? 'LIMPIAR RESULTADO' : 'LIMPIAR'}
                        </button>
                        <button onClick={clearAllData} className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all" title="Borrar TODOS los datos">
                            <Trash2 size={24} />
                        </button>
                    </div>
                </div>
            </header>

            {/* BIG V.A/VAM BADGE - IN A CORNER */}
            {preCheckResult && (
                <div className="fixed top-32 right-10 z-[100] animate-in slide-in-from-right-10 duration-500">
                    <div className="bg-slate-900 border-2 border-indigo-400 text-white rounded-2xl shadow-2xl p-6 flex flex-col items-end min-w-[180px] hover:scale-105 transition-transform cursor-help group">
                        <div className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.2em] mb-1">
                            UNIDAD DE REFERENCIA (DEDUCIDA)
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black text-white italic">{preCheckResult.v_a_deducido.tipo}</span>
                            <span className="text-5xl font-black text-indigo-400">
                                ${(preCheckResult.v_a_deducido.valor || 0).toLocaleString('es-CL')}
                            </span>
                        </div>
                        <div className="mt-3 text-[10px] font-mono text-slate-400 max-w-[250px] text-right line-clamp-2 opacity-60 group-hover:opacity-100 transition-opacity">
                            {preCheckResult.v_a_deducido.evidencia?.[0] || 'Deducción matemática desde PAM + Contrato'}
                        </div>
                        {isPreChecking && (
                            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                                <Loader2 className="animate-spin text-white" />
                            </div>
                        )}
                    </div>
                </div>
            )}

            <main className="flex-grow max-w-[1800px] mx-auto w-full p-3 sm:p-6 lg:p-10">
                {status === 'IDLE' && (
                    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in zoom-in-95 duration-500">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 sm:gap-6 print:hidden">
                            <DataStatusCard title="Cuenta Clínica" icon={<FileText size={20} className="sm:w-6 sm:h-6" />} ready={hasBill} desc="Detalle de gastos" onDelete={clearBill} />
                            <DataStatusCard title="PAM (Isapre)" icon={<ShieldCheck size={20} className="sm:w-6 sm:h-6" />} ready={hasPam} desc="Bonificaciones" onDelete={clearPam} />
                            <DataStatusCard title="Reglas Contrato" icon={<Scale size={20} className="sm:w-6 sm:h-6" />} ready={hasContract} desc="(Legacy) Coberturas" onDelete={clearContract} />
                            <DataStatusCard title="Proyección HTML" icon={<Zap size={20} className="sm:w-6 sm:h-6" />} ready={hasHtml} desc="Contexto Módulo 5" onClick={() => handlePreview('HTML')} onDelete={clearHtml} />
                        </div>

                        <div className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xl shadow-slate-200/50 text-center space-y-6">
                            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-900 mx-auto border border-slate-200 shadow-inner">
                                <Search size={28} className="sm:w-9 sm:h-9" />
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm sm:text-base text-slate-500 max-w-xl mx-auto">
                                    Esta herramienta realiza una validación triple para detectar fraudes,
                                    desagregación indebida de insumos y violaciones al principio de evento único.
                                </p>
                                {!hasPam || !hasBill || (!hasContract && !hasHtml) ? (
                                    <div className="p-4 sm:p-6 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 sm:gap-4 text-left max-w-2xl mx-auto">
                                        <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                                        <div>
                                            <p className="text-sm font-bold text-amber-900">Documentación Insuficiente</p>
                                            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                                                Requisitos para auditar: PAM, Cuenta Clínica y Validación (Contrato o HTML).
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <button onClick={handleExecuteAudit} className="w-full sm:w-auto px-6 sm:px-10 py-4 sm:py-5 bg-slate-900 text-white rounded-2xl font-black text-base sm:text-lg hover:bg-black transition-all hover:scale-105 active:scale-95 shadow-2xl flex items-center justify-center gap-3 mx-auto">
                                        <Gavel size={20} className="sm:w-6 sm:h-6" /> EJECUTAR ANÁLISIS FORENSE
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {status === 'PROCESSING' && (
                    <div className="max-w-[1800px] mx-auto py-2 sm:py-6 animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col lg:flex-row gap-4 sm:gap-6">
                        {/* LEFT COLUMN: LOGS (Responsive) */}
                        <div className="w-full lg:w-[70%] bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden h-[400px] sm:h-[500px] lg:h-[600px] flex flex-col relative order-2 lg:order-1 print:hidden">
                            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Terminal size={14} className="text-slate-400" />
                                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-500">Forensic Engine Logs</span>
                                </div>
                            </div>
                            <div className="p-4 sm:p-6 h-full overflow-y-auto font-mono text-[10px] sm:text-xs space-y-2 pb-20 bg-white">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-2 sm:gap-4 items-start py-1">
                                        <span className="opacity-40 w-16 sm:w-24 shrink-0 text-slate-400 font-bold text-[9px] sm:text-[10px]">{log.match(/\[(.*?)\]/)?.[1] || ""}</span>
                                        <span className="text-slate-600 break-words">{log.replace(/^\[.*?\]/, '').trim()}</span>
                                    </div>
                                ))}
                                <div ref={logEndRef} />
                            </div>
                        </div>

                        {/* RIGHT COLUMN: CHAT (Responsive) */}
                        <div className="w-full lg:w-[30%] order-1 lg:order-2 print:hidden">
                            <InterrogationZone auditResult={auditResult} compactMode={false} responsiveHeight={true} />
                        </div>

                        {/* FOOTER METRICS (Fixed at bottom) */}
                        <div className="fixed bottom-0 left-0 w-full bg-slate-950 text-white z-[200] border-t border-slate-800 h-16 sm:h-20 flex items-center justify-between px-4 sm:px-8 shadow-2xl print:hidden">
                            <div className="flex gap-4 sm:gap-8 overflow-x-auto no-scrollbar">
                                <div><p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-black">Time</p><p className="font-mono text-sm sm:text-xl font-black">T+{formatTime(seconds)}</p></div>
                                <div><p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-black">Payload</p><p className="font-mono text-sm sm:text-xl font-black text-slate-300">{realTimeUsage ? (realTimeUsage.totalTokens / 1000).toFixed(1) + 'k' : '0.0k'}</p></div>
                                <div><p className="text-[8px] sm:text-[9px] text-slate-500 uppercase font-black">Est. Cost</p><p className="font-mono text-sm sm:text-xl font-black text-emerald-400">${realTimeUsage ? realTimeUsage.estimatedCostCLP : '0'} <span className="hidden sm:inline">CLP</span></p></div>
                            </div>
                            <button onClick={() => window.location.reload()} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-rose-950/50 flex items-center justify-center text-rose-500 hover:bg-rose-600 hover:text-white transition-all"><X size={16} className="sm:w-[18px]" /></button>
                        </div>
                    </div>
                )}

                {status === 'SUCCESS' && auditResult && (
                    <div className="max-w-[1800px] mx-auto animate-in fade-in slide-in-from-bottom-6 duration-700">
                        <div className="flex flex-col xl:flex-row gap-6 sm:gap-8 items-start">
                            {/* LEFT COLUMN: AUDIT RESULTS (Responsive) */}
                            <div className="w-full xl:w-[70%] space-y-6 sm:space-y-10 order-2 xl:order-1 print:w-full">
                                <div id="audit-report-content" className="bg-white p-5 sm:p-10 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-6 sm:space-y-10 print:shadow-none print:border-none print:p-0">
                                    <div className="flex flex-col gap-6 border-b border-slate-100 pb-6 sm:pb-10">
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-3 sm:space-y-4 max-w-2xl">
                                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase w-fit">
                                                    <CheckCircle2 size={12} /> Análisis Forense Completado
                                                </div>
                                                <h2 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tighter leading-tight">Resultados de la Auditoría</h2>
                                                <p className="text-sm sm:text-base text-slate-600 font-medium leading-relaxed">{auditResult.resumenEjecutivo}</p>
                                            </div>
                                            <button
                                                id="btn-download-pdf"
                                                onClick={handleDownloadPDF}
                                                className="shrink-0 p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-lg flex items-center gap-2 text-xs font-bold uppercase tracking-wider print:hidden"
                                                title="Descargar Reporte Completo en PDF"
                                            >
                                                <Download size={16} /> <span className="hidden sm:inline">DESCARGAR PDF</span>
                                            </button>
                                            <button
                                                onClick={() => window.print()}
                                                className="shrink-0 p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-lg flex items-center gap-2 text-xs font-bold uppercase tracking-wider print:hidden"
                                                title="Imprimir (Nativo del Navegador)"
                                            >
                                                <Printer size={16} /> <span className="hidden sm:inline">IMPRIMIR</span>
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-4 print:flex-nowrap">
                                            {/* CATEGORÍA A: AHORRO CONFIRMADO */}
                                            <div className="bg-slate-900 p-5 sm:p-6 rounded-2xl text-white min-w-[220px] border border-emerald-900/50 shadow-lg relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                                    <ShieldCheck size={40} className="text-emerald-500" />
                                                </div>
                                                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1 flex items-center gap-2">
                                                    <ShieldCheck size={12} /> Ahorro Confirmado (Cat A)
                                                </p>
                                                <div className="text-2xl sm:text-3xl font-black text-emerald-400">
                                                    ${(auditResult.resumenFinanciero?.ahorro_confirmado || 0).toLocaleString('es-CL')}
                                                </div>
                                                <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Cobros Improcedentes Exigibles</p>
                                            </div>

                                            {/* CATEGORÍA B: COPAGO BAJO CONTROVERSIA */}
                                            <div className="bg-slate-900 p-5 sm:p-6 rounded-2xl text-white min-w-[220px] border border-amber-900/50 shadow-lg relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                                    <AlertCircle size={40} className="text-amber-500" />
                                                </div>
                                                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1 flex items-center gap-2">
                                                    <AlertCircle size={12} /> En Controversia (Cat B)
                                                </p>
                                                <div className="text-2xl sm:text-3xl font-black text-amber-400">
                                                    ${(auditResult.resumenFinanciero?.copagos_bajo_controversia || 0).toLocaleString('es-CL')}
                                                </div>
                                                <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Indeterminado por Opacidad</p>
                                            </div>

                                            {/* CATEGORÍA Z: INDETERMINADO TÉCNICO */}
                                            <div className="bg-slate-100 p-5 sm:p-6 rounded-2xl text-slate-700 min-w-[220px] border border-slate-200 shadow-sm relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                                    <FileJson size={40} className="text-slate-400" />
                                                </div>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                                                    <FileType size={12} /> Indeterminado (Cat Z)
                                                </p>
                                                <div className="text-2xl sm:text-3xl font-black text-slate-600">
                                                    ${(auditResult.resumenFinanciero?.monto_indeterminado || 0).toLocaleString('es-CL')}
                                                </div>
                                                <p className="text-[8px] text-slate-400 mt-1 uppercase font-bold tracking-tighter">Gap Técnico / No Verificable</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 1. NARRATIVA DEL INFORME FORMAL (Moved to Top) */}
                                    <div className="border-b border-slate-100 pb-10">
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                                            <FileText size={16} className="text-slate-900" /> Informe de Auditoría Forense
                                        </h3>
                                        <div className="prose prose-slate max-w-none prose-sm sm:prose-base">
                                            <MarkdownRenderer content={auditResult.auditoriaFinalMarkdown} />
                                        </div>
                                    </div>

                                    {/* 2. BITÁCORA DE ANÁLISIS TÉCNICO (Evidencia de Respaldo) */}
                                    {(auditResult.bitacoraAnalisis?.length > 0 || auditResult.bitacoraCompleta) && (
                                        <div className="space-y-4 sm:space-y-6">
                                            <h3 className="text-xs sm:text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                <BrainCircuit size={16} className="text-indigo-600" /> Bitácora Técnica de Respaldo
                                            </h3>
                                            <div className="bg-slate-50 border border-slate-200 rounded-2xl sm:rounded-3xl overflow-hidden overflow-x-auto">
                                                <table className="w-full text-left min-w-[600px]">
                                                    <thead className="bg-slate-100 border-b border-slate-200">
                                                        <tr>
                                                            <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] font-black text-slate-500 uppercase w-1/4">Paso</th>
                                                            <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] font-black text-slate-500 uppercase w-1/2">Razonamiento</th>
                                                            <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] font-black text-slate-500 uppercase">Evidencia</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200">
                                                        {(auditResult.bitacoraAnalisis || []).map((item: any, idx: number) => (
                                                            <tr key={idx} className="hover:bg-white transition-colors">
                                                                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-bold text-slate-700">{idx + 1}. {item.paso}</td>
                                                                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs text-slate-600 font-mono">{item.razonamiento}</td>
                                                                <td className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] font-bold text-slate-400 uppercase">{item.evidencia}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {/* 3. DETALLE DE HALLAZGOS (Anexo Técnico) */}
                                    <div className="space-y-4 sm:space-y-6">
                                        <h3 className="text-xs sm:text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                            <ChevronRight size={16} className="text-slate-900" /> Detalle de Hallazgos Individuales ({(auditResult.hallazgos || []).length})
                                        </h3>
                                        <div className="grid grid-cols-1 gap-4">
                                            {(auditResult.hallazgos || []).map((hallazgo: any, idx: number) => (
                                                <div key={idx} className="p-4 sm:p-6 bg-white rounded-2xl border border-slate-200 hover:border-slate-400 transition-all shadow-sm">
                                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                                                {/* BADGE LOGIC UPDATED FOR 3-STATE SYSTEM */}
                                                                <span className={`px-2 py-1 rounded text-[8px] font-black uppercase tracking-tighter ${hallazgo.categoria_final === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                    hallazgo.categoria_final === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                        hallazgo.categoria_final === 'Z' ? 'bg-slate-100 text-slate-600' :
                                                                            // Fallback for legacy
                                                                            hallazgo.tipo_monto === 'COBRO_IMPROCEDENTE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                                                    }`}>
                                                                    {hallazgo.categoria_final === 'A' ? 'Exigible (Cat A)' :
                                                                        hallazgo.categoria_final === 'B' ? 'Controversia (Cat B)' :
                                                                            hallazgo.categoria_final === 'Z' ? 'Indeterminado (Cat Z)' :
                                                                                // Fallback
                                                                                hallazgo.tipo_monto === 'COBRO_IMPROCEDENTE' ? 'Exigible (Cat A)' : 'Controversia (Cat B)'}
                                                                </span>
                                                                <span className="px-2 py-1 bg-slate-900 text-white rounded text-[10px] font-mono">{hallazgo.codigos}</span>
                                                            </div>
                                                            <h4 className="font-bold text-slate-900 text-sm sm:text-base">{hallazgo.glosa}</h4>
                                                        </div>
                                                        <div className={`font-black text-base sm:text-lg ${hallazgo.tipo_monto === 'COBRO_IMPROCEDENTE' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                            -${(hallazgo.montoObjetado || 0).toLocaleString()}
                                                        </div>
                                                    </div>
                                                    <MarkdownRenderer content={hallazgo.hallazgo} />
                                                    <div className="flex flex-wrap gap-2 sm:gap-4 text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase mt-2">
                                                        <span className="flex items-center gap-1"><Scale size={10} className="sm:w-3 sm:h-3" /> {hallazgo.normaFundamento}</span>
                                                        <span className="flex items-center gap-1"><Search size={10} className="sm:w-3 sm:h-3" /> {hallazgo.anclajeJson}</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {(!auditResult.hallazgos || auditResult.hallazgos.length === 0) && (
                                                <div className="p-6 sm:p-8 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                                                    <CheckCircle2 size={32} className="mx-auto mb-2 opacity-50" />
                                                    <p>No se encontraron hallazgos negativos.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* 4. TABLAS DETERMINISTAS (3 NIVELES) */}
                                    <div className="border-t border-slate-100 pt-10">
                                        <h3 className="text-xs sm:text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-900"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>
                                            Tablas de Auditoría (3 Niveles Deterministas)
                                        </h3>
                                        <AuditTablesSection
                                            audit={auditResult}
                                            pam={(auditResult as any)._rawPam || null}
                                            cuenta={(auditResult as any)._rawCuenta || null}
                                        />
                                    </div>

                                    <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 pt-4 print:hidden">
                                        <button onClick={() => window.print()} className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-slate-900 text-white rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-black transition-all shadow-lg active:scale-95 text-xs sm:text-sm"><Printer size={18} /> IMPRIMIR</button>
                                        <button onClick={() => downloadFormat(auditResult, 'json', 'audit_forense')} className="w-full sm:w-auto px-6 sm:px-6 py-3 sm:py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center justify-center gap-2 text-xs sm:text-sm">JSON</button>
                                        <button onClick={() => downloadFormat(auditResult, 'md', 'audit_forense')} className="w-full sm:w-auto px-6 sm:px-6 py-3 sm:py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black flex items-center justify-center gap-2 text-xs sm:text-sm">MD</button>
                                    </div>
                                </div>
                            </div>

                            {/* RIGHT COLUMN: CHAT (Responsive - Sticky only on Desktop) */}
                            <div id="chat-container" className="w-full xl:w-[30%] xl:sticky xl:top-24 h-fit order-1 xl:order-2">
                                <InterrogationZone auditResult={auditResult} compactMode={true} responsiveHeight={true} />
                            </div>
                        </div>
                    </div>
                )}

                {status === 'ERROR' && <div className="max-w-md mx-auto py-20 text-center px-4"><AlertCircle size={48} className="text-rose-500 mx-auto mb-6 sm:w-16 sm:h-16" /><h3 className="text-xl sm:text-2xl font-black text-slate-900 mb-2">Error en Auditoría</h3><p className="text-sm sm:text-base text-slate-500 mb-8">{error}</p><button onClick={() => setStatus('IDLE')} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold">VOLVER A INTENTAR</button></div>}


                {previewData && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm sm:text-base"><Search size={18} /> {previewData.title}</h3>
                                <button onClick={() => setPreviewData(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><X size={20} className="text-slate-500" /></button>
                            </div>
                            <div className="p-4 sm:p-6 overflow-auto bg-slate-50 font-mono text-xs text-slate-600 whitespace-pre-wrap">{previewData.content}</div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function DataStatusCard({ title, icon, ready, desc, onClick, onDelete }: { title: string, icon: React.ReactNode, ready: boolean, desc: string, onClick?: () => void, onDelete?: () => void }) {
    return (
        <div
            onClick={ready && onClick ? onClick : undefined}
            className={`p-4 sm:p-6 rounded-2xl border transition-all duration-300 relative group overflow-hidden ${ready
                ? 'bg-white border-emerald-200 shadow-sm hover:shadow-md hover:border-emerald-300'
                : 'bg-slate-50 border-slate-200 opacity-80'
                }`}
        >
            {/* CACHE INDICATOR (PIN) */}
            {ready && (
                <div className="absolute top-0 right-0 p-2">
                    <div className="bg-emerald-100 text-emerald-600 p-1 rounded-bl-lg rounded-tr-lg shadow-sm">
                        <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-tight">EN CACHÉ</span>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-3 sm:mb-4 mt-1 sm:mt-2">
                <div className={`p-2 sm:p-3 rounded-xl transition-colors ${ready ? 'bg-slate-900 text-white shadow-lg shadow-slate-200' : 'bg-slate-200 text-slate-400'}`}>
                    {icon}
                </div>

                {ready && onDelete && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`¿Seguro que deseas eliminar ${title} de la memoria?`)) {
                                onDelete();
                            }
                        }}
                        className="p-1.5 sm:p-2 bg-white text-slate-300 hover:bg-rose-50 hover:text-rose-600 rounded-lg border border-transparent hover:border-rose-100 transition-all z-10"
                        title="Borrar de memoria"
                    >
                        <Trash2 size={16} className="sm:w-[18px]" />
                    </button>
                )}
            </div>

            <h4 className={`font-bold mb-0.5 sm:mb-1 transition-colors text-sm sm:text-base ${ready ? 'text-slate-900' : 'text-slate-400'}`}>{title}</h4>
            <p className="text-[9px] sm:text-[10px] text-slate-500 font-bold uppercase tracking-tight">{desc}</p>
        </div>
    );
}

function InterrogationZone({ auditResult, compactMode = false, responsiveHeight = false }: { auditResult?: any, compactMode?: boolean, responsiveHeight?: boolean }) {
    const [question, setQuestion] = useState('');
    const [history, setHistory] = useState<{ question: string; answer: string; images?: string[] }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentStreamingAnswer, setCurrentStreamingAnswer] = useState('');
    const [images, setImages] = useState<string[]>([]); // Base64 images
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [history, currentStreamingAnswer, images]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [question]);

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                if (blob) {
                    processFile(blob);
                }
            }
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    };

    const processFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (e.target?.result) {
                setImages(prev => [...prev, e.target!.result as string]);
            }
        };
        reader.readAsDataURL(file);
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleAsk = async () => {
        if ((!question.trim() && images.length === 0) || isLoading) return;

        const currentQuestion = question;
        const currentImages = [...images];

        setQuestion('');
        setImages([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto'; // Reset height

        setIsLoading(true);
        setCurrentStreamingAnswer('');

        try {
            const response = await fetch('/api/audit/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: currentQuestion,
                    images: currentImages,
                    context: {
                        htmlContext: localStorage.getItem('html_projection_result') || '',
                        billJson: JSON.parse(localStorage.getItem('clinic_audit_result') || '{}'),
                        pamJson: JSON.parse(localStorage.getItem('pam_audit_result') || '{}'),
                        contractJson: JSON.parse(localStorage.getItem('contract_audit_result') || '{}'),
                        auditResult
                    }
                })
            });
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = '';
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    accumulatedText += decoder.decode(value);
                    setCurrentStreamingAnswer(accumulatedText);
                }
            }
            setHistory(prev => [...prev, { question: currentQuestion, answer: accumulatedText, images: currentImages }]);
            setCurrentStreamingAnswer('');
        } catch (err: any) {
            setHistory(prev => [...prev, { question: currentQuestion, answer: `Error: ${err.message}`, images: currentImages }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={`bg-white rounded-2xl shadow-xl border border-slate-200 flex flex-col overflow-hidden transition-all duration-300 ${compactMode
            ? `${responsiveHeight ? 'h-[500px] xl:h-[calc(100vh-8rem)]' : 'h-[calc(100vh-8rem)]'} sticky top-24`
            : `${responsiveHeight ? 'h-[450px] sm:h-[500px] lg:h-[600px]' : 'h-[600px]'}`
            }`}>
            <div className={`px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center ${isLoading ? 'animate-pulse' : ''}`}>
                <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-indigo-500" />
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-500">
                        {isLoading ? 'Analizando...' : 'Asistente Forense'}
                    </span>
                </div>
                {history.length > 0 && (
                    <button onClick={() => setHistory([])} className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors" title="Borrar historial">
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            <div ref={scrollRef} className="flex-grow overflow-y-auto p-4 space-y-4 bg-slate-50/30 scroll-smooth">
                {history.length === 0 && !currentStreamingAnswer && (
                    <div className="flex flex-col items-center justify-center h-full text-center opacity-40 p-6">
                        <BrainCircuit size={32} className="mb-3 text-slate-300" />
                        <p className="text-xs text-slate-400 font-medium">
                            {auditResult ? "Pregunta sobre los hallazgos encontrados..." : "El asistente está listo para analizar evidencias..."}
                        </p>
                    </div>
                )}

                {history.map((item, idx) => (
                    <div key={idx} className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex justify-end">
                            <div className="bg-white border border-slate-200 text-slate-700 px-4 py-3 rounded-2xl rounded-tr-none shadow-sm max-w-[90%] text-sm">
                                <p>{item.question}</p>
                                {item.images && item.images.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {item.images.map((img, i) => (
                                            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                                                <img src={img} alt="Uploaded" className="object-cover w-full h-full" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-start">
                            <div className="bg-slate-50 border border-slate-200 text-slate-800 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm max-w-[95%] text-sm">
                                <MarkdownRenderer content={item.answer} />
                            </div>
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="space-y-2">
                        <div className="flex justify-start">
                            <div className="bg-white border border-slate-200 text-slate-700 px-5 py-3.5 rounded-2xl rounded-tl-sm max-w-[90%] text-xs shadow-sm whitespace-pre-wrap">
                                {currentStreamingAnswer || (
                                    <div className="flex items-center gap-2 text-indigo-600 font-bold">
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>Analizando evidencia...</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* INPUT AREA */}
            <div className={`shrink-0 ${compactMode ? 'p-4 border-t border-slate-100 bg-white rounded-b-3xl' : 'pt-2'}`}>
                {/* Image Previews */}
                {images.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-3 mb-2 px-1">
                        {images.map((img, idx) => (
                            <div key={idx} className="relative group shrink-0">
                                <img src={img} className="w-16 h-16 object-cover rounded-lg border border-slate-200 shadow-sm" />
                                <button onClick={() => removeImage(idx)} className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full p-0.5 shadow-md hover:scale-110 transition-transform">
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-400 transition-all shadow-inner">
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={handleFileSelect}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors shrink-0 tooltip"
                        title="Adjuntar imagen"
                    >
                        <ImageIcon size={20} />
                    </button>

                    <textarea
                        ref={textareaRef}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleAsk();
                            }
                        }}
                        placeholder="Escribe o pega texto/imágenes..."
                        className="flex-1 bg-transparent border-none outline-none text-sm text-slate-800 placeholder-slate-400 resize-none max-h-32 py-2"
                        rows={1}
                        style={{ minHeight: '40px' }}
                    />

                    <button
                        onClick={handleAsk}
                        disabled={isLoading || (!question.trim() && images.length === 0)}
                        className={`p-2 rounded-xl transition-all shadow-sm shrink-0 ${isLoading || (!question.trim() && images.length === 0) ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 active:scale-95'}`}
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                </div>
                <div className="text-[9px] text-slate-400 text-center mt-2 font-medium">
                    Presiona Enter para enviar • Shift+Enter para salto de línea • Ctrl+V para pegar
                </div>
            </div>
        </div>
    );
}

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function MarkdownRenderer({ content }: { content: string }) {
    if (!content) return null;

    // --- PRE-PROCESSING TO CLEAN AI ARTIFACTS ---
    let processedContent = content;
    // Remove AI pagination artifacts (e.g. "...851", "...852", "...")
    processedContent = processedContent.replace(/^\s*\.{3,}\d*\s*$/gm, '');

    return (
        <div className="prose prose-slate max-w-none prose-sm sm:prose-base forensic-markdown">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h1: ({ node, ...props }) => <h1 className="text-2xl font-black text-slate-900 mt-8 mb-4 tracking-tighter" {...props} />,
                    h2: ({ node, ...props }) => <h2 className="text-xl font-black text-slate-900 mt-7 mb-3 tracking-tighter" {...props} />,
                    h3: ({ node, ...props }) => <h3 className="text-lg font-black text-slate-900 mt-6 mb-2 tracking-tighter" {...props} />,
                    h4: ({ node, ...props }) => <h4 className="text-base font-black text-slate-900 mt-5 mb-2 uppercase tracking-tight" {...props} />,
                    h5: ({ node, ...props }) => (
                        <h5 className="font-black text-slate-900 mt-6 mb-3 text-[11px] uppercase tracking-widest border-l-4 border-slate-900 pl-3" {...props} />
                    ),
                    p: ({ node, ...props }) => <p className="text-sm text-slate-600 mb-3 leading-relaxed px-1" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-none space-y-2 mb-4 ml-2" {...props} />,
                    li: ({ node, ...props }) => (
                        <li className="flex gap-2 text-sm text-slate-600">
                            <span className="text-emerald-500 font-bold shrink-0">•</span>
                            <span className="leading-relaxed" {...props} />
                        </li>
                    ),
                    strong: ({ node, ...props }) => <strong className="font-black text-slate-900" {...props} />,
                    table: ({ node, ...props }) => (
                        <div className="my-4 overflow-x-auto rounded-xl border border-slate-200 shadow-sm transition-all duration-300">
                            <table className="min-w-[500px] w-full text-sm text-left border-collapse border-hidden" {...props} />
                        </div>
                    ),
                    thead: ({ node, ...props }) => <thead className="bg-slate-50 text-slate-900 border-b border-slate-200" {...props} />,
                    th: ({ node, ...props }) => (
                        <th className="px-4 py-3 font-black text-[10px] uppercase tracking-wider bg-slate-100/50 whitespace-normal text-slate-700" {...props} />
                    ),
                    tbody: ({ node, ...props }) => <tbody className="divide-y divide-slate-100 bg-white" {...props} />,
                    tr: ({ node, ...props }) => <tr className="hover:bg-indigo-50/30 transition-colors" {...props} />,
                    td: ({ node, ...props }) => (
                        <td className="px-4 py-2.5 border-r border-slate-50 last:border-r-0 font-mono text-[11px] text-slate-700 whitespace-pre-wrap align-top" {...props} />
                    ),
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-slate-200 pl-4 py-1 italic text-slate-500 mb-4" {...props} />
                    ),
                    hr: ({ node, ...props }) => <hr className="my-8 border-slate-100" {...props} />
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
}
