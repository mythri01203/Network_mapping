import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText, GitBranch, List, MapPin, Route, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type NetworkTraceResult,
  TRACE_STEP_STATE_LABELS,
  TRACE_TYPE_LABELS,
  TRACE_TYPES,
  TRACE_TYPES_BETWEEN,
  type TraceGraph,
  type TracePath,
  type TracePoint,
  tracePointFromId,
  tracePointLabel,
  type TraceRequest,
  type TraceStep,
  type TraceTreeNode,
  type TraceType,
} from '@fibergis/shared';

import { Modal } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { traceCableRoute } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useTraceStore } from '../../stores/traceStore';
import { useUiStore } from '../../stores/uiStore';
import { runTrace, showTraceOnMap } from './networkTraceActions';
import { TraceDiagram } from './TraceDiagram';
import { downloadTraceCsv, downloadTracePdf } from './traceExport';
import { traceGraphOf } from './traceGraph';
import { KIND_WORDS, STATE_STYLE } from './traceWords';

/**
 * Network mapping Phase 15: one screen for all 12 traces, on the one trace engine. Pick what to
 * trace and from where (an item, cable, fibre, port, ODF port, closure, splice, splitter, customer,
 * fault), or between two points. Every step shows its state in words and a mark: checked good, not
 * checked, planned, faulty, or a missing link. Works at 390 px, with 48 px targets.
 */

const BIG = 'min-h-12 rounded-xl px-4 text-sm font-semibold';

/** The text a point is typed as. */
function pointText(p: TracePoint | undefined): string {
  if (!p) return '';
  switch (p.type) {
    case 'core':
      return `${p.cableId}#${p.core}`;
    case 'pon_port':
      return `${p.oltId}/${p.ponPortId}`;
    case 'odf_port':
      return p.equipmentId;
    case 'splice':
      return p.closureId;
    default:
      return p.id;
  }
}

/** The finer choice a point was made with, as the picker's value. */
function subText(p: TracePoint): string {
  if (p.type === 'odf_port') return `${p.panelId}/${p.portId}`;
  if (p.type === 'splice') return p.spliceId;
  if (p.type === 'splitter' && p.port !== undefined) return String(p.port);
  return '';
}

/** The finer choice a point offers: a port of an ODF, a splice of a closure, an output of a splitter, a fibre of a cable. */
function subChoices(g: TraceGraph, base: TracePoint | undefined): { label: string; options: { value: string; label: string; point: TracePoint }[] } | null {
  if (!base) return null;
  if (base.type === 'equipment') {
    const eq = g.equipment.get(base.id);
    const ports = (eq?.odfPanels ?? []).flatMap((panel) =>
      panel.ports
        .filter((port) => port.patch || port.feederCableId)
        .map((port) => ({ value: `${panel.id}/${port.id}`, label: `${panel.label} port ${port.number}`, point: { type: 'odf_port', equipmentId: base.id, panelId: panel.id, portId: port.id } as TracePoint })),
    );
    const splices = g.data.closures
      .filter((c) => c.equipmentId === base.id)
      .flatMap((c) => c.splices.filter((s) => !s.retiredAt && !s.enteredInError).map((s) => ({ value: `${c.id}/${s.id}`, label: `Splice ${s.inputCableName || s.inputCableId} F${s.inputCore} → ${s.outputCableName || s.outputCableId} F${s.outputCore}`, point: { type: 'splice', closureId: c.id, spliceId: s.id } as TracePoint })));
    const options = [...ports, ...splices];
    return options.length ? { label: ports.length && !splices.length ? 'Which ODF port? (or leave it: all ports)' : 'Which port or splice? (or leave it: all)', options } : null;
  }
  if (base.type === 'closure') {
    const c = g.closures.get(base.id);
    const options = (c?.splices ?? []).filter((s) => !s.retiredAt && !s.enteredInError).map((s) => ({ value: s.id, label: `Splice ${s.inputCableName || s.inputCableId} F${s.inputCore} → ${s.outputCableName || s.outputCableId} F${s.outputCore}`, point: { type: 'splice', closureId: base.id, spliceId: s.id } as TracePoint }));
    return options.length ? { label: 'Which splice? (or leave it: all splices)', options } : null;
  }
  if (base.type === 'splitter') {
    const sp = g.splitters.get(base.id);
    const options = (sp?.outputPorts ?? []).map((p) => ({ value: String(p.portNumber), label: `Output ${p.portNumber}${p.label ? ` (${p.label})` : ''}`, point: { type: 'splitter', id: base.id, port: p.portNumber } as TracePoint }));
    return options.length ? { label: 'Which output? (or leave it: the whole splitter)', options } : null;
  }
  if (base.type === 'cable') {
    const cable = g.cables.get(base.id);
    const options: { value: string; label: string; point: TracePoint }[] = [];
    for (let n = 1; n <= (cable?.fiberCount ?? 0) && n <= 288; n += 1) options.push({ value: String(n), label: `Fibre ${n}`, point: { type: 'core', cableId: base.id, core: n } });
    return options.length ? { label: 'Which fibre? (or leave it: every fibre with a link)', options } : null;
  }
  return null;
}

