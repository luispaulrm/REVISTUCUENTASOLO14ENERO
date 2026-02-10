import React from 'react';
import {
    ChevronRight,
    ChevronDown,
    CircleDashed,
    Layers
} from 'lucide-react';
import { TaxonomySkeleton } from '../types';

interface SkeletonTreeViewProps {
    skeleton: TaxonomySkeleton;
}

const SkeletonNode: React.FC<{ node: TaxonomySkeleton; depth: number }> = ({ node, depth }) => {
    const [isOpen, setIsOpen] = React.useState(true);
    const hasChildren = node.children && node.children.length > 0;

    return (
        <div className="select-none">
            <div
                className={`flex items-center gap-1.5 py-0.5 group ${hasChildren ? 'cursor-pointer' : ''}`}
                onClick={() => hasChildren && setIsOpen(!isOpen)}
                style={{ paddingLeft: `${depth * 12}px` }}
            >
                <div className="w-4 h-4 flex items-center justify-center text-slate-400 group-hover:text-slate-600">
                    {hasChildren ? (
                        isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                    ) : (
                        <div className="w-1 h-1 bg-slate-200 rounded-full" />
                    )}
                </div>

                <span className={`text-[11px] font-medium tracking-tight ${depth === 0 ? 'text-slate-900 font-bold uppercase' : 'text-slate-600'}`}>
                    {node.name}
                </span>

                {node.total_count > 0 && (
                    <span className="text-[9px] text-slate-400 ml-1 font-mono">
                        ({node.total_count})
                    </span>
                )}
            </div>

            {hasChildren && isOpen && (
                <div>
                    {node.children!.map((child, idx) => (
                        <SkeletonNode key={`${child.name}-${idx}`} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

export const SkeletonTreeView: React.FC<SkeletonTreeViewProps> = ({ skeleton }) => {
    if (!skeleton) return null;

    const hasChildren = skeleton.children && skeleton.children.length > 0;

    return (
        <div className="mt-4 mb-6">
            <div className="flex items-center gap-2 mb-2 px-1">
                <Layers size={14} className="text-slate-400" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estructura Documental</h3>
            </div>

            <div className="border-l border-slate-100 ml-1.5 pl-2 py-1">
                {!hasChildren ? (
                    <div className="flex items-center gap-2 text-slate-400 italic text-[11px] py-2">
                        <CircleDashed size={12} />
                        <span>Sin estructura jerárquica detectada</span>
                    </div>
                ) : (
                    <SkeletonNode node={skeleton} depth={0} />
                )}
            </div>
        </div>
    );
};
