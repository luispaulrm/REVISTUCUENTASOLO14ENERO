import React from 'react';
import { CheckCircle, AlertTriangle, Scale, CreditCard, ListOrdered, Calculator } from 'lucide-react';
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
          <span className="text-sm font-medium uppercase tracking-wider">Suma Extracción</span>
        </div>
        <div className="text-3xl font-bold text-indigo-600">{formatCurrency(data.extractedTotal)}</div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 text-slate-500 mb-2">
          <ListOrdered size={20} />
          <span className="text-sm font-medium uppercase tracking-wider">Ítems Procesados</span>
        </div>
        <div className="text-3xl font-bold text-slate-900">{data.totalItems || 0}</div>
      </div>

      {data.valorUnidadReferencia && (
        <div className="p-6 rounded-xl shadow-sm border bg-indigo-50 border-indigo-200">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600">
              <Calculator size={20} />
            </div>
            <span className="text-xs font-bold text-indigo-600">INFERIDO</span>
          </div>
          <p className="text-sm text-slate-500 mb-1">Unidad Forense (AC2)</p>
          <p className="text-xl font-bold text-indigo-700">{data.valorUnidadReferencia}</p>
        </div>
      )}

      <div className={`p-6 rounded-xl shadow-sm border ${data.isBalanced ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className={`p-2 rounded-lg ${data.isBalanced ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
            <Scale size={20} />
          </div>
          <span className={`text-xs font-bold ${data.isBalanced ? 'text-emerald-600' : 'text-rose-600'}`}>
            {data.isBalanced ? 'CONCILIADO' : 'DESCUADRE'}
          </span>
        </div>
        <p className="text-sm text-slate-500 mb-1">Estado Balance</p>
        <p className={`text-xl font-bold ${data.isBalanced ? 'text-emerald-700' : 'text-rose-700'}`}>
          {data.isBalanced ? 'Cuadre Perfecto' : `$${Math.abs(data.clinicStatedTotal - data.extractedTotal).toLocaleString()}`}
        </p>
      </div>

    </div >
  );
};
