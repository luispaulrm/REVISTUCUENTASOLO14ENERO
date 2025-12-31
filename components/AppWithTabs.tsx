import React, { useState } from 'react';
import App from '../App';
import PAMApp from './PAMApp';
import { ShieldCheck, Receipt } from 'lucide-react';

type DocumentType = 'bill' | 'pam';

export function AppWithTabs() {
    const [activeTab, setActiveTab] = useState<DocumentType>('bill');

    const handleTabChange = (tab: DocumentType) => {
        setActiveTab(tab);
    };

    return (
        <div className="min-h-screen bg-white text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
            {/* Tab Navigation */}
            <div className="sticky top-0 z-[100] bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
                <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                        <button
                            onClick={() => handleTabChange('bill')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'bill'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
                                }`}
                        >
                            <Receipt size={16} />
                            Cuentas Clínicas
                        </button>

                        <button
                            onClick={() => handleTabChange('pam')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'pam'
                                ? 'bg-violet-600 text-white shadow-lg shadow-violet-200'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
                                }`}
                        >
                            <ShieldCheck size={16} />
                            PAM (Coberturas)
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div>
                <div style={{ display: activeTab === 'bill' ? 'block' : 'none' }}>
                    <App />
                </div>
                <div style={{ display: activeTab === 'pam' ? 'block' : 'none' }}>
                    <PAMApp />
                </div>
            </div>
        </div>
    );
}
