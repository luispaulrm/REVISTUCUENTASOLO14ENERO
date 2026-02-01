import React, { useEffect, useState } from 'react';
import { LucideIcon } from 'lucide-react';

interface MentalBranchProps {
    title: string;
    icon: LucideIcon;
    delay: number;
    isVisible: boolean;
    children: React.ReactNode;
    colorClass: string;
    position: 'left' | 'right' | 'bottom';
}

export const MentalBranch: React.FC<MentalBranchProps> = ({
    title,
    icon: Icon,
    delay,
    isVisible,
    children,
    colorClass,
    position
}) => {
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
        if (isVisible) {
            const timer = setTimeout(() => setShouldRender(true), delay);
            return () => clearTimeout(timer);
        } else {
            setShouldRender(false);
        }
    }, [isVisible, delay]);

    if (!shouldRender) return null;

    const animations = {
        left: 'animate-in slide-in-from-right fade-in duration-500',
        right: 'animate-in slide-in-from-left fade-in duration-500',
        bottom: 'animate-in slide-in-from-top fade-in duration-500'
    };

    return (
        <div className={`p-6 bg-white rounded-3xl shadow-xl border border-slate-100 group hover:scale-105 transition-all duration-300 ${animations[position]}`}>
            <div className="flex items-center gap-3 mb-4">
                <div className={`p-2.5 rounded-xl transition-colors duration-300 ${colorClass}`}>
                    <Icon size={20} />
                </div>
                <h3 className="font-black text-sm uppercase tracking-tighter text-slate-900">{title}</h3>
            </div>
            {children}
        </div>
    );
};
