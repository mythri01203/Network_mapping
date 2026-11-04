import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Route,
  History,
  TableProperties,
  Cable as CableIconLucide,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useNetwork } from '../../context/NetworkContext';
import type { CoreStatus } from '@fibergis/shared';
import { Tabs, Select, IconButton, Button, Badge, StatusBadge, EmptyState, ProgressBar, cn, cableColor } from '../ui';

type Tab = 'cores' | 'trace' | 'audit';

const CORE_FILTERS: Array<'All' | CoreStatus> = [
  'All',
  'Available',
  'In Use',
  'Reserved',
  'Damaged',
  'Under Maintenance',
  'Unverified',
];

const formatLength = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

export const BottomInfoPanel: React.FC = () => {
  const {
    cables,
    equipments,
    customers,
    selectedObject,
    isBottomPanelOpen,
    setIsBottomPanelOpen,
    activeTracePath,
    activeTraceSummary,
    clearTrace,
    auditLogs,
    allocateFiberCore,
    flyToLocation,
  } = useNetwork();

  const [activeTab, setActiveTab] = useState<Tab>('cores');
  const [coreFilter, setCoreFilter] = useState<'All' | CoreStatus>('All');

  const selectedCableId = selectedObject?.type === 'cable' ? selectedObject.data?.id : null;
  const cable = useMemo(
    () => (selectedCableId ? (cables.find((c) => c.id === selectedCableId) ?? null) : null),
    [cables, selectedCableId],
  );

  useEffect(() => {
    if (selectedCableId) setActiveTab('cores');
  }, [selectedCableId]);

  const traceKey = activeTraceSummary?.targetId ?? (activeTracePath ? activeTracePath.length : null);
  useEffect(() => {
    if (traceKey !== null) setActiveTab('trace');
  }, [traceKey]);

  const equipmentName = (id?: string) => (id ? (equipments.find((e) => e.id === id)?.name ?? id) : undefined);
  const customerName = (id?: string) => (id ? (customers.find((c) => c.id === id)?.name ?? id) : undefined);

  const allocationTargetId = cable ? cable.endEquipmentId || cable.startEquipmentId : undefined;
  const allocationTargetName = equipmentName(allocationTargetId);

  const coreStats = useMemo(() => {
    const cores = cable?.cores ?? [];
    return {
      total: cores.length,
      inUse: cores.filter((c) => c.status === 'In Use').length,
      available: cores.filter((c) => c.status === 'Available').length,
      damaged: cores.filter((c) => c.status === 'Damaged').length,
    };
  }, [cable]);

  const filteredCores = (cable?.cores ?? []).filter((core) => coreFilter === 'All' || core.status === coreFilter);

  if (!isBottomPanelOpen) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-3 text-xs">
        <button
          type="button"
          onClick={() => setIsBottomPanelOpen(true)}
          className="flex items-center gap-2 font-medium text-slate-600 hover:text-slate-900"
        >
          <ChevronUp size={14} className="text-slate-400" />
          <TableProperties size={14} className="text-slate-400" />
          Attribute table
        </button>
        <span className="h-3.5 w-px bg-slate-200" />
        <span className="truncate text-slate-500">
          {cable ? (
            <>
              <span className="font-medium text-slate-700">{cable.name}</span> · {cable.fiberCount}F ·{' '}
              {coreStats.available} available
            </>
          ) : activeTraceSummary ? (
            <>
              Trace to <span className="font-medium text-slate-700">{activeTraceSummary.targetLabel}</span> ·{' '}
              {formatLength(activeTraceSummary.totalLengthMeters)} · {activeTraceSummary.totalLossDb.toFixed(2)} dB
            </>
          ) : (
            'Select a cable on the map to inspect its fiber cores'
          )}
        </span>
      </div>
    );
  }

  return (
    <section className="flex h-72 shrink-0 flex-col border-t border-slate-200 bg-white" aria-label="Attribute table">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-slate-200 pl-2 pr-2">
        <Tabs<Tab>
          size="sm"
          className="h-10 self-stretch border-b-0"
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { id: 'cores', label: 'Fiber cores', icon: TableProperties, count: cable ? cable.cores.length : undefined },
            { id: 'trace', label: 'Trace', icon: Route, count: activeTracePath ? activeTracePath.length : undefined },
            { id: 'audit', label: 'Activity', icon: History },
          ]}
        />

        <div className="min-w-0 flex-1" />

        {activeTab === 'cores' && cable && (
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex">
              <span className="tabular">
                <span className="font-medium text-slate-800">{coreStats.inUse}</span>/{coreStats.total} in use
              </span>
              <ProgressBar value={coreStats.inUse} max={coreStats.total || 1} tone="auto" size="sm" className="w-20" />
            </div>
            <Select
              controlSize="sm"
              value={coreFilter}
              onChange={(e) => setCoreFilter(e.target.value as 'All' | CoreStatus)}
              aria-label="Filter cores by status"
              wrapperClassName="w-40"
            >
              {CORE_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'All' ? 'All statuses' : s}
                </option>
              ))}
            </Select>
          </div>
        )}

        {activeTab === 'trace' && activeTracePath && (
          <Button size="sm" variant="ghost" icon={X} onClick={clearTrace}>
            Clear trace
          </Button>
        )}

        <IconButton icon={ChevronDown} label="Minimize panel" size="sm" onClick={() => setIsBottomPanelOpen(false)} />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'cores' &&
          (!cable ? (
            <EmptyState
              compact
              icon={CableIconLucide}
              title="No cable selected"
              description="Click a cable on the map, or open one from the Cables view, to see its core assignments."
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cableColor(cable.type) }} />
                <span className="font-medium text-slate-800">{cable.name}</span>
                <span className="font-mono text-[11px] text-slate-400">{cable.id}</span>
                <span>·</span>
                <span>{cable.type}</span>
                <span>·</span>
                <span className="tabular">{formatLength(cable.lengthMeters)}</span>
                {(cable.startEquipmentId || cable.endEquipmentId) && (
                  <>
                    <span>·</span>
                    <span className="truncate">
                      {equipmentName(cable.startEquipmentId) ?? 'Open end'}
                      <ChevronRight size={12} className="mx-0.5 inline align-[-2px] text-slate-400" />
                      {equipmentName(cable.endEquipmentId) ?? 'Open end'}
                    </span>
                  </>
                )}
              </div>
              {filteredCores.length === 0 ? (
                <EmptyState
                  compact
                  title="No cores match this filter"
                  description={`No ${coreFilter.toLowerCase()} cores on this cable.`}
                />
              ) : (
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th className="w-16">Core</th>
                      <th>Colour</th>
                      <th className="w-16">Tube</th>
                      <th>Status</th>
                      <th>Connected to</th>
                      <th>Port</th>
                      <th className="text-right">Loss</th>
                      <th>Remarks</th>
                      <th className="w-28 text-right" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCores.map((core) => {
                      const connected =
                        core.connectedToEquipmentName ||
                        equipmentName(core.connectedToEquipmentId) ||
                        core.customerName ||
                        customerName(core.customerId);
                      return (
                        <tr key={core.coreNumber}>
                          <td className="tabular font-mono font-medium text-slate-900">
                            {String(core.coreNumber).padStart(2, '0')}
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-3 w-3 rounded-full ring-1 ring-inset ring-black/15"
                                style={{ backgroundColor: core.colorHex }}
                              />
                              {core.colorName}
                            </span>
                          </td>
                          <td className="tabular text-slate-500">T{core.tubeNumber}</td>
                          <td>
                            <StatusBadge status={core.status} />
                          </td>
                          <td className="max-w-[220px] truncate">
                            {connected ?? <span className="text-slate-400">—</span>}
                          </td>
                          <td className="font-mono text-[11px] text-slate-500">{core.connectedPort || '—'}</td>
                          <td className="tabular text-right text-slate-600">
                            {core.attenuationDb !== undefined ? `${core.attenuationDb.toFixed(2)} dB` : '—'}
                          </td>
                          <td className="max-w-[260px] truncate text-slate-500" title={core.remarks}>
                            {core.remarks || '—'}
                          </td>
                          <td className="text-right">
                            {core.status === 'Available' ? (
                              <Button
                                size="xs"
                                variant="secondary"
                                disabled={!allocationTargetId}
                                title={
                                  allocationTargetId
                                    ? `Allocate core ${core.coreNumber} to ${allocationTargetName}`
                                    : 'This cable is not terminated on any equipment'
                                }
                                onClick={() =>
                                  allocationTargetId &&
                                  allocateFiberCore(cable.id, core.coreNumber, undefined, allocationTargetId)
                                }
                              >
                                Allocate
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          ))}

        {activeTab === 'trace' &&
          (!activeTracePath || activeTracePath.length === 0 ? (
            <EmptyState
              compact
              icon={Route}
              title="No active trace"
              description="Select a customer, equipment or cable and choose Trace path to follow the optical route back to the OLT."
            />
          ) : (
            <div className="space-y-3 p-4">
              {activeTraceSummary && (
                <div className="flex flex-wrap items-stretch gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
                  {[
                    { label: 'Target', value: activeTraceSummary.targetLabel },
                    { label: 'Total length', value: formatLength(activeTraceSummary.totalLengthMeters) },
                    { label: 'Path loss', value: `${activeTraceSummary.totalLossDb.toFixed(2)} dB` },
                    {
                      label: 'Est. Rx power',
                      value:
                        activeTraceSummary.estimatedRxDbm !== undefined
                          ? `${activeTraceSummary.estimatedRxDbm.toFixed(2)} dBm`
                          : '—',
                    },
                    {
                      label: 'Measured Rx',
                      value:
                        activeTraceSummary.measuredRxDbm !== undefined
                          ? `${activeTraceSummary.measuredRxDbm.toFixed(2)} dBm`
                          : '—',
                    },
                    {
                      label: 'Downstream customers',
                      value: activeTraceSummary.downstreamCustomerCount.toLocaleString(),
                    },
                  ].map((kpi) => (
                    <div key={kpi.label} className="min-w-[120px] flex-1 bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500">{kpi.label}</div>
                      <div className="tabular truncate text-[13px] font-semibold text-slate-900">{kpi.value}</div>
                    </div>
                  ))}
                  <div className="flex min-w-[120px] flex-1 flex-col justify-center bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-500">Power budget</div>
                    <div>
                      <StatusBadge
                        status={activeTraceSummary.budgetStatus}
                        tone={
                          activeTraceSummary.budgetStatus === 'Pass'
                            ? 'green'
                            : activeTraceSummary.budgetStatus === 'Warning'
                              ? 'amber'
                              : activeTraceSummary.budgetStatus === 'Fail'
                                ? 'red'
                                : 'neutral'
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTraceSummary && activeTraceSummary.warnings.length > 0 && (
                <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {activeTraceSummary.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2">
                      <TriangleAlert size={13} className="mt-px shrink-0 text-amber-600" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              <ol className="flex items-stretch overflow-x-auto pb-1">
                {activeTracePath.map((hop, idx) => {
                  const locatable = typeof hop.lat === 'number' && typeof hop.lng === 'number';
                  return (
                    <li key={`${hop.id}-${idx}`} className="flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={!locatable}
                        onClick={() => locatable && flyToLocation(hop.lat as number, hop.lng as number, 18)}
                        className={cn(
                          'w-44 rounded-md border px-2.5 py-2 text-left transition-colors',
                          hop.status === 'Faulty'
                            ? 'border-red-300 bg-red-50'
                            : hop.status === 'Warning'
                              ? 'border-amber-300 bg-amber-50'
                              : 'border-slate-200 bg-white',
                          locatable && 'hover:border-blue-400',
                        )}
                        title={locatable ? 'Zoom to this hop' : undefined}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            tone={hop.status === 'Faulty' ? 'red' : hop.status === 'Warning' ? 'amber' : 'neutral'}
                          >
                            {hop.type}
                          </Badge>
                          {hop.cumulativeLossDb !== undefined && (
                            <span className="tabular text-[11px] text-slate-500">
                              {hop.cumulativeLossDb.toFixed(2)} dB
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate text-[13px] font-medium text-slate-900" title={hop.name}>
                          {hop.name}
                        </div>
                        <div className="truncate text-[11px] text-slate-500" title={hop.details}>
                          {hop.lengthMeters ? `${formatLength(hop.lengthMeters)} · ` : ''}
                          {hop.details}
                        </div>
                      </button>
                      {idx < activeTracePath.length - 1 && (
                        <ChevronRight size={16} className="mx-1 shrink-0 text-slate-300" />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

        {activeTab === 'audit' &&
          (auditLogs.length === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="No activity yet"
              description="Edits, allocations and connections will be logged here."
            />
          ) : (
            <table className="ui-table">
              <thead>
                <tr>
                  <th className="w-44">Time</th>
                  <th className="w-48">User</th>
                  <th className="w-48">Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.slice(0, 200).map((log) => (
                  <tr key={log.id}>
                    <td className="tabular whitespace-nowrap text-slate-500">{log.timestamp}</td>
                    <td className="whitespace-nowrap">
                      <span className="font-medium text-slate-800">{log.user}</span>
                      <span className="text-slate-400"> · {log.role}</span>
                    </td>
                    <td>
                      <span className="font-mono text-[11px] text-slate-600">{log.action}</span>
                    </td>
                    <td className="text-slate-700">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </section>
  );
};
