import React, { useState } from 'react';
import App from '../App';
import PAMApp from './PAMApp';
import { Pill, Receipt } from 'lucide-react';

type DocumentType = 'bill' | 'pam';

export function AppWithTabs() {
    const [activeTab, setActiveTab] = useState<DocumentType>('bill');

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
                        onClick={() => setActiveTab('bill')}
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
                        onClick={() => setActiveTab('pam')}
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
                        <Pill size={18} />
                        PAM (Medicamentos)
                    </button>
                </div>
            </div>

            {/* Content */}
            <div>
                {activeTab === 'bill' && <App />}
                {activeTab === 'pam' && <PAMApp />}
            </div>
        </div>
    );
}
