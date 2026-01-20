
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
          <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">{data.clinicName || 'Entidad Clínica'}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded uppercase border border-slate-200">Paciente</span>
            <p className="text-sm text-slate-600 font-medium">{data.patientName || 'N/A'}</p>
            <span className="text-slate-300 mx-1">•</span>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded uppercase border border-slate-200">Doc</span>
            <p className="text-sm text-slate-600 font-medium">{data.invoiceNumber || 'N/A'}</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Fecha de Auditoría</span>
          <p className="text-slate-700 font-bold bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 inline-block">{data.date || 'N/A'}</p>
        </div>
      </div>

      <div className="space-y-4">
        {data.sections.map((section, sIdx) => {
          const diff = section.sectionTotal - section.calculatedSectionTotal;
          const hasDiff = Math.abs(diff) > 5;

          return (
            <div key={sIdx} className={`bg-white border rounded-2xl overflow-hidden transition-all shadow-sm hover:shadow-md ${section.hasSectionError ? 'border-rose-200 ring-1 ring-rose-100' : 'border-slate-200'}`}>
              <button
                onClick={() => toggleSection(sIdx)}
                className={`w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors ${section.hasSectionError ? 'bg-rose-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${section.hasSectionError ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    {expanded[sIdx] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </div>
                  <span className="font-black text-slate-700 uppercase text-xs tracking-wider">{section.category}</span>
                  {section.hasSectionError && (
                    <div className="flex items-center gap-2">
                      {section.isTaxConfusion ? (
                        <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-black uppercase">
                          <Info size={10} /> Impuestos/Recargos (Chile)
                        </span>
                      ) : section.isUnjustifiedCharge ? (
                        <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 bg-rose-100 text-rose-700 border border-rose-200 rounded-full font-black animate-pulse uppercase">
                          <AlertTriangle size={10} /> Cobro No Justificado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-full font-black uppercase">
                          <AlertTriangle size={10} /> Discrepancia
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-rose-600 font-mono">
                        Dif: {formatCurrency(diff)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mb-0.5">Total Sección (ISA)</span>
                  <span className="font-black text-slate-900 text-base">{formatCurrency(section.sectionTotal)}</span>
                </div>
              </button>

              {expanded[sIdx] && (
                <div className="px-4 pb-4">
                  {section.isUnjustifiedCharge && (
                    <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-4 animate-in fade-in slide-in-from-top-2">
                      <div className="p-3 bg-rose-100 text-rose-600 rounded-xl shrink-0 shadow-sm border border-rose-200">
                        <AlertTriangle size={20} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-black text-rose-700 uppercase tracking-tighter flex items-center gap-2">
                          Auditoría Forense: Cobro No Justificado
                        </p>
                        <div className="text-[11px] text-rose-600/80 leading-relaxed font-medium space-y-1">
                          <p>• <strong>Total Clínica:</strong> {formatCurrency(section.sectionTotal)} (Extraído del resumen/subtotal de la sección en tu cuenta).</p>
                          <p>• <strong>Total Auditado:</strong> {formatCurrency(section.calculatedSectionTotal)} (Suma aritmética de todos los ítems detallados abajo).</p>
                          <p>• <strong>Conclusión:</strong> El cobro de esta sección es <strong>mayor</strong> a la suma de sus partes. Faltan detalles por valor de <strong>{formatCurrency(diff)}</strong>.</p>
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
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-950 text-white uppercase tracking-tighter font-black">
                        <tr>
                          <th className="px-4 py-3 w-10">#</th>
                          <th className="px-2 py-3">Descripción del Ítem</th>
                          <th className="py-3 text-center w-12">Cant</th>
                          <th className="py-3 text-right w-24">Precio (Neto)</th>
                          <th className="px-2 py-3 text-right w-24">Valor ISA</th>
                          <th className="px-2 py-3 text-right w-24 text-emerald-400">Bonif</th>
                          <th className="px-4 py-3 text-right w-24 font-black">Copago</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {section.items.map((item, iIdx) => (
                          <tr key={iIdx} className={`group hover:bg-slate-50 transition-colors ${item.hasCalculationError ? 'bg-amber-50' : ''}`}>
                            <td className="px-4 py-3 text-slate-900 font-mono text-[10px] font-bold">
                              {item.index || iIdx + 1}
                            </td>
                            <td className="px-2 py-3 text-slate-700 font-medium">
                              <div className="flex items-center gap-2">
                                {item.description}
                                {item.hasCalculationError && (
                                  <div className="group relative">
                                    <Info size={14} className="text-amber-600 cursor-help" />
                                    <div className="hidden group-hover:block absolute left-0 top-5 z-50 w-72 p-4 bg-white text-slate-600 text-[10px] rounded-2xl shadow-xl border border-slate-200 leading-relaxed animate-in fade-in zoom-in-95">
                                      <p className="font-black text-amber-600 mb-2 uppercase tracking-widest flex items-center gap-2">
                                        <EyeOff size={12} /> Alerta de Trazabilidad
                                      </p>
                                      <div className="space-y-1 font-mono text-slate-500">
                                        <p>Fórmula: {item.quantity} × {formatCurrency(item.unitPrice)}</p>
                                        <p className="text-emerald-600 font-bold">Esperado: {formatCurrency(item.calculatedTotal)}</p>
                                        <p className="text-rose-600 font-bold">En Cuenta: {formatCurrency(item.total)}</p>
                                      </div>
                                      <p className="mt-3 text-slate-400 italic border-t border-slate-100 pt-2">
                                        Diferencia esperada por la aplicación de IVA, Impuestos Específicos o Recargos Legales sobre el valor neto.
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-3 text-center text-slate-600 font-bold font-mono">{item.quantity}</td>
                            {/* COL 4: Unit Price */}
                            <td className="px-3 py-2 text-right">
                              <div className="font-mono text-gray-900">
                                {formatCurrency(item.unitPrice)}
                              </div>
                              {item.unitPriceTrust !== undefined && item.unitPriceTrust < 0.5 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800" title="Precio Unitario no confiable (posible desplazamiento)">
                                  ⚠️ Dudoso
                                </span>
                              )}
                            </td>

                            {/* COL 5: Total (replaces Valor ISA and adds new badges) */}
                            <td className="px-3 py-2 text-right">
                              <div>
                                <div className={`font-mono font-medium ${item.hasCalculationError ? 'text-red-600' : 'text-gray-900'}`}>
                                  {formatCurrency(item.total)}
                                </div>
                                {item.hasCalculationError && (
                                  <div className="text-xs text-red-500 mt-1">
                                    Calc: {formatCurrency(item.calculatedTotal)}
                                  </div>
                                )}

                                {/* Billing Model Badges */}
                                <div className="flex flex-col items-end gap-1 mt-1">
                                  {item.billingModel === 'PRORATED_REFERENCE_PRICE' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800" title="Precio referencial por caja/pack. Total prorrateado.">
                                      📦 Prorrateo
                                    </span>
                                  )}
                                  {item.billingModel === 'UNIT_PRICE_UNTRUSTED' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-800" title="Posible error de lectura o desplazamiento de columnas">
                                      ⚠️ Extracción
                                    </span>
                                  )}
                                  {item.valorIsa > 0 && item.valorIsa !== item.total && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800" title={`Valor Autorizado (ISA): ${formatCurrency(item.valorIsa)}`}>
                                      ✅ ISA: {formatCurrency(item.valorIsa)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-3 text-right text-emerald-600 font-mono font-bold text-xs">
                              {item.bonificacion ? formatCurrency(item.bonificacion) : '-'}
                            </td>
                            <td className={`px-4 py-3 text-right font-black font-mono text-sm ${item.hasCalculationError ? 'text-amber-600' : 'text-slate-900'}`}>
                              {item.copago ? formatCurrency(item.copago) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan={6} className="px-4 py-4 text-right font-black text-slate-400 uppercase tracking-widest text-[10px]">Total Real Auditado (Suma de ítems)</td>
                          <td className={`px-4 py-4 text-right font-black text-base ${section.hasSectionError ? 'text-rose-600' : 'text-slate-900'}`}>
                            {formatCurrency(section.calculatedSectionTotal)}
                          </td>
                        </tr>
                        {section.hasSectionError && (
                          <tr className={section.isUnjustifiedCharge ? 'bg-rose-50' : 'bg-amber-50'}>
                            <td colSpan={4} className={`px-4 py-2 text-center text-[9px] font-black uppercase tracking-[0.2em] ${section.isUnjustifiedCharge ? 'text-rose-600' : 'text-amber-600'}`}>
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
