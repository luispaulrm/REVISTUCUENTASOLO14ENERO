import React, { useState } from 'react';
import App from '../App';
import PAMApp from './PAMApp';
import ContractApp from './ContractApp';
import { ShieldCheck, Receipt, Scale } from 'lucide-react';

type DocumentType = 'bill' | 'pam' | 'contract';

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
                                ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                        >
                            <Receipt size={16} />
                            Cuentas Clínicas
                        </button>

                        <button
                            onClick={() => handleTabChange('pam')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'pam'
                                ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                        >
                            <ShieldCheck size={16} />
                            PAM (Coberturas)
                        </button>

                        <button
                            onClick={() => handleTabChange('contract')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'contract'
                                ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                        >
                            <Scale size={16} />
                            Contratos
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
                <div style={{ display: activeTab === 'contract' ? 'block' : 'none' }}>
                    <ContractApp />
                </div>
            </div>
        </div>
    );
}
