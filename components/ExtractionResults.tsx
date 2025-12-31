
import React from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Info, EyeOff } from 'lucide-react';
import { ExtractedAccount } from '../types';

interface ExtractionResultsProps {
  data: ExtractedAccount;
}

export const ExtractionResults: React.FC<ExtractionResultsProps> = ({ data }) => {
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({ 0: true });

  const toggleSection = (idx: number) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: data.currency || 'CLP',
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end border-b-2 border-slate-900 pb-4">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tighter uppercase">{data.clinicName || 'Entidad Clínica'}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-900 text-slate-400 rounded uppercase">Paciente</span>
            <p className="text-sm text-slate-300 font-medium">{data.patientName || 'N/A'}</p>
            <span className="text-slate-700 mx-1">•</span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-900 text-slate-400 rounded uppercase">Doc</span>
            <p className="text-sm text-slate-300 font-medium">{data.invoiceNumber || 'N/A'}</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Fecha de Auditoría</span>
          <p className="text-white font-bold bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 inline-block">{data.date || 'N/A'}</p>
        </div>
      </div>

      <div className="space-y-4">
        {data.sections.map((section, sIdx) => {
          const diff = section.sectionTotal - section.calculatedSectionTotal;
          const hasDiff = Math.abs(diff) > 5;

          return (
            <div key={sIdx} className={`bg-slate-950 border rounded-2xl overflow-hidden transition-all shadow-xl ${section.hasSectionError ? 'border-rose-900/50 ring-1 ring-rose-900/20' : 'border-slate-900'}`}>
              <button
                onClick={() => toggleSection(sIdx)}
                className={`w-full flex items-center justify-between p-4 hover:bg-slate-900 transition-colors ${section.hasSectionError ? 'bg-rose-950/10' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${section.hasSectionError ? 'bg-rose-950 text-rose-500' : 'bg-slate-900 text-slate-500'}`}>
                    {expanded[sIdx] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </div>
                  <span className="font-black text-slate-200 uppercase text-xs tracking-wider">{section.category}</span>
                  {section.hasSectionError && (
                    <div className="flex items-center gap-2">
                      {section.isTaxConfusion ? (
                        <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 bg-amber-900/50 text-amber-200 border border-amber-900 rounded-full font-black uppercase">
                          <Info size={10} /> Impuestos/Recargos (Chile)
                        </span>
                      ) : section.isUnjustifiedCharge ? (
                        <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 bg-rose-900/50 text-rose-200 border border-rose-900 rounded-full font-black animate-pulse uppercase">
                          <AlertTriangle size={10} /> Cobro No Justificado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-full font-black uppercase">
                          <AlertTriangle size={10} /> Discrepancia
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-rose-400 font-mono">
                        Dif: {formatCurrency(diff)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block mb-0.5">Total Sección (ISA)</span>
                  <span className="font-black text-white text-base">{formatCurrency(section.sectionTotal)}</span>
                </div>
              </button>

              {expanded[sIdx] && (
                <div className="px-4 pb-4">
                  {section.isUnjustifiedCharge && (
                    <div className="mb-4 p-4 bg-rose-950/20 border border-rose-900/30 rounded-2xl flex items-start gap-4 animate-in fade-in slide-in-from-top-2">
                      <div className="p-3 bg-rose-950 text-rose-500 rounded-xl shrink-0 shadow-sm border border-rose-900/50">
                        <AlertTriangle size={20} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-black text-rose-200 uppercase tracking-tighter flex items-center gap-2">
                          Auditoría Forense: Cobro No Justificado
                        </p>
                        <div className="text-[11px] text-rose-300/80 leading-relaxed font-medium space-y-1">
                          <p>• <strong>Total Clínica:</strong> {formatCurrency(section.sectionTotal)} (Extraído del resumen/subtotal de la sección en tu cuenta).</p>
                          <p>• <strong>Total Auditado:</strong> {formatCurrency(section.calculatedSectionTotal)} (Suma aritmética de todos los ítems detallados abajo).</p>
                          <p className="pt-1 mt-1 border-t border-rose-900/30 text-rose-400 font-bold italic">
                            Resultado: Se te está cobrando un excedente de {formatCurrency(Math.abs(section.sectionTotal - section.calculatedSectionTotal))} sin respaldo en el detalle de la cuenta.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {section.isTaxConfusion && (
                    <div className="mb-4 p-4 bg-amber-950/20 border border-amber-900/30 rounded-2xl flex items-start gap-4">
                      <div className="p-3 bg-amber-950 text-amber-500 rounded-xl shrink-0 shadow-sm border border-amber-900/50">
                        <Info size={20} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-black text-amber-200 uppercase tracking-tighter">Variación por Impuestos o Recargos Legales</p>
                        <p className="text-[11px] text-amber-300/80 leading-relaxed font-medium">
                          La diferencia de <strong>{formatCurrency(Math.abs(section.sectionTotal - section.calculatedSectionTotal))}</strong> corresponde a la aplicación de impuestos (IVA) o recargos específicos vigentes en el sistema de salud chileno que incrementan el valor neto detallado.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-xl border border-slate-900">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-900 text-slate-500 uppercase tracking-tighter font-black">
                        <tr>
                          <th className="px-4 py-3 w-10">#</th>
                          <th className="px-2 py-3">Descripción del Ítem</th>
                          <th className="py-3 text-center w-16">Cant</th>
                          <th className="py-3 text-right w-32">Precio (Neto)</th>
                          <th className="px-4 py-3 text-right w-32">Total ISA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900">
                        {section.items.map((item, iIdx) => (
                          <tr key={iIdx} className={`group hover:bg-slate-900/50 transition-colors ${item.hasCalculationError ? 'bg-amber-950/10' : ''}`}>
                            <td className="px-4 py-3 text-slate-600 font-mono text-[10px] font-bold">
                              {item.index || iIdx + 1}
                            </td>
                            <td className="px-2 py-3 text-slate-300 font-medium">
                              <div className="flex items-center gap-2">
                                {item.description}
                                {item.hasCalculationError && (
                                  <div className="group relative">
                                    <Info size={14} className="text-amber-500 cursor-help" />
                                    <div className="hidden group-hover:block absolute left-0 top-5 z-50 w-72 p-4 bg-black text-slate-300 text-[10px] rounded-2xl shadow-2xl border border-slate-800 leading-relaxed animate-in fade-in zoom-in-95">
                                      <p className="font-black text-amber-400 mb-2 uppercase tracking-widest flex items-center gap-2">
                                        <EyeOff size={12} /> Alerta de Trazabilidad
                                      </p>
                                      <div className="space-y-1 font-mono text-slate-400">
                                        <p>Fórmula: {item.quantity} × {formatCurrency(item.unitPrice)}</p>
                                        <p className="text-emerald-500 font-bold">Esperado: {formatCurrency(item.calculatedTotal)}</p>
                                        <p className="text-rose-500 font-bold">En Cuenta: {formatCurrency(item.total)}</p>
                                      </div>
                                      <p className="mt-3 text-slate-500 italic border-t border-slate-800 pt-2">
                                        Diferencia esperada por la aplicación de IVA, Impuestos Específicos o Recargos Legales sobre el valor neto.
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-3 text-center text-slate-500 font-bold font-mono">{item.quantity}</td>
                            <td className="py-3 text-right text-slate-500 font-mono">{formatCurrency(item.unitPrice)}</td>
                            <td className={`px-4 py-3 text-right font-black font-mono text-sm ${item.hasCalculationError ? 'text-amber-500' : 'text-slate-100'}`}>
                              {formatCurrency(item.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-900/50 border-t-2 border-slate-900">
                        <tr>
                          <td colSpan={3} className="px-4 py-4 text-right font-black text-slate-500 uppercase tracking-widest text-[10px]">Total Real Auditado (Suma de ítems)</td>
                          <td className={`px-4 py-4 text-right font-black text-base ${section.hasSectionError ? 'text-rose-500' : 'text-white'}`}>
                            {formatCurrency(section.calculatedSectionTotal)}
                          </td>
                        </tr>
                        {section.hasSectionError && (
                          <tr className={section.isUnjustifiedCharge ? 'bg-rose-950/20' : 'bg-amber-950/20'}>
                            <td colSpan={4} className={`px-4 py-2 text-center text-[9px] font-black uppercase tracking-[0.2em] ${section.isUnjustifiedCharge ? 'text-rose-500' : 'text-amber-500'}`}>
                              {section.isUnjustifiedCharge
                                ? 'Detectada discrepancia crítica: La clínica cobra más de lo respaldado en los ítems.'
                                : section.isTaxConfusion
                                  ? 'Posible inconsistencia por aplicación de IVA (Neto vs Bruto).'
                                  : 'Atención: La suma declarada por la clínica no coincide con el detalle de los ítems.'}
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
