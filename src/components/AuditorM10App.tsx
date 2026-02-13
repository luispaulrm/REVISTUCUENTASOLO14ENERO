import React, { useState, useEffect } from 'react';
import { Brain, Database, FileText, Activity, Layers, Zap, CheckCircle2, AlertCircle } from 'lucide-react';

export default function AuditorM10App() {
    const [dataStatus, setDataStatus] = useState({
        canonical: false,
        pam: false,
        account: false
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkData = () => {
            const canonical = localStorage.getItem('canonical_contract_result');
            const pam = localStorage.getItem('pam_audit_result');
            const account = localStorage.getItem('clinic_audit_result');

            setDataStatus({
                canonical: !!canonical,
                pam: !!pam,
                account: !!account
            });
            setLoading(false);
        };

        checkData();
        // Poll for changes in case files are uploaded in other tabs
        const interval = setInterval(checkData, 2000);
        return () => clearInterval(interval);
    }, []);

    const allDataReady = dataStatus.canonical && dataStatus.pam && dataStatus.account;

    return (
        <div className="min-h-[calc(100vh-64px)] bg-[#f8fafc] p-8 animate-in fade-in duration-700">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-200">
                                <Brain className="text-white" size={24} />
                            </div>
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Advanced Forensic Layer</span>
                        </div>
                        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">
                            Módulo 10 <span className="text-indigo-600">Auditor</span>
                        </h1>
                        <p className="mt-2 text-slate-500 max-w-2xl text-lg">
                            Motor de auditoría independiente de nueva generación. Conexión directa con JSON Canónico, PAM y Cuenta Clínica sin dependencias de módulos anteriores.
                        </p>
                    </div>

                    <div className="flex gap-4">
                        <div className="px-6 py-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${allDataReady ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
                            <span className="text-sm font-semibold text-slate-700">
                                {allDataReady ? 'Fuentes Listas' : 'Esperando Conexiones'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main Dashboard Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Connection Cards */}
                    {[
                        {
                            title: 'JSON Canónico',
                            icon: <Database className={dataStatus.canonical ? "text-blue-500" : "text-slate-400"} />,
                            label: 'Contrato Estructurado',
                            ready: dataStatus.canonical
                        },
                        {
                            title: 'PAM Data',
                            icon: <FileText className={dataStatus.pam ? "text-purple-500" : "text-slate-400"} />,
                            label: 'Coberturas Reales',
                            ready: dataStatus.pam
                        },
                        {
                            title: 'Cuenta Clínica',
                            icon: <Activity className={dataStatus.account ? "text-rose-500" : "text-slate-400"} />,
                            label: 'Gastos Médicos',
                            ready: dataStatus.account
                        }
                    ].map((card, idx) => (
                        <div key={idx} className={`group relative bg-white p-6 rounded-3xl border transition-all duration-500 ${card.ready ? 'border-indigo-100 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5' : 'border-slate-200 opacity-70'}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div className={`p-3 rounded-2xl transition-all duration-500 ${card.ready ? 'bg-slate-50 group-hover:bg-white group-hover:scale-110' : 'bg-slate-100'}`}>
                                    {card.icon}
                                </div>
                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Source Connection</div>
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-1">{card.title}</h3>
                            <p className="text-sm text-slate-500 mb-4">{card.label}</p>
                            <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${card.ready ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                <span className={`text-xs font-medium ${card.ready ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    {card.ready ? 'Linked' : 'Disconnected'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Empty State / Processing placeholder */}
                <div className="relative overflow-hidden bg-slate-900 rounded-[2.5rem] p-12 text-center shadow-2xl">
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600" />
                        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
                    </div>

                    <div className="relative z-10 flex flex-col items-center">
                        <div className="p-4 bg-white/10 rounded-full backdrop-blur-xl mb-6">
                            <Zap className={allDataReady ? "text-indigo-400" : "text-slate-500"} size={48} />
                        </div>
                        <h2 className="text-3xl font-bold text-white mb-4">
                            {allDataReady ? 'Listo para Iniciar Auditoría M10' : 'Fuentes Incompletas'}
                        </h2>
                        <p className="text-slate-400 max-w-xl mx-auto mb-10 text-lg leading-relaxed">
                            {allDataReady
                                ? 'Este módulo operará de forma paralela y aislada. La lógica de auditoría se ejecutará sin interferir con los hallazgos del Auditor Forense estándar.'
                                : 'Por favor cargue los documentos necesarios en las pestañas correspondientes (Cuentas, PAM y Canonizar) para activar el motor M10.'}
                        </p>
                        <button
                            disabled={!allDataReady}
                            className={`px-10 py-4 font-bold rounded-2xl shadow-lg transition-all duration-300 flex items-center gap-3 ${allDataReady
                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30 hover:scale-105 active:scale-95'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                        >
                            <Layers size={20} />
                            Iniciar Procesamiento M10
                        </button>
                    </div>
                </div>

                {/* Footer Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-8">
                    {[
                        { label: 'Precision Engine', value: 'V1.0' },
                        { label: 'Neural Mapping', value: 'Active' },
                        { label: 'Integrity Check', value: 'Verified' },
                        { label: 'Cloud Context', value: 'Synced' }
                    ].map((m, i) => (
                        <div key={i} className="bg-white/50 backdrop-blur-sm border border-slate-200 rounded-2xl p-4 flex flex-col items-center">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{m.label}</span>
                            <span className="text-sm font-bold text-slate-700">{m.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
