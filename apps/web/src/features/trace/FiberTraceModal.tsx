import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Route,
  Search,
  Wrench,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  traceOpticalPath,
  type WavelengthNm,
} from '@fibergis/shared';

import { Button, cn } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

const formatLength = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

export const FiberTraceModal: React.FC = () => {
  const { isFiberTraceOpen, setModalOpen, activeTraceTargetId, setActiveTraceTargetId } = useUiStore(
    useShallow((s) => ({
      isFiberTraceOpen: s.modals.fiberTrace,
      setModalOpen: s.setModalOpen,
      activeTraceTargetId: s.activeTraceTargetId,
      setActiveTraceTargetId: s.setActiveTraceTargetId,
    })),
  );

  const { equipment, cables, customers, splitters, closures, faults } = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      customers: s.customers,
      splitters: s.splitters,
      closures: s.closures,
      faults: s.faults,
    })),
  );

  const flyToLocation = useMapStore((s) => s.flyTo);
  const showToast = useToastStore((s) => s.show);

  const [wavelengthNm, setWavelengthNm] = useState<WavelengthNm>(1490);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Target resolution
  const targetId = activeTraceTargetId || customers[0]?.id || 'CUST-001';

  const networkSnapshot = useMemo(
    () => ({
      equipment,
      cables,
      customers,
      splitters,
      closures,
      faults,
    }),
    [equipment, cables, customers, splitters, closures, faults],
  );

  // Trace execution with live loss engine
  const traceResult = useMemo(() => {
    if (!targetId) return null;
    return traceOpticalPath(targetId, networkSnapshot, { wavelengthNm });
  }, [targetId, networkSnapshot, wavelengthNm]);

  if (!isFiberTraceOpen) return null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;

    const cust = customers.find(
      (c) => c.id.toLowerCase() === q || c.ontSerialNumber.toLowerCase() === q || c.name.toLowerCase().includes(q),
    );
    if (cust) {
      setActiveTraceTargetId(cust.id);
      return;
    }

    const eq = equipment.find((x) => x.id.toLowerCase() === q || x.name.toLowerCase().includes(q));
    if (eq) {
      setActiveTraceTargetId(eq.id);
      return;
    }

    showToast('warning', 'Target Not Found', `No customer or equipment matches "${searchQuery}".`);
  };

  const budget = traceResult?.budget;
  const hops = traceResult?.hops || [];

  const verdict = budget?.verdict || 'Normal';
  const isAlert = verdict === 'High Attenuation / Macro-bend Alert';
  const isWarning = verdict === 'Margin Warning';

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Route className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-slate-900">End-to-End Optical Path Trace</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  AI Link Budget Diagnostics
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Tracing upstream feed from <strong className="text-slate-700">{traceResult?.targetLabel}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Wavelength Switcher */}
            <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setWavelengthNm(1310)}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all',
                  wavelengthNm === 1310 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900',
                )}
                title="1310 nm: Upstream GPON / EPON (0.35 dB/km)"
              >
                1310 nm
              </button>
              <button
                type="button"
                onClick={() => setWavelengthNm(1490)}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all',
                  wavelengthNm === 1490 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900',
                )}
                title="1490 nm: Downstream GPON Data (0.25 dB/km)"
              >
                1490 nm
              </button>
              <button
                type="button"
                onClick={() => setWavelengthNm(1550)}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all',
                  wavelengthNm === 1550 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900',
                )}
                title="1550 nm: RF Video / Overlay (0.20 dB/km)"
              >
                1550 nm
              </button>
            </div>

            <button
              onClick={() => setModalOpen('fiberTrace', false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Quick Picker Bar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-4">
          <form onSubmit={handleSearch} className="flex-1 max-w-md relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer, ONT serial, equipment..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
            />
          </form>

          {/* Quick Target Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Quick Trace:</span>
            {customers.slice(0, 4).map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveTraceTargetId(c.id)}
                className={cn(
                  'px-2 py-1 rounded-md font-mono text-[11px] transition-colors',
                  targetId === c.id
                    ? 'bg-blue-600 text-white font-bold'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100',
                )}
              >
                {c.name.split(' ')[0]} ({c.ontSerialNumber.slice(-5)})
              </button>
            ))}
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* Diagnostic Stats Grid */}
          {budget && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Route Distance
                </span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {formatLength(budget.totalDistanceMeters)}
                </span>
                <span className="text-[10px] text-slate-500">{budget.totalDistanceKm} km fiber run</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Fiber Cable Loss
                </span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {budget.fiberLossDb.toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500">@{budget.attenuationRateDbPerKm} dB/km</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Splitter Loss
                </span>
                <span className="text-base font-bold text-purple-700 mt-0.5 block">
                  {budget.splitterLossDb.toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500">Passive PLC insertion</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Splice & Connectors
                </span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {(budget.spliceLossDb + budget.connectorLossDb).toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500">Splices + Mated pairs</span>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 block">
                  Expected Rx Power
                </span>
                <span className="text-base font-bold text-blue-900 mt-0.5 block">
                  {budget.expectedRxDbm.toFixed(1)} dBm
                </span>
                <span className="text-[10px] text-blue-600">Tx: +{budget.oltTxPowerDbm} dBm</span>
              </div>

              <div
                className={cn(
                  'rounded-xl border p-3 shadow-xs',
                  isAlert
                    ? 'border-red-300 bg-red-50/70 text-red-900'
                    : isWarning
                      ? 'border-amber-300 bg-amber-50/70 text-amber-900'
                      : 'border-emerald-300 bg-emerald-50/70 text-emerald-900',
                )}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider block opacity-75">
                  Measured ONU Rx
                </span>
                <span className="text-base font-bold mt-0.5 block">
                  {budget.measuredRxDbm !== undefined ? `${budget.measuredRxDbm.toFixed(1)} dBm` : '—'}
                </span>
                <span className="text-[10px] font-semibold">
                  {budget.discrepancyDb !== undefined
                    ? `${budget.discrepancyDb > 0 ? '+' : ''}${budget.discrepancyDb.toFixed(1)} dB margin`
                    : 'Unmeasured'}
                </span>
              </div>
            </div>
          )}

          {/* AI Optical Loss Verdict Banner */}
          {budget && (
            <div
              className={cn(
                'rounded-xl border p-4 flex items-start gap-3.5 shadow-xs transition-all',
                isAlert
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : isWarning
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-900',
              )}
            >
              <div
                className={cn(
                  'p-2 rounded-lg shrink-0 mt-0.5',
                  isAlert ? 'bg-red-600 text-white' : isWarning ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white',
                )}
              >
                {isAlert ? (
                  <AlertOctagon className="w-5 h-5" />
                ) : isWarning ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{budget.verdictTitle}</span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                      isAlert
                        ? 'bg-red-200 text-red-800'
                        : isWarning
                          ? 'bg-amber-200 text-amber-800'
                          : 'bg-emerald-200 text-emerald-800',
                    )}
                  >
                    {budget.verdict}
                  </span>
                </div>
                <p className="text-xs mt-1 leading-relaxed">{budget.verdictDescription}</p>
                <div className="mt-2 text-[11px] font-medium flex items-center gap-1.5 opacity-90">
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span><strong>Technician Action:</strong> {budget.recommendedAction}</span>
                </div>
              </div>
            </div>
          )}

          {/* Visual Breadcrumb Stepper Strip */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Optical Signal Propagation Chain
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1 bg-slate-50 border border-slate-200 rounded-xl p-3">
              {hops.map((hop, idx) => {
                const isLast = idx === hops.length - 1;
                return (
                  <React.Fragment key={`${hop.id}-${idx}`}>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shrink-0 shadow-xs">
                      <span className="w-5 h-5 rounded-md bg-slate-800 text-white font-mono text-[10px] flex items-center justify-center font-bold">
                        {hop.index}
                      </span>
                      <div>
                        <div className="font-bold text-[11px] text-slate-900 truncate max-w-[140px]">{hop.name}</div>
                        <div className="text-[9px] text-slate-500 flex items-center gap-1">
                          <span>{hop.type}</span>
                          {hop.portName && <span>· {hop.portName}</span>}
                        </div>
                      </div>
                    </div>
                    {!isLast && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Detailed Hop-by-Hop Timeline Stepper */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Detailed Hop Breakdown & Port Matrix
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white shadow-xs">
              {hops.map((hop) => {
                const canFly = hop.lat !== undefined && hop.lng !== undefined;
                return (
                  <div key={hop.index} className="p-3.5 hover:bg-slate-50/60 transition-colors flex items-center gap-4">
                    {/* Index circle */}
                    <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-300 font-bold text-slate-700 flex items-center justify-center font-mono shrink-0 text-xs">
                      {hop.index}
                    </div>

                    {/* Main Hop Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-xs">{hop.name}</span>
                        <span className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                          {hop.type}
                        </span>
                        {hop.portName && (
                          <span className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                            {hop.portName}
                          </span>
                        )}
                        {hop.coreColorName && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 border border-slate-200">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block border border-black/20"
                              style={{ backgroundColor: hop.coreColorHex }}
                            />
                            <span>Core {hop.coreNumber} ({hop.coreColorName})</span>
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 mt-0.5 leading-normal">{hop.details}</div>
                    </div>

                    {/* Hop Distance & Loss */}
                    <div className="text-right shrink-0 font-mono text-xs">
                      {hop.hopDistanceMeters > 0 && (
                        <div className="text-slate-600 font-semibold">
                          +{formatLength(hop.hopDistanceMeters)}
                        </div>
                      )}
                      <div className="text-slate-900 font-bold">
                        +{hop.hopLossDb.toFixed(2)} dB
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Total: {hop.cumulativeLossDb.toFixed(2)} dB
                      </div>
                    </div>

                    {/* Action button */}
                    {canFly && (
                      <button
                        type="button"
                        onClick={() => {
                          flyToLocation(hop.lat!, hop.lng!, 18);
                          showToast('info', 'Map Centered', `Navigated to ${hop.name}`);
                        }}
                        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900"
                        title="Focus on map"
                      >
                        <MapPin className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Total Hops: <strong className="text-slate-700">{hops.length}</strong> · End-to-End Route: <strong className="text-slate-700">{formatLength(budget?.totalDistanceMeters ?? 0)}</strong>
          </div>
          <Button variant="secondary" onClick={() => setModalOpen('fiberTrace', false)}>
            Close Trace
          </Button>
        </div>
      </div>
    </div>
  );
};
