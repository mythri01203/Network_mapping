import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, FileSpreadsheet, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  boxDemand,
  CAPACITY_KIND_LABELS,
  CAPACITY_SETTING_DEFS,
  CAPACITY_STATE_WORDS,
  type CapacityData,
  type CapacityLine,
  capacityLines,
  capacitySettingSources,
  capacityTotals,
  coreUtilization,
  type Fault,
  isFaultOpen,
  type OpticalSettings,
  type OspSettings,
  PLAN_STATE_WORDS,
  resolveCapacitySettings,
  type Setting,
  splitterOutputUse,
} from '@fibergis/shared';

import { useMayDo } from '../../stores/authStore';
import { selectOpticalSettings, selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { FieldSettingRow } from '../admin/FieldSettingsPanel';
import { ScenarioPanel } from './ScenarioPanel';

/**
 * Capacity dashboard. Network mapping Phase 18: every figure from the saved records through the
 * shared `capacityLines`; built and planned apart; nothing not recorded is counted as free;
 * "nearly full" by the levels in settings (`capacity.*`), shown with their source. Expansion
 * scenarios are below, as plans only.
 */

const STATE_STYLE: Record<CapacityLine['state'], string> = {
  over: 'bg-red-100 text-red-900',
  full: 'bg-red-100 text-red-900',
  nearly_full: 'bg-amber-100 text-amber-900',
  not_known: 'bg-slate-200 text-slate-800',
  ok: 'bg-emerald-100 text-emerald-900',
};
const STATE_MARK: Record<CapacityLine['state'], string> = { over: '✕', full: '■', nearly_full: '!', not_known: '?', ok: '✓' };

function Tile({ title, value, sub, tone }: { title: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`min-w-0 rounded-2xl border p-3 ${tone}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide opacity-80">{title}</div>
      <div className="mt-0.5 break-words text-lg font-extrabold">{value}</div>
      <div className="mt-0.5 text-[11px] opacity-90">{sub}</div>
    </div>
  );
}

function Fold({ title, children, open = false, testId }: { title: string; children: React.ReactNode; open?: boolean; testId?: string }) {
  return (
    <details className="group rounded-2xl border border-slate-200 bg-slate-50" open={open} data-testid={testId}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-slate-900">
        {title}
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

export const CapacityDashboardModal: React.FC = () => {
  const { isCapacityDashboardOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isCapacityDashboardOpen: s.modals.capacityDashboard, setModalOpen: s.setModalOpen })),
  );
  const data = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      splitters: s.splitters,
      closures: s.closures,
      customers: s.customers,
      onts: s.onts,
      services: s.services,
      spans: s.spans,
      attachments: s.attachments,
      ducts: s.ducts,
      sites: s.sites,
      racks: s.racks,
      zones: s.zones,
      planningScenarios: s.planningScenarios,
    })),
  );
  const settingRecords = useNetworkStore((s) => s.settings);
  const faults = useNetworkStore((s) => s.faults);
  const optical = useNetworkStore(selectOpticalSettings);
  const osp = useNetworkStore(selectOspSettings);
  const mayConfigure = useMayDo('configure');
  if (!isCapacityDashboardOpen) return null;
  return (
    <CapacityDashboardView
      data={data}
      settingRecords={settingRecords}
      faults={faults}
      optical={optical}
      osp={osp}
      mayConfigure={mayConfigure}
      onClose={() => setModalOpen('capacityDashboard', false)}
      onOpenReports={() => {
        setModalOpen('capacityDashboard', false);
        setModalOpen('reports', true);
      }}
    />
  );
};

export interface CapacityDashboardProps {
  data: CapacityData;
  settingRecords: readonly Setting[];
  faults: readonly Fault[];
  optical: OpticalSettings;
  osp: OspSettings;
  mayConfigure: boolean;
  onClose: () => void;
  onOpenReports: () => void;
}

/** The dashboard itself, from the data it is given (so it can be checked without the stores). */
export function CapacityDashboardView({ data, settingRecords, faults, optical, osp, mayConfigure, onClose, onOpenReports }: CapacityDashboardProps) {
  const [showAll, setShowAll] = useState(false);
  const capacity = useMemo(() => resolveCapacitySettings([...settingRecords]), [settingRecords]);
  const capacityData = data;
  const lines = useMemo(() => capacityLines(capacityData, { settings: capacity, osp }), [capacityData, capacity, osp]);
  const totals = useMemo(() => capacityTotals(lines), [lines]);
  const demand = useMemo(() => boxDemand(capacityData), [capacityData]);
  const zones = data.zones ?? [];

  // Top tiles, from the records.
  const cores = data.cables.filter((c) => c.fiberCount > 0 && c.type !== 'Coaxial Cable').map(coreUtilization);
  const coreTotal = cores.reduce((s, u) => s + u.total, 0);
  const coreUsed = cores.reduce((s, u) => s + u.inUse, 0);
  const coreFree = cores.reduce((s, u) => s + u.available, 0);
  const outputs = data.splitters.map((s) => splitterOutputUse(data, s).counts);
  const outTotal = outputs.reduce((s, c) => s + c.capacity, 0);
  const outUsed = outputs.reduce((s, c) => s + c.used, 0);
  const outFree = outputs.reduce((s, c) => s + c.free, 0);
  const connected = data.customers.filter((c) => c.status === 'Active' || c.status === 'Suspended').length;
  const waiting = data.customers.filter((c) => c.status === 'Pending Installation').length;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : 'Not known');

  const attention = lines
    .filter((l) => l.state === 'over' || l.state === 'full' || l.state === 'nearly_full')
    .sort((a, b) => ['over', 'full', 'nearly_full'].indexOf(a.state) - ['over', 'full', 'nearly_full'].indexOf(b.state) || a.name.localeCompare(b.name));
  const unknown = lines.filter((l) => l.state === 'not_known');
  const short = demand.filter((d) => d.shortBy > 0);
  const sources = capacitySettingSources(settingRecords);

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] flex items-stretch justify-center bg-slate-900/60 sm:items-center sm:p-4" data-testid="capacity-dashboard">
      <div className="flex w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">Network capacity</h2>
              <p className="text-xs text-slate-600">Counted from saved records. Not recorded is never counted as free. No live connection.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close capacity" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile title="Splitter outputs" value={`${outFree} free`} sub={`${outUsed} of ${outTotal} in use (${pct(outUsed, outTotal)})`} tone="border-purple-200 bg-purple-50 text-purple-950" />
            <Tile title="Fibres in cables" value={`${coreFree} free`} sub={`${coreUsed} of ${coreTotal} in use (${pct(coreUsed, coreTotal)})`} tone="border-amber-200 bg-amber-50 text-amber-950" />
            <Tile title="Customers" value={`${connected} connected`} sub={`${waiting} waiting to be connected`} tone="border-emerald-200 bg-emerald-50 text-emerald-950" />
            <Tile title="Needs attention" value={`${attention.length} item(s)`} sub={`${unknown.length} with capacity not recorded`} tone="border-red-200 bg-red-50 text-red-950" />
          </div>

          <section className="space-y-2" data-testid="capacity-totals" aria-labelledby="capacity-totals-title">
            <h3 id="capacity-totals-title" className="text-sm font-bold text-slate-900">
              By kind: built and planned kept apart
            </h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {totals.map((t) => (
                <li key={`${t.kind}-${t.built}`} className={`rounded-xl border p-2 ${t.built ? 'border-slate-200 bg-white' : 'border-dashed border-violet-300 bg-violet-50/50'}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <span className="font-bold text-slate-900">{CAPACITY_KIND_LABELS[t.kind]}</span>
                    <span className="text-[11px] text-slate-600">{t.built ? 'Built' : 'Planned, proposed or awaiting review'} · {t.elements}</span>
                  </div>
                  <div className="text-xs text-slate-700">
                    {t.free} free of {t.capacity}
                    {t.capacityNotRecorded ? ` (+${t.capacityNotRecorded} with capacity not recorded)` : ''} · {t.used} used · {t.heldForPlanned} held for planned · {t.reserved} reserved · {t.faulty} faulty
                    {t.notRecorded ? ` · ${t.notRecorded} not recorded` : ''}
                  </div>
                  {(t.over || t.full || t.nearlyFull) > 0 && (
                    <div className="text-xs font-semibold text-red-800">
                      {[t.over ? `${t.over} over` : '', t.full ? `${t.full} full` : '', t.nearlyFull ? `${t.nearlyFull} nearly full` : ''].filter(Boolean).join(', ')}
                    </div>
                  )}
                </li>
              ))}
              {totals.length === 0 && <li className="text-xs text-slate-600">Nothing with capacity is recorded yet.</li>}
            </ul>
          </section>

          <section className="space-y-2" data-testid="capacity-attention" aria-labelledby="capacity-attention-title">
            <h3 id="capacity-attention-title" className="text-sm font-bold text-slate-900">
              Full or nearly full
            </h3>
            {attention.length === 0 ? (
              <p className="text-xs text-slate-600">Nothing is full or nearly full, as recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {(showAll ? attention : attention.slice(0, 12)).map((l) => (
                  <li key={`${l.kind}-${l.id}`} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 font-bold ${STATE_STYLE[l.state]}`}>
                        {STATE_MARK[l.state]} {CAPACITY_STATE_WORDS[l.state]}
                      </span>
                      <span className="font-semibold text-slate-900 break-words">{l.name}</span>
                      <span className="text-slate-500">
                        {CAPACITY_KIND_LABELS[l.kind]} · {l.where}
                        {l.plan !== 'built' ? ` · ${PLAN_STATE_WORDS[l.plan]}` : ''}
                      </span>
                    </div>
                    <div className="text-slate-700">{l.summary}</div>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 12 && (
              <button type="button" className="min-h-11 text-xs font-semibold text-blue-700" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${attention.length}`}
              </button>
            )}
          </section>

          <section className="space-y-2" data-testid="capacity-demand" aria-labelledby="capacity-demand-title">
            <h3 id="capacity-demand-title" className="text-sm font-bold text-slate-900">
              Customers waiting against free outputs
            </h3>
            {demand.length === 0 ? (
              <p className="text-xs text-slate-600">No customer is waiting to be connected.</p>
            ) : (
              <ul className="space-y-1.5">
                {(short.length > 0 ? short : demand.slice(0, 6)).map((d) => (
                  <li key={d.boxId || 'none'} className={`rounded-lg border p-2 text-xs ${d.shortBy > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <span className="font-semibold text-slate-900">{d.boxName}</span>: {d.waiting} waiting, {d.needingOutput} need an output, {d.freeOutputs} free
                    {d.notRecordedOutputs ? ` (${d.notRecordedOutputs} not recorded)` : ''} ·{' '}
                    <span className="font-bold">
                      {d.state === 'box_not_recorded' ? 'box not recorded on the customers' : d.state === 'no_splitter' ? `no splitter recorded, short by ${d.shortBy}` : d.shortBy > 0 ? `short by ${d.shortBy}` : 'enough'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ScenarioPanel data={capacityData} optical={optical} osp={osp} />

          <Fold title="Warning levels and where they come from" testId="capacity-levels">
            <p className="text-xs text-slate-600">
              &quot;Nearly full&quot; is said when this share is taken or not recorded. These are planning proposals, not standards. They only warn.
            </p>
            {mayConfigure ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {CAPACITY_SETTING_DEFS.map((def) => (
                      <FieldSettingRow key={def.id} def={def} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="space-y-1 text-xs text-slate-700">
                {sources.map((s) => (
                  <li key={s.def.id}>
                    <span className="font-semibold">{CAPACITY_KIND_LABELS[s.def.kind]}:</span> {s.text}
                  </li>
                ))}
              </ul>
            )}
          </Fold>

          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 font-bold text-slate-900">Items on record</div>
              <div>OLTs: {data.equipment.filter((e) => e.type === 'OLT').length}</div>
              <div>ODFs: {data.equipment.filter((e) => e.type === 'ODF' || e.type === 'Fiber Patch Panel').length}</div>
              <div>Boxes (FAT, FDT, terminal): {data.equipment.filter((e) => e.type === 'FAT' || e.type === 'FDT' || e.type.includes('Terminal Box')).length}</div>
              <div>Joint closures: {(data.closures ?? []).length}</div>
              <div>Ducts: {(data.ducts ?? []).length} · Racks: {(data.racks ?? []).length}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 font-bold text-slate-900">More</div>
              <div>Open faults: {faults.filter((f) => isFaultOpen(f) && !f.isTest).length}</div>
              <div>Zones with a drawn boundary: {zones.filter((z) => z.boundaryCoords.length >= 3).length} of {zones.length}</div>
              <button
                type="button"
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 font-semibold text-white"
                onClick={onOpenReports}
                data-testid="capacity-open-reports"
              >
                <FileSpreadsheet className="h-4 w-4" /> Full tables in Reports (per zone, per element, CSV)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
