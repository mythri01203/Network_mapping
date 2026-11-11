import { useState } from 'react';

import type { CombinedTarget } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { CombinedViewPanel } from './CombinedViewPanel';
import { ReconciliationPanel } from './ReconciliationPanel';
import { ServiceTopologyPanel } from './ServiceTopologyPanel';

type TopologyTab = 'tree' | 'compare' | 'checks';

const TABS: { id: TopologyTab; label: string }[] = [
  { id: 'tree', label: 'Network tree' },
  { id: 'compare', label: 'Physical and logical' },
  { id: 'checks', label: 'Readings and lengths' },
];

/**
 * Topology (network mapping Phase 14): the tree built from recorded links, the physical path next
 * to the recorded service settings, and the reading and length checks. The older picture that
 * grouped equipment by type, and showed no real connections, is gone.
 */
export function NetworkTopologyView() {
  const [tab, setTab] = useState<TopologyTab>('tree');
  const [target, setTarget] = useState<CombinedTarget | null>(null);
  const compare = (t: CombinedTarget) => {
    setTarget(t);
    setTab('compare');
  };
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 md:px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`topology-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px min-h-12 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium md:min-h-10 md:text-[13px]',
              tab === t.id ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'tree' && <ServiceTopologyPanel onCompare={compare} />}
      {tab === 'compare' && <CombinedViewPanel target={target} onTarget={setTarget} />}
      {tab === 'checks' && <ReconciliationPanel />}
    </div>
  );
}
