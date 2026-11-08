import React, { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { buildImpactIndex, correlateAlarms, isFaultOpen, isWorkOrderOpen, resolveFaultSettings } from '@fibergis/shared';

import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { AlarmsTab } from './AlarmsTab';
import { FaultsTab } from './FaultsTab';
import { JobsTab } from './JobsTab';
import { ImpactTab, SuspectedTab } from './SuspectedTab';

type Tab = 'alarms' | 'suspected' | 'faults' | 'jobs' | 'impact';

/**
 * Faults and field operations (Phase 8): alarms (reported, from the field or TEST), suspected
 * causes from recorded paths, faults through their lifecycle, work orders with their phone
 * evidence and checks, and who is affected by any element. No device alarms: "No live connection".
 */
export const FaultManagementModal: React.FC = () => {
  const { open, setModalOpen } = useUiStore(useShallow((s) => ({ open: s.modals.faults, setModalOpen: s.setModalOpen })));
  const data = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      splitters: s.splitters,
      closures: s.closures,
      customers: s.customers,
      spans: s.spans,
      attachments: s.attachments,
      onts: s.onts,
      services: s.services,
      alarms: s.alarms,
      faults: s.faults,
      workOrders: s.workOrders,
      settings: s.settings,
    })),
  );
  const optical = useNetworkStore(selectOpticalSettings);
  const [tab, setTab] = useState<Tab>('alarms');
  const [faultId, setFaultId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const ix = useMemo(
    () => (open ? buildImpactIndex(data, optical) : null),
    // Only the recorded network matters for paths; alarms and faults do not change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, data.equipment, data.cables, data.splitters, data.closures, data.customers, data.spans, data.attachments, data.onts, data.services, optical],
  );
  const faultSettings = useMemo(() => resolveFaultSettings(data.settings), [data.settings]);
  const correlation = useMemo(() => (ix ? correlateAlarms(ix, data.alarms, faultSettings) : { suspicions: [], notes: [] }), [ix, data.alarms, faultSettings]);

  if (!open || !ix) return null;

  const openAlarms = data.alarms.filter((a) => a.state !== 'cleared').length;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'alarms', label: `Alarms (${openAlarms})` },
    { id: 'suspected', label: `Suspected causes (${correlation.suspicions.filter((s) => s.primary).length})` },
    { id: 'faults', label: `Faults (${data.faults.filter(isFaultOpen).length})` },
    { id: 'jobs', label: `Work orders (${data.workOrders.filter((w) => isWorkOrderOpen(w) || w.status === 'Completed').length})` },
    { id: 'impact', label: 'Who is affected?' },
  ];

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs" data-testid="fault-center">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Faults and field work</h2>
              <p className="text-[11px] text-slate-500">Alarms, suspected causes from recorded paths, faults, work orders and checks</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={() => setModalOpen('faults', false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-100/50 px-3 py-2 text-xs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-testid={`fault-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 font-semibold ${tab === t.id ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-xs">
          {tab === 'alarms' && <AlarmsTab ix={ix} />}
          {tab === 'suspected' && (
            <SuspectedTab
              ix={ix}
              correlation={correlation}
              onOpenFault={(id) => {
                setFaultId(id);
                setTab('faults');
              }}
            />
          )}
          {tab === 'faults' && (
            <FaultsTab
              ix={ix}
              selectedId={faultId}
              onSelect={setFaultId}
              onShowJob={(id) => {
                setJobId(id);
              }}
            />
          )}
          {tab === 'jobs' && <JobsTab selectedId={jobId} onSelect={setJobId} />}
          {tab === 'impact' && <ImpactTab ix={ix} />}
        </div>
      </div>
    </div>
  );
};
