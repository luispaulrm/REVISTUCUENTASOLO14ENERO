import React from 'react';
import {
    Database,
    Activity,
    Pill,
    User,
    CheckCircle,
    ChevronRight,
    ChevronDown,
    Box,
    Stethoscope
} from 'lucide-react';
import { TaxonomySkeleton } from '../types';

interface SkeletonTreeViewProps {
    skeleton: TaxonomySkeleton;
}

const getCategoryIcon = (name: string) => {
    const norm = name.toLowerCase();
    if (norm.includes('hospitalización')) return <Activity size={14} className="text-indigo-500" />;
    if (norm.includes('exámenes')) return <Database size={14} className="text-emerald-500" />;
    if (norm.includes('procedimientos')) return <Stethoscope size={14} className="text-amber-500" />;
    if (norm.includes('medicamentos') || norm.includes('materiales')) return <Pill size={14} className="text-blue-500" />;
    if (norm.includes('honorarios')) return <User size={14} className="text-purple-500" />;
    if (norm.includes('otros')) return <Box size={14} className="text-slate-400" />;
    return <CheckCircle size={14} className="text-slate-400" />;
};

const SkeletonNode: React.FC<{ node: TaxonomySkeleton; depth: number }> = ({ node, depth }) => {
    const [isOpen, setIsOpen] = React.useState(true);
    const hasChildren = node.children && node.children.length > 0;

    return (
        <div className="ml-2">
            <div
                className={`flex items-center gap-2 py-1 select-none ${hasChildren ? 'cursor-pointer hover:bg-slate-50' : ''} rounded transition-colors`}
                onClick={() => hasChildren && setIsOpen(!isOpen)}
            >
                <div className="flex items-center justify-center w-4 h-4">
                    {hasChildren ? (
                        isOpen ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />
                    ) : (
                        <div className="w-1 h-1 bg-slate-300 rounded-full" />
                    )}
                </div>

                {getCategoryIcon(node.name)}

                <span className={`text-[11px] uppercase tracking-tight font-bold ${depth === 0 ? 'text-slate-900 border-b border-slate-900' : 'text-slate-600'}`}>
                    {node.name}
                </span>

                <span className="text-[10px] font-mono font-black text-slate-400 bg-slate-100 px-1 rounded">
                    {node.total_count}
                </span>
            </div>

            {hasChildren && isOpen && (
                <div className="ml-2 pl-2 border-l border-slate-200 mt-0.5 space-y-0.5">
                    {node.children!.map((child, idx) => (
                        <SkeletonNode key={`${child.name}-${idx}`} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

export const SkeletonTreeView: React.FC<SkeletonTreeViewProps> = ({ skeleton }) => {
    if (!skeleton) {
        console.warn('[SkeletonTreeView] Render blocked: No skeleton data provided.');
        return null;
    }

    const hasChildren = skeleton.children && skeleton.children.length > 0;

    return (
        <div className="bg-white border-2 border-slate-900 p-4 rounded-2xl shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-6 bg-slate-900 rounded-full" />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tighter">Esqueleto de la Cuenta</h3>
                <span className="text-[10px] text-slate-400 font-bold ml-auto px-2 py-0.5 bg-slate-100 rounded border border-slate-200">
                    Clasificación Automática
                </span>
            </div>

            {!hasChildren ? (
                <div className="p-4 text-center border-2 border-dashed border-slate-200 rounded-xl">
                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                        Sin ramificaciones detectadas (Taxonomía v1.0)
                    </p>
                </div>
            ) : (
                <div className="bg-slate-50/50 p-2 rounded-xl border border-slate-100">
                    <SkeletonNode node={skeleton} depth={0} />
                </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-[9px] text-slate-400 font-medium italic">
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                <span>Estructura jerárquica detectada vía Módulo de Taxonomía v1.0</span>
            </div>
        </div>
    );
};