/** A typed id, a finer choice, and suggestions as big buttons. */
const PointPicker: React.FC<{
  label: string;
  graph: TraceGraph;
  value: string;
  sub: string;
  onChange: (text: string, sub: string) => void;
  testId: string;
}> = ({ label, graph, value, sub, onChange, testId }) => {
  const selected = useUiStore((s) => s.selectedObject);
  const base = useMemo(() => tracePointFromId(graph, value), [graph, value]);
  const choices = useMemo(() => subChoices(graph, base), [graph, base]);
  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q.length < 2 || base) return [];
    const out: { id: string; words: string }[] = [];
    const add = (id: string, words: string) => {
      if (out.length < 6 && (id.toLowerCase().includes(q) || words.toLowerCase().includes(q))) out.push({ id, words });
    };
    for (const e of graph.data.equipment) add(e.id, `${e.name} · ${e.type}`);
    for (const c of graph.data.cables) add(c.id, `${c.name} · cable`);
    for (const c of graph.data.closures) add(c.id, `${c.name} · closure`);
    for (const s of graph.data.splitters) add(s.id, `${s.name} · splitter`);
    for (const c of graph.data.customers) add(c.id, `${c.name} · customer`);
    return out;
  }, [graph, value, base]);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-800" htmlFor={testId}>
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={testId}
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value, '')}
          placeholder="Id of an item, cable, customer, closure, splitter, fault, OLT/PORT or CABLE#FIBRE"
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-500"
          autoComplete="off"
        />
        {selected && (
          <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => onChange(selected.data.id, '')}>
            Use the selected item
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm text-slate-800" onClick={() => onChange(s.id, '')}>
              <span className="font-mono text-xs">{s.id}</span> <span className="text-slate-600">{s.words}</span>
            </button>
          ))}
        </div>
      )}
      {value.trim() && (
        <p className={`text-sm ${base ? 'text-slate-700' : 'text-red-700'}`} data-testid={`${testId}-found`}>
          {base ? `Found: ${tracePointLabel(graph, base)}` : 'Nothing on record has this id.'}
        </p>
      )}
      {choices && (
        <select
          aria-label={choices.label}
          value={sub}
          onChange={(e) => onChange(value, e.target.value)}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
          data-testid={`${testId}-sub`}
        >
          <option value="">{choices.label}</option>
          {choices.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

const resolvePoint = (g: TraceGraph, text: string, sub: string): TracePoint | undefined => {
  const base = tracePointFromId(g, text);
  if (!base || !sub) return base;
  return subChoices(g, base)?.options.find((o) => o.value === sub)?.point ?? base;
};

const StateBadge: React.FC<{ step: TraceStep }> = ({ step }) => {
  const s = STATE_STYLE[step.state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${s.badge}`}>
      <span aria-hidden>{s.mark}</span>
      {TRACE_STEP_STATE_LABELS[step.state]}
    </span>
  );
};

export const StepCard: React.FC<{ step: TraceStep; index?: number }> = ({ step, index }) => {
  const flyTo = useMapStore((s) => s.flyTo);
  const located = step.lat !== undefined && step.lng !== undefined;
  return (
    <div className={`rounded-xl border p-3 ${step.kind === 'gap' ? 'border-2 border-dashed border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`} data-testid="trace-step" data-state={step.state} data-kind={step.kind}>
      <div className="flex flex-wrap items-center gap-2">
        {index !== undefined && <span className="font-mono text-xs text-slate-500">{index}</span>}
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{KIND_WORDS[step.kind]}</span>
        {step.kind !== 'note' && <StateBadge step={step} />}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{step.title}</div>
      {step.detail && <div className="text-sm text-slate-600">{step.detail}</div>}
      {step.reasons.length > 0 && step.state !== 'unverified' && (
        <ul className="mt-1 list-disc pl-5 text-xs text-slate-700">
          {step.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {step.links.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {step.links.map((l) => (
            <li key={l.connectionId}>
              <span className="font-semibold">{l.kindLabel}:</span> {l.checkLabel} <span className="text-slate-500">(recorded in {l.recordedIn})</span>
            </li>
          ))}
        </ul>
      )}
      {located && (
        <button type="button" className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-800" onClick={() => flyTo(step.lat!, step.lng!, 18)}>
          <MapPin className="h-4 w-4" /> Show on map
        </button>
      )}
    </div>
  );
};

const PathList: React.FC<{ path: TracePath; n: number }> = ({ path, n }) => (
  <section className="space-y-2" data-testid="trace-path">
    <h4 className="text-sm font-bold text-slate-800">
      {path.label ?? `Path ${n}`}
      {path.reaches ? ` · reaches ${path.reaches.oltId} ${path.reaches.ponPortId}` : ''}
    </h4>
    <ol className="space-y-2">
      {path.steps.map((step, i) => (
        <li key={`${step.key}-${i}`}>
          <StepCard step={step} index={i + 1} />
        </li>
      ))}
    </ol>
  </section>
);

const TreeList: React.FC<{ node: TraceTreeNode; depth?: number }> = ({ node, depth = 0 }) => (
  <li className={depth > 0 ? 'border-l-2 border-slate-200 pl-2' : ''}>
    <StepCard step={node.step} />
    {node.children.length > 0 &&
      (depth >= 3 ? (
        <details className="mt-1">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-blue-700">Show {node.children.length} more below</summary>
          <ul className="mt-1 space-y-2">
            {node.children.map((c, i) => (
              <TreeList key={`${c.step.key}-${i}`} node={c} depth={depth + 1} />
            ))}
          </ul>
        </details>
      ) : (
        <ul className="mt-2 space-y-2">
          {node.children.map((c, i) => (
            <TreeList key={`${c.step.key}-${i}`} node={c} depth={depth + 1} />
          ))}
        </ul>
      ))}
  </li>
);

export const TraceSummaryView: React.FC<{ result: NetworkTraceResult }> = ({ result }) => {
  const c = result.counts;
  const chips: [keyof typeof STATE_STYLE, number][] = [
    ['ok', c.ok],
    ['unverified', c.unverified],
    ['warning', c.warning],
    ['planned', c.planned],
    ['faulty', c.faulty],
    ['missing', c.missing],
  ];
  return (
    <div className="space-y-2">
      <div role="status" className={`rounded-xl border p-3 text-sm ${result.complete ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`} data-testid="trace-summary">
        <div className="font-bold">{result.complete ? 'No missing link on record.' : `Not complete: ${result.gaps.length} missing link(s).`}</div>
        <div>{result.title}</div>
        {result.level === 'cable' && <div className="mt-1 font-semibold">Cables only: the fibres are not recorded end to end. This shows where cables go, not that light gets through.</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {chips
          .filter(([, n]) => n > 0)
          .map(([state, n]) => (
            <span key={state} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[state].badge}`}>
              <span aria-hidden>{STATE_STYLE[state].mark}</span> {n} {TRACE_STEP_STATE_LABELS[state].toLowerCase()}
            </span>
          ))}
      </div>
      {result.gaps.length > 0 && (
        <ul className="list-disc space-y-1 rounded-xl border border-red-200 bg-white p-3 pl-7 text-sm text-red-900">
          {result.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="list-disc space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** The screen itself. Mounted only while open, so nothing is built while it is closed. */
const NetworkTracePanel: React.FC = () => {
  const { open, network, request, closePanel, clear } = useTraceStore(
    useShallow((s) => ({ open: s.panelOpen, network: s.network, request: s.request, closePanel: s.closePanel, clear: s.clear })),
  );
  // Rebuild the graph only when a record the trace reads changes.
  const deps = useNetworkStore(
    useShallow((s) => [s.equipment, s.cables, s.splitters, s.closures, s.customers, s.onts, s.linkVerifications, s.faults, s.services, s.cableSegments, s.ducts, s.attachments, s.settings]),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` are the records the graph reads.
  const graph = useMemo(() => traceGraphOf(useNetworkStore.getState()), [deps]);

  const [type, setType] = useState<TraceType>('customer_to_olt');
  const [from, setFrom] = useState({ text: '', sub: '' });
  const [to, setTo] = useState({ text: '', sub: '' });
  const [view, setView] = useState<'list' | 'diagram'>('list');

  // Opened from somewhere else with a request: show it in the form (once per request).
  const [formFor, setFormFor] = useState<TraceRequest | null>(null);
  if (open && request && request !== formFor) {
    setFormFor(request);
    setType(request.type);
    setFrom({ text: pointText(request.from), sub: subText(request.from) });
    if (request.to) setTo({ text: pointText(request.to), sub: subText(request.to) });
  }

  // The records changed while a trace is shown: run it again, so the screen never shows old links.
  useEffect(() => {
    if (open && request && network) runTrace(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const between = TRACE_TYPES_BETWEEN.has(type);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = resolvePoint(graph, from.text, from.sub);
    const b = between ? resolvePoint(graph, to.text, to.sub) : undefined;
    if (!a) {
      showToast('warning', 'Choose where to start', from.text.trim() ? `Nothing on record has the id "${from.text.trim()}".` : 'Type or pick an id to trace from.');
      return;
    }
    if (between && !b) {
      showToast('warning', 'Choose the second point', 'This trace needs two points.');
      return;
    }
    const result = runTrace({ type, from: a, ...(b ? { to: b } : {}) });
    showTraceOnMap(result);
  };

  const legacyId = request && (request.from.type === 'customer' || request.from.type === 'equipment' || request.from.type === 'cable') ? request.from.id : undefined;

  return (
    <Modal
      open={open}
      onClose={closePanel}
      title="Network trace"
      description="Follows only the links on record. A missing link is shown as missing, never filled in."
      icon={Route}
      size="xl"
      footer={
        <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={closePanel}>
          Close
        </button>
      }
    >
      <div className="space-y-4" data-testid="network-trace">
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div>
            <label className="block text-sm font-semibold text-slate-800" htmlFor="trace-type">
              What do you want to trace?
            </label>
            <select id="trace-type" data-testid="trace-type" value={type} onChange={(e) => setType(e.target.value as TraceType)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
              {TRACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRACE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <PointPicker label={between ? 'First point' : 'Start from'} graph={graph} value={from.text} sub={from.sub} onChange={(text, sub) => setFrom({ text, sub })} testId="trace-from" />
          {between && <PointPicker label="Second point" graph={graph} value={to.text} sub={to.sub} onChange={(text, sub) => setTo({ text, sub })} testId="trace-to" />}
          <button type="submit" className={`${BIG} w-full bg-blue-600 text-white`} data-testid="trace-run">
            Trace
          </button>
        </form>

        {network && (
          <>
            <TraceSummaryView result={network} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${BIG} inline-flex items-center gap-2 border ${view === 'list' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-800'}`} onClick={() => setView('list')} aria-pressed={view === 'list'}>
                <List className="h-4 w-4" /> Steps
              </button>
              <button type="button" className={`${BIG} inline-flex items-center gap-2 border ${view === 'diagram' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-800'}`} onClick={() => setView('diagram')} aria-pressed={view === 'diagram'} data-testid="trace-view-diagram">
                <GitBranch className="h-4 w-4" /> Diagram
              </button>
              <button type="button" className={`${BIG} inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800`} onClick={() => showTraceOnMap(network) || showToast('info', 'Nothing to show', 'No step of this trace has a position on record.')}>
                <MapPin className="h-4 w-4" /> Show on map
              </button>
              <button type="button" className={`${BIG} inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800`} onClick={() => downloadTracePdf(network)} data-testid="trace-pdf">
                <FileText className="h-4 w-4" /> Report (PDF)
              </button>
              <button type="button" className={`${BIG} inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800`} onClick={() => downloadTraceCsv(network)} data-testid="trace-csv">
                <Download className="h-4 w-4" /> Table (CSV)
              </button>
              {legacyId && (
                <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => traceCableRoute(legacyId)}>
                  Cables and loss estimate
                </button>
              )}
              <button type="button" className={`${BIG} inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800`} onClick={clear}>
                <X className="h-4 w-4" /> Clear from map
              </button>
            </div>
            {view === 'diagram' ? (
              <TraceDiagram result={network} onPick={(s) => useMapStore.getState().flyTo(s.lat!, s.lng!, 18)} />
            ) : (
              <div className="space-y-4">
                {network.paths.map((p, i) => (
                  <PathList key={`p${i}`} path={p} n={i + 1} />
                ))}
                {network.trees.length > 0 && (
                  <ul className="space-y-2" data-testid="trace-tree">
                    {network.trees.map((t, i) => (
                      <TreeList key={`t${i}`} node={t} />
                    ))}
                  </ul>
                )}
                {network.paths.length === 0 && network.trees.length === 0 && <p className="text-sm text-slate-600">No step is on record for this trace.</p>}
              </div>
            )}
            {network.notes.length > 0 && (
              <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <summary className="flex min-h-12 cursor-pointer items-center font-semibold">How this was worked out ({network.notes.length})</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {network.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export const NetworkTraceModal: React.FC = () => {
  const open = useTraceStore((s) => s.panelOpen);
  return open ? <NetworkTracePanel /> : null;
};
