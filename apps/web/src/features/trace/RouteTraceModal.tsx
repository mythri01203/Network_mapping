import React, { useEffect, useState } from 'react';
import { Activity, MapPin, Route, TriangleAlert, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { BadgeTone } from '../../components/ui';
import {
  Badge,
  Button,
  cn,
  EmptyState,
  IconButton,
  Modal,
  SearchInput,
  SectionLabel,
  StatTile,
  StatusBadge,
} from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { traceNetworkPath } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useTraceStore } from '../../stores/traceStore';
import { useUiStore } from '../../stores/uiStore';

const formatLength = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const formatDbm = (v?: number) => (v !== undefined ? `${v.toFixed(1)} dBm` : '—');

const BUDGET_TILE_TONE: Record<string, 'good' | 'warn' | 'bad' | 'default'> = {
  Pass: 'good',
  Warning: 'warn',
  Fail: 'bad',
  Unknown: 'default',
};

const HOP_TONE: Record<string, BadgeTone> = {
  Normal: 'green',
  Warning: 'amber',
  Faulty: 'red',
};

export const RouteTraceModal: React.FC = () => {
  const { isRouteTraceModalOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isRouteTraceModalOpen: s.modals.routeTrace, setModalOpen: s.setModalOpen })),
  );
  const { activeTracePath, activeTraceSummary, clearTrace } = useTraceStore(
    useShallow((s) => ({ activeTracePath: s.path, activeTraceSummary: s.summary, clearTrace: s.clear })),
  );
  const { customers, equipments, cables } = useNetworkStore(
    useShallow((s) => ({ customers: s.customers, equipments: s.equipment, cables: s.cables })),
  );
  const flyToLocation = useMapStore((s) => s.flyTo);
  const showToast = useToastStore((s) => s.show);

  const [searchTarget, setSearchTarget] = useState('');

  useEffect(() => {
    if (isRouteTraceModalOpen) setSearchTarget('');
  }, [isRouteTraceModalOpen]);

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
    const cust = customers.find((c) => c.id.toLowerCase() === q || c.ontSerialNumber.toLowerCase() === q) || undefined;
    if (cust) return traceAndFly(cust.id, cust.lat, cust.lng);

    const eq = equipments.find((x) => x.id.toLowerCase() === q);
    if (eq) return traceAndFly(eq.id, eq.lat, eq.lng);

    const cable = cables.find((c) => c.id.toLowerCase() === q);
    if (cable) return traceAndFly(cable.id, cable.coordinates[0]?.[0], cable.coordinates[0]?.[1]);

    const custByName = customers.find((c) => c.name.toLowerCase().includes(q));
    if (custByName) return traceAndFly(custByName.id, custByName.lat, custByName.lng);

    const eqByName = equipments.find((x) => x.name.toLowerCase().includes(q));
    if (eqByName) return traceAndFly(eqByName.id, eqByName.lat, eqByName.lng);

    // Faults, closures, splitters and PON ports are resolved by the context.
    if (!traceNetworkPath(searchTarget.trim())) {
      showToast('warning', 'No match', `Nothing matching "${searchTarget.trim()}" was found.`);
    }
  };

  const quickTargets = customers.slice(0, 5);
  const summary = activeTraceSummary;
  const close = () => setModalOpen('routeTrace', false);

  return (
    <Modal
      open={isRouteTraceModalOpen}
      onClose={close}
      title="Route trace"
      description="End-to-end OLT to customer ONT path with optical budget"
      icon={Route}
      size="xl"
      bodyClassName="p-0"
      headerActions={
        activeTracePath ? (
          <Button variant="ghost" size="sm" icon={X} onClick={clearTrace}>
            Clear trace
          </Button>
        ) : undefined
      }
      footer={
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <form onSubmit={handleSearchTrace} className="flex gap-2">
          <SearchInput
            className="flex-1"
            value={searchTarget}
            onValueChange={setSearchTarget}
            placeholder="Customer ID or name, ONT serial, equipment, cable, fault or PON port"
            data-autofocus
          />
          <Button type="submit" variant="primary" icon={Activity}>
            Trace route
          </Button>
        </form>

        {quickTargets.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
            <span className="mr-1 shrink-0 text-xs text-slate-500">Quick trace</span>
            {quickTargets.map((c) => (
              <Button
                key={c.id}
                variant="secondary"
                size="xs"
                title={c.name}
                onClick={() => traceAndFly(c.id, c.lat, c.lng)}
                className="font-mono"
              >
                {c.id}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 px-5 py-4">
        {activeTracePath && activeTracePath.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {summary?.targetLabel || 'Traced path'}
                </div>
                <div className="tabular text-xs text-slate-500">
                  {activeTracePath.length} nodes · {formatLength(summary?.totalLengthMeters ?? 0)} ·{' '}
                  {(summary?.totalLossDb ?? 0).toFixed(2)} dB estimated loss
                </div>
              </div>
              {summary && (
                <StatusBadge
                  status={summary.budgetStatus}
                  size="md"
                  label={
                    !summary.pathComplete
                      ? 'Path not complete'
                      : summary.estimatedRxDbm !== undefined
                        ? `Estimated Rx ${summary.estimatedRxDbm.toFixed(1)} dBm · ${summary.budgetStatus}`
                        : 'Launch power not recorded'
                  }
                />
              )}
            </div>

            {summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile
                  label="OLT Tx power"
                  value={<span className="font-mono text-base">{formatDbm(summary.txPowerDbm) ?? 'Not recorded'}</span>}
                />
                <StatTile
                  label="Estimated Rx"
                  value={<span className="font-mono text-base">{formatDbm(summary.estimatedRxDbm) ?? 'Not recorded'}</span>}
                  tone={BUDGET_TILE_TONE[summary.budgetStatus] ?? 'default'}
                />
                <StatTile
                  label="Measured Rx"
                  value={<span className="font-mono text-base">{formatDbm(summary.measuredRxDbm) ?? 'Not recorded'}</span>}
                />
                <StatTile
                  label="Downstream customers"
                  value={<span className="tabular text-base">{summary.downstreamCustomerCount}</span>}
                />
              </div>
            )}

            {summary && summary.warnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {summary.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-600" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <SectionLabel>Path</SectionLabel>
              <ol className="relative mt-2">
                {activeTracePath.map((hop, idx) => {
                  const isFaulty = hop.status === 'Faulty';
                  const isWarning = hop.status === 'Warning';
                  const isLast = idx === activeTracePath.length - 1;
                  const canFly = hop.lat !== undefined && hop.lng !== undefined;
                  return (
                    <li key={`${hop.id}-${idx}`} className="relative flex gap-3 pb-3 last:pb-0">
                      {!isLast && (
                        <span className="absolute left-[9.5px] top-6 bottom-0 w-px bg-slate-200" aria-hidden />
                      )}
                      <span
                        className={cn(
                          'relative z-10 mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular',
                          isFaulty
                            ? 'border-red-600 bg-red-600 text-white'
                            : isWarning
                              ? 'border-amber-500 bg-amber-500 text-white'
                              : 'border-slate-300 bg-white text-slate-600',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <div
                        className={cn(
                          'min-w-0 flex-1 rounded-md border px-3 py-2',
                          isFaulty
                            ? 'border-red-200 bg-red-50/60'
                            : isWarning
                              ? 'border-amber-200 bg-amber-50/60'
                              : 'border-slate-200 bg-white',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge tone="neutral">{hop.type}</Badge>
                            <span className="truncate font-mono text-xs text-slate-500">{hop.id}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {canFly && (
                              <IconButton
                                icon={MapPin}
                                label="Show on map"
                                size="xs"
                                onClick={() => flyToLocation(hop.lat!, hop.lng!, 18)}
                              />
                            )}
                            <StatusBadge status={hop.status} tone={HOP_TONE[hop.status]} />
                          </div>
                        </div>
                        <div className="mt-1 text-[13px] font-medium text-slate-900">{hop.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{hop.details}</div>
                        {(hop.lengthMeters !== undefined ||
                          hop.lossDb !== undefined ||
                          hop.cumulativeLossDb !== undefined) && (
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-slate-600">
                            {hop.lengthMeters !== undefined && <span>Length {formatLength(hop.lengthMeters)}</span>}
                            {hop.lossDb !== undefined && <span>Loss {hop.lossDb.toFixed(2)} dB</span>}
                            {hop.cumulativeLossDb !== undefined && (
                              <span>Cumulative {hop.cumulativeLossDb.toFixed(2)} dB</span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </>
        ) : (
          <EmptyState
            icon={Activity}
            title="No active trace"
            description="Search for a customer, ONT serial, equipment or cable to trace its optical path."
          />
        )}
      </div>
    </Modal>
  );
};
