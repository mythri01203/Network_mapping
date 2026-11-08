import { useMemo, useState } from 'react';
import { Repeat, Ruler, Search, Trash2, UtilityPole, Waypoints } from 'lucide-react';

import {
  type AttachmentStatus,
  type Cable,
  cableLengths,
  ductsForCable,
  type Equipment,
  hasPlacedPosition,
  LENGTH_MARK_UNITS,
  type LengthMarkUnit,
  LINK_BASIS_LABELS,
  pointToLine,
  polesSupportingCable,
  STRUCTURE_STATUS_LABELS,
  suggestPolesForCable,
} from '@fibergis/shared';

import { Button, Field, Input, KeyValueList, Select } from '../../../components/ui';
import { updateCable } from '../../../stores/networkActions';
import { selectOspSettings, useNetworkStore } from '../../../stores/networkStore';
import { addAttachments, addSlackLoop, deleteSlackLoop, removeAttachment } from '../../../stores/ospActions';
import { useUiStore } from '../../../stores/uiStore';
import { NOT_RECORDED } from '../format';
import { InspectorSection, RecordLink } from '../sections';
import { formatMeters, parseOptionalNumber, useOspData } from './ospData';
import { StatusChoice } from './StructureSections';

/* ------------------------------------------------------------------ */
/* Poles supporting this route                                         */
/* ------------------------------------------------------------------ */

