import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type LogicalNode, serviceTopology } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { cn } from '../../components/ui';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';

const KIND_LABEL: Record<LogicalNode['kind'], string> = {
  olt: 'OLT',
  pon: 'PON port',
  splitter: 'Splitter',
  output: 'Output',
  ont: 'ONT',
  customer: 'Customer',
  service: 'Service',
  gap: 'Missing link',
  note: '',
};

function TreeNode({ n, depth, onShow }: { n: LogicalNode; depth: number; onShow: (n: LogicalNode) => void }) {
  const [open, setOpen] = useState(depth < 6);
  const hasKids = n.children.length > 0;
  return (
    <li data-testid={`topo-${n.kind}`} data-key={n.key}>
      <div
        className={cn(
          'flex min-h-9 items-start gap-1.5 rounded px-1 py-1 text-[13px]',
          n.status === 'gap' && 'bg-red-50 text-red-800',
          n.status === 'warning' && 'text-amber-800',
        )}
      >
        {hasKids ? (
          <button type="button" aria-label={open ? 'Fold' : 'Unfold'} aria-expanded={open} className="mt-0.5 shrink-0 text-slate-400" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {KIND_LABEL[n.kind] && !n.label.startsWith(KIND_LABEL[n.kind]) && <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{KIND_LABEL[n.kind]}</span>}
          {n.ref ? (
            <button type="button" className="text-left font-medium text-blue-700 hover:underline" onClick={() => onShow(n)}>
              {n.label}
            </button>
          ) : (
            <span className={n.kind === 'gap' ? 'font-medium' : n.kind === 'note' ? 'text-slate-500' : 'font-medium'}>{n.label}</span>
          )}
          {n.detail && <span className="block text-xs text-slate-500 break-words">{n.detail}</span>}
        </div>
      </div>
      {hasKids && open && (
        <ul className="ml-3 border-l border-slate-200 pl-2">
          {n.children.map((c) => (
            <TreeNode key={c.key} n={c} depth={depth + 1} onShow={onShow} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Logical view: OLT → PON → splitter stages → ONT → customer → services, from recorded links only. */
export function ServiceTopologyPanel() {
  const network = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, onts: s.onts, services: s.services, buildings: s.buildings })),
  );
  const optical = useNetworkStore(selectOpticalSettings);
  const topo = useMemo(() => serviceTopology(network, { settings: optical }), [network, optical]);
  const showOnMap = useShowOnMap();
  const show = (n: LogicalNode) => {
    if (!n.ref) return;
    const state = useNetworkStore.getState();
    if (n.ref.type === 'customer') {
      const data = state.customers.find((c) => c.id === n.ref!.id);
      if (data) showOnMap({ type: 'customer', data });
    } else if (n.ref.type === 'equipment') {
      const data = state.equipment.find((e) => e.id === n.ref!.id);
      if (data) showOnMap({ type: 'equipment', data });
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="service-topology">
      <p className="mb-3 max-w-3xl text-xs text-slate-600">
        Built only from recorded links: patches, ODF ports, splices, splitter inputs and outputs, drop fibers and ONT records. A link that is not recorded shows in red with its name. Map position is never used.
      </p>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-700" data-testid="topo-counts">
        <span>{topo.counts.ponPorts} PON ports</span>
        <span>{topo.counts.splitters} splitters reached</span>
        <span>{topo.counts.customersReached} customers reached</span>
        <span className={topo.counts.customersUnreached ? 'font-semibold text-red-700' : ''}>{topo.counts.customersUnreached} not reached</span>
        <span className={topo.counts.gaps ? 'font-semibold text-red-700' : ''}>{topo.counts.gaps} missing links</span>
      </div>
      {topo.roots.length === 0 ? (
        <p className="text-sm text-slate-600">No OLT is recorded.</p>
      ) : (
        <ul className="space-y-1">
          {topo.roots.map((n) => (
            <TreeNode key={n.key} n={n} depth={0} onShow={show} />
          ))}
        </ul>
      )}
      {topo.unreached.length > 0 && (
        <section className="mt-5" data-testid="topo-unreached">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">Not reached from any PON port</h3>
          <ul className="space-y-1">
            {topo.unreached.map((n) => (
              <TreeNode key={n.key} n={n} depth={0} onShow={show} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
