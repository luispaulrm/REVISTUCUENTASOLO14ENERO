import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Brain } from 'lucide-react';

interface NodeData {
    titulo: string;
    cobertura?: string;
    detalle?: string;
    children?: NodeData[];
}

interface MentalModel {
    metadata: {
        source_contract: string;
        generated_at: string;
    };
    root: NodeData;
}

export default function MentalMapApp({ isActive, initialData }: { isActive: boolean, initialData?: any }) {
    const [model, setModel] = useState<MentalModel | null>(initialData || null);
    const [loading, setLoading] = useState(!initialData);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['root']));

    useEffect(() => {
        if (!isActive) return;

        if (initialData) {
            setModel(initialData);
            setLoading(false);
            return;
        }

        setLoading(true);
        fetch('/api/mental-model')
            .then(res => res.json())
            .then(data => {
                setModel(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [isActive, initialData]);

    const toggleNode = (path: string) => {
        const newPaths = new Set(expandedPaths);
        if (newPaths.has(path)) newPaths.delete(path);
        else newPaths.add(path);
        setExpandedPaths(newPaths);
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[600px] bg-white">
            <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
        </div>
    );

    if (!model) return <div className="p-10 text-slate-400">No se pudo cargar la Guía Maestra</div>;

    const renderNode = (node: NodeData, path: string, depth: number = 0) => {
        const isExpanded = expandedPaths.has(path);
        const hasChildren = node.children && node.children.length > 0;

        return (
            <div key={path} className="flex items-center group/row">
                {/* Node Box */}
                <div className={`
                    relative z-10 px-6 py-4 rounded-xl shadow-sm border transition-all duration-500
                    ${depth === 0 ? 'bg-indigo-100 border-indigo-200 w-[350px]' : 'bg-blue-50 border-blue-100 w-[280px]'}
                    hover:shadow-md
                `}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="overflow-hidden">
                            <h3 className="text-sm font-bold text-slate-800 truncate">{node.titulo}</h3>
                            {node.cobertura && (
                                <p className="text-indigo-600 font-black text-xs mt-0.5">{node.cobertura}</p>
                            )}
                            {node.detalle && (
                                <p className="text-slate-500 text-[10px] mt-0.5 italic truncate">{node.detalle}</p>
                            )}
                        </div>

                        {hasChildren && (
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleNode(path); }}
                                className={`w-6 h-6 flex items-center justify-center rounded-lg border transition-all
                                    ${isExpanded ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-600'}
                                `}
                            >
                                {isExpanded ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
                            </button>
                        )}
                    </div>

                    {/* SVG Connector to Children (The Curved Path) */}
                    {hasChildren && isExpanded && (
                        <div className="absolute right-[-40px] top-1/2 w-10 overflow-visible pointer-events-none">
                            <svg width="40" height="200" viewBox="0 0 40 200" className="absolute top-0">
                                <path
                                    d="M 0 0 Q 20 0, 40 50"
                                    fill="none"
                                    stroke="#E2E8F0"
                                    strokeWidth="2"
                                />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Children Container */}
                {hasChildren && isExpanded && (
                    <div className="flex flex-col ml-14 space-y-4 animate-in fade-in slide-in-from-left-4 duration-500">
                        {node.children!.map((child, idx) =>
                            renderNode(child, `${path}-${idx}`, depth + 1)
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full bg-slate-50/30 p-6 select-none overflow-auto custom-scrollbar">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-indigo-600 rounded-lg text-white">
                        <Brain size={20} />
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 leading-none">Guía Maestra: {model.metadata.source_contract}</h1>
                </div>
                <p className="text-slate-400 font-bold text-xs uppercase tracking-widest pl-11">Estructura Dinámica de Prestaciones</p>
            </header>

            <main className="flex items-start min-h-[500px] pl-4 pt-4">
                {renderNode(model.root, 'root')}
            </main>
        </div>
    );
}