export function PolesSupportingSection({ cable }: { cable: Cable }) {
  const data = useOspData();
  const settings = useNetworkStore(selectOspSettings);
  const select = useUiStore((s) => s.select);
  const poles = useMemo(() => polesSupportingCable(data, cable.id), [data, cable.id]);
  const [suggesting, setSuggesting] = useState(false);
  const suggestions = useMemo(() => (suggesting ? suggestPolesForCable(data, cable.id, settings) : []), [suggesting, data, cable.id, settings]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<AttachmentStatus>();

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    if (!status || ticked.size === 0) return;
    const saved = addAttachments([...ticked].map((structureId) => ({ cableId: cable.id, structureId, status, basis: 'route_proposal_confirmed' as const })));
    if (saved > 0) {
      setTicked(new Set());
      setStatus(undefined);
      setSuggesting(false);
    }
  };

  return (
    <InspectorSection title="Poles supporting this route" icon={UtilityPole} aside={poles.length || undefined}>
      <div className="space-y-2" data-testid="poles-supporting">
        {poles.length === 0 ? (
          <p className="text-[12px] text-slate-600" data-testid="poles-supporting-empty">
            No poles are recorded as carrying this cable. Poles near the line on the map are not counted until a person confirms them.
          </p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {poles.map((item, i) => (
              <li key={item.structure.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <RecordLink name={item.structure.name} id={item.structure.id} onSelect={() => select({ type: 'equipment', data: item.structure })} />
                  <span className="block text-[11px] text-slate-500">
                    {item.via === 'pole' ? 'Recorded on the pole' : `End of span ${item.span?.name ?? ''}`} · {STRUCTURE_STATUS_LABELS[item.attachment.status]}
                  </span>
                </span>
                {item.via === 'pole' && (
                  <button
                    type="button"
                    aria-label={`Remove ${item.structure.name} from this cable`}
                    onClick={() => removeAttachment(item.attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}

        {!suggesting ? (
          <Button size="sm" icon={Search} onClick={() => setSuggesting(true)} disabled={cable.coordinates.length < 2} data-testid="suggest-poles">
            Find poles near this line
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2" data-testid="pole-suggestions">
            <p className="text-[12px] text-amber-900">
              Poles within {settings.attachmentCorridorMeters} m of the drawn line. Being near the line does not mean the cable is on the pole:
              tick only the ones you know carry it.
            </p>
            {suggestions.length === 0 ? (
              <p className="text-[12px] text-slate-700" data-testid="pole-suggestions-empty">
                No unrecorded poles are that close to the line.
              </p>
            ) : (
              <ul className="space-y-1">
                {suggestions.map((s) => (
                  <li key={s.pole.id}>
                    <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md bg-white px-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={ticked.has(s.pole.id)}
                        onChange={() => toggle(s.pole.id)}
                        className="h-5 w-5"
                        data-testid={`suggest-tick-${s.pole.id}`}
                      />
                      <span className="flex-1">{s.pole.name}</span>
                      <span className="text-[11px] text-slate-500">{Math.round(s.distanceMeters)} m from line</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {suggestions.length > 0 && <StatusChoice value={status} onChange={setStatus} testId="suggest-status" />}
            <div className="flex gap-2">
              {suggestions.length > 0 && (
                <Button variant="primary" size="sm" disabled={ticked.size === 0 || !status} onClick={save} data-testid="suggest-save">
                  Save {ticked.size || ''} ticked
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  setSuggesting(false);
                  setTicked(new Set());
                }}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Lengths: drawn, sheath and optical, kept apart                      */
/* ------------------------------------------------------------------ */

export function LengthsSection({ cable }: { cable: Cable }) {
  const settings = useNetworkStore(selectOspSettings);
  const slackLoops = useNetworkStore((s) => s.slackLoops);
  const lengths = useMemo(() => cableLengths(cable, slackLoops, settings), [cable, slackLoops, settings]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    markStart: cable.sheathMarkStart?.toString() ?? '',
    markEnd: cable.sheathMarkEnd?.toString() ?? '',
    unit: (cable.sheathMarkUnit ?? 'm') as LengthMarkUnit,
    optical: cable.opticalLengthMeters?.toString() ?? '',
    opticalDate: cable.opticalMeasuredAt?.slice(0, 10) ?? '',
    opticalNote: cable.opticalLengthNote ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const start = parseOptionalNumber(draft.markStart);
    const end = parseOptionalNumber(draft.markEnd);
    const optical = parseOptionalNumber(draft.optical);
    if ((start === undefined) !== (end === undefined)) return setError('Enter both cable marks, or neither.');
    if ([start, end].some((v) => v !== undefined && !(Number.isFinite(v) && v >= 0))) return setError('Cable marks must be numbers.');
    if (optical !== undefined && !(Number.isFinite(optical) && optical > 0)) return setError('Optical length must be a number above 0.');
    const next: Cable = { ...cable };
    const set = <K extends keyof Cable>(key: K, value: Cable[K] | undefined) => {
      if (value === undefined) delete next[key];
      else next[key] = value;
    };
    const marksChanged = start !== cable.sheathMarkStart || end !== cable.sheathMarkEnd || (start !== undefined && draft.unit !== cable.sheathMarkUnit);
    set('sheathMarkStart', start);
    set('sheathMarkEnd', end);
    set('sheathMarkUnit', start !== undefined ? draft.unit : undefined);
    set('sheathRecordedAt', start === undefined ? undefined : marksChanged ? new Date().toISOString() : cable.sheathRecordedAt);
    set('opticalLengthMeters', optical);
    set('opticalMeasuredAt', optical !== undefined && draft.opticalDate ? draft.opticalDate : undefined);
    set('opticalLengthNote', optical !== undefined && draft.opticalNote.trim() ? draft.opticalNote.trim() : undefined);
    updateCable(next);
    setError(null);
    setEditing(false);
  };

  return (
    <InspectorSection title="Lengths" icon={Ruler}>
      <div className="space-y-2" data-testid="cable-lengths">
        <KeyValueList
          items={[
            { label: 'Drawn on the map', value: lengths.drawnMeters !== undefined ? `${formatMeters(lengths.drawnMeters)} (worked out from the line)` : NOT_RECORDED },
            {
              label: 'Sheath (cable marks)',
              value:
                lengths.sheathMeters !== undefined
                  ? `${formatMeters(lengths.sheathMeters)} (marks ${cable.sheathMarkStart} to ${cable.sheathMarkEnd} ${cable.sheathMarkUnit ?? 'm'})`
                  : NOT_RECORDED,
            },
            {
              label: 'Optical (OTDR)',
              value:
                lengths.opticalMeters !== undefined
                  ? `${formatMeters(lengths.opticalMeters)}${cable.opticalMeasuredAt ? `, ${cable.opticalMeasuredAt.slice(0, 10)}` : ''}${cable.opticalLengthNote ? `, ${cable.opticalLengthNote}` : ''}`
                  : NOT_RECORDED,
            },
            { label: 'Slack recorded', value: lengths.slackCount ? `${formatMeters(lengths.slackMeters)} in ${lengths.slackCount} loop(s)` : 'None recorded' },
          ]}
        />
        {lengths.flags.length > 0 && (
          <ul className="space-y-1" data-testid="length-flags">
            {lengths.flags.map((flag) => (
              <li key={flag.code} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">
                {flag.message}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">The three lengths measure different things and are never copied into each other.</p>
        {!editing ? (
          <Button size="sm" icon={Ruler} onClick={() => setEditing(true)} data-testid="lengths-edit">
            Enter measured lengths
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Mark at start">
                <Input inputMode="decimal" value={draft.markStart} onChange={(e) => setDraft({ ...draft, markStart: e.target.value })} data-testid="sheath-start" />
              </Field>
              <Field label="Mark at end">
                <Input inputMode="decimal" value={draft.markEnd} onChange={(e) => setDraft({ ...draft, markEnd: e.target.value })} data-testid="sheath-end" />
              </Field>
            </div>
            <Field label="Marks are in">
              <Select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as LengthMarkUnit })} data-testid="sheath-unit">
                {LENGTH_MARK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u === 'm' ? 'Metres' : 'Feet'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Optical length from OTDR (m)">
              <Input inputMode="decimal" value={draft.optical} onChange={(e) => setDraft({ ...draft, optical: e.target.value })} data-testid="optical-length" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Measured on">
                <Input type="date" value={draft.opticalDate} onChange={(e) => setDraft({ ...draft, opticalDate: e.target.value })} />
              </Field>
              <Field label="Note" hint="e.g. core 1, OLT end">
                <Input value={draft.opticalNote} onChange={(e) => setDraft({ ...draft, opticalNote: e.target.value })} />
              </Field>
            </div>
            {error && <p className="text-[12px] font-semibold text-red-700">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={save} data-testid="lengths-save">
                Save lengths
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Slack loops                                                         */
/* ------------------------------------------------------------------ */

export function SlackLoopsSection({ cable }: { cable: Cable }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const loops = useMemo(() => (data.slackLoops ?? []).filter((l) => l.cableId === cable.id), [data.slackLoops, cable.id]);
  const [adding, setAdding] = useState(false);
  const [hostId, setHostId] = useState('');
  const [mode, setMode] = useState<'length' | 'marks'>('length');
  const [length, setLength] = useState('');
  const [marks, setMarks] = useState({ before: '', after: '', unit: 'm' as LengthMarkUnit });

  // Places to hang the loop: the poles recorded on the cable, its two ends, then structures near the line.
  const hosts = useMemo(() => {
    const seen = new Set<string>();
    const list: { item: Equipment; note: string }[] = [];
    const push = (item: Equipment | undefined, note: string) => {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      list.push({ item, note });
    };
    for (const p of polesSupportingCable(data, cable.id)) push(p.structure, 'carries this cable');
    push(data.equipment.find((e) => e.id === cable.startEquipmentId), 'cable start');
    push(data.equipment.find((e) => e.id === cable.endEquipmentId), 'cable end');
    if (cable.coordinates.length >= 2) {
      data.equipment
        .filter((e) => e.category === 'Supporting Infrastructure' && hasPlacedPosition(e))
        .map((e) => ({ e, gap: pointToLine([e.lat, e.lng], cable.coordinates)?.distanceMeters ?? Infinity }))
        .filter((x) => x.gap <= 50)
        .sort((a, b) => a.gap - b.gap)
        .forEach((x) => push(x.e, `${Math.round(x.gap)} m from line`));
    }
    return list;
  }, [data, cable]);

  const save = () => {
    const created = addSlackLoop({
      cableId: cable.id,
      structureId: hostId,
      ...(mode === 'length'
        ? { lengthMeters: Number(length) }
        : { marks: { before: Number(marks.before), after: Number(marks.after), unit: marks.unit } }),
    });
    if (created) {
      setAdding(false);
      setLength('');
      setMarks({ before: '', after: '', unit: 'm' });
    }
  };

  const ready = hostId && (mode === 'length' ? length.trim() !== '' : marks.before.trim() !== '' && marks.after.trim() !== '');

  return (
    <InspectorSection title="Slack loops" icon={Repeat} aside={loops.length || undefined}>
      <div className="space-y-2" data-testid="slack-loops">
        {loops.length === 0 ? (
          <p className="text-[12px] text-slate-600">No slack loops recorded on this cable.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {loops.map((loop) => (
              <li key={loop.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <RecordLink name={loop.name} id={loop.id} onSelect={() => select({ type: 'slackLoop', data: loop })} />
                  <span className="block text-[11px] text-slate-500">{loop.lengthSource === 'marks' ? 'From the cable marks' : 'Length as entered'}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${loop.name}`}
                  onClick={() => void deleteSlackLoop(loop.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!adding ? (
          <Button size="sm" icon={Repeat} onClick={() => setAdding(true)} data-testid="slack-add">
            Add slack loop
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <Field label="Where is it?">
              <Select value={hostId} onChange={(e) => setHostId(e.target.value)} data-testid="slack-host">
                <option value="">Choose the pole, chamber or box</option>
                {hosts.map(({ item, note }) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({note})
                  </option>
                ))}
              </Select>
            </Field>
            {hosts.length === 0 && <p className="text-[12px] text-amber-800">No pole or chamber is recorded near this cable yet. Record one first.</p>}
            <div className="flex gap-1">
              {(['length', 'marks'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`h-8 flex-1 rounded-md border text-[12px] font-medium ${mode === m ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  {m === 'length' ? 'I know the length' : 'From cable marks'}
                </button>
              ))}
            </div>
            {mode === 'length' ? (
              <Field label="Loop length (m)">
                <Input inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} data-testid="slack-length" />
              </Field>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Mark before">
                  <Input inputMode="decimal" value={marks.before} onChange={(e) => setMarks({ ...marks, before: e.target.value })} />
                </Field>
                <Field label="Mark after">
                  <Input inputMode="decimal" value={marks.after} onChange={(e) => setMarks({ ...marks, after: e.target.value })} />
                </Field>
                <Field label="Unit">
                  <Select value={marks.unit} onChange={(e) => setMarks({ ...marks, unit: e.target.value as LengthMarkUnit })}>
                    <option value="m">m</option>
                    <option value="ft">ft</option>
                  </Select>
                </Field>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={!ready} onClick={save} data-testid="slack-save">
                Save loop
              </Button>
              <Button size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Ducts this cable runs in                                            */
/* ------------------------------------------------------------------ */

export function CableDuctsSection({ cable }: { cable: Cable }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const ducts = useMemo(() => ductsForCable(data, cable.id), [data, cable.id]);
  if (ducts.length === 0) return null;
  return (
    <InspectorSection title="Ducts" icon={Waypoints} aside={ducts.length}>
      <ul className="divide-y divide-slate-100">
        {ducts.map(({ duct, subduct }) => (
          <li key={duct.id} className="py-1.5 text-[13px]">
            <RecordLink name={duct.name} id={duct.id} onSelect={() => select({ type: 'duct', data: duct })} />
            <span className="block text-[11px] text-slate-500">
              {subduct ? `In sub-duct ${subduct.label}` : 'In the duct'} · {STRUCTURE_STATUS_LABELS[duct.status]} · {LINK_BASIS_LABELS[duct.basis]}
            </span>
          </li>
        ))}
      </ul>
    </InspectorSection>
  );
}
