import React, { useState, useEffect } from 'react';
import { Brain, Map as MapIcon, ChevronRight, ShieldAlert, Zap, Filter, Search, Maximize2, Layers, AlertCircle, HardDrive } from 'lucide-react';

interface Modalidad {
    activa: boolean;
    detalle_cobertura: string;
}

interface PreferenteModality {
    activa: boolean;
    opciones: Array<{
        porcentaje: number;
        prestadores_resumen: string[];
        condiciones: string[];
    }>;
}

interface Prestacion {
    slug: string;
    titulo: string;
    esquema_mental: {
        cobertura_base: string;
        tope_evento: string;
        tope_anual: string;
    };
    modalidades: {
        libre_eleccion: Modalidad;
        preferente?: PreferenteModality;
    };
    alertas_forenses: string[];
    debug_trace: string[];
}

interface MentalModel {
    metadata: {
        source_contract: string;
        generated_at: string;
        engine_version: string;
    };
    prestaciones: Prestacion[];
}

export default function MentalMapApp({ isActive, initialData }: { isActive: boolean, initialData?: MentalModel }) {
    const [model, setModel] = useState<MentalModel | null>(initialData || null);
    const [loading, setLoading] = useState(!initialData);
    const [error, setError] = useState<string | null>(null);
    const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterLocked, setFilterLocked] = useState(false);

    useEffect(() => {
        if (initialData) {
            setModel(initialData);
            setLoading(false);
            if (initialData.prestaciones?.length > 0) {
                setSelectedSlug(initialData.prestaciones[0].slug);
            }
            return;
        }

        if (!isActive) return;

        setLoading(true);
        fetch('/api/mental-model')
            .then(res => {
                if (!res.ok) throw new Error('Modelo mental no encontrado. Por favor, corre la canonización primero.');
                return res.json();
            })
            .then(data => {
                setModel(data);
                if (data.prestaciones?.length > 0) {
                    setSelectedSlug(data.prestaciones[0].slug);
                }
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [isActive]);

    const filteredPrestaciones = model?.prestaciones.filter(p => {
        const matchesSearch = p.titulo.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesLock = filterLocked ? p.alertas_forenses.some(a => a.includes('Bloqueada')) : true;
        return matchesSearch && matchesLock;
    });

    const selectedPrestacion = model?.prestaciones.find(p => p.slug === selectedSlug);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[600px] bg-slate-50">
                <div className="relative">
                    <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                        <Brain size={32} className="animate-pulse" />
                    </div>
                </div>
                <p className="mt-6 text-slate-500 font-bold uppercase tracking-widest text-[10px]">Invocando Proyección Mental...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[600px] bg-white p-10 text-center">
                <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mb-6 border border-rose-100 shadow-xl">
                    <AlertCircle size={36} />
                </div>
                <h2 className="text-2xl font-black text-slate-900 mb-2">Error de Proyección</h2>
                <p className="text-slate-500 max-w-md mx-auto mb-8 font-medium">{error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95"
                >
                    REINTENTAR ACCESO
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-64px)] bg-slate-50 overflow-hidden">
            {/* Sidebar: Navigation List */}
            <aside className="w-[400px] border-r border-slate-200 bg-white flex flex-col shadow-2xl z-10">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 backdrop-blur-md sticky top-0">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                            <Brain size={22} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-900 leading-none">Mapa Mental</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">NotebookLM View v1.0</p>
                        </div>
                    </div>

                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar prestación..."
                            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setFilterLocked(!filterLocked)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all ${filterLocked ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                            <ShieldAlert size={12} />
                            Solo Bloqueos Modalidad
                        </button>
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {filteredPrestaciones?.map(p => (
                        <button
                            key={p.slug}
                            onClick={() => setSelectedSlug(p.slug)}
                            className={`w-full text-left p-4 rounded-2xl transition-all duration-300 relative group border ${selectedSlug === p.slug
                                ? 'bg-slate-900 text-white shadow-xl shadow-slate-200 border-transparent translate-x-1'
                                : 'bg-white text-slate-600 border-slate-100 hover:bg-slate-50 hover:border-slate-200'}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className={`text-[10px] font-black uppercase tracking-widest ${selectedSlug === p.slug ? 'text-indigo-400' : 'text-slate-400'}`}>
                                    {p.slug.replace(/-/g, ' ')}
                                </span>
                                {p.alertas_forenses.some(a => a.includes(' Bloqueada')) && (
                                    <ShieldAlert size={14} className={selectedSlug === p.slug ? 'text-rose-400' : 'text-rose-500'} />
                                )}
                            </div>
                            <h3 className="font-bold text-sm leading-tight pr-6">{p.titulo}</h3>
                            <ChevronRight size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-transform duration-300 ${selectedSlug === p.slug ? 'translate-x-0 opacity-100 text-white' : 'translate-x-2 opacity-0 text-slate-400'}`} />
                        </button>
                    ))}
                </div>
            </aside>

            {/* Main Content: Mind Map Visualizer */}
            <main className="flex-grow relative overflow-hidden bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
                {selectedPrestacion ? (
                    <div className="absolute inset-0 flex items-center justify-center p-12 overflow-auto">
                        <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center relative transition-all duration-700 ease-out transform">

                            {/* Central Node: The Provision */}
                            <div className="md:col-span-2 flex justify-center mb-4 z-20">
                                <div className="p-8 bg-slate-900 text-white rounded-[40px] shadow-2xl border-4 border-white inline-flex flex-col items-center text-center relative max-w-xl group hover:scale-[1.02] transition-transform duration-500">
                                    <div className="absolute -top-6 bg-white p-3 rounded-2xl text-slate-900 shadow-xl border border-slate-100 group-hover:rotate-12 transition-transform duration-300">
                                        <MapIcon size={24} />
                                    </div>
                                    <h1 className="text-2xl font-black mb-2 leading-tight uppercase tracking-tight">{selectedPrestacion.titulo}</h1>
                                    <div className="flex items-center gap-4 mt-2">
                                        <div className="flex flex-col items-center">
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Tope Evento</span>
                                            <span className="text-lg font-bold text-indigo-400">{selectedPrestacion.esquema_mental.tope_evento}</span>
                                        </div>
                                        <div className="w-px h-8 bg-slate-700"></div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Tope Anual</span>
                                            <span className="text-lg font-bold text-emerald-400">{selectedPrestacion.esquema_mental.tope_anual}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Leaf Node: Libre Elección */}
                            <div className="flex justify-end pr-4 animate-in slide-in-from-left duration-700 fill-mode-forwards">
                                <div className="p-6 bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-[280px] hover:shadow-2xl transition-all group hover:scale-105 duration-300">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300">
                                            <Layers size={20} />
                                        </div>
                                        <h3 className="font-black text-sm uppercase tracking-tighter">Libre Elección</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Cobertura</span>
                                            <span className="text-xl font-bold text-slate-900">{selectedPrestacion.modalidades.libre_eleccion.detalle_cobertura}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-black rounded-full uppercase">ACTIVA</span>
                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-black rounded-full uppercase">Red Abierta</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Leaf Node: Preferente */}
                            <div className="flex justify-start pl-4 animate-in slide-in-from-right duration-700 fill-mode-forwards">
                                <div className={`p-6 bg-white rounded-3xl shadow-xl border w-full max-w-[420px] transition-all group hover:scale-105 duration-300 ${selectedPrestacion.modalidades.preferente?.activa ? 'border-slate-100 opacity-100' : 'border-rose-100 opacity-60 grayscale bg-rose-50/10'}`}>
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className={`p-2.5 rounded-xl transition-colors duration-300 ${selectedPrestacion.modalidades.preferente?.activa ? 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white' : 'bg-rose-50 text-rose-600'}`}>
                                            <ShieldAlert size={20} />
                                        </div>
                                        <h3 className="font-black text-sm uppercase tracking-tighter">Modalidad Preferente</h3>
                                    </div>

                                    {selectedPrestacion.modalidades.preferente?.activa ? (
                                        <div className="space-y-4">
                                            {selectedPrestacion.modalidades.preferente.opciones.map((opt, i) => (
                                                <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-white transition-all shadow-sm">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-xl font-black text-indigo-600">{opt.porcentaje}%</span>
                                                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Opción {i + 1}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {opt.prestadores_resumen.map(p => (
                                                            <span key={p} className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 text-[8px] font-bold rounded-md uppercase">{p}</span>
                                                        ))}
                                                    </div>
                                                    {opt.condiciones.length > 0 && (
                                                        <div className="mt-2 text-[8px] font-bold text-slate-400 italic">
                                                            * {opt.condiciones.join(", ")}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center py-6">
                                            <div className="text-rose-500 font-black text-xs uppercase tracking-widest">🔒 Bloqueada</div>
                                            <p className="text-[10px] text-rose-400 font-bold mt-2 text-center leading-tight">Esta prestación solo está disponible en modalidad Libre Elección.</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Alerts Node */}
                            <div className="md:col-span-2 flex justify-center mt-6 animate-in slide-in-from-bottom duration-1000">
                                <div className="bg-indigo-900/5 backdrop-blur-md rounded-3xl border border-indigo-100 p-8 w-full max-w-2xl shadow-xl relative overflow-hidden group">
                                    <div className="absolute -right-4 -top-4 text-indigo-100 rotate-12 transition-transform duration-500 group-hover:scale-150 opacity-50">
                                        <AlertCircle size={80} />
                                    </div>

                                    <div className="relative z-10">
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg">
                                                <Zap size={20} />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-black text-slate-900 leading-none">Alertas y Hallazgos</h3>
                                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Soberanía Determinista</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {selectedPrestacion.alertas_forenses.length > 0 ? (
                                                selectedPrestacion.alertas_forenses.map(a => (
                                                    <div key={a} className="flex items-start gap-3 p-4 bg-white border border-indigo-50 rounded-2xl shadow-sm hover:translate-x-1 hover:shadow-md transition-all">
                                                        <div className={`mt-0.5 ${a.includes('🔒') ? 'text-rose-500' : 'text-indigo-500'}`}>
                                                            {a.includes('🔒') ? <ShieldAlert size={16} /> : <Zap size={16} />}
                                                        </div>
                                                        <span className="text-[11px] font-bold text-slate-700 leading-snug">{a}</span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="col-span-2 p-6 text-center border-2 border-dashed border-slate-200 rounded-3xl">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sin alertas forenses críticas para esta prestación</p>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4">
                                            <div className="flex items-center gap-2">
                                                <Maximize2 size={12} className="text-slate-400" />
                                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest underline decoration-dotted">Ver Trazabilidad Técnica</span>
                                            </div>
                                            <div className="flex gap-2">
                                                {selectedPrestacion.debug_trace.map(t => (
                                                    <span key={t} className="px-2 py-0.5 bg-slate-900 text-white text-[8px] font-mono rounded tracking-tighter">{t}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center opacity-40">
                        <MapIcon size={80} className="text-slate-200 mb-6" />
                        <h3 className="text-xl font-black text-slate-400 uppercase tracking-widest">Selecciona una prestación para proyectar</h3>
                    </div>
                )}
            </main>
        </div>
    );
}
