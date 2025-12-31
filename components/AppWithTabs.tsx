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
        <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
            {/* Tab Navigation */}
            <div style={{
                background: 'white',
                borderBottom: '2px solid #e2e8f0',
                position: 'sticky',
                top: 0,
                zIndex: 100
            }}>
                <div style={{
                    maxWidth: '1200px',
                    margin: '0 auto',
                    display: 'flex',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem'
                }}>
                    <button
                        onClick={() => handleTabChange('bill')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem 1.5rem',
                            fontSize: '0.875rem',
                            fontWeight: 'bold',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            background: activeTab === 'bill' ? '#4f46e5' : 'transparent',
                            color: activeTab === 'bill' ? 'white' : '#64748b',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Receipt size={18} />
                        Cuentas Clínicas
                    </button>

                    <button
                        onClick={() => handleTabChange('pam')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem 1.5rem',
                            fontSize: '0.875rem',
                            fontWeight: 'bold',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            background: activeTab === 'pam' ? '#7c3aed' : 'transparent',
                            color: activeTab === 'pam' ? 'white' : '#64748b',
                            transition: 'all 0.2s'
                        }}
                    >
                        <ShieldCheck size={18} />
                        PAM (Coberturas)
                    </button>
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
