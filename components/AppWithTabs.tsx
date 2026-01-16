import React, { useState } from 'react';
import App from '../App';
import PAMApp from './PAMApp';
import ContractApp from './ContractApp';
import ForensicApp from './ForensicApp';
import PdfProjector from './PdfProjector';

import TotalAuditV8 from './TotalAuditV8';
import { ShieldCheck, Receipt, Scale, Gavel, Eye, FileSpreadsheet, Zap } from 'lucide-react';

type DocumentType = 'bill' | 'pam' | 'contract' | 'audit' | 'view' | 'm7' | 'm8';

export function AppWithTabs() {
    const [activeTab, setActiveTab] = useState<DocumentType>('bill');

    // Clear session data on refresh (mount)
    // Clear session data on refresh (mount) - DISABLED FOR PERSISTENCE
    // React.useEffect(() => {
    //     const hasData = localStorage.getItem('clinic_audit_result') ||
    //         localStorage.getItem('pam_audit_result') ||
    //         localStorage.getItem('contract_audit_result') ||
    //         localStorage.getItem('html_projection_result');

    //     if (hasData) {
    //         console.log('[System] ℹ️ Sesión anterior detectada y preservada.');
    //         // localStorage.removeItem('clinic_audit_result');
    //         // localStorage.removeItem('pam_audit_result');
    //         // localStorage.removeItem('contract_audit_result');
    //         // localStorage.removeItem('html_projection_result');
    //     }
    // }, []);

    const handleTabChange = (tab: DocumentType) => {
        setActiveTab(tab);
    };

    return (
        <div className="min-h-screen bg-white text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
            {/* Tab Navigation */}
            <div className="sticky top-0 z-[100] bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
                <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
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

                        <button
                            onClick={() => handleTabChange('audit')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'audit'
                                ? 'bg-slate-900 text-emerald-400 shadow-lg shadow-emerald-900/20'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                        >
                            <Gavel size={16} />
                            Auditoría Forense
                        </button>

                        <button
                            onClick={() => handleTabChange('view')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'view'
                                ? 'bg-slate-900 text-indigo-400 shadow-lg shadow-indigo-900/20'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                        >
                            <Eye size={16} />
                            Contrato Proyector
                        </button>


                        <button
                            onClick={() => handleTabChange('m8')}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${activeTab === 'm8'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                }`}
                        >
                            <Zap size={16} />
                            Auditoría Total M8
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
                <div style={{ display: activeTab === 'audit' ? 'block' : 'none' }}>
                    <ForensicApp />
                </div>
                <div style={{ display: activeTab === 'view' ? 'block' : 'none' }}>
                    <PdfProjector />
                </div>

                <div style={{ display: activeTab === 'm8' ? 'block' : 'none' }}>
                    <TotalAuditV8 />
                </div>
            </div>
        </div>
    );
}
