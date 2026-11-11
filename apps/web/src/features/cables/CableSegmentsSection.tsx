import { useEffect, useMemo, useState } from 'react';
import { MapPin, MousePointerClick, Pencil, Plus, Rows3, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type Cable,
  CABLE_INSTALLATION_TYPES,
  type CableInstallationType,
  type CableSegment,
  cableSegmentIssues,
  describeSegmentEnd,
  drawnMetersOf,
  type Duct,
  pointToLine,
  type SegmentEndDraft,
  segmentsForCable,
  STRUCTURE_STATUS_LABELS,
  STRUCTURE_STATUSES,
  type StructureStatus,
} from '@fibergis/shared';

import { Button, Field, Input, Select } from '../../components/ui';
import { selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { deleteCableSegment, saveCableSegment } from '../../stores/segmentActions';
import { useUiStore } from '../../stores/uiStore';
import { NOT_RECORDED } from '../inspector/format';
import { InspectorSection } from '../inspector/sections';
import { INSTALL_LABELS } from './cableLabels';
import { useSegmentPickStore } from './segmentPickStore';

/**
 * Network mapping Phase 6: the stretches of one cable (aerial on poles for one part, in a duct for
 * the next...). The cable stays one record; each stretch only describes part of it. A stretch is
 * added by choosing two poles or boxes on the line, or by tapping two points on the map. Blank is
 * "Not recorded", never filled in.
 */

const tap = 'min-h-[48px] md:min-h-0';
const m = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`);

function useSegmentData() {
  return useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      ducts: s.ducts,
      spans: s.spans,
      attachments: s.attachments,
      cableSegments: s.cableSegments,
    })),
  );
}

const segmentById = (id: string | undefined) => (id ? useNetworkStore.getState().cableSegments.find((s) => s.id === id) : undefined);

/** Where a stretch runs, in plain words. */
function runsIn(segment: CableSegment, ducts: readonly Duct[], spanName: (id: string) => string): string {
  if (segment.ductId) {
    const duct = ducts.find((d) => d.id === segment.ductId);
    const way = duct?.subducts.flatMap((w) => [{ id: w.id, label: `way ${w.label}` }, ...(w.microducts ?? []).map((x) => ({ id: x.id, label: `microduct ${x.label}` }))]).find((w) => w.id === segment.ductWayId);
    return `In duct ${duct?.name ?? segment.ductId}${way ? `, ${way.label}` : ''}`;
  }
  if (segment.spanIds?.length) return `On ${segment.spanIds.length === 1 ? 'span' : 'spans'} ${segment.spanIds.map(spanName).join(', ')}`;
  return 'Duct or poles not recorded';
}

export function CableSegmentsSection({ cable }: { cable: Cable }) {
  const data = useSegmentData();
  const settings = useNetworkStore(selectOspSettings);
  const network = useMemo(() => ({ ...data, splitters: [], closures: [], customers: [], faults: [], workOrders: [], zones: [], documents: [] }), [data]);
  const rows = useMemo(() => segmentsForCable(network, cable.id, settings), [network, cable.id, settings]);
  const issues = useMemo(() => cableSegmentIssues(network, cable.id, settings), [network, cable.id, settings]);
  const byId = useMemo(() => new Map(data.equipment.map((e) => [e.id, e])), [data.equipment]);
  const spanName = (id: string) => data.spans.find((s) => s.id === id)?.name ?? id;
  const drawn = drawnMetersOf(cable);
  // A finished "tap two points" comes back here: on a phone the panel opens again with it.
  const [editing, setEditing] = useState<{ segment?: CableSegment; picked?: [number, number] } | null>(() => {
    const result = useSegmentPickStore.getState().result;
    return result?.cableId === cable.id ? { segment: segmentById(result.segmentId), picked: result.meters } : null;
  });
  useEffect(() => {
    // Consume a result handed over when the panel opened; later ones (desktop) arrive by subscription.
    useSegmentPickStore.getState().take(cable.id);
    return useSegmentPickStore.subscribe((state) => {
      if (state.result?.cableId !== cable.id) return;
      const result = useSegmentPickStore.getState().take(cable.id);
      if (result) setEditing({ segment: segmentById(result.segmentId), picked: result.meters });
    });
  }, [cable.id]);
  // A stretch shown on the map goes away when this cable's panel closes.
  useEffect(() => () => useSegmentPickStore.getState().showStretch(null), [cable.id]);

  const covered =rows.reduce((sum, r) => sum + (r.range ? r.range.to - r.range.from : 0), 0);
  const methods = [...new Set(rows.map((r) => r.segment.installMethod).filter((x): x is CableInstallationType => !!x))];
  const cableIssues = issues.filter((i) => !i.segmentId);

  return (
    <InspectorSection title="Stretches (how each part runs)" icon={Rows3} aside={rows.length || undefined} defaultOpen={rows.length > 0 || editing !== null}>
      <div className="space-y-2" data-testid="cable-segments">
        <p className="text-[12px] text-slate-600">
          One cable can be on poles for one stretch and in a duct for the next. It stays one cable; each stretch only says how that part runs.
        </p>
        {drawn === undefined && <p className="text-[12px] font-semibold text-amber-800">This cable has no line drawn yet. Draw its route first, then mark its stretches.</p>}
        {rows.length === 0 ? (
          <p className="text-[12px] text-slate-600" data-testid="cable-segments-empty">
            No stretches recorded. The whole cable uses its own install method: {cable.installationType ? INSTALL_LABELS[cable.installationType] : NOT_RECORDED}.
          </p>
        ) : (
          <>
            <ol className="space-y-2" data-testid="cable-segments-list">
              {rows.map(({ segment, range, problem }) => {
                const own = issues.filter((i) => i.segmentId === segment.id || i.otherSegmentId === segment.id);
                return (
                  <li key={segment.id} className="rounded-lg border border-slate-200 p-2 text-[13px]" data-testid={`cable-segment-${segment.id}`}>
                    <div className="font-semibold text-slate-900">
                      {describeSegmentEnd(segment, 'from', byId)} to {describeSegmentEnd(segment, 'to', byId)}
                    </div>
                    <div className="text-[12px] text-slate-700">
                      {segment.installMethod ? INSTALL_LABELS[segment.installMethod] : 'Install method not recorded'} · {runsIn(segment, data.ducts, spanName)}
                    </div>
                    <div className="text-[12px] text-slate-600">
                      {range ? `About ${m(range.to - range.from)} on the drawn line` : 'Not placed on the line'} ·{' '}
                      {segment.measuredLengthMeters !== undefined ? `Measured ${segment.measuredLengthMeters} m${segment.lengthNote ? ` (${segment.lengthNote})` : ''}` : 'Length not measured'} ·{' '}
                      {segment.status ? STRUCTURE_STATUS_LABELS[segment.status] : 'Status not recorded'}
                    </div>
                    {problem && <p className="mt-1 text-[12px] font-semibold text-red-700">{problem}</p>}
                    {own.map((i) => (
                      <p key={`${i.code}:${i.message}`} className={`mt-1 text-[12px] ${i.severity === 'error' ? 'font-semibold text-red-700' : 'text-amber-800'}`}>
                        {i.severity === 'error' ? 'Problem: ' : 'Please check: '}
                        {i.message}
                      </p>
                    ))}
                    {segment.notes && <p className="mt-1 text-[12px] text-slate-600">{segment.notes}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {range && (
                        <Button size="md" icon={MapPin} className={tap} onClick={() => useSegmentPickStore.getState().showStretch({ cableId: cable.id, from: range.from, to: range.to })} data-testid={`cable-segment-show-${segment.id}`}>
                          Show on map
                        </Button>
                      )}
                      <Button size="md" icon={Pencil} className={tap} onClick={() => setEditing({ segment })} data-testid={`cable-segment-edit-${segment.id}`}>
                        Change
                      </Button>
                      <Button size="md" variant="danger" icon={Trash2} className={tap} onClick={() => void deleteCableSegment(segment.id)} data-testid={`cable-segment-delete-${segment.id}`}>
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {drawn !== undefined && (
              <p className="text-[12px] text-slate-600" data-testid="cable-segments-coverage">
                Stretches cover about {m(covered)} of the {m(drawn)} drawn line{covered < drawn - 1 ? '. The rest is not recorded.' : '.'}
              </p>
            )}
            {methods.length > 1 && (
              <p className="text-[12px] text-slate-700" data-testid="cable-segments-mixed">
                Mixed: {methods.map((x) => INSTALL_LABELS[x]).join(' and ')}. On the map the whole line is drawn once, and it is listed in each install layer these stretches name.
              </p>
            )}
          </>
        )}
        {cableIssues.map((i) => (
          <p key={i.code} className="text-[12px] text-amber-800" data-testid="cable-segments-length-warning">
            Please check: {i.message}
          </p>
        ))}
        {editing ? (
          <SegmentForm key={editing.segment?.id ?? 'new'} cable={cable} segment={editing.segment} picked={editing.picked} onDone={() => setEditing(null)} />
        ) : (
          drawn !== undefined && (
            <Button size="md" variant="primary" icon={Plus} className={tap} onClick={() => setEditing({})} data-testid="cable-segment-add">
              Add a stretch
            </Button>
          )
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

type EndChoice = '' | `s:${string}` | `m:${number}`;

const endChoiceOf = (segment: CableSegment | undefined, side: 'from' | 'to'): EndChoice => {
  if (!segment) return '';
  const structure = side === 'from' ? segment.fromStructureId : segment.toStructureId;
  const meters = side === 'from' ? segment.fromMeters : segment.toMeters;
  return structure ? `s:${structure}` : meters !== undefined ? `m:${meters}` : '';
};

const draftEnd = (choice: EndChoice): SegmentEndDraft | undefined =>
  choice.startsWith('s:') ? { structureId: choice.slice(2) } : choice.startsWith('m:') ? { meters: Number(choice.slice(2)) } : undefined;

function SegmentForm({ cable, segment, picked, onDone }: { cable: Cable; segment?: CableSegment; picked?: [number, number]; onDone: () => void }) {
  const data = useSegmentData();
  const settings = useNetworkStore(selectOspSettings);
  const tapped = (i: 0 | 1): EndChoice => (picked ? (`m:${Math.round(picked[i] * 10) / 10}` as EndChoice) : endChoiceOf(segment, i === 0 ? 'from' : 'to'));
  const [from, setFrom] = useState<EndChoice>(tapped(0));
  const [to, setTo] = useState<EndChoice>(tapped(1));
  const [method, setMethod] = useState<CableInstallationType | ''>(segment?.installMethod ?? '');
  const [runs, setRuns] = useState<'' | 'duct' | 'spans'>(segment?.ductId ? 'duct' : segment?.spanIds?.length ? 'spans' : '');
  const [ductId, setDuctId] = useState(segment?.ductId ?? '');
  const [wayId, setWayId] = useState(segment?.ductWayId ?? '');
  const [spanIds, setSpanIds] = useState<string[]>(segment?.spanIds ?? []);
  const [measured, setMeasured] = useState(segment?.measuredLengthMeters?.toString() ?? '');
  const [lengthNote, setLengthNote] = useState(segment?.lengthNote ?? '');
  const [status, setStatus] = useState<StructureStatus | ''>(segment?.status ?? '');
  const [notes, setNotes] = useState(segment?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  // Taps that arrive while the form is open (desktop keeps the panel open) fill both ends.
  const [seenPicked, setSeenPicked] = useState(picked);
  if (picked !== seenPicked) {
    setSeenPicked(picked);
    if (picked) {
      setFrom(`m:${Math.round(picked[0] * 10) / 10}` as EndChoice);
      setTo(`m:${Math.round(picked[1] * 10) / 10}` as EndChoice);
    }
  }

  // Poles, chambers and boxes on the drawn line, in order along it. Only placed ones can be placed on it.
  const onLine = useMemo(
    () =>
      data.equipment
        .flatMap((e) => {
          if (e.officeMustPlace || e.locationMethod === 'not_placed' || (e.lat === 0 && e.lng === 0)) return [];
          const near = pointToLine([e.lat, e.lng], cable.coordinates);
          return near && near.distanceMeters <= settings.attachmentCorridorMeters ? [{ e, along: near.alongMeters }] : [];
        })
        .sort((a, b) => a.along - b.along),
    [data.equipment, cable.coordinates, settings.attachmentCorridorMeters],
  );
  // Ducts that list this cable first, then the others that run along its line.
  const ductChoices = useMemo(() => {
    const lists = (d: Duct) => d.cableIds.includes(cable.id) || d.subducts.some((w) => w.cableIds.includes(cable.id) || (w.microducts ?? []).some((x) => x.cableIds.includes(cable.id)));
    const listed = data.ducts.filter(lists);
    const near = data.ducts.filter((d) => !lists(d) && d.coordinates.some((p) => (pointToLine(p, cable.coordinates)?.distanceMeters ?? Infinity) <= settings.attachmentCorridorMeters));
    const current = data.ducts.filter((d) => d.id === ductId && !listed.includes(d) && !near.includes(d));
    return { listed, others: [...near, ...current] };
  }, [data.ducts, cable.id, cable.coordinates, settings.attachmentCorridorMeters, ductId]);
  const duct = data.ducts.find((d) => d.id === ductId);
  const ways = duct ? duct.subducts.flatMap((w) => [{ id: w.id, label: `Way ${w.label}` }, ...(w.microducts ?? []).map((x) => ({ id: x.id, label: `Way ${w.label}, microduct ${x.label}` }))]) : [];
  // Spans this cable is recorded on first, then spans whose two poles are both on its line.
  const spanChoices = useMemo(() => {
    const onIt = new Set(data.attachments.filter((a) => a.cableId === cable.id && a.spanId).map((a) => a.spanId!));
    const lineIds = new Set(onLine.map((x) => x.e.id));
    return data.spans
      .filter((s) => onIt.has(s.id) || spanIds.includes(s.id) || (lineIds.has(s.fromStructureId) && lineIds.has(s.toStructureId)))
      .map((s) => ({ span: s, recorded: onIt.has(s.id) }));
  }, [data.attachments, data.spans, cable.id, onLine, spanIds]);

  const endOptions = (choice: EndChoice) => (
    <>
      <option value="">Choose</option>
      {choice.startsWith('m:') && <option value={choice}>Tapped point, about {Math.round(Number(choice.slice(2)))} m from the start</option>}
      {onLine.map(({ e, along }) => (
        <option key={e.id} value={`s:${e.id}`}>
          {e.name} ({e.type}), about {Math.round(along)} m along
        </option>
      ))}
      {choice.startsWith('s:') && !onLine.some((x) => `s:${x.e.id}` === choice) && <option value={choice}>{choice.slice(2)} (not on the line)</option>}
    </>
  );

  const pickOnMap = () => {
    useSegmentPickStore.getState().start({ cableId: cable.id, segmentId: segment?.id });
    useSegmentPickStore.getState().showStretch(null);
    if (window.innerWidth < 768) useUiStore.getState().setPanelOpen('right', false);
  };

  const save = async () => {
    setError(null);
    const a = draftEnd(from);
    const b = draftEnd(to);
    if (!a || !b) {
      setError('Choose where the stretch starts and ends: two poles or boxes, or tap two points on the map.');
      return;
    }
    const length = measured.trim() === '' ? undefined : Number(measured);
    if (length !== undefined && !(Number.isFinite(length) && length > 0)) {
      setError('The measured length is a number of metres above 0, or empty if nobody measured it.');
      return;
    }
    const saved = await saveCableSegment({
      id: segment?.id,
      cableId: cable.id,
      from: a,
      to: b,
      installMethod: method || undefined,
      ductId: runs === 'duct' ? ductId || undefined : undefined,
      ductWayId: runs === 'duct' && ductId ? wayId || undefined : undefined,
      spanIds: runs === 'spans' ? spanIds : undefined,
      measuredLengthMeters: length,
      lengthNote,
      status: status || undefined,
      notes,
    });
    if (saved) onDone();
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="cable-segment-form">
      <p className="text-[13px] font-semibold text-slate-900">{segment ? 'Change this stretch' : 'New stretch'}</p>
      <Button size="md" icon={MousePointerClick} className={`w-full ${tap}`} onClick={pickOnMap} data-testid="cable-segment-pick">
        Tap two points on the map
      </Button>
      <p className="text-[11px] text-slate-500">Or choose two poles, chambers or boxes on the cable's line:</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Starts at">
          <Select className={tap} value={from} onChange={(e) => setFrom(e.target.value as EndChoice)} data-testid="cable-segment-from">
            {endOptions(from)}
          </Select>
        </Field>
        <Field label="Ends at">
          <Select className={tap} value={to} onChange={(e) => setTo(e.target.value as EndChoice)} data-testid="cable-segment-to">
            {endOptions(to)}
          </Select>
        </Field>
      </div>
      <Field label="How this stretch is installed">
        <Select className={tap} value={method} onChange={(e) => setMethod(e.target.value as CableInstallationType | '')} data-testid="cable-segment-method">
          <option value="">Not recorded</option>
          {CABLE_INSTALLATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {INSTALL_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Runs in">
        <Select className={tap} value={runs} onChange={(e) => setRuns(e.target.value as '' | 'duct' | 'spans')} data-testid="cable-segment-runs">
          <option value="">Not recorded</option>
          <option value="duct">A duct</option>
          <option value="spans">Poles (spans between them)</option>
        </Select>
      </Field>
      {runs === 'duct' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Duct">
            <Select
              className={tap}
              value={ductId}
              onChange={(e) => {
                setDuctId(e.target.value);
                setWayId('');
              }}
              data-testid="cable-segment-duct"
            >
              <option value="">Choose a duct</option>
              {ductChoices.listed.length > 0 && (
                <optgroup label="Ducts that list this cable">
                  {ductChoices.listed.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {ductChoices.others.length > 0 && (
                <optgroup label="Other ducts along this cable">
                  {ductChoices.others.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
          {ways.length > 0 && (
            <Field label="Way">
              <Select className={tap} value={wayId} onChange={(e) => setWayId(e.target.value)} data-testid="cable-segment-way">
                <option value="">Not recorded</option>
                {ways.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {ductChoices.listed.length + ductChoices.others.length === 0 && <p className="text-[12px] text-slate-600">No duct is recorded along this cable.</p>}
        </div>
      )}
      {runs === 'spans' && (
        <div className="space-y-1" data-testid="cable-segment-spans">
          {spanChoices.length === 0 ? (
            <p className="text-[12px] text-slate-600">No span is recorded between poles on this cable's line.</p>
          ) : (
            spanChoices.map(({ span, recorded }) => (
              <label key={span.id} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-2 text-[13px] md:min-h-[36px]">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-600"
                  checked={spanIds.includes(span.id)}
                  onChange={(e) => setSpanIds(e.target.checked ? [...spanIds, span.id] : spanIds.filter((x) => x !== span.id))}
                />
                <span className="min-w-0 flex-1">
                  {span.name}
                  <span className="block text-[11px] text-slate-500">{recorded ? 'This cable is recorded on it' : 'Not yet recorded as carrying this cable'}</span>
                </span>
              </label>
            ))
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Measured length (m)" hint="Tape, wheel or cable marks. Empty if nobody measured it.">
          <Input className={tap} inputMode="decimal" value={measured} onChange={(e) => setMeasured(e.target.value)} data-testid="cable-segment-length" />
        </Field>
        <Field label="How it was measured" hint='Such as "marks 1200 to 1450"'>
          <Input className={tap} value={lengthNote} onChange={(e) => setLengthNote(e.target.value)} disabled={measured.trim() === ''} />
        </Field>
      </div>
      <Field label="How sure">
        <Select className={tap} value={status} onChange={(e) => setStatus(e.target.value as StructureStatus | '')} data-testid="cable-segment-status">
          <option value="">Not recorded</option>
          {STRUCTURE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STRUCTURE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes">
        <Input className={tap} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="text-[12px] font-semibold text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button size="md" variant="primary" className={tap} onClick={() => void save()} data-testid="cable-segment-save">
          Save stretch
        </Button>
        <Button size="md" className={tap} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
