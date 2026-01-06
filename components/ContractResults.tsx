import React, { useState, useRef } from 'react';
import { Search, Info, AlertTriangle, ShieldCheck, Scale, Download, Printer, Loader2, FileText } from 'lucide-react';
import { Contract, UsageMetrics } from '../types';

interface Props {
    data: Contract;
}

const TokenStatsBadge: React.FC<{ metadata?: any }> = ({ metadata }) => {
    // ... (keep existing TokenStatsBadge)
    if (!metadata) return null;

    // Normalizar métricas del motor v2.0
    const promptTokens = metadata.promptTokens ?? metadata.promptTokenCount ?? metadata.input ?? 0;
    const candidatesTokens = metadata.candidatesTokens ?? metadata.candidatesTokenCount ?? metadata.output ?? 0;
    const costClp = metadata.estimatedCostCLP ?? metadata.costClp ?? 0;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-4 p-2 bg-slate-50 rounded border border-slate-200">
                <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-400 uppercase">Input Tokens</span>
                    <span className="text-xs font-mono font-bold text-slate-600">{(promptTokens / 1000).toFixed(1)}k</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-400 uppercase">Output Tokens</span>
                    <span className="text-xs font-mono font-bold text-slate-600">{(candidatesTokens / 1000).toFixed(1)}k</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-400 uppercase">Costo Est.</span>
                    <span className="text-xs font-mono font-bold text-emerald-600">${Math.round(costClp)} CLP</span>
                </div>
            </div>

            {metadata.phases && Array.isArray(metadata.phases) && metadata.phases.length > 0 && (
                <div className="flex flex-wrap gap-2 max-w-md">
                    {metadata.phases.map((p: any, idx: number) => (
                        <div key={idx} className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 rounded text-[8px] font-bold text-indigo-600 uppercase flex items-center gap-1">
                            <span>{String(p.phase || '').replace(/_/g, ' ')}:</span>
                            <span className="font-mono">{((Number(p.totalTokens) || 0) / 1000).toFixed(1)}k</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const SmartValueBadge: React.FC<{ value: string }> = ({ value }) => {
    if (!value || value === '-' || value === 'N/A' || value === 'SIN TOPE') {
        return <span className="text-slate-300 font-bold">-</span>;
    }

    const cleanVal = value.toString();

    if (cleanVal.includes('$')) {
        return (
            <span className="inline-flex items-center px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-black tracking-tighter shadow-sm whitespace-nowrap">
                {cleanVal}
            </span>
        );
    }

    if (cleanVal.includes('UF')) {
        return (
            <span className="inline-flex items-center px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-black tracking-tighter shadow-sm whitespace-nowrap">
                {cleanVal}
            </span>
        );
    }

    if (cleanVal.includes('VAM') || cleanVal.includes('AC3')) {
        return (
            <span className="inline-flex items-center px-2 py-1 rounded bg-violet-50 text-violet-700 border border-violet-100 text-[10px] font-black tracking-tighter whitespace-nowrap">
                {cleanVal}
            </span>
        );
    }

    // Default / Porcentaje
    return (
        <span className="text-xs font-bold text-slate-700">
            {cleanVal}
        </span>
    );
};

export function ContractResults({ data }: Props) {
    const [activeTab, setActiveTab] = useState<'coberturas' | 'reglas'>('coberturas');
    const [searchTerm, setSearchTerm] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    // Extraer métricas si vienen con otro nombre del motor v2.0
    const displayUsage = data?.usage || (data as any)?.metrics?.tokenUsage || (data as any)?.usageMetadata;

    // Conteo para los badges de las pestañas
    const totalCoberturas = data?.coberturas?.length || 0;
    const totalReglas = data?.reglas?.length || 0;

    const handleDownloadJson = () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `auditoria_contrato_${data?.diseno_ux?.nombre_isapre || 'isapre'}_${new Date().getTime()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownloadPdf = async () => {
        if (!reportRef.current || !data) return;
        setIsExporting(true);

        try {
        } catch (err) {
            console.error('PDF Error:', err);
            alert('Error al generar PDF. Por favor reintente.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleDownloadMarkdown = () => {
        if (!data) return;

        const { diseno_ux, coberturas, reglas } = data;
        let md = `# Auditoría Contractual: ${diseno_ux?.nombre_isapre || 'Isapre Desconocida'}\n`;
        md += `## Plan: ${diseno_ux?.titulo_plan || 'Sin Título'}\n`;
        if (diseno_ux?.subtitulo_plan) md += `### Subtítulo: ${diseno_ux.subtitulo_plan}\n`;
        md += `**Fecha de Generación:** ${new Date().toLocaleString()}\n\n`;

        md += `## 1. Coberturas Detectadas\n\n`;

        // Agrupar por categoría
        const grouped = (coberturas || []).reduce((acc: any, curr: any) => {
            const cat = curr.categoria || 'SIN CATEGORÍA';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(curr);
            return acc;
        }, {});

        Object.keys(grouped).forEach(cat => {
            md += `### ${cat}\n\n`;
            md += `| Prestación | Modalidad | Cobertura | Tope | Copago | Notas |\n`;
            md += `|---|---|---|---|---|---|\n`;
            grouped[cat].forEach((c: any) => {
                const item = c.item || '-';
                const mod = c.modalidad || '-';
                const cob = c.cobertura || '-';
                const tope = c.tope || '-';
                const copago = c.copago || '-';
                const notas = c.nota_restriccion || '';
                md += `| ${item} | ${mod} | ${cob} | ${tope} | ${copago} | ${notas} |\n`;
            });
            md += `\n`;
        });

        md += `## 2. Reglas y Notas Explicativas\n\n`;
        (reglas || []).forEach((r: any, idx: number) => {
            md += `**${idx + 1}. Sección ${r['CÓDIGO/SECCIÓN'] || ''} (Pág ${r['PÁGINA ORIGEN'] || ''})**\n`;
            md += `> ${r['VALOR EXTRACTO LITERAL DETALLADO'] || ''}\n`;
            if (r['LOGICA_DE_CALCULO']) md += `- *Lógica:* ${r['LOGICA_DE_CALCULO']}\n`;
            md += `\n`;
        });

        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Auditoria_${diseno_ux?.nombre_isapre || 'Isapre'}_${new Date().getTime()}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Helper ultra-resiliente...
    const getFuzzy = (target: any, keys: string[]) => {
        // ... (existing getFuzzy)
        if (!target) return '';
        for (const k of keys) {
            // Intento búsqueda exacta
            if (target[k] !== undefined && target[k] !== null && target[k] !== '') return target[k];

            // Intento búsqueda insensible a mayúsculas y acentos
            const normalizedK = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
            const foundKey = Object.keys(target).find(tk => {
                const normalizedTK = tk.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
                return normalizedTK === normalizedK;
            });

            if (foundKey && target[foundKey] !== undefined && target[foundKey] !== null && target[foundKey] !== '') {
                return target[foundKey];
            }
        }
        return '-';
    };

    const safeCoberturas = Array.isArray(data?.coberturas) ? data.coberturas : [];
    const filteredCoberturas = safeCoberturas.filter(c => {
        const prestacion = String(getFuzzy(c, ['item', 'prestacion', 'PRESTACIÓN CLAVE', 'PRESTACION CLAVE']) || '').toLowerCase();
        const restriccion = String(getFuzzy(c, ['nota_restriccion', 'restriccion', 'RESTRICCIÓN Y CONDICIONAMIENTO', 'RESTRICCION']) || '').toLowerCase();
        return prestacion.includes(searchTerm.toLowerCase()) || restriccion.includes(searchTerm.toLowerCase());
    });

    const safeReglas = data?.reglas || [];

    return (
        <div ref={reportRef} className="space-y-6 print:space-y-4 font-sans max-w-full overflow-hidden bg-white">
            {/* Header Limpio y Blanco */}
            <div className="bg-white border-2 border-dashed border-slate-300 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-100 bg-white">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] bg-blue-50 text-blue-600 font-black px-2 py-0.5 rounded border border-blue-100 uppercase tracking-widest">Módulo de Auditoría Contractual</span>
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter leading-none mb-1">
                            {data?.diseno_ux?.nombre_isapre || 'Cargando...'}
                        </h2>
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-tight">
                            {data?.diseno_ux?.titulo_plan} {data?.diseno_ux?.subtitulo_plan ? `| ${data.diseno_ux.subtitulo_plan}` : ''}
                        </p>

                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDownloadPdf}
                            disabled={isExporting}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                            Descargar PDF
                        </button>
                        <button
                            onClick={handleDownloadJson}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-md active:scale-95"
                        >
                            <Download size={14} />
                            Exportar JSON
                        </button>
                        <button
                            onClick={handleDownloadMarkdown}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-md active:scale-95"
                        >
                            <FileText size={14} />
                            Exportar MD
                        </button>
                        {(() => {
                            const ufRule = safeReglas.find(r =>
                                String(getFuzzy(r, ['categoria', 'SUBCATEGORÍA']) || '').includes('UF') ||
                                String(getFuzzy(r, ['seccion', 'CÓDIGO/SECCIÓN']) || '').includes('UF')
                            );
                            if (ufRule) {
                                const ufText = String(getFuzzy(ufRule, ['texto', 'VALOR EXTRACTO LITERAL DETALLADO']) || '');
                                const match = ufText.match(/\$[\d.]+/);
                                if (match) {
                                    return (
                                        <div className="flex items-center gap-2 px-3 py-1 bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-full shadow-sm">
                                            <Scale size={12} className="text-cyan-600" />
                                            <span className="text-[10px] font-black uppercase tracking-widest">
                                                UF Ref: {match[0]}
                                            </span>
                                        </div>
                                    )
                                }
                            }
                            return null;
                        })()}
                        {displayUsage && <TokenStatsBadge metadata={displayUsage} />}
                    </div>
                </div>
            </div>

            {/* Tabs Minimalistas */}
            <div className="flex bg-slate-50 border-b border-slate-100 print:hidden items-center">
                <button
                    onClick={() => setActiveTab('coberturas')}
                    className={`px-8 py-4 text-[10px] font-black uppercase tracking-widest transition-all border-r border-slate-100 flex items-center gap-2 ${activeTab === 'coberturas' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Malla de Cobertura
                    <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full text-[9px]">{totalCoberturas}</span>
                </button>
                <button
                    onClick={() => setActiveTab('reglas')}
                    className={`px-8 py-4 text-[10px] font-black uppercase tracking-widest transition-all border-r border-slate-100 flex items-center gap-2 ${activeTab === 'reglas' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    Extractos Literales
                    <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full text-[9px]">{totalReglas}</span>
                </button>
                <div className="flex-grow flex justify-end px-6">
                    <div className="relative w-64 group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                        <input
                            type="text"
                            placeholder="Filtrar por prestación o nota..."
                            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded text-xs font-medium outline-none focus:border-slate-400 transition-all shadow-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="p-0 bg-white min-h-[400px]">
                {/* SECCIÓN 1: MALLA DE COBERTURA */}
                <div className={`${activeTab === 'coberturas' ? 'block' : 'hidden print:block'} animate-in fade-in duration-300`}>
                    {/* Header Solo para Print */}
                    <div className="hidden print:block p-6 bg-slate-950 text-white">
                        <h3 className="text-xl font-black uppercase tracking-tighter">I. Malla de Cobertura Forense</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase">Extracto detallado de bonificaciones y topes según contrato vigente</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[1400px]">
                            <thead>
                                <tr className="bg-slate-950 text-xs text-white font-black uppercase tracking-tighter border-b border-black">
                                    <th className="px-4 py-5 border-r border-slate-800 w-[280px]">Prestación Clave</th>
                                    <th className="px-2 py-5 border-r border-slate-800 text-center w-24">Modalidad</th>
                                    <th className="px-2 py-5 border-r border-slate-800 text-center w-20">Bonif.</th>
                                    <th className="px-2 py-5 border-r border-slate-800 text-center w-20">Copago</th>
                                    <th className="px-2 py-5 border-r border-slate-800 text-center w-40">Tope Local 1</th>
                                    <th className="px-2 py-5 border-r border-slate-800 text-center w-28">Tope Local 2</th>
                                    <th className="px-6 py-5 min-w-[600px]">Restricciones y Notas (Evidencia Forense)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {filteredCoberturas.map((coverage, idx) => (
                                    <tr key={idx} className={`hover:bg-blue-50/20 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/10'}`}>
                                        <td className="px-4 py-5 border-r border-slate-100 align-top">
                                            <div className="font-black text-black text-xs uppercase leading-tight mb-1">
                                                {getFuzzy(coverage, ['item', 'prestacion', 'PRESTACIÓN CLAVE'])}
                                            </div>
                                            {(coverage as any).categoria_canonica && (coverage as any).categoria_canonica !== 'OTRO' && (
                                                <div className="inline-flex items-center gap-1 text-[9px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded shadow-sm">
                                                    <span>📍 {(coverage as any).categoria_canonica.replace(/_/g, ' ')}</span>
                                                </div>
                                            )}
                                            {getFuzzy(coverage, ['anclajes', 'ANCLAJES']) !== '-' && Array.isArray(getFuzzy(coverage, ['anclajes', 'ANCLAJES'])) && (
                                                <div className="flex flex-wrap gap-1">
                                                    {getFuzzy(coverage, ['anclajes', 'ANCLAJES']).map((a: string, i: number) => (
                                                        <span key={i} className="text-[10px] font-black text-slate-500 bg-slate-100 px-1 rounded">[{a}]</span>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-2 py-4 text-center align-top border-r border-slate-100">
                                            <span className="text-[11px] font-black text-slate-800 uppercase tracking-tighter">{getFuzzy(coverage, ['modalidad', 'MODALIDAD/RED'])}</span>
                                        </td>
                                        <td className="px-2 py-4 text-center align-top border-r border-slate-100">
                                            <span className="text-sm font-black text-black">{getFuzzy(coverage, ['cobertura', 'bonificacion', '% BONIFICACIÓN'])}</span>
                                        </td>
                                        <td className="px-2 py-4 text-center align-top border-r border-slate-100">
                                            <span className="text-[11px] font-black text-slate-700 tracking-tight">{getFuzzy(coverage, ['copago', 'COPAGO FIJO'])}</span>
                                        </td>
                                        <td className="px-2 py-4 text-center align-top border-r border-slate-100">
                                            <div className="text-[11px] font-black text-black bg-slate-100 py-1 px-1.5 rounded-md border border-slate-200 inline-block min-w-full">
                                                {getFuzzy(coverage, ['tope', 'tope_1', 'TOPE LOCAL 1 (VAM/EVENTO)'])}
                                            </div>
                                        </td>
                                        <td className="px-2 py-4 text-center align-top border-r border-slate-100">
                                            <div className="text-[11px] font-black text-slate-900 bg-slate-50 py-1 px-1.5 rounded-md border border-slate-200 inline-block min-w-full">
                                                {getFuzzy(coverage, ['tope_2', 'TOPE LOCAL 2 (ANUAL/UF)'])}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 align-top">
                                            <div className="text-xs text-slate-700 leading-relaxed font-medium whitespace-pre-wrap">
                                                {getFuzzy(coverage, ['nota_restriccion', 'restriccion', 'RESTRICCIÓN Y CONDICIONAMIENTO'])}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* SECCIÓN 2: EXTRACTOS LITERALES */}
                <div className={`${activeTab === 'reglas' ? 'block' : 'hidden print:block'} animate-in fade-in duration-300 ${activeTab !== 'reglas' ? 'print:mt-12' : ''}`}>
                    {/* Header Solo para Print */}
                    <div className="hidden print:block p-6 bg-slate-100 border-y border-slate-200">
                        <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">II. Extractos Literales Mandatorios</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase">Transcripción fiel de artículos y cláusulas relevantes</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-xs text-slate-500 font-black uppercase tracking-widest border-b border-slate-200">
                                    <th className="px-4 py-4 w-24">Página</th>
                                    <th className="px-4 py-4 w-56">Sección</th>
                                    <th className="px-4 py-4 w-40">Categoría</th>
                                    <th className="px-4 py-4">Extracto Literal Mandatorio</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-950">
                                {safeReglas.map((rule, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-4 font-mono text-xs text-slate-500 align-top">{getFuzzy(rule, ['pagina', 'PÁGINA ORIGEN'])}</td>
                                        <td className="px-4 py-4 font-black text-slate-950 text-sm align-top uppercase">{getFuzzy(rule, ['seccion', 'CÓDIGO/SECCIÓN'])}</td>
                                        <td className="px-4 py-4 text-slate-900 text-xs font-black uppercase align-top tracking-tighter">
                                            {getFuzzy(rule, ['categoria', 'SUBCATEGORÍA'])}
                                            {(rule as any).categoria_canonica && (rule as any).categoria_canonica !== 'OTRO' && (
                                                <div className="inline-flex items-center gap-1 text-[9px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded shadow-sm mt-1 animate-pulse">
                                                    <span>📍 {(rule as any).categoria_canonica.replace(/_/g, ' ')}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="text-[13px] text-black leading-relaxed font-sans bg-white p-4 rounded-lg border-2 border-slate-900 italic shadow-sm">
                                                "{getFuzzy(rule, ['texto', 'VALOR EXTRACTO LITERAL DETALLADO'])}"
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            {/* Footer de Auditoría */}
            <div className="pt-8 flex justify-between items-center text-[10px] font-black text-slate-400 uppercase tracking-widest border-t border-slate-200 print:hidden">
                <div className="flex items-center gap-6">
                    <span className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        Auditor {data?.diseno_ux?.layout || 'v2.0'}
                    </span>
                    <span>|</span>
                    <span>Generado: {new Date().toLocaleString()}</span>
                </div>
                <div className="flex gap-8">
                    <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-blue-500" /> Registro Legal</span>
                    <span className="flex items-center gap-1.5"><Scale size={14} className="text-slate-400" /> Sin Alteraciones</span>
                </div>
            </div>
        </div>
    );
}
