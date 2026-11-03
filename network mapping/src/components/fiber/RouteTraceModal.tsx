import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import {
  X,
  Activity,
  AlertTriangle,
  Search,
  MapPin
} from 'lucide-react';

const statusPill: Record<string, string> = {
  Pass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Warning: 'text-amber-800 bg-amber-50 border-amber-200',
  Fail: 'text-rose-700 bg-rose-50 border-rose-200',
  Unknown: 'text-slate-600 bg-slate-50 border-slate-200'
};

const formatLength = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

export const RouteTraceModal: React.FC = () => {
  const {
    isRouteTraceModalOpen,
    setIsRouteTraceModalOpen,
    activeTracePath,
    activeTraceSummary,
    customers,
    equipments,
    cables,
    traceNetworkPath,
    clearTrace,
    flyToLocation,
    showToast
  } = useNetwork();

  const [searchTarget, setSearchTarget] = useState('');

  if (!isRouteTraceModalOpen) return null;

  const traceAndFly = (id: string, lat?: number, lng?: number) => {
    if (traceNetworkPath(id) && lat !== undefined && lng !== undefined) {
      flyToLocation(lat, lng, 17);
    }
  };

  const handleSearchTrace = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchTarget.trim().toLowerCase();
    if (!q) return;

    // Exact identifiers first, then partial name matches.
    const cust =
      customers.find(c => c.id.toLowerCase() === q || c.ontSerialNumber.toLowerCase() === q) ||
      undefined;
    if (cust) return traceAndFly(cust.id, cust.lat, cust.lng);

    const eq = equipments.find(x => x.id.toLowerCase() === q);
    if (eq) return traceAndFly(eq.id, eq.lat, eq.lng);

    const cable = cables.find(c => c.id.toLowerCase() === q);
    if (cable) return traceAndFly(cable.id, cable.coordinates[0]?.[0], cable.coordinates[0]?.[1]);

    const custByName = customers.find(c => c.name.toLowerCase().includes(q));
    if (custByName) return traceAndFly(custByName.id, custByName.lat, custByName.lng);

    const eqByName = equipments.find(x => x.name.toLowerCase().includes(q));
    if (eqByName) return traceAndFly(eqByName.id, eqByName.lat, eqByName.lng);

    // Faults, closures, splitters and PON ports are resolved by the context.
    if (!traceNetworkPath(searchTarget.trim())) {
      showToast('warning', 'No Match', `Nothing matching "${searchTarget.trim()}" was found.`);
    }
  };

  const quickTargets = customers.slice(0, 5);
  const summary = activeTraceSummary;

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Advanced Optical Route Trace</h2>
              <p className="text-[11px] text-slate-500">End-to-End OLT to Customer ONT Physical & Logical Path</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {activeTracePath && (
              <button
                onClick={clearTrace}
                className="px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Clear trace
              </button>
            )}
            <button
              onClick={() => setIsRouteTraceModalOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Search Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <form onSubmit={handleSearchTrace} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Trace by customer ID or name, ONT serial, equipment, cable, fault or PON port..."
                value={searchTarget}
                onChange={e => setSearchTarget(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 shadow-xs"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
            >
              Trace Route
            </button>
          </form>

          {/* Quick Trace Buttons */}
          {quickTargets.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto text-[11px]">
              <span className="text-slate-400 font-semibold mr-1">Quick Trace:</span>
              {quickTargets.map(c => (
                <button
                  key={c.id}
                  onClick={() => traceAndFly(c.id, c.lat, c.lng)}
                  title={c.name}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg font-mono text-blue-700 transition-colors"
                >
                  {c.id}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Trace Flow Sequence */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTracePath && activeTracePath.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-xs text-slate-800">
                  {summary?.targetLabel ? `${summary.targetLabel} ? ` : ''}
                  {activeTracePath.length} nodes &bull; {formatLength(summary?.totalLengthMeters ?? 0)} &bull; {(summary?.totalLossDb ?? 0).toFixed(2)} dB loss
                </span>
                {summary && (
                  <span className={`border px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusPill[summary.budgetStatus]}`}>
                    {summary.estimatedRxDbm !== undefined
                      ? `Est. Rx ${summary.estimatedRxDbm.toFixed(1)} dBm (${summary.budgetStatus})`
                      : `Link budget: ${summary.budgetStatus}`}
                  </span>
                )}
              </div>

              {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">OLT Tx power</div>
                    <div className="font-mono font-bold text-slate-800">{summary.txPowerDbm !== undefined ? `${summary.txPowerDbm.toFixed(1)} dBm` : 'n/a'}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Estimated Rx</div>
                    <div className="font-mono font-bold text-slate-800">{summary.estimatedRxDbm !== undefined ? `${summary.estimatedRxDbm.toFixed(1)} dBm` : 'n/a'}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Measured Rx</div>
                    <div className="font-mono font-bold text-slate-800">{summary.measuredRxDbm !== undefined ? `${summary.measuredRxDbm.toFixed(1)} dBm` : 'n/a'}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Downstream customers</div>
                    <div className="font-mono font-bold text-slate-800">{summary.downstreamCustomerCount}</div>
                  </div>
                </div>
              )}

              {summary && summary.warnings.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-[11px] text-amber-900 space-y-1">
                  {summary.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Vertical Detailed Step Trace */}
              <div className="relative pl-6 space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gradient-to-b before:from-blue-600 before:via-emerald-500 before:to-blue-600">
                {activeTracePath.map((hop, idx) => {
                  const isFaulty = hop.status === 'Faulty';
                  const isWarning = hop.status === 'Warning';
                  const canFly = hop.lat !== undefined && hop.lng !== undefined;
                  return (
                    <div key={`${hop.id}-${idx}`} className="relative group">
                      <div className={`absolute -left-6 top-1.5 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center font-bold text-[10px] shadow-sm ${
                        isFaulty ? 'bg-rose-600 text-white animate-pulse' : isWarning ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                      }`}>
                        {idx + 1}
                      </div>

                      <div className={`p-3.5 rounded-xl border transition-all ${
                        isFaulty
                          ? 'bg-rose-50 border-rose-300 shadow-sm'
                          : isWarning
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-slate-50 border-slate-200/80 hover:bg-white hover:shadow-xs'
                      }`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] font-bold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {hop.type} &bull; {hop.id}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {canFly && (
                              <button
                                type="button"
                                onClick={() => flyToLocation(hop.lat!, hop.lng!, 18)}
                                title="Show on map"
                                className="p-0.5 text-slate-400 hover:text-blue-600"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isFaulty ? 'bg-rose-200 text-rose-800' : isWarning ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {hop.status}
                            </span>
                          </div>
                        </div>
                        <div className="font-bold text-xs text-slate-900 mt-1">{hop.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{hop.details}</div>
                        {(hop.lengthMeters !== undefined || hop.lossDb !== undefined || hop.cumulativeLossDb !== undefined) && (
                          <div className="flex flex-wrap gap-3 mt-1.5 text-[10px] font-mono text-slate-600">
                            {hop.lengthMeters !== undefined && <span>Length {formatLength(hop.lengthMeters)}</span>}
                            {hop.lossDb !== undefined && <span>Loss {hop.lossDb.toFixed(2)} dB</span>}
                            {hop.cumulativeLossDb !== undefined && <span>Cumulative {hop.cumulativeLossDb.toFixed(2)} dB</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <div>Search for a customer, ONT serial, equipment or cable to begin route tracing</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
