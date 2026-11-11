import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
  type CapacityData,
  describeScenarioItem,
  evaluateScenario,
  isPoleType,
  newScenarioItemId,
  type OpticalSettings,
  type OspSettings,
  type PlanningScenario,
  SCENARIO_LINE_STATE_WORDS,
  SCENARIO_STATUS_LABELS,
  type ScenarioItem,
  type ScenarioLineState,
  SPLITTER_RATIOS,
  type SplitterRatio,
} from '@fibergis/shared';

import { addScenario, removeScenario, updateScenario, useMayPlan } from '../../stores/planningActions';

/**
 * Network mapping Phase 18: expansion scenarios on the Capacity dashboard. A planner writes planned
 * additions and sees the capacity "if built". Plans only: nothing here is a network record or in any
 * count of the built network.
 */

const BTN = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-50';
const INPUT = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm';

const STATE_STYLE: Record<ScenarioLineState, string> = {
  fits: 'bg-emerald-100 text-emerald-900',
  tight: 'bg-amber-100 text-amber-900',
  short: 'bg-red-100 text-red-900',
  not_known: 'bg-slate-200 text-slate-800',
  broken_ref: 'bg-red-100 text-red-900',
};

const STATE_MARK: Record<ScenarioLineState, string> = { fits: '✓', tight: '!', short: '✕', not_known: '?', broken_ref: '✕' };

type Kind = ScenarioItem['kind'];
type Place = 'splitter' | 'box' | 'pon';
type Feed = 'not_decided' | 'splitter' | 'pon';

interface LineDraft {
  kind: Kind;
  count: string;
  place: Place;
  target: string;
  ratio: SplitterRatio;
  boxId: string;
  feed: Feed;
  feedTarget: string;
  feedOutput: string;
  fiberCount: string;
  ductId: string;
  diameter: string;
  poles: string;
}

const emptyDraft = (): LineDraft => ({ kind: 'customers', count: '', place: 'splitter', target: '', ratio: '1:8', boxId: '', feed: 'not_decided', feedTarget: '', feedOutput: '', fiberCount: '', ductId: '', diameter: '', poles: '' });

const wholeNumber = (text: string): number | undefined => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);

/** The planned line from the form, or the reason it cannot be added yet. */
function lineFrom(d: LineDraft): ScenarioItem | string {
  const id = newScenarioItemId();
  if (d.kind === 'customers') {
    const count = wholeNumber(d.count);
    if (!count || count > 1024) return 'Write how many customers, from 1 to 1024.';
    if (!d.target) return 'Choose where the customers go.';
    if (d.place === 'pon') {
      const [oltId, ponPortId] = d.target.split('#');
      return { id, kind: 'customers', count, oltId, ponPortId };
    }
    return d.place === 'box' ? { id, kind: 'customers', count, boxId: d.target } : { id, kind: 'customers', count, splitterId: d.target };
  }
  if (d.kind === 'splitter') {
    if (!d.boxId) return 'Choose the box the splitter goes in.';
    if (d.feed !== 'not_decided' && !d.feedTarget) return 'Choose what feeds the splitter, or "Not decided yet".';
    const output = d.feedOutput.trim() ? wholeNumber(d.feedOutput) : undefined;
    if (d.feedOutput.trim() && !output) return 'The output number must be a whole number.';
    const feed =
      d.feed === 'not_decided'
        ? ({ kind: 'not_decided' } as const)
        : d.feed === 'pon'
          ? ({ kind: 'pon', oltId: d.feedTarget.split('#')[0], ponPortId: d.feedTarget.split('#')[1] } as const)
          : ({ kind: 'splitter', splitterId: d.feedTarget, ...(output ? { output } : {}) } as const);
    return { id, kind: 'splitter', ratio: d.ratio, boxId: d.boxId, feed };
  }
  const fiberCount = wholeNumber(d.fiberCount);
  if (!fiberCount || fiberCount > 1728) return 'Write how many fibres the cable has.';
  const diameter = d.diameter.trim() ? Number(d.diameter.trim()) : undefined;
  if (diameter !== undefined && !(diameter > 0 && diameter <= 100)) return 'The outside diameter must be a number of millimetres, or empty.';
  const poleIds = d.poles
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!d.ductId && poleIds.length === 0) return 'Choose a duct, or write the poles it would hang on.';
  return { id, kind: 'cable', fiberCount, ...(d.ductId ? { ductId: d.ductId } : {}), ...(diameter ? { outerDiameterMm: diameter } : {}), ...(poleIds.length ? { poleIds } : {}) };
}

