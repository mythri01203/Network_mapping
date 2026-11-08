import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
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
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { CorePathView } from '../fiber/CorePathView';

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

  const optical = useNetworkStore(selectOpticalSettings);
  const flyToLocation = useMapStore((s) => s.flyTo);
  const showToast = useToastStore((s) => s.show);

  const [wavelengthNm, setWavelengthNm] = useState<WavelengthNm>(1490);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Only what the person chose. With nothing chosen the screen asks, rather than tracing the first customer.
  const targetId = activeTraceTargetId || '';

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

  const traceResult = useMemo(() => {
    if (!targetId) return null;
    return traceOpticalPath(targetId, networkSnapshot, { wavelengthNm, settings: optical });
  }, [targetId, networkSnapshot, wavelengthNm, optical]);

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

  const gaps = traceResult?.warnings ?? [];
  const notes = traceResult?.notes ?? [];
  const reading = traceResult?.rxReading;
  const verdict = budget?.verdict;
  const isNeutral = verdict === 'Not Assessed';
  const isGood = verdict === 'Normal';
  const isWarning = verdict === 'Margin Warning' || verdict === 'Incomplete';
  const isAlert = !isNeutral && !isGood && !isWarning;
  const toneClass = isNeutral
    ? 'border-slate-300 bg-slate-50 text-slate-800'
    : isGood
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : isWarning
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-red-300 bg-red-50 text-red-900';

  return (
    <div className="modal-sheet fixed inset-0 z-[1200] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Route className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-slate-900">End-to-End Optical Path Trace</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Estimated link budget
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {traceResult ? (
                  <>
                    Tracing upstream feed from <strong className="text-slate-700">{traceResult.targetLabel}</strong>
                  </>
                ) : (
                  'Search for a customer or equipment to trace.'
                )}
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
                title={`1310 nm: Upstream GPON / EPON (${optical.fiberDbPerKm[1310]} dB/km)`}
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
                title={`1490 nm: Downstream GPON Data (${optical.fiberDbPerKm[1490]} dB/km)`}
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
                title={`1550 nm: RF Video / Overlay (${optical.fiberDbPerKm[1550]} dB/km)`}
              >
                1550 nm
              </button>
            </div>

            <button
              type="button"
              aria-label="Close"
              onClick={() => setModalOpen('fiberTrace', false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Quick Picker Bar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
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
                {c.name.split(' ')[0]} ({c.ontSerialNumber ? c.ontSerialNumber.slice(-5) : c.id})
              </button>
            ))}
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {!traceResult && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
              {targetId ? `Nothing on record matches "${targetId}".` : 'Search above, or pick a customer, to see their path.'}
            </div>
          )}

          {/* Missing links come first: nothing below is complete while any are listed. */}
          {gaps.length > 0 && (
            <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
              <div className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                This path is not complete: {gaps.length} missing {gaps.length === 1 ? 'link' : 'links'}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          )}

          {traceResult?.corePath && (
            <section className="rounded-xl border border-slate-200 p-4" data-testid="trace-core-section">
              <h3 className="mb-2 text-sm font-bold text-slate-900">
                Fiber by fiber{' '}
                <span className="ml-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600" data-testid="trace-level">
                  {traceResult.level === 'core' ? 'Every fiber recorded' : 'Cables only: fibers not recorded end to end'}
                </span>
              </h3>
              <CorePathView path={traceResult.corePath} />
            </section>
          )}

          {/* Stats Grid */}
          {budget && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Route Distance
                </span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {formatLength(budget.totalDistanceMeters)}
                </span>
                <span className="text-[10px] text-slate-500">
                  {budget.totalLossDb.toFixed(2)} dB estimated in total{gaps.length > 0 ? ', linked part only' : ''}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Estimated fiber loss
                </span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {budget.fiberLossDb.toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500">@{budget.attenuationRateDbPerKm} dB/km</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Estimated splitter loss
                </span>
                <span className="text-base font-bold text-purple-700 mt-0.5 block">
                  {budget.splitterLossDb.toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500">Recorded ratio or setting</span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Estimated splices & connectors
                </span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {(budget.spliceLossDb + budget.connectorLossDb).toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500">
                  {traceResult?.spliceRecordsCounted ?? 0} recorded splices, {traceResult?.connectorPairsCounted ?? 0} connector
                  pairs counted from the equipment on this path
                </span>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 block">
                  Estimated Rx
                </span>
                <span className="text-base font-bold text-blue-900 mt-0.5 block">
                  {gaps.length > 0
                    ? 'Not known'
                    : budget.expectedRxDbm !== undefined
                      ? `${budget.expectedRxDbm.toFixed(1)} dBm`
                      : budget.expectedRxRangeDbm
                        ? `${budget.expectedRxRangeDbm.min.toFixed(1)} to ${budget.expectedRxRangeDbm.max.toFixed(1)} dBm`
                        : 'Not known'}
                </span>
                <span className="text-[10px] text-blue-600">
                  {budget.oltTxPowerDbm !== undefined ? `Recorded launch ${budget.oltTxPowerDbm} dBm` : 'Launch not recorded'}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs text-slate-900">
                <span className="text-[10px] font-semibold uppercase tracking-wider block text-slate-400">
                  ONU reading
                </span>
                <span className="text-base font-bold mt-0.5 block">
                  {reading?.valueDbm !== undefined ? `${reading.valueDbm.toFixed(1)} dBm` : 'Not recorded'}
                </span>
                <span className="text-[10px] font-semibold text-slate-500">
                  {reading?.originLabel ?? 'Not recorded'}
                  {budget.discrepancyDb !== undefined
                    ? ` · ${budget.discrepancyDb > 0 ? '+' : ''}${budget.discrepancyDb.toFixed(1)} dB against estimate`
                    : ''}
                </span>
              </div>
            </div>
          )}

          {/* Verdict Banner */}
          {budget && (
            <div className={cn('rounded-xl border p-4 flex items-start gap-3.5 shadow-xs transition-all', toneClass)}>
              <div
                className={cn(
                  'p-2 rounded-lg shrink-0 mt-0.5',
                  isNeutral
                    ? 'bg-slate-600 text-white'
                    : isAlert
                      ? 'bg-red-600 text-white'
                      : isWarning
                        ? 'bg-amber-600 text-white'
                        : 'bg-emerald-600 text-white',
                )}
              >
                {isNeutral ? (
                  <Info className="w-5 h-5" />
                ) : isAlert ? (
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
                      isNeutral
                        ? 'bg-slate-200 text-slate-700'
                        : isAlert
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
                  <span><strong>Next step:</strong> {budget.recommendedAction}</span>
                </div>
              </div>
            </div>
          )}

          {/* Caveats that do not break the path */}
          {notes.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600">
              <summary className="cursor-pointer font-semibold text-slate-700">
                What this estimate does not know ({notes.length})
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <p className="mt-2">
                This checks cables, not single fibers: it does not follow one core through splices, so it cannot prove
                light reaches the customer.
              </p>
            </details>
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
                    <div
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-lg shrink-0 shadow-xs',
                        hop.gap ? 'bg-red-50 border-2 border-dashed border-red-400' : 'bg-white border border-slate-200',
                      )}
                    >
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
                  <div
                    key={hop.index}
                    className={cn(
                      'p-3.5 transition-colors flex items-center gap-4',
                      hop.gap ? 'bg-red-50 text-red-900' : 'hover:bg-slate-50/60',
                    )}
                  >
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

                      <div className={cn('text-[11px] mt-0.5 leading-normal', hop.gap ? 'text-red-800' : 'text-slate-500')}>
                        {hop.details}
                      </div>
                    </div>

                    {/* Hop Distance & Loss */}
                    <div className={cn('text-right shrink-0 font-mono text-xs', hop.gap && 'hidden')}>
                      {hop.hopDistanceMeters > 0 && (
                        <div className="text-slate-600 font-semibold">
                          +{formatLength(hop.hopDistanceMeters)}
                        </div>
                      )}
                      <div className="text-slate-900 font-bold">
                        +{hop.hopLossDb.toFixed(2)} dB
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Estimated total: {hop.cumulativeLossDb.toFixed(2)} dB
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
            {gaps.length > 0 ? 'Linked part' : 'Whole route'}:{' '}
            <strong className="text-slate-700">{formatLength(budget?.totalDistanceMeters ?? 0)}</strong>
          </div>
          <Button variant="secondary" onClick={() => setModalOpen('fiberTrace', false)}>
            Close Trace
          </Button>
        </div>
      </div>
    </div>
  );
};
