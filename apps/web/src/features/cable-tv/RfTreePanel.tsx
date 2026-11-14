import { describeRfLink, portKey, RF_KIND_INFO, rfPowerWord, type RfTreeNode } from '@fibergis/shared';

import { estimateText } from './rfText';
import type { RfModel } from './useRfModel';

const POWER_STYLE: Record<string, string> = {
  Powered: 'bg-amber-100 text-amber-900 border-amber-300',
  Passive: 'bg-slate-100 text-slate-700 border-slate-300',
  'Power not recorded': 'bg-red-50 text-red-800 border-red-300',
  'Customer device': 'bg-blue-50 text-blue-800 border-blue-200',
};

function NodeRow({ node, model }: { node: RfTreeNode; model: RfModel }) {
  const el = node.element;
  const power = rfPowerWord(el);
  const input = el.ports.find((p) => p.direction === 'in' && p.signal !== 'power');
  const outs = el.ports.filter((p) => p.direction === 'out' && p.signal !== 'power');
  return (
    <li className="mt-1" data-testid={`rf-tree-${el.name}`}>
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{el.name}</span>
          <span className="text-xs text-slate-600">{RF_KIND_INFO[el.kind].label}</span>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${POWER_STYLE[power]}`} data-testid="rf-power-badge">
            {power}
          </span>
          {node.loop && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">Loop: links go back here</span>}
        </div>
        {node.via && <div className="mt-0.5 text-xs text-slate-600">Fed by: {describeRfLink(model.ix, node.via)}</div>}
        {input && (
          <div className="mt-0.5 text-xs text-slate-700" data-testid="rf-tree-in">
            {input.label}: {estimateText(model.estimates.get(portKey(el.id, input.id)), model.rf)}
          </div>
        )}
        {outs.length > 0 && outs.length <= 2 && (
          <div className="text-xs text-slate-700">
            {outs.map((p) => (
              <div key={p.id}>
                {p.label}: {estimateText(model.estimates.get(portKey(el.id, p.id)), model.rf)}
              </div>
            ))}
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 border-l-2 border-orange-200 pl-3">
          {node.children.map((child) => (
            <NodeRow key={`${child.element.id}-${child.via?.id ?? ''}`} node={child} model={model} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The directional tree from each headend, then every piece no headend reaches with its gap. */
export function RfTreePanel({ model }: { model: RfModel }) {
  const { tree } = model;
  if (model.data.rfElements.length === 0) {
    return <p className="ui-empty p-6 text-center text-sm">Not recorded. No Cable TV items are on record yet. Add them under Items, then link them under Links.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs" data-testid="rf-tree-counts">
        <span className="rounded border border-amber-300 bg-amber-100 px-2 py-1 font-semibold text-amber-900">Powered: {tree.counts.powered}</span>
        <span className="rounded border border-slate-300 bg-slate-100 px-2 py-1 font-semibold text-slate-700">Passive: {tree.counts.passive}</span>
        <span className="rounded border border-red-300 bg-red-50 px-2 py-1 font-semibold text-red-800">Power not recorded: {tree.counts.powerNotRecorded}</span>
        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-800">Customer devices: {tree.counts.customerDevices}</span>
      </div>
      <p className="text-xs text-slate-600">
        Built only from recorded links, top to bottom in the direction the signal flows. Every level here is Estimated from what was entered (rated
        output, gain, tilt, coax type and length, losses), not measured.
      </p>
      {tree.loops.map((l) => (
        <p key={l} className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm font-semibold text-red-800">{l}</p>
      ))}
      {tree.roots.length === 0 && <p className="text-sm text-slate-700">No headend is recorded, so nothing is reached from the top.</p>}
      {tree.roots.map((root) => (
        <ul key={root.element.id} data-testid="rf-tree-root">
          <NodeRow node={root} model={model} />
        </ul>
      ))}
      {tree.detached.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50/40 p-3" data-testid="rf-detached">
          <h4 className="text-sm font-bold text-red-800">Not reached from a headend ({tree.detached.length})</h4>
          {tree.detached.map(({ node, gap }) => (
            <div key={node.element.id} className="mt-2">
              <p className="text-sm font-semibold text-red-800" data-testid="rf-gap">Gap: {gap}</p>
              <ul>
                <NodeRow node={node} model={model} />
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
