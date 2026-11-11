import { useState } from 'react';
import { Wifi } from 'lucide-react';

import { Modal } from '../../components/ui';
import { useUiStore } from '../../stores/uiStore';
import { ImportPanel } from './ImportPanel';
import { MonitoringOverview, UnmatchedList } from './MonitoringOverview';
import { NocPanel } from './NocPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { SourcesPanel } from './SourcesPanel';
import { useMay } from './useMonitoring';

type Tab = 'overview' | 'noc' | 'unmatched' | 'sources' | 'import' | 'test';

/**
 * Live monitoring (Phase 7): what the OLT or NMS reported, from stored rows only. Everyone may look;
 * sources, tokens and the TEST simulator are for the administrator; file import also for engineers.
 */
export function MonitoringModal() {
  const open = useUiStore((s) => s.modals.monitoring);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const [tab, setTab] = useState<Tab>('overview');
  const manage = useMay('manage_monitoring');
  const importer = useMay('import_monitoring');
  if (!open) return null;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: true },
    // Phase 20: the NOC screen, one line per PON port.
    { id: 'noc', label: 'OLT and PON ports', show: true },
    { id: 'unmatched', label: 'Not matched', show: true },
    { id: 'sources', label: 'Sources', show: manage },
    { id: 'import', label: 'Import file', show: importer },
    { id: 'test', label: 'TEST simulator', show: manage },
  ];
  return (
    <Modal
      open
      onClose={() => setModalOpen('monitoring', false)}
      title="Live status"
      description="Status and light levels reported by your OLT or NMS, with their time and source. Nothing here is estimated. With nothing sent: No live connection."
      icon={Wifi}
      size="2xl"
    >
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-testid={`mon-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`min-h-[48px] rounded-lg px-3 text-xs font-semibold ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} ${t.id === 'test' ? 'border border-violet-300' : ''}`}
            >
              {t.label}
            </button>
          ))}
      </div>
      {tab === 'overview' && <MonitoringOverview />}
      {tab === 'noc' && <NocPanel />}
      {tab === 'unmatched' && <UnmatchedList />}
      {tab === 'sources' && manage && <SourcesPanel />}
      {tab === 'import' && importer && <ImportPanel />}
      {tab === 'test' && manage && <SimulatorPanel />}
    </Modal>
  );
}
