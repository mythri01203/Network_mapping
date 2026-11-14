import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type CombinedTarget, type LogicalNode, type ServiceTopology,serviceTopology } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { cn } from '../../components/ui';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { countsText, withoutLogical } from './topologyUi';

/**
 * Network mapping Phase 14: the topology tree, built only from recorded links (OLT → PON port →
 * splitters in their boxes, cascade by cascade → ONT → customer), with what is below each step and
 * every missing link shown in its place. The logical layer (services, VLANs, the ONT's
 * registration and where it disagrees with the links) is shown on request. A folding list, not a
 * canvas, so it reads on a 390 px phone.
 */

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

const SUMMARISED = new Set<LogicalNode['kind']>(['olt', 'pon', 'splitter', 'output']);

interface TreeNodeProps {
  n: LogicalNode;
  depth: number;
  logical: boolean;
  /** Bumped by "Open all" and "Close all"; each row takes that as its new state. */
  fold: { version: number; open: boolean | null };
  onShow: (n: LogicalNode) => void;
  onCompare?: (target: CombinedTarget) => void;
}

function TreeNode({ n, depth, logical, fold, onShow, onCompare }: TreeNodeProps) {
  const [state, setState] = useState<{ open: boolean; version: number }>({ open: depth < 6, version: fold.version });
  const open = fold.version !== state.version && fold.open !== null ? fold.open : state.open;
  const toggle = () => setState({ open: !open, version: fold.version });
  const [actions, setActions] = useState(false);
  const hasKids = n.children.length > 0;
  const counts = SUMMARISED.has(n.kind) && n.counts ? countsText(n.counts, logical) : '';
  const canAct = !!n.ref || !!(n.target && onCompare);
  return (
    <li data-testid={`topo-${n.kind}`} data-key={n.key}>
      <div
        className={cn(
          'flex min-h-12 items-start gap-1 rounded-md py-1 pr-1 text-sm md:min-h-9 md:text-[13px]',
          n.status === 'gap' && 'bg-red-50 text-red-800',
          n.status === 'warning' && 'text-amber-800',
          logical && n.mismatch && 'bg-amber-50',
        )}
      >
        {hasKids ? (
          <button
            type="button"
            aria-label={open ? `Fold ${n.label}` : `Unfold ${n.label}`}
            aria-expanded={open}
            className="flex h-12 w-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 md:h-8 md:w-7"
            onClick={toggle}
          >
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        ) : (
          <span className="w-10 shrink-0 md:w-7" />
        )}
        <div className="min-w-0 flex-1 py-1.5 md:py-1">
          {KIND_LABEL[n.kind] && !n.label.startsWith(KIND_LABEL[n.kind]) && (
            <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{KIND_LABEL[n.kind]}</span>
          )}
          {n.kind === 'gap' && <span aria-hidden="true">✕ </span>}
          {canAct ? (
            <button type="button" aria-expanded={actions} className="text-left font-medium text-blue-700 underline-offset-2 hover:underline" onClick={() => setActions(!actions)}>
              {n.label}
            </button>
          ) : (
            <span className={n.kind === 'note' ? 'text-slate-600' : 'font-medium'}>{n.label}</span>
          )}
          {n.box && (
            <span className="ml-1.5 inline-block rounded bg-slate-100 px-1.5 text-xs text-slate-700" data-testid="topo-box">
              in box {n.box.name}
            </span>
          )}
          {n.detail && <span className="block break-words text-xs text-slate-600">{n.detail}</span>}
          {counts && (
            <span className="block text-xs font-semibold text-slate-700" data-testid="topo-node-counts">
              {counts}
            </span>
          )}
          {logical && n.logicalDetail && (
            <span className="block break-words text-xs text-violet-800" data-testid="topo-logical">
              Service settings: {n.logicalDetail}
            </span>
          )}
          {logical && n.mismatch && (
            <span className="block break-words text-xs font-semibold text-amber-900" data-testid="topo-mismatch">
              ✕ Does not match: {n.mismatch}
            </span>
          )}
          {actions && canAct && (
            <span className="mt-1 flex flex-wrap gap-2">
              {n.ref && (
                <button type="button" className="min-h-12 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 md:min-h-8 md:text-xs" onClick={() => onShow(n)}>
                  Show on map
                </button>
              )}
              {n.target && onCompare && (
                <button
                  type="button"
                  data-testid="topo-compare"
                  className="min-h-12 rounded-lg border border-blue-300 bg-blue-50 px-3 text-sm font-semibold text-blue-800 md:min-h-8 md:text-xs"
                  onClick={() => onCompare(n.target!)}
                >
                  Physical and logical
                </button>
              )}
            </span>
          )}
        </div>
      </div>
      {hasKids && open && (
        <ul className="ml-3 border-l border-slate-200 pl-1 md:ml-3 md:pl-2">
          {n.children.map((c) => (
            <TreeNode key={c.key} n={c} depth={depth + 1} logical={logical} fold={fold} onShow={onShow} onCompare={onCompare} />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface TopologyTreeProps {
  topo: ServiceTopology;
  logical: boolean;
  onLogical: (on: boolean) => void;
  onShow: (n: LogicalNode) => void;
  onCompare?: (target: CombinedTarget) => void;
}

/** The tree itself, from a worked-out topology (no store), so it can be tested and reused. */
export function TopologyTree({ topo, logical, onLogical, onShow, onCompare }: TopologyTreeProps) {
  const [fold, setFold] = useState<{ version: number; open: boolean | null }>({ version: 0, open: null });
  const roots = logical ? topo.roots : withoutLogical(topo.roots);
  const unreached = logical ? topo.unreached : withoutLogical(topo.unreached);
  const c = topo.counts;
  const button = 'min-h-12 rounded-lg border px-3 text-sm font-semibold md:min-h-9 md:text-xs';
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:p-4" data-testid="service-topology">
      <p className="mb-3 max-w-3xl text-xs text-slate-600">
        Built only from recorded links: patches, ODF ports, splices, splitter inputs and outputs, drop fibres and ONT records. A link that is not recorded shows in red with
        its name. Map position is never used.
      </p>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700" data-testid="topo-counts">
        <span>{c.ponPorts} PON ports</span>
        <span>{c.splitters} splitters reached</span>
        <span>{c.customersReached} customers reached</span>
        <span className={c.customersUnreached ? 'font-semibold text-red-700' : ''}>{c.customersUnreached} not reached</span>
        <span className={c.gaps ? 'font-semibold text-red-700' : ''}>{c.gaps} missing links</span>
        {logical && <span className={c.mismatches ? 'font-semibold text-amber-800' : ''}>{c.mismatches} ONT records that do not match the links</span>}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={logical}
          data-testid="topo-logical-toggle"
          className={cn(button, logical ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-slate-300 bg-white text-slate-800')}
          onClick={() => onLogical(!logical)}
        >
          {logical ? '✓ ' : ''}Show services and VLANs
        </button>
        <button type="button" className={cn(button, 'border-slate-300 bg-white text-slate-800')} onClick={() => setFold({ version: fold.version + 1, open: true })}>
          Open all
        </button>
        <button type="button" className={cn(button, 'border-slate-300 bg-white text-slate-800')} onClick={() => setFold({ version: fold.version + 1, open: false })}>
          Close all
        </button>
      </div>
      {roots.length === 0 ? (
        <p className="text-sm text-slate-600">No OLT is recorded.</p>
      ) : (
        <ul className="ui-section-card space-y-1 p-2 md:p-3">
          {roots.map((n) => (
            <TreeNode key={n.key} n={n} depth={0} logical={logical} fold={fold} onShow={onShow} onCompare={onCompare} />
          ))}
        </ul>
      )}
      {unreached.length > 0 && (
        <section className="mt-5" data-testid="topo-unreached">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">Not reached from any PON port</h3>
          <ul className="space-y-1">
            {unreached.map((n) => (
              <TreeNode key={n.key} n={n} depth={0} logical={logical} fold={fold} onShow={onShow} onCompare={onCompare} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The tree from the network on this device (already limited to this organisation and hidden by role by the server). */
export function ServiceTopologyPanel({ onCompare }: { onCompare?: (target: CombinedTarget) => void }) {
  const network = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, onts: s.onts, services: s.services, buildings: s.buildings })),
  );
  const optical = useNetworkStore(selectOpticalSettings);
  const topo = useMemo(() => serviceTopology(network, { settings: optical }), [network, optical]);
  const [logical, setLogical] = useState(false);
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
    } else {
      const data = state.cables.find((c) => c.id === n.ref!.id);
      if (data) showOnMap({ type: 'cable', data });
    }
  };
  return <TopologyTree topo={topo} logical={logical} onLogical={setLogical} onShow={show} onCompare={onCompare} />;
}
