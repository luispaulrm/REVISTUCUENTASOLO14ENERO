import React, { useState } from 'react';
import { Upload, FileText, CreditCard, Calendar, User, Hash, AlertCircle } from 'lucide-react';

export default function TotalAuditV8() {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [showData, setShowData] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            // 1. CREAR PROYECCIÓN (La forma más rápida - tal cual el código del usuario)
            const url = URL.createObjectURL(file);
            setPdfUrl(url);
            setShowData(true);
            console.log("Archivo proyectado con éxito.");
        }
    };

    return (
        <div className="flex flex-col lg:flex-row h-[calc(100vh-100px)] bg-[#f0f2f5] font-sans selection:bg-indigo-100 selection:text-indigo-900">
            {/* Panel de Datos (Izquierda) */}
            <div className="w-full lg:w-[400px] bg-white p-6 shadow-xl z-10 overflow-y-auto flex flex-col gap-6 shrink-0 border-r border-slate-200">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                        <FileText size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-800 tracking-tight">Módulo 8</h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visualizador de Cuentas</p>
                    </div>
                </div>

                <div className="relative group">
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 hover:bg-slate-50 transition-all cursor-pointer text-center group-hover:border-indigo-500 group-hover:shadow-md">
                        <input
                            type="file"
                            accept="application/pdf"
                            onChange={handleFileChange}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20"
                        />
                        <div className="relative z-10 pointer-events-none">
                            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                <Upload size={24} />
                            </div>
                            <p className="text-sm font-bold text-slate-600 group-hover:text-indigo-700">Subir Cuenta PDF</p>
                            <p className="text-xs text-slate-400 mt-1">Click o arrastrar archivo</p>
                        </div>
                    </div>
                </div>

                {showData && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-500">
                        {/* Tarjeta Información del Paciente */}
                        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-slate-900"></div>
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3 mb-4 flex items-center gap-2">
                                <User size={14} /> Información del Paciente
                            </h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-start">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Nombre</span>
                                    <span className="text-sm font-bold text-slate-900 text-right">SANTIAGO RIQUELME PRUDENCIO</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-500 uppercase">RUT</span>
                                    <span className="text-sm font-medium text-slate-700 font-mono">27286332-6</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Nº Cuenta</span>
                                    <span className="text-sm font-medium text-slate-700 font-mono">13055971</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Previsión</span>
                                    <span className="text-xs font-bold text-white bg-indigo-500 px-2 py-0.5 rounded shadow-sm shadow-indigo-200">ISAPRE BANMEDICA S.A.</span>
                                </div>
                            </div>
                        </div>

                        {/* Tarjeta Resumen Financiero */}
                        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3 mb-4 flex items-center gap-2">
                                <CreditCard size={14} /> Resumen Financiero
                            </h3>
                            <div className="space-y-5">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Empresa</p>
                                    <p className="text-2xl font-black text-blue-600 tracking-tight">$14.107.721</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bonificación Isapre</p>
                                    <p className="text-xl font-black text-emerald-600 tracking-tight">$4.929.919</p>
                                </div>
                                <div className="pt-3 border-t border-slate-50 flex items-center justify-end gap-2 text-slate-400">
                                    <Calendar size={12} />
                                    <span className="text-[10px] font-bold uppercase">Fecha Emisión: 19/06/2024</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
                            <AlertCircle size={20} className="text-amber-500 shrink-0" />
                            <div>
                                <p className="text-xs font-bold text-amber-700 uppercase mb-1">Nota de Desarrollo</p>
                                <p className="text-[11px] text-amber-600/80 leading-relaxed">
                                    Este módulo esta en fase prototipo (v0.1). Los datos mostrados corresponden a una maqueta estática para validación de UX/UI.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Visor (Derecha) */}
            <div className="flex-grow p-6 bg-slate-50 h-full overflow-hidden flex flex-col">
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 h-full overflow-hidden relative">
                    {pdfUrl ? (
                        <iframe
                            src={pdfUrl}
                            className="w-full h-full border-none"
                            title="Visor PDF"
                        />
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300">
                            <div className="w-24 h-24 rounded-full bg-slate-50 border-4 border-slate-100 flex items-center justify-center mb-4">
                                <FileText size={48} className="opacity-50" />
                            </div>
                            <p className="text-lg font-bold text-slate-400">Vista Previa del Documento</p>
                            <p className="text-sm text-slate-300">Sube un archivo para visualizarlo aquí</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
