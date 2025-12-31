import React from 'react';
import { PamDocument } from './pamService';
import { FileText, User, Calendar, Pill, Activity } from 'lucide-react';

interface PAMResultsProps {
    data: PamDocument;
}

export function PAMResults({ data }: PAMResultsProps) {
    return (
        <div className="pam-results">
            {/* Header con información del paciente */}
            <div className="pam-header" style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                padding: '2rem',
                borderRadius: '12px',
                color: 'white',
                marginBottom: '2rem'
            }}>
                <h2 style={{ margin: 0, marginBottom: '1rem', fontSize: '1.8rem' }}>
                    📋 Plan Anual de Medicamentos
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <User size={18} />
                            <strong>Paciente:</strong>
                        </div>
                        <div style={{ paddingLeft: '1.8rem' }}>{data.patient}</div>
                        {data.rut !== 'N/A' && <div style={{ paddingLeft: '1.8rem', fontSize: '0.9rem', opacity: 0.9 }}>RUT: {data.rut}</div>}
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <Activity size={18} />
                            <strong>Médico:</strong>
                        </div>
                        <div style={{ paddingLeft: '1.8rem' }}>{data.doctor}</div>
                        {data.specialty !== 'N/A' && <div style={{ paddingLeft: '1.8rem', fontSize: '0.9rem', opacity: 0.9 }}>{data.specialty}</div>}
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <Calendar size={18} />
                            <strong>Fecha:</strong>
                        </div>
                        <div style={{ paddingLeft: '1.8rem' }}>{data.date}</div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <FileText size={18} />
                            <strong>Vigencia:</strong>
                        </div>
                        <div style={{ paddingLeft: '1.8rem' }}>{data.validity}</div>
                    </div>
                </div>
            </div>

            {/* Diagnóstico */}
            {data.diagnosis && data.diagnosis !== 'N/A' && (
                <div style={{
                    background: '#fef3c7',
                    border: '2px solid #f59e0b',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '2rem'
                }}>
                    <strong style={{ color: '#92400e' }}>🏥 Diagnóstico:</strong>
                    <p style={{ margin: '0.5rem 0 0 0', color: '#78350f' }}>{data.diagnosis}</p>
                </div>
            )}

            {/* Tabla de Medicamentos */}
            <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <Pill size={24} />
                    Medicamentos Prescritos ({data.totalMedications})
                </h3>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #d1d5db' }}>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>#</th>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Medicamento</th>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Dosis</th>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Frecuencia</th>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Duración</th>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Cantidad</th>
                                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Observaciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.medications.map((med, idx) => (
                                <tr key={idx} style={{
                                    borderBottom: '1px solid #e5e7eb',
                                    background: idx % 2 === 0 ? 'white' : '#f9fafb'
                                }}>
                                    <td style={{ padding: '0.75rem' }}>{med.index}</td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <strong>{med.name}</strong>
                                        <br />
                                        <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                                            {med.concentration} - {med.form}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>{med.dose}</td>
                                    <td style={{ padding: '0.75rem' }}>{med.frequency}</td>
                                    <td style={{ padding: '0.75rem' }}>{med.duration}</td>
                                    <td style={{ padding: '0.75rem' }}>{med.totalQuantity}</td>
                                    <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#6b7280' }}>
                                        {med.observations || '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Métricas de IA */}
            {data.usage && (
                <div style={{
                    background: '#e0f2fe',
                    border: '2px solid #0ea5e9',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginTop: '2rem'
                }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#0c4a6e' }}>📊 Métricas de IA</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#075985' }}>Tokens Entrada</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0c4a6e' }}>{data.usage.promptTokens}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#075985' }}>Tokens Salida</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0c4a6e' }}>{data.usage.candidatesTokens}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#075985' }}>Total Tokens</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0c4a6e' }}>{data.usage.totalTokens}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#075985' }}>Costo Estimado</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0c4a6e' }}>${data.usage.estimatedCostCLP} CLP</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
