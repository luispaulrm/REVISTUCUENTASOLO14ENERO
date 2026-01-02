import React, { useState } from 'react';
import { ShieldCheck, FileText, Info, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Search, Scale, Receipt, Zap } from 'lucide-react';
import { Contract, ContractRegla, ContractCobertura } from '../types';

interface Props {
    data: Contract;
}

export function ContractResults({ data }: Props) {
    const [activeTab, setActiveTab] = useState<'coberturas' | 'reglas' | 'triangulacion'>('coberturas');
    const [searchTerm, setSearchTerm] = useState('');

    // Cargar datos de otros módulos para triangulación
    const billDataStr = localStorage.getItem('clinic_audit_result');
    const pamDataStr = localStorage.getItem('pam_audit_result');

    const billData = billDataStr ? JSON.parse(billDataStr) : null;
    const pamData = pamDataStr ? JSON.parse(pamDataStr) : null;

    const filteredCoberturas = data.coberturas.filter(c =>
        c.prestacion.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.restriccion_condicionamiento.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const renderTriangulacion = () => {
        if (!billData && !pamData) {
            return (
                <div className="bg-amber-50 border border-amber-200 rounded-3xl p-12 text-center">
                    <AlertTriangle className="mx-auto text-amber-500 mb-4" size={48} />
                    <h3 className="text-xl font-black text-amber-900 mb-2">Datos Insuficientes</h3>
                    <p className="text-amber-700 max-w-md mx-auto">
                        Para realizar una triangulación forense, debes haber procesado primero una **Cuenta Clínica** y un **PAM**.
                    </p>
                </div>
            );
        }

        return (
            <div className="space-y-8 animate-in fade-in duration-500">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Bill Summary */}
                    <div className={`p-6 rounded-3xl border-2 ${billData ? 'bg-white border-slate-900 shadow-xl' : 'bg-slate-50 border-dashed border-slate-200 opacity-60'}`}>
                        <div className="flex items-center gap-2 mb-4">
                            <Receipt size={18} className="text-slate-400" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Módulo Cuenta</span>
                        </div>
                        {billData ? (
                            <>
                                <div className="text-3xl font-black text-slate-900">${billData.clinicStatedTotal.toLocaleString()}</div>
                                <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Total Declarado Clínica</div>
                                <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-600">
                                    <CheckCircle2 size={14} /> Data Cargada
                                </div>
                            </>
                        ) : (
                            <div className="text-sm font-bold text-slate-400">Sin datos de cuenta</div>
                        )}
                    </div>

                    {/* PAM Summary */}
                    <div className={`p-6 rounded-3xl border-2 ${pamData ? 'bg-white border-slate-900 shadow-xl' : 'bg-slate-50 border-dashed border-slate-200 opacity-60'}`}>
                        <div className="flex items-center gap-2 mb-4">
                            <ShieldCheck size={18} className="text-slate-400" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Módulo PAM</span>
                        </div>
                        {pamData ? (
                            <>
                                <div className="text-3xl font-black text-slate-900">${pamData.global.totalValor.toLocaleString()}</div>
                                <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Total Valorizado Isapre</div>
                                <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-600">
                                    <CheckCircle2 size={14} /> Data Cargada
                                </div>
                            </>
                        ) : (
                            <div className="text-sm font-bold text-slate-400">Sin datos de PAM</div>
                        )}
                    </div>

                    {/* Contract Summary */}
                    <div className="p-6 rounded-3xl border-2 bg-indigo-600 border-indigo-700 shadow-xl text-white">
                        <div className="flex items-center gap-2 mb-4">
                            <Scale size={18} className="text-indigo-300" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Módulo Contrato</span>
                        </div>
                        <div className="text-3xl font-black">{data.diseno_ux.nombre_isapre}</div>
                        <div className="text-[10px] font-bold text-indigo-300 mt-1 uppercase">Plan: {data.diseno_ux.titulo_plan}</div>
                        <div className="mt-4 flex items-center gap-2 text-xs font-bold">
                            <Zap size={14} /> Mandato Activo
                        </div>
                    </div>
                </div>

                {/* Triangulation Logic */}
                {billData && pamData && (
                    <div className="bg-white border-2 border-slate-900 rounded-3xl overflow-hidden shadow-2xl">
                        <div className="bg-slate-900 p-6 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-slate-900">
                                    <Zap size={24} />
                                </div>
                                <div>
                                    <h3 className="text-white font-black text-xl leading-none">Hallazgos de Triangulación</h3>
                                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Comparativa Forense Bill vs PAM vs Contract</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-900 pb-2 border-b-2 border-slate-100">Discrepancias Financieras</h4>

                                    <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                                        <span className="text-xs font-bold text-slate-600">Diferencia Cuenta vs PAM</span>
                                        <span className={`text-sm font-black ${Math.abs(billData.clinicStatedTotal - pamData.global.totalValor) > 1000 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            ${(billData.clinicStatedTotal - pamData.global.totalValor).toLocaleString()}
                                        </span>
                                    </div>

                                    <p className="text-xs text-slate-500 leading-relaxed">
                                        Esta diferencia sugiere que existen items facturados por la clínica que no fueron valorizados (o bonificados) por la Isapre según el PAM procesado.
                                        Revisa la malla de cobertura del contrato para ver si estos items están bajo exclusión o tope regional.
                                    </p>
                                </div>

                                <div className="space-y-6">
                                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-900 pb-2 border-b-2 border-slate-100">Alertas de Contrato</h4>

                                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                                        <div className="flex items-start gap-3">
                                            <Info size={16} className="text-indigo-600 mt-0.5" />
                                            <div>
                                                <div className="text-[11px] font-black text-indigo-900 uppercase">Validación de Cobertura</div>
                                                <p className="text-[10px] text-indigo-700 mt-1 leading-relaxed">
                                                    El contrato indica un plan <strong>{data.diseno_ux.titulo_plan}</strong> de <strong>{data.diseno_ux.nombre_isapre}</strong>.
                                                    El PAM muestra una bonificación acumulada de ${(pamData.global.totalBonif).toLocaleString()}.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                                        <div className="flex items-start gap-3">
                                            <AlertTriangle size={16} className="text-amber-600 mt-0.5" />
                                            <div>
                                                <div className="text-[11px] font-black text-amber-900 uppercase">Puntos de Fuga por Malla</div>
                                                <p className="text-[10px] text-amber-700 mt-1 leading-relaxed">
                                                    Examine las cláusulas de "Malla Visual" en el contrato. Si el PAM muestra bonificaciones reducidas, verifique si la clínica del Bill es un prestador con restricción (ej: Clínica Las Condes 60%).
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-8 print:space-y-4">
            {/* Header Forense */}
            <div className="bg-white rounded-3xl p-8 shadow-xl border border-slate-200 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Scale size={120} />
                </div>

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className="bg-slate-900 text-white text-[10px] font-black px-2 py-1 rounded uppercase tracking-widest">Contrato / Plan de Salud</span>
                            <span className="bg-indigo-50 text-indigo-600 text-[10px] font-bold px-2 py-1 rounded border border-indigo-100 uppercase tracking-widest">Forensic Report v2</span>
                        </div>
                        <h2 className="text-4xl font-black text-slate-900 leading-tight">
                            {data.diseno_ux.nombre_isapre}
                        </h2>
                        <h3 className="text-xl font-bold text-slate-500 mt-1">
                            {data.diseno_ux.titulo_plan}
                        </h3>
                        {data.diseno_ux.subtitulo_plan && (
                            <p className="text-sm font-mono text-slate-400 mt-2 font-bold uppercase">
                                {data.diseno_ux.subtitulo_plan}
                            </p>
                        )}
                    </div>

                    <div className="flex gap-4">
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-center min-w-[140px]">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Prestaciones</span>
                            <span className="text-2xl font-black text-slate-900">{data.coberturas.length}</span>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-center min-w-[140px]">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Cláusulas/Notas</span>
                            <span className="text-2xl font-black text-slate-900">{data.reglas.length}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Selector de Vista */}
            <div className="flex p-1 bg-slate-200/50 rounded-2xl w-fit print:hidden">
                <button
                    onClick={() => setActiveTab('coberturas')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'coberturas' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500 hover:text-slate-700'
                        }`}
                >
                    Malla
                </button>
                <button
                    onClick={() => setActiveTab('reglas')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'reglas' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500 hover:text-slate-700'
                        }`}
                >
                    Reglas
                </button>
                <button
                    onClick={() => setActiveTab('triangulacion')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'triangulacion' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                        }`}
                >
                    🛟 Triangulación
                </button>
            </div>

            {activeTab === 'coberturas' && (
                <div className="space-y-6">
                    {/* Barra de Búsqueda */}
                    <div className="relative group print:hidden">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar prestación, clínica o restricción..."
                            className="w-full pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:ring-4 focus:ring-slate-100 focus:border-slate-300 outline-none transition-all text-sm font-medium"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        {filteredCoberturas.map((cober, idx) => (
                            <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
                                <div className="flex flex-col md:flex-row justify-between gap-6 relative z-10">
                                    <div className="flex-grow">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded leading-none uppercase tracking-tighter ${cober.modalidad_red.includes('Internacional') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                                }`}>
                                                {cober.modalidad_red}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">#ITEM: {idx + 1}</span>
                                        </div>
                                        <h4 className="text-lg font-black text-slate-900 group-hover:text-black transition-colors">
                                            {cober.prestacion}
                                        </h4>
                                        <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100 italic text-[11px] leading-relaxed text-slate-500 font-medium">
                                            <Info size={14} className="inline mr-2 text-slate-400" />
                                            {cober.restriccion_condicionamiento}
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 gap-3">
                                        <div className="bg-white border-2 border-slate-900 rounded-2xl p-4 flex flex-col justify-center items-center min-w-[120px] shadow-[4px_4px_0px_rgba(15,23,42,0.1)] group-hover:shadow-[4px_4px_0px_rgba(15,23,42,0.2)] transition-all">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tope 1</span>
                                            <span className="text-xl font-black text-slate-900">{cober.tope_local_1}</span>
                                        </div>
                                        {cober.tope_local_2 && cober.tope_local_2 !== 'No Aplica' && (
                                            <div className="bg-slate-900 rounded-2xl p-4 flex flex-col justify-center items-center min-w-[120px] shadow-[4px_4px_0px_rgba(0,0,0,0.1)]">
                                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Tope 2</span>
                                                <span className="text-xl font-black text-white">{cober.tope_local_2}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'reglas' && (
                <div className="space-y-4">
                    {data.reglas.map((regla, idx) => (
                        <div key={idx} className="bg-white border-l-4 border-slate-900 rounded-2xl p-6 shadow-sm flex gap-6 group hover:bg-slate-50 transition-colors">
                            <div className="shrink-0 w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 font-black text-lg group-hover:bg-slate-900 group-hover:text-white transition-all">
                                {idx + 1}
                            </div>
                            <div className="flex-grow">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-black text-slate-500 uppercase tracking-widest">
                                        Página {regla.pagina_origen}
                                    </span>
                                </div>
                                <p className="text-sm font-medium leading-relaxed text-slate-700">
                                    {regla.clausula}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'triangulacion' && renderTriangulacion()}
        </div>
    );
}
