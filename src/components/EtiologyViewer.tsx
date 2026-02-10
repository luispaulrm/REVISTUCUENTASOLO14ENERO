import React from 'react';
import { TaxonomyResult, EtiologiaResult } from '../../server/types/taxonomy.types';
import {
    FileText,
    Tag,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    HelpCircle,
    Info,
    ShieldAlert
} from 'lucide-react';

interface EtiologyViewerProps {
    items: TaxonomyResult[];
    anchors?: {
        hasPabellon: boolean;
        hasDayBed: boolean;
        hasUrgencia: boolean;
        sectionNames?: string[];
    };
}

const EtiologyBadge: React.FC<{ etiology: EtiologiaResult }> = ({ etiology }) => {
    let color = "bg-slate-100 text-slate-600 border-slate-200";
    let Icon = HelpCircle;

    switch (etiology.tipo) {
        case "CORRECTO":
            color = "bg-emerald-50 text-emerald-700 border-emerald-200";
            Icon = CheckCircle2;
            break;
        case "ACTO_NO_AUTONOMO":
            color = "bg-amber-50 text-amber-700 border-amber-200";
            Icon = AlertTriangle;
            break;
        case "DESCLASIFICACION_CLINICA":
            color = "bg-rose-50 text-rose-700 border-rose-200";
            Icon = ShieldAlert;
            break;
        case "DESCLASIFICACION_ADMINISTRATIVA":
            color = "bg-slate-200 text-slate-700 border-slate-300"; // Gray for "Administrative/Glosa"
            Icon = XCircle;
            break;
        case "CODIGO_INEXISTENTE":
            color = "bg-slate-800 text-slate-200 border-slate-700";
            Icon = XCircle;
            break;
    }

    return (
        <div className={`flex flex-col gap-1 p-2 rounded-lg border ${color} text-xs`}>
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                <Icon size={12} />
                <span>{etiology.tipo.replace(/_/g, " ")}</span>
            </div>

            {etiology.absorcion_clinica && (
                <div className="flex items-center gap-1 mt-1 opacity-80">
                    <span className="font-semibold">Absorción:</span>
                    <span>{etiology.absorcion_clinica}</span>
                </div>
            )}

            <div className="mt-1 pt-1 border-t border-current/20 opacity-90 italic">
                {etiology.rationale_short}
            </div>

            {etiology.impacto_previsional !== "BONIFICABLE" && (
                <div className="mt-1 font-bold text-[10px] uppercase opacity-75">
                    Impacto: {etiology.impacto_previsional.replace(/_/g, " ")}
                </div>
            )}
        </div>
    );
};

export const EtiologyViewer: React.FC<EtiologyViewerProps> = ({ items, anchors }) => {
    if (!items || items.length === 0) return null;

    return (
        <div className="space-y-8 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* HEADERS & ANCHORS CONTEXT */}
            {anchors && (
                <div className="bg-slate-900 text-slate-300 p-4 rounded-xl text-xs font-mono mb-6 flex flex-wrap gap-4 items-center">
                    <div className="text-white font-bold uppercase tracking-widest mr-2">Contexto Normativo Detectado:</div>
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${anchors.hasPabellon ? 'bg-indigo-900 text-indigo-100 border border-indigo-700' : 'bg-slate-800 text-slate-500'}`}>
                        {anchors.hasPabellon ? <CheckCircle2 size={10} /> : <XCircle size={10} />} Pabellón
                    </div>
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${anchors.hasDayBed ? 'bg-indigo-900 text-indigo-100 border border-indigo-700' : 'bg-slate-800 text-slate-500'}`}>
                        {anchors.hasDayBed ? <CheckCircle2 size={10} /> : <XCircle size={10} />} Día Cama
                    </div>
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${anchors.hasUrgencia ? 'bg-indigo-900 text-indigo-100 border border-indigo-700' : 'bg-slate-800 text-slate-500'}`}>
                        {anchors.hasUrgencia ? <CheckCircle2 size={10} /> : <XCircle size={10} />} Urgencia
                    </div>
                </div>
            )}

            <div className="overflow-hidden border border-slate-200 rounded-2xl shadow-sm bg-white">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
                            <th className="px-4 py-3 w-[30%]">
                                <div className="flex items-center gap-2">
                                    <FileText size={14} />
                                    1. Transcripción (Hecho)
                                </div>
                            </th>
                            <th className="px-4 py-3 w-[30%]">
                                <div className="flex items-center gap-2">
                                    <Tag size={14} />
                                    2. Taxonomía (Qué es)
                                </div>
                            </th>
                            <th className="px-4 py-3 w-[40%]">
                                <div className="flex items-center gap-2">
                                    <ShieldAlert size={14} />
                                    3. Etiología (Por qué)
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map((item, idx) => (
                            <tr key={item.id || idx} className="hover:bg-slate-50/50 transition-colors group">
                                {/* BLOCK 1: TRANSCRIPTION */}
                                <td className="px-4 py-3 align-top">
                                    <div className="font-mono text-xs text-slate-700 font-medium">
                                        {item.text || item.item_original}
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-1">
                                        ID: {item.id} | Ref: {item.sourceRef || 'N/A'}
                                    </div>
                                    {/* Show Attributes if any useful ones exist for context */}
                                    {item.atributos?.section && (
                                        <div className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded inline-block mt-1">
                                            Sec: {item.atributos.section}
                                        </div>
                                    )}
                                </td>

                                {/* BLOCK 2: TAXONOMY */}
                                <td className="px-4 py-3 align-top border-l border-slate-100">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold uppercase text-slate-400 w-12 shrink-0">Grupo</span>
                                            <span className="text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full">
                                                {item.grupo}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold uppercase text-slate-400 w-12 shrink-0">SubFam</span>
                                            <span className="text-xs text-slate-600">
                                                {item.sub_familia}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-2">
                                            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full ${item.confidence > 0.8 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                                                    style={{ width: `${(item.confidence || 0) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-[9px] text-slate-400 font-mono">
                                                {Math.round((item.confidence || 0) * 100)}%
                                            </span>
                                        </div>
                                    </div>
                                </td>

                                {/* BLOCK 3: ETIOLOGY */}
                                <td className="px-4 py-3 align-top border-l border-slate-100 bg-slate-50/30">
                                    {item.etiologia ? (
                                        <EtiologyBadge etiology={item.etiologia} />
                                    ) : (
                                        <div className="flex items-center gap-2 text-slate-300 italic text-xs py-2">
                                            <Info size={14} />
                                            Sin análisis etiológico
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="text-center text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                Fin del Reporte de Transparencia Tributaria
            </div>
        </div>
    );
};
