import React from 'react';
import { CheckCircle, AlertTriangle, Scale, CreditCard, ListOrdered } from 'lucide-react';
import { ExtractedAccount } from '../types';

interface AuditSummaryProps {
  data: ExtractedAccount;
}

export const AuditSummary: React.FC<AuditSummaryProps> = ({ data }) => {
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: data.currency || 'CLP',
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 text-slate-500 mb-2">
          <CreditCard size={20} />
          <span className="text-sm font-medium uppercase tracking-wider">Total Declarado</span>
        </div>
        <div className="text-3xl font-bold text-slate-900">{formatCurrency(data.clinicStatedTotal)}</div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 text-slate-500 mb-2">
          <Scale size={20} />
          <span className="text-sm font-medium uppercase tracking-wider">Suma Auditada</span>
        </div>
        <div className="text-3xl font-bold text-indigo-600">{formatCurrency(data.extractedTotal)}</div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 text-slate-500 mb-2">
          <ListOrdered size={20} />
          <span className="text-sm font-medium uppercase tracking-wider">Ítems Auditados</span>
        </div>
        <div className="text-3xl font-bold text-slate-900">{data.totalItems || 0}</div>
      </div>

      <div className={`p-6 rounded-xl shadow-sm border ${data.isBalanced ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
        <div className="flex items-center gap-3 mb-2">
          {data.isBalanced ? (
            <CheckCircle className="text-emerald-600" size={24} />
          ) : (
            <AlertTriangle className="text-rose-600" size={24} />
          )}
          <span className={`text-sm font-bold uppercase tracking-wider ${data.isBalanced ? 'text-emerald-800' : 'text-rose-800'}`}>
            Estado
          </span>
        </div>
        <div className={`text-2xl font-bold ${data.isBalanced ? 'text-emerald-700' : 'text-rose-700'}`}>
          {data.isBalanced ? 'Cuadrado' : 'Discrepancia'}
        </div>
        {!data.isBalanced && (
          <div className="text-sm text-rose-600 mt-1 font-medium">
            Dif: {formatCurrency(data.discrepancy)}
          </div>
        )}
      </div>

      {data.valorUnidadReferencia && (
        <div className="bg-indigo-900 p-6 rounded-xl shadow-lg border border-indigo-700 col-span-1 sm:col-span-2 lg:col-span-4 mt-2">
          <div className="flex items-center gap-3 text-indigo-200 mb-2">
            <Scale size={24} className="text-indigo-400" />
            <span className="text-lg font-bold uppercase tracking-widest">Deducción Forense (RTC NORM)</span>
          </div>
          <div className="flex flex-col sm:flex-row items-baseline gap-4">
            <div className="text-4xl font-extrabold text-white">
              {(data as any).valorUnidadReferencia}
            </div>
            <div className="text-indigo-300 text-sm italic">
              Este valor ha sido reconstruido matemáticamente desde su liquidación y contrato.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