export function ScenarioPanel({ data, optical, osp }: { data: CapacityData; optical: OpticalSettings; osp: OspSettings }) {
  const mayPlan = useMayPlan();
  const scenarios = data.planningScenarios ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState<LineDraft>(emptyDraft);
  const [problem, setProblem] = useState<string | null>(null);
  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];
  const result = useMemo(() => (selected ? evaluateScenario(data, selected, { optical, osp }) : null), [data, selected, optical, osp]);

  const boxes = useMemo(() => {
    const withSplitter = new Set(data.splitters.map((s) => s.terminalBoxId));
    return data.equipment.filter((e) => withSplitter.has(e.id) || /FAT|FDT|FDMS|Terminal|Splitter/i.test(e.type)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.equipment, data.splitters]);
  const ponPorts = useMemo(
    () => data.equipment.flatMap((olt) => (olt.ponPorts ?? []).map((p) => ({ key: `${olt.id}#${p.id}`, label: `${olt.name} port ${p.portNumber}${p.vendorAddress ? ` (${p.vendorAddress})` : ''}` }))),
    [data.equipment],
  );
  const planned = (selected?.items ?? []).filter((i): i is Extract<ScenarioItem, { kind: 'splitter' }> => i.kind === 'splitter');
  const splitterOptions = [
    ...data.splitters.map((s) => ({ id: s.id, label: `${s.name} (${s.ratio}) in ${data.equipment.find((e) => e.id === s.terminalBoxId)?.name ?? s.terminalBoxId}` })),
    ...planned.map((p) => ({ id: p.id, label: `Planned ${p.ratio} in ${data.equipment.find((e) => e.id === p.boxId)?.name ?? p.boxId} (this scenario)` })),
  ];
  const poleNames = useMemo(() => data.equipment.filter((e) => isPoleType(e.type)).map((e) => e.id), [data.equipment]);

  const create = () => {
    const made = addScenario({ name: newName });
    if (made) {
      setNewName('');
      setSelectedId(made.id);
    }
  };
  const save = (next: PlanningScenario) => updateScenario(next);
  const addLine = () => {
    if (!selected) return;
    const line = lineFrom(draft);
    if (typeof line === 'string') {
      setProblem(line);
      return;
    }
    if (save({ ...selected, items: [...selected.items, line] })) {
      setProblem(null);
      setDraft({ ...emptyDraft(), kind: draft.kind });
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/40 p-3" data-testid="capacity-scenarios" aria-labelledby="scenario-title">
      <div>
        <h3 id="scenario-title" className="text-sm font-bold text-slate-900">
          Expansion scenarios: what if we build more?
        </h3>
        <p className="text-xs text-slate-700">
          A plan only. Nothing here is on the network, on the map or in any count above. Each line is worked out on top of the records as they are today.
        </p>
      </div>

      {mayPlan && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
            New scenario name
            <input className={INPUT} value={newName} placeholder="Such as Ward 12 next 100 homes" onChange={(e) => setNewName(e.target.value)} data-testid="scenario-new-name" />
          </label>
          <button type="button" className={`${BTN} bg-violet-700 text-white`} disabled={!newName.trim()} onClick={create} data-testid="scenario-create">
            <Plus className="h-4 w-4" /> Start scenario
          </button>
        </div>
      )}
      {!mayPlan && <p className="text-xs text-slate-600">Your account can look at scenarios. Planners and engineers write them.</p>}

      {scenarios.length === 0 ? (
        <p className="text-xs text-slate-600">No scenarios yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2" role="list">
          {scenarios.map((s) => (
            <button
              key={s.id}
              role="listitem"
              type="button"
              aria-pressed={selected?.id === s.id}
              onClick={() => setSelectedId(s.id)}
              className={`${BTN} border ${selected?.id === s.id ? 'border-violet-600 bg-white text-violet-900 ring-2 ring-violet-500/20' : 'border-slate-300 bg-white text-slate-700'}`}
              data-testid={`scenario-${s.id}`}
            >
              {s.name}
              <span className="text-[11px] font-normal text-slate-500">({s.items.length})</span>
            </button>
          ))}
        </div>
      )}

      {selected && result && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 break-words">{selected.name}</div>
              <div className="text-[11px] text-slate-500">
                {SCENARIO_STATUS_LABELS[selected.status]} · made {selected.createdAt.slice(0, 10)}
                {selected.createdBy ? ` by ${selected.createdBy}` : ''}
              </div>
            </div>
            {mayPlan && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`${BTN} border border-slate-300 bg-white text-slate-700`} onClick={() => save({ ...selected, status: selected.status === 'open' ? 'closed' : 'open' })} data-testid="scenario-toggle">
                  {selected.status === 'open' ? 'Close' : 'Reopen'}
                </button>
                <button type="button" className={`${BTN} border border-red-200 bg-white text-red-700`} onClick={() => void removeScenario(selected.id)} data-testid="scenario-delete">
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            )}
          </div>

          {selected.items.length === 0 ? (
            <p className="text-xs text-slate-600">No planned lines yet. Add one below.</p>
          ) : (
            <ol className="space-y-2" data-testid="scenario-results">
              {selected.items.map((item, i) => {
                const lines = result.lines.filter((l) => l.itemId === item.id);
                return (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900 break-words">
                        {i + 1}. {describeScenarioItem(item, data)}
                      </div>
                      {mayPlan && (
                        <button
                          type="button"
                          aria-label={`Remove line ${i + 1}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                          onClick={() => save({ ...selected, items: selected.items.filter((x) => x.id !== item.id) })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {lines.map((l, j) => (
                        <li key={j} className="text-xs text-slate-700">
                          <span className={`mr-1 inline-block rounded px-1.5 py-0.5 font-bold ${STATE_STYLE[l.state]}`} data-testid="scenario-line-state">
                            {STATE_MARK[l.state]} {SCENARIO_LINE_STATE_WORDS[l.state]}
                          </span>
                          <span className="font-semibold">{l.element}:</span> now {l.now} → if built {l.ifBuilt}
                          {l.notes.map((n) => (
                            <span key={n} className="block text-[11px] text-slate-600">
                              {n}
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}

          {mayPlan && selected.status === 'open' && (
            <fieldset className="space-y-2 rounded-lg border border-dashed border-slate-300 p-2" aria-label="Add a planned line">
              <legend className="px-1 text-xs font-bold text-slate-700">Add a planned line</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(['customers', 'splitter', 'cable'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={draft.kind === k}
                    onClick={() => setDraft({ ...emptyDraft(), kind: k })}
                    className={`${BTN} border ${draft.kind === k ? 'border-violet-600 bg-violet-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                    data-testid={`scenario-kind-${k}`}
                  >
                    {k === 'customers' ? 'More customers' : k === 'splitter' ? 'New splitter' : 'New cable'}
                  </button>
                ))}
              </div>

              {draft.kind === 'customers' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    How many customers
                    <input className={INPUT} inputMode="numeric" value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} data-testid="scenario-count" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    On
                    <select className={INPUT} value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value as Place, target: '' })} data-testid="scenario-place">
                      <option value="splitter">A splitter</option>
                      <option value="box">A box (any free output in it)</option>
                      <option value="pon">A PON port</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Which
                    <select className={INPUT} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} data-testid="scenario-target">
                      <option value="">Choose…</option>
                      {draft.place === 'splitter' && splitterOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      {draft.place === 'box' && boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      {draft.place === 'pon' && ponPorts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {draft.kind === 'splitter' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Ratio
                    <select className={INPUT} value={draft.ratio} onChange={(e) => setDraft({ ...draft, ratio: e.target.value as SplitterRatio })} data-testid="scenario-ratio">
                      {SPLITTER_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    In box
                    <select className={INPUT} value={draft.boxId} onChange={(e) => setDraft({ ...draft, boxId: e.target.value })} data-testid="scenario-box">
                      <option value="">Choose…</option>
                      {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Fed from
                    <select className={INPUT} value={draft.feed} onChange={(e) => setDraft({ ...draft, feed: e.target.value as Feed, feedTarget: '' })} data-testid="scenario-feed">
                      <option value="not_decided">Not decided yet</option>
                      <option value="splitter">An output of a splitter</option>
                      <option value="pon">A PON port</option>
                    </select>
                  </label>
                  {draft.feed !== 'not_decided' && (
                    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                      Which
                      <select className={INPUT} value={draft.feedTarget} onChange={(e) => setDraft({ ...draft, feedTarget: e.target.value })} data-testid="scenario-feed-target">
                        <option value="">Choose…</option>
                        {draft.feed === 'splitter' ? splitterOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>) : ponPorts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </label>
                  )}
                  {draft.feed === 'splitter' && (
                    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                      Output number (empty: any free one)
                      <input className={INPUT} inputMode="numeric" value={draft.feedOutput} onChange={(e) => setDraft({ ...draft, feedOutput: e.target.value })} />
                    </label>
                  )}
                </div>
              )}

              {draft.kind === 'cable' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Fibres in the cable
                    <input className={INPUT} inputMode="numeric" value={draft.fiberCount} onChange={(e) => setDraft({ ...draft, fiberCount: e.target.value })} data-testid="scenario-fibers" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Through duct
                    <select className={INPUT} value={draft.ductId} onChange={(e) => setDraft({ ...draft, ductId: e.target.value })} data-testid="scenario-duct">
                      <option value="">No duct</option>
                      {(data.ducts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    Outside diameter, mm (from the maker&apos;s sheet; empty if not known)
                    <input className={INPUT} inputMode="decimal" value={draft.diameter} onChange={(e) => setDraft({ ...draft, diameter: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                    On poles (ids, with commas)
                    <input className={INPUT} list="scenario-pole-ids" value={draft.poles} onChange={(e) => setDraft({ ...draft, poles: e.target.value })} />
                    <datalist id="scenario-pole-ids">
                      {poleNames.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </label>
                </div>
              )}
              {problem && <p className="text-xs font-semibold text-red-700">{problem}</p>}
              <button type="button" className={`${BTN} bg-violet-700 text-white`} onClick={addLine} data-testid="scenario-add-line">
                <Plus className="h-4 w-4" /> Add line
              </button>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
