
import React, { useState } from 'react';
import {
    Building2,
    FileText,
    ShieldAlert,
    Search,
    Scale,
    Activity,
    AlertTriangle,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';

interface AlphaFoldVisualizerProps {
    auditResult: any; // Using any for now to avoid strict type issues with backend types in frontend
}

export const AlphaFoldVisualizer: React.FC<AlphaFoldVisualizerProps> = ({ auditResult }) => {
    const [activeTab, setActiveTab] = useState<'map' | 'signals' | 'findings' | 'structure'>('map');

    if (!auditResult) return null;

    const { pamState, signals, hypothesisRanking, activeHypotheses, findings, balance, decisionGlobal } = auditResult;

    const getConfColor = (conf: number) => {
        if (conf > 0.8) return 'bg-red-500';
        if (conf > 0.5) return 'bg-amber-500';
        return 'bg-blue-500';
    };

    const formatMoney = (amount: number) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    };

    return (
        <div className="flex flex-col gap-6 p-6 bg-gray-50 min-h-screen">

            {/* 1. Header: Case Info & Global State */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Validación Jurídica (AlphaFold)</h1>
                        <div className="flex gap-4 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1"><Building2 size={16} /> {auditResult.metadata?.institucion || "Clínica"}</span>
                            <span className="flex items-center gap-1"><FileText size={16} /> PAM: <span className={`font-bold ${pamState === "OPACO" ? "text-red-600" : "text-green-600"}`}>{pamState}</span></span>
                            <span className="flex items-center gap-1"><Activity size={16} /> Confianza Global: <strong>{((decisionGlobal?.confianza || 0) * 100).toFixed(0)}%</strong></span>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${decisionGlobal?.estado?.includes("FRAUDE") ? "bg-red-100 text-red-800" :
                            decisionGlobal?.estado?.includes("INDETERMINADO") ? "bg-amber-100 text-amber-800" :
                                "bg-green-100 text-green-800"
                            }`}>
                            {decisionGlobal?.estado?.replace(/_/g, " ")}
                        </span>
                    </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-700 italic border-l-4 border-slate-300">
                    "{decisionGlobal?.fundamento}"
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* 2. Balance Card (Left Column) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <Scale size={20} /> Balance Contable
                    </h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-100">
                            <span className="text-red-700 font-medium">Cat A (Impugnable)</span>
                            <span className="text-red-900 font-bold">{formatMoney(balance?.A || 0)}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg border border-amber-100">
                            <span className="text-amber-700 font-medium">Cat B (Aclarar)</span>
                            <span className="text-amber-900 font-bold">{formatMoney(balance?.B || 0)}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-slate-100 rounded-lg border border-slate-200">
                            <span className="text-slate-700 font-medium">Cat Z (Indeterminado)</span>
                            <span className="text-slate-900 font-bold">{formatMoney(balance?.Z || 0)}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-100">
                            <span className="text-green-700 font-medium">Cat OK (Validado)</span>
                            <span className="text-green-900 font-bold">{formatMoney(balance?.OK || 0)}</span>
                        </div>
                        <div className="border-t pt-3 mt-2 flex justify-between items-center">
                            <span className="font-bold text-gray-900">TOTAL</span>
                            <span className="font-bold text-gray-900">{formatMoney(balance?.TOTAL || 0)}</span>
                        </div>
                    </div>
                </div>

                {/* 3. Hypothesis Map (Center/Right Column - Spans 2) */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <Search size={20} /> Mapa de Hipótesis (AlphaFold)
                        </h3>
                        <div className="flex gap-2">
                            <button onClick={() => setActiveTab('map')} className={`text-xs px-3 py-1 rounded-full ${activeTab === 'map' ? 'bg-blue-100 text-blue-800 font-bold' : 'bg-gray-100 text-gray-600'}`}>Mapa</button>
                            <button onClick={() => setActiveTab('signals')} className={`text-xs px-3 py-1 rounded-full ${activeTab === 'signals' ? 'bg-blue-100 text-blue-800 font-bold' : 'bg-gray-100 text-gray-600'}`}>Señales</button>
                            <button onClick={() => setActiveTab('findings')} className={`text-xs px-3 py-1 rounded-full ${activeTab === 'findings' ? 'bg-blue-100 text-blue-800 font-bold' : 'bg-gray-100 text-gray-600'}`}>Hallazgos</button>
                        </div>
                    </div>

                    {activeTab === 'map' && (
                        <div className="space-y-4">
                            {(hypothesisRanking || []).map((h: any) => {
                                const isActive = activeHypotheses?.includes(h.hypothesis);
                                const isFraud = h.hypothesis === "H_FRAUDE_PROBABLE";
                                // If it's fraud and inactive, we show it dimmed/ghosted to show "it was checked but failed gating"
                                const opacityClass = !isActive ? "opacity-40 grayscale" : "opacity-100";

                                return (
                                    <div key={h.hypothesis} className={`relative pt-1 ${opacityClass}`}>
                                        <div className="flex mb-2 items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {isActive ? <CheckCircle2 size={16} className="text-green-600" /> : <div className="w-4 h-4 rounded-full border border-gray-300"></div>}
                                                <span className={`text-sm font-semibold inline-block py-1 px-2 uppercase rounded-lg ${isActive ? "bg-slate-100 text-slate-800" : "text-gray-500"
                                                    }`}>
                                                    {h.hypothesis.replace('H_', '').replace('_', ' ')}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-xs font-semibold inline-block text-gray-600">
                                                    {(h.confidence * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                        </div>
                                        <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-gray-200">
                                            <div style={{ width: `${h.confidence * 100}%` }} className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center ${getConfColor(h.confidence)}`}></div>
                                        </div>
                                    </div>
                                );
                            })}

                            <div className="mt-8 p-4 bg-gray-50 rounded border border-gray-200">
                                <h4 className="font-bold text-sm text-gray-700 mb-2">Estructura Detectada (Explicación Estable)</h4>
                                <ul className="text-sm text-gray-600 space-y-2">
                                    {activeHypotheses?.includes("H_OPACIDAD_ESTRUCTURAL") && (
                                        <li className="flex gap-2 items-start"><AlertCircle size={14} className="mt-1 text-amber-600" /> Opacidad parcial detectada: materiales/medicamentos agrupados impiden validación de topes.</li>
                                    )}
                                    {activeHypotheses?.includes("H_UNBUNDLING_IF319") && (
                                        <li className="flex gap-2 items-start"><AlertCircle size={14} className="mt-1 text-amber-600" /> Unbundling probado: cobro separado de hotelería/alimentación inherente al día cama.</li>
                                    )}
                                    {activeHypotheses?.includes("H_PRACTICA_IRREGULAR") && (
                                        <li className="flex gap-2 items-start"><AlertTriangle size={14} className="mt-1 text-red-600" /> Práctica Irregular: el diseño del cobro obstaculiza sistemáticamente la auditoría.</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeTab === 'signals' && (
                        <div className="space-y-3">
                            {(signals || []).map((s: any) => (
                                <div key={s.id} className="flex items-center text-sm">
                                    <div className="w-1/2 font-medium text-gray-700 truncate" title={s.id}>{s.id.replace('S_', '').replace(/_/g, ' ')}</div>
                                    <div className="w-1/2 pl-4 flex items-center gap-2">
                                        <div className="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                                            <div style={{ width: `${s.value * 100}%` }} className="h-full bg-blue-500"></div>
                                        </div>
                                        <span className="text-xs w-8 text-right">{(s.value * 100).toFixed(0)}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'findings' && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left text-gray-500">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-4 py-3">Cat</th>
                                        <th scope="col" className="px-4 py-3">Hallazgo</th>
                                        <th scope="col" className="px-4 py-3 text-right">Monto</th>
                                        <th scope="col" className="px-4 py-3">Acción</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(findings || []).map((f: any) => (
                                        <tr key={f.id} className="bg-white border-b hover:bg-gray-50">
                                            <td className="px-4 py-3 font-bold">
                                                <span className={`px-2 py-0.5 rounded text-xs text-white ${f.category === 'A' ? 'bg-red-600' :
                                                    f.category === 'B' ? 'bg-amber-500' :
                                                        f.category === 'Z' ? 'bg-slate-500' : 'bg-green-500'
                                                    }`}>{f.category}</span>
                                            </td>
                                            <td className="px-4 py-3 font-medium text-gray-900">{f.label}</td>
                                            <td className="px-4 py-3 text-right">{formatMoney(f.amount)}</td>
                                            <td className="px-4 py-3">{f.action.replace('_', ' ')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>
            </div>

            {/* 4. Contact Map (Relational View) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4 font-mono uppercase tracking-tighter text-sm">AlphaFold Logical Contact Map</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {/* Relación Día Cama -> Hotelería */}
                    <div className={`p-4 border rounded-xl flex items-center justify-between transition-all duration-500 ${activeHypotheses?.includes("H_UNBUNDLING_IF319")
                        ? "bg-red-50 border-red-200 shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                        : "bg-blue-50 border-blue-100"
                        }`}>
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-900">Día Cama</span>
                            <span className="text-[10px] text-slate-500">Gasto Basal</span>
                        </div>
                        <div className="flex flex-col items-center px-4">
                            <span className={`font-black tracking-tighter transition-colors ${activeHypotheses?.includes("H_UNBUNDLING_IF319") ? "text-red-500" : "text-blue-400"}`}>
                                {activeHypotheses?.includes("H_UNBUNDLING_IF319") ? "── unbundling ──▶" : "── incluye ──▶"}
                            </span>
                        </div>
                        <div className="flex flex-col text-right">
                            <span className="font-bold text-slate-900">Hotelería / Alim.</span>
                            <span className="text-[10px] text-slate-500">Insumos Basales</span>
                        </div>
                    </div>

                    {/* Relación Materiales -> Topes (La que pidió el usuario con flechas ➤) */}
                    {(() => {
                        const matGrouping = signals?.find((s: any) => s.id === 'S_PAM_AGRUPADOR_MATERIALES')?.value || 0;
                        const medGrouping = signals?.find((s: any) => s.id === 'S_PAM_AGRUPADOR_MEDICAMENTOS')?.value || 0;
                        const isBlocked = matGrouping > 0.5 || medGrouping > 0.5;

                        return (
                            <div className={`p-4 border rounded-xl flex items-center justify-between transition-all duration-500 ${isBlocked
                                ? "bg-slate-50 border-slate-200 grayscale"
                                : "bg-green-50 border-green-200 shadow-[0_0_15px_rgba(34,197,94,0.15)]"
                                }`}>
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-900">PAM Materiales</span>
                                    <span className="text-[10px] text-slate-500">{isBlocked ? "Agrupado/Opaco" : "Desglosado"}</span>
                                </div>
                                <div className="flex flex-col items-center px-4">
                                    <span className={`font-black tracking-tighter transition-colors ${isBlocked ? "text-slate-400" : "text-green-600 animate-pulse"}`}>
                                        {isBlocked ? "── bloquea ──▶" : "── validados ➤"}
                                    </span>
                                </div>
                                <div className="flex flex-col text-right">
                                    <span className="font-bold text-slate-900">Topes Contrato</span>
                                    <span className="text-[10px] text-slate-500">{isBlocked ? "No Verificables" : "Cruce Exitoso"}</span>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Relación Cuenta -> PAM */}
                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-between col-span-1 md:col-span-2">
                        <div className="flex flex-col">
                            <span className="font-bold text-slate-900">Cuenta Detallada (Ficha)</span>
                            <span className="text-[10px] text-slate-500">Origen de Datos</span>
                        </div>
                        <span className="text-amber-400 font-black tracking-tighter px-4">── Reconstrucción Métrica ──▶</span>
                        <div className="flex flex-col text-right">
                            <span className="font-bold text-slate-900">PAM Agrupado</span>
                            <span className="text-[10px] text-slate-500">Destino Facturación</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 5. Detailed Tope Validation Panel (The requested corroboration) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-6">
                    <Scale size={20} className="text-green-600" />
                    <h3 className="text-lg font-bold text-gray-800">Panel de Verificación de Topes (Cruce Contrato)</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                        { id: 'S_VAL_HONORARIOS', label: 'Honorarios Médicos', desc: 'Arancel / VAM' },
                        { id: 'S_VAL_PABELLON', label: 'Derecho Pabellón', desc: 'Recargos / Integral' },
                        { id: 'S_VAL_MEDICAMENTOS', label: 'Medicamentos', desc: 'Tope Evento/Anual' },
                        { id: 'S_VAL_MATERIALES', label: 'Materiales Clínicos', desc: 'Tope 20 UF' },
                    ].map(tope => {
                        const val = signals?.find((s: any) => s.id === tope.id)?.value || 0;
                        const isValidated = val > 0.5;

                        return (
                            <div key={tope.id} className={`p-4 border rounded-xl flex flex-col gap-2 transition-all duration-300 ${isValidated ? 'bg-green-50 border-green-200 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-60'
                                }`}>
                                <div className="flex justify-between items-start">
                                    <span className="font-bold text-sm text-slate-800">{tope.label}</span>
                                    {isValidated ? (
                                        <span className="text-green-600 font-black text-xs">➤ VALIDADO</span>
                                    ) : (
                                        <span className="text-slate-400 font-bold text-[10px] uppercase">Pendiente</span>
                                    )}
                                </div>
                                <div className="flex items-center justify-between mt-auto">
                                    <span className="text-[10px] text-slate-500">{tope.desc}</span>
                                    {isValidated && <CheckCircle2 size={14} className="text-green-600" />}
                                </div>
                                {isValidated && (
                                    <div className="h-1 bg-green-200 rounded-full overflow-hidden mt-1">
                                        <div className="h-full bg-green-500 w-full animate-progress"></div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {!signals?.some((s: any) => s.id.startsWith('S_VAL_') && s.value > 0.5) && (
                    <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100 flex items-center gap-2 text-xs text-amber-700">
                        <AlertTriangle size={14} />
                        <span>La opacidad estructural impide el cruce automático de topes en algunas categorías.</span>
                    </div>
                )}
            </div>

        </div>
    );
};
