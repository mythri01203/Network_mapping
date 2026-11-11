import { useMemo, useState } from 'react';
import { Cable as CableGlyph, Check, Gauge, Info, Layers, MapPin, Pencil, Plus, Route, Spline, Trash2, Waypoints, X } from 'lucide-react';

import {
  type AttachmentStatus,
  boundsOf,
  type Cable,
  cablesOnSpan,
  type Duct,
  ductCableIds,
  ductCapacity,
  type DuctPlace,
  ductPlaces,
  formatFill,
  LINK_BASIS_LABELS,
  newOspId,
  OSP_CONDITION_LABELS,
  OSP_CONDITIONS,
  type OspCondition,
  placeFill,
  polylineLengthMeters,
  type SlackLoop,
  type Span,
  spanDrawnMeters,
  STRUCTURE_STATUS_LABELS,
  undergroundTrace,
  WAY_CONDITION_LABELS,
  WAY_CONDITIONS,
  type WayCondition,
  withCableIn,
  withoutCable,
  withWayCondition,
} from '@fibergis/shared';

import { Button, Field, Input, KeyValueList, Select } from '../../../components/ui';
import { useMapStore } from '../../../stores/mapStore';
import { updateCable } from '../../../stores/networkActions';
import { selectOspSettings, useNetworkStore } from '../../../stores/networkStore';
import { addAttachments, deleteDuct, deleteSlackLoop, deleteSpan, removeAttachment, saveDuct, saveSpan, setSpanRoute, setSpanStatus } from '../../../stores/ospActions';
import { useOspUiStore } from '../../../stores/ospUiStore';
import { useUiStore } from '../../../stores/uiStore';
import { formatDateTime, NOT_RECORDED, orNotRecorded } from '../format';
import { InspectorLayout, InspectorSection, RecordLink } from '../sections';
import { DuctRouteTools } from '../../cables/CableRouteTools';
import { CorridorSection } from './CorridorSection';
import { InspectionsSection } from './InspectionSection';
import { blankToUndefined, formatMeters, parseOptionalNumber, useOspData } from './ospData';
import { StatusChoice } from './StructureSections';

/** On a phone the inspector covers the map; drawing needs the map. */
const closePanelOnPhone = () => {
  if (window.innerWidth < 768) useUiStore.getState().setPanelOpen('right', false);
};

const WAY_TONE: Record<WayCondition, string> = {
  clear: 'bg-emerald-100 text-emerald-900',
  damaged: 'bg-amber-100 text-amber-900',
  blocked: 'bg-red-100 text-red-900',
};

/* ------------------------------------------------------------------ */
/* Span                                                                */
/* ------------------------------------------------------------------ */

export function SpanInspector({ span }: { span: Span }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const from = data.equipment.find((e) => e.id === span.fromStructureId);
  const to = data.equipment.find((e) => e.id === span.toStructureId);
  const drawn = spanDrawnMeters(span, data.equipment);
  const bends = span.routePoints?.length ?? 0;
  const onSpan = useMemo(() => cablesOnSpan(data, span.id), [data, span.id]);
  const [measured, setMeasured] = useState(span.measuredLengthMeters?.toString() ?? '');
  const [condition, setCondition] = useState<OspCondition | ''>(span.condition ?? '');
  const [cableId, setCableId] = useState('');
  const [status, setStatus] = useState<AttachmentStatus>();

  const saveMeasured = () => {
    const value = parseOptionalNumber(measured);
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) return;
    const next: Span = { ...span };
    if (value === undefined) delete next.measuredLengthMeters;
    else next.measuredLengthMeters = value;
    saveSpan(next);
  };

  const saveCondition = () => {
    const next: Span = { ...span };
    if (condition) {
      next.condition = condition;
      next.conditionAt = new Date().toISOString();
    } else {
      delete next.condition;
      delete next.conditionAt;
    }
    saveSpan(next);
  };

  const drawLine = () => {
    useOspUiStore.getState().startDraw({ kind: 'spanRoute', spanId: span.id });
    closePanelOnPhone();
  };

  const recorded = new Set(onSpan.map((c) => c.cable.id));
  const cableChoices = data.cables.filter((c) => !recorded.has(c.id));

  return (
    <InspectorLayout
      actions={
        <>
          {from && (
            <Button size="sm" icon={MapPin} onClick={() => useMapStore.getState().flyTo(from.lat, from.lng)}>
              Show on map
            </Button>
          )}
          <Button variant="danger" size="sm" icon={Trash2} className="ml-auto" onClick={() => void deleteSpan(span.id)} data-testid="span-delete">
            Delete
          </Button>
        </>
      }
    >
      {span.status === 'proposed' && (
        <div className="m-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="span-confirm">
          <p className="text-[13px] font-semibold text-amber-900">Proposed span: please confirm</p>
          <p className="text-[12px] text-amber-900">
            {span.basis === 'field_sequence'
              ? 'A field worker captured these two poles one after the other. That shows the order of the walk, not that a line joins them.'
              : 'Nobody has confirmed this span yet.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" icon={Check} onClick={() => setSpanStatus(span.id, 'built')} data-testid="span-confirm-built">
              Yes, built
            </Button>
            <Button size="sm" icon={Check} onClick={() => setSpanStatus(span.id, 'planned')} data-testid="span-confirm-planned">
              Yes, planned
            </Button>
            <Button variant="danger" size="sm" icon={X} onClick={() => void deleteSpan(span.id)} data-testid="span-reject">
              Not a span
            </Button>
          </div>
        </div>
      )}

      <InspectorSection title="Span" icon={Waypoints}>
        <KeyValueList
          items={[
            {
              label: 'From',
              value: from ? <RecordLink name={from.name} id={from.id} onSelect={() => select({ type: 'equipment', data: from })} /> : `${span.fromStructureId} (missing)`,
            },
            { label: 'To', value: to ? <RecordLink name={to.name} id={to.id} onSelect={() => select({ type: 'equipment', data: to })} /> : `${span.toStructureId} (missing)` },
            { label: 'Status', value: STRUCTURE_STATUS_LABELS[span.status] },
            { label: 'Where it came from', value: LINK_BASIS_LABELS[span.basis] },
            {
              label: 'On the map',
              value: drawn !== undefined ? `${formatMeters(drawn)} (${bends ? `as drawn, ${bends} bend${bends === 1 ? '' : 's'}` : 'straight line between the pins'})` : NOT_RECORDED,
            },
            { label: 'Measured', value: span.measuredLengthMeters !== undefined ? `${span.measuredLengthMeters} m` : NOT_RECORDED },
            {
              label: 'Condition',
              value: span.condition ? `${OSP_CONDITION_LABELS[span.condition]}${span.conditionAt ? ` (set ${formatDateTime(span.conditionAt)})` : ''}` : NOT_RECORDED,
            },
            { label: 'Confirmed', value: span.confirmedAt ? `${formatDateTime(span.confirmedAt)}${span.confirmedBy ? ` by ${span.confirmedBy}` : ''}` : NOT_RECORDED },
          ]}
        />
        {span.status !== 'proposed' && (
          <div className="mt-2">
            <Field label="How sure">
              <Select value={span.status} onChange={(e) => setSpanStatus(span.id, e.target.value as 'planned' | 'built' | 'verified')}>
                <option value="planned">Planned</option>
                <option value="built">Built</option>
                <option value="verified">Verified on site</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="mt-2 flex items-end gap-2">
          <Field label="Measured length (m)" hint="Tape or wheel. Empty if nobody measured it." className="flex-1">
            <Input inputMode="decimal" value={measured} onChange={(e) => setMeasured(e.target.value)} />
          </Field>
          <Button size="sm" onClick={saveMeasured} disabled={measured === (span.measuredLengthMeters?.toString() ?? '')}>
            Save
          </Button>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <Field label="Condition" hint="As someone saw it. Record an inspection below for the details." className="flex-1">
            <Select value={condition} onChange={(e) => setCondition(e.target.value as OspCondition | '')} data-testid="span-condition">
              <option value="">Not recorded</option>
              {OSP_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {OSP_CONDITION_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" onClick={saveCondition} disabled={condition === (span.condition ?? '')} data-testid="span-condition-save">
            Save
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {from && to && (
            <Button size="md" icon={Spline} onClick={drawLine} className="min-h-[48px] md:min-h-0" data-testid="span-draw-line">
              {bends ? 'Draw the line again' : 'Draw the line (bends, sag)'}
            </Button>
          )}
          {bends > 0 && (
            <Button size="md" onClick={() => setSpanRoute(span.id, null)} className="min-h-[48px] md:min-h-0" data-testid="span-straight">
              Make it a straight line
            </Button>
          )}
        </div>
        {span.notes && <p className="mt-2 text-[12px] text-slate-600">{span.notes}</p>}
      </InspectorSection>

      <InspectorSection title="Cables on this span" icon={CableGlyph} aside={onSpan.length || undefined}>
        <div className="space-y-2" data-testid="cables-on-span">
          {onSpan.length === 0 ? (
            <p className="text-[12px] text-slate-600">No cables are recorded on this span. A span is the stretch between poles, not a cable.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {onSpan.map(({ cable, attachment }) => (
                <li key={attachment.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <RecordLink name={cable.name} id={cable.id} onSelect={() => select({ type: 'cable', data: cable })} />
                    <span className="block text-[11px] text-slate-500">{STRUCTURE_STATUS_LABELS[attachment.status]}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${cable.name} from this span`}
                    onClick={() => removeAttachment(attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {span.status === 'proposed' ? (
            <p className="text-[11px] text-slate-500">Confirm the span before recording cables on it.</p>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <Field label="Record a cable on this span">
                <Select value={cableId} onChange={(e) => setCableId(e.target.value)} data-testid="span-cable-select">
                  <option value="">Choose a cable</option>
                  {cableChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <StatusChoice value={status} onChange={setStatus} testId="span-cable-status" />
              <Button
                variant="primary"
                size="sm"
                disabled={!cableId || !status}
                data-testid="span-cable-save"
                onClick={() => {
                  if (status && addAttachments([{ cableId, spanId: span.id, status, basis: 'office_confirmed' }]) > 0) {
                    setCableId('');
                    setStatus(undefined);
                  }
                }}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      </InspectorSection>

      {/* Network mapping Phase 6: every cable along this span, read-only. */}
      <CorridorSection kind="span" id={span.id} />
      <InspectionsSection targetType="span" targetId={span.id} name={span.name} />
    </InspectorLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Duct                                                                */
/* ------------------------------------------------------------------ */

function WayBadge({ place }: { place: DuctPlace }) {
  if (!place.effectiveCondition) return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">Not checked</span>;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${WAY_TONE[place.effectiveCondition]}`}>
      {WAY_CONDITION_LABELS[place.effectiveCondition].split(':')[0]}
      {place.conditionFrom ? ` (${place.conditionFrom})` : ''}
    </span>
  );
}

function DuctDetailsForm({ duct, onDone }: { duct: Duct; onDone: () => void }) {
  const [draft, setDraft] = useState({
    material: duct.material ?? '',
    wayCount: duct.wayCount?.toString() ?? '',
    diameter: duct.diameterMm?.toString() ?? '',
    inner: duct.innerDiameterMm?.toString() ?? '',
    depthSeen: duct.depthObservedMeters?.toString() ?? '',
    depthPermit: duct.permitDepthMeters?.toString() ?? '',
    owner: duct.ownerName ?? '',
    startEntry: duct.startEntry ?? '',
    endEntry: duct.endEntry ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  const save = async () => {
    const numbers = {
      wayCount: parseOptionalNumber(draft.wayCount),
      diameterMm: parseOptionalNumber(draft.diameter),
      innerDiameterMm: parseOptionalNumber(draft.inner),
      depthObservedMeters: parseOptionalNumber(draft.depthSeen),
      permitDepthMeters: parseOptionalNumber(draft.depthPermit),
    };
    if (Object.values(numbers).some((v) => v !== undefined && !(Number.isFinite(v) && v > 0))) {
      setError('Numbers must be above 0, or empty if not recorded.');
      return;
    }
    if (numbers.wayCount !== undefined && !Number.isInteger(numbers.wayCount)) {
      setError('Ducts laid together is a whole number.');
      return;
    }
    if ((numbers.depthObservedMeters ?? 0) > 20 || (numbers.permitDepthMeters ?? 0) > 20) {
      setError('Depth is in metres, 20 or less.');
      return;
    }
    if (numbers.innerDiameterMm !== undefined && numbers.diameterMm !== undefined && numbers.innerDiameterMm >= numbers.diameterMm) {
      setError('The inside diameter must be smaller than the outside size.');
      return;
    }
    const next: Duct = { ...duct };
    const put = <K extends keyof Duct>(key: K, value: Duct[K] | undefined) => {
      if (value === undefined) delete next[key];
      else next[key] = value;
    };
    put('material', blankToUndefined(draft.material));
    put('wayCount', numbers.wayCount);
    put('diameterMm', numbers.diameterMm);
    put('innerDiameterMm', numbers.innerDiameterMm);
    put('depthObservedMeters', numbers.depthObservedMeters);
    put('permitDepthMeters', numbers.permitDepthMeters);
    put('ownerName', blankToUndefined(draft.owner));
    put('startEntry', duct.fromStructureId ? blankToUndefined(draft.startEntry) : undefined);
    put('endEntry', duct.toStructureId ? blankToUndefined(draft.endEntry) : undefined);
    if (await saveDuct(next)) onDone();
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="duct-details-form">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Depth seen (m)" hint="Where someone saw it">
          <Input inputMode="decimal" value={draft.depthSeen} onChange={set('depthSeen')} data-testid="duct-depth-seen" />
        </Field>
        <Field label="Depth in permit (m)">
          <Input inputMode="decimal" value={draft.depthPermit} onChange={set('depthPermit')} data-testid="duct-depth-permit" />
        </Field>
      </div>
      <Field label="Owner" hint="As written, such as Own, BSNL or the city">
        <Input value={draft.owner} onChange={set('owner')} data-testid="duct-owner" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ducts laid together">
          <Input inputMode="numeric" value={draft.wayCount} onChange={set('wayCount')} />
        </Field>
        <Field label="Material">
          <Input value={draft.material} onChange={set('material')} placeholder="HDPE, PVC…" />
        </Field>
        <Field label="Outside size (mm)">
          <Input inputMode="decimal" value={draft.diameter} onChange={set('diameter')} />
        </Field>
        <Field label="Inside diameter (mm)" hint="Used for fill">
          <Input inputMode="decimal" value={draft.inner} onChange={set('inner')} data-testid="duct-inner" />
        </Field>
      </div>
      {duct.fromStructureId && (
        <Field label="Where it enters at the start" hint='As written, such as "north wall, hole 2"'>
          <Input value={draft.startEntry} onChange={set('startEntry')} data-testid="duct-start-entry" />
        </Field>
      )}
      {duct.toStructureId && (
        <Field label="Where it enters at the end">
          <Input value={draft.endEntry} onChange={set('endEntry')} data-testid="duct-end-entry" />
        </Field>
      )}
      {error && <p className="text-[12px] font-semibold text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={() => void save()} data-testid="duct-details-save">
          Save details
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One place in the duct: its condition, fill and cables. */
function PlaceBlock({ duct, place, cableById }: { duct: Duct; place: DuctPlace; cableById: Map<string, Cable> }) {
  const select = useUiStore((s) => s.select);
  const settings = useNetworkStore(selectOspSettings);
  const cables = useNetworkStore((s) => s.cables);
  const fill = useMemo(() => placeFill(place, cables, settings), [place, cables, settings]);
  const [label, setLabel] = useState('');
  const [condition, setCondition] = useState<WayCondition | ''>(place.condition ?? '');
  const [note, setNote] = useState('');

  const saveCondition = async () => {
    const next = withWayCondition(duct, place.key, condition || undefined, new Date().toISOString(), note);
    if (next && (await saveDuct(next))) setNote('');
  };
  const addMicroduct = async () => {
    if (!label.trim() || !place.subductId) return;
    const next: Duct = {
      ...duct,
      subducts: duct.subducts.map((s) => (s.id === place.subductId ? { ...s, microducts: [...(s.microducts ?? []), { id: newOspId('MCD'), label: label.trim(), cableIds: [] }] } : s)),
    };
    if (await saveDuct(next)) setLabel('');
  };

  const indent = place.kind === 'microduct' ? 'ml-4' : '';
  const fillText =
    fill.cableCount === 0
      ? 'Empty, as recorded.'
      : fill.ratio !== undefined
        ? `Fill ${formatFill(fill.ratio)} with ${fill.cableCount} cable(s)${fill.over ? `: above the ${formatFill(fill.limit)} setting` : ` (setting ${formatFill(fill.limit)})`}`
        : `Fill not worked out. ${fill.missing ?? ''}`;

  return (
    <div className={`space-y-1.5 rounded-md border border-slate-200 p-2 ${indent}`} data-testid={`duct-place-${place.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-slate-800">{place.label}</span>
        <WayBadge place={place} />
      </div>
      <p className={`text-[11px] ${fill.over ? 'font-semibold text-amber-800' : 'text-slate-600'}`} data-testid={`duct-fill-${place.key}`}>
        {fillText}
      </p>
      {place.cableIds.length > 0 && (
        <ul>
          {place.cableIds.map((id) => {
            const cable = cableById.get(id);
            return (
              <li key={id} className="flex items-center gap-2 py-0.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  {cable ? <RecordLink name={cable.name} id={cable.id} onSelect={() => select({ type: 'cable', data: cable })} /> : `${id} (missing)`}
                  {cable && <span className="block text-[11px] text-slate-500">Outside diameter: {cable.outerDiameterMm ? `${cable.outerDiameterMm} mm` : NOT_RECORDED}</span>}
                </span>
                <button
                  type="button"
                  aria-label="Take this cable out of the duct record"
                  onClick={() => void saveDuct(withoutCable(duct, id))}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <details className="text-[12px]">
        <summary className="cursor-pointer py-1 text-slate-600">Mark its condition{place.kind === 'subduct' ? ' or add a microduct' : ''}</summary>
        <div className="mt-1 space-y-2">
          <div className="flex items-end gap-2">
            <Field label="Condition" className="flex-1">
              <Select value={condition} onChange={(e) => setCondition(e.target.value as WayCondition | '')} data-testid={`way-condition-${place.key}`}>
                <option value="">Not checked</option>
                {WAY_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {WAY_CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button size="sm" onClick={() => void saveCondition()} disabled={condition === (place.condition ?? '') && !note.trim()} data-testid={`way-condition-save-${place.key}`}>
              Save
            </Button>
          </div>
          <Field label="Note" hint="Who found it and how, such as rodded on 3 Nov">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {place.kind === 'subduct' && (
            <div className="flex items-end gap-2">
              <Field label="New microduct label" hint="As marked, such as Red or 7" className="flex-1">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`microduct-label-${place.key}`} />
              </Field>
              <Button size="sm" icon={Plus} disabled={!label.trim()} onClick={() => void addMicroduct()} data-testid={`microduct-add-${place.key}`}>
                Add
              </Button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function CableDiameterForm({ cables }: { cables: Cable[] }) {
  const [cableId, setCableId] = useState('');
  const [value, setValue] = useState('');
  const number = parseOptionalNumber(value);
  const valid = number !== undefined && Number.isFinite(number) && number > 0 && number <= 200;
  if (cables.length === 0) return null;
  const save = () => {
    const cable = cables.find((c) => c.id === cableId);
    if (!cable || !valid) return;
    updateCable({ ...cable, outerDiameterMm: number });
    setCableId('');
    setValue('');
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2" data-testid="cable-diameter-form">
      <p className="text-[12px] text-amber-900">Fill needs each cable's outside diameter. Take it from the drum label or datasheet, or measure it.</p>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Cable">
          <Select value={cableId} onChange={(e) => setCableId(e.target.value)} data-testid="cable-diameter-cable">
            <option value="">Choose a cable</option>
            {cables.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outside (mm)">
          <Input inputMode="decimal" className="w-24" value={value} onChange={(e) => setValue(e.target.value)} data-testid="cable-diameter-value" />
        </Field>
      </div>
      <Button size="sm" variant="primary" disabled={!cableId || !valid} onClick={save} data-testid="cable-diameter-save">
        Save diameter
      </Button>
    </div>
  );
}

function UndergroundTraceSection({ duct }: { duct: Duct }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const traced = useOspUiStore((s) => s.tracedDuctIds);
  const [shown, setShown] = useState(false);
  const trace = useMemo(() => (shown ? undergroundTrace(data, duct.id) : undefined), [shown, data, duct.id]);
  const onMap = traced.length > 0 && traced.includes(duct.id);

  const showOnMap = () => {
    if (!trace) return;
    useOspUiStore.getState().showTrace(trace.steps.map((s) => s.duct.id));
    const bounds = boundsOf(trace.steps.flatMap((s) => s.duct.coordinates));
    if (bounds) useMapStore.getState().fitBounds(bounds);
    closePanelOnPhone();
  };

  return (
    <InspectorSection title="Underground trace" icon={Route} defaultOpen={false}>
      <div className="space-y-2" data-testid="underground-trace">
        <p className="text-[12px] text-slate-600">
          Duct to duct through the chambers each one is recorded as ending at. Ducts whose lines only touch on the map are not joined.
        </p>
        {!shown ? (
          <Button size="md" icon={Route} className="min-h-[48px] md:min-h-0" onClick={() => setShown(true)} data-testid="underground-trace-run">
            Trace from this duct
          </Button>
        ) : trace ? (
          <>
            <ol className="space-y-1 text-[13px]" data-testid="underground-trace-steps">
              {trace.steps.map((step) => (
                <li key={step.duct.id} className="rounded-md border border-slate-200 p-1.5" style={{ marginLeft: `${Math.min(step.depth, 6) * 8}px` }}>
                  <RecordLink name={step.duct.name} id={step.duct.id} onSelect={() => select({ type: 'duct', data: step.duct })} />
                  <span className="block text-[11px] text-slate-500">
                    {step.depth === 0 ? 'Start' : `Reached through ${step.viaStructure?.name ?? step.viaStructureId}`} · {ductCableIds(step.duct).length} cable(s) ·{' '}
                    {formatMeters(polylineLengthMeters(step.duct.coordinates))} on the map
                  </span>
                </li>
              ))}
            </ol>
            {trace.gaps.length > 0 && (
              <ul className="space-y-0.5 text-[12px] text-red-700" data-testid="underground-trace-gaps">
                {trace.gaps.map((g) => (
                  <li key={`${g.ductId}:${g.end}`}>Missing: {g.message}</li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-slate-600">
              {trace.steps.length} duct(s) through {trace.structures.length} place(s).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="md" variant="primary" className="min-h-[48px] md:min-h-0" onClick={showOnMap} data-testid="underground-trace-map">
                Show on map
              </Button>
              {onMap && (
                <Button size="md" className="min-h-[48px] md:min-h-0" onClick={() => useOspUiStore.getState().clearTrace()} data-testid="underground-trace-clear">
                  Clear from map
                </Button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </InspectorSection>
  );
}

export function DuctInspector({ duct }: { duct: Duct }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const cableById = useMemo(() => new Map(data.cables.map((c) => [c.id, c])), [data.cables]);
  const start = duct.fromStructureId ? data.equipment.find((e) => e.id === duct.fromStructureId) : undefined;
  const end = duct.toStructureId ? data.equipment.find((e) => e.id === duct.toStructureId) : undefined;
  const places = useMemo(() => ductPlaces(duct), [duct]);
  const capacity = useMemo(() => ductCapacity(duct), [duct]);
  const occupied = new Set(ductCableIds(duct));
  const free = data.cables.filter((c) => !occupied.has(c.id));
  const withoutDiameter = [...occupied].map((id) => cableById.get(id)).filter((c): c is Cable => !!c && !c.outerDiameterMm);
  const [editing, setEditing] = useState(false);
  const [place, setPlace] = useState('duct');
  const [cableId, setCableId] = useState('');
  const [label, setLabel] = useState('');

  const chosenPlace = places.find((p) => p.key === place);
  const addCable = async () => {
    if (!cableId) return;
    const next = withCableIn(duct, place, cableId);
    if (next && (await saveDuct(next))) setCableId('');
  };
  const addSubduct = async () => {
    if (!label.trim()) return;
    if (await saveDuct({ ...duct, subducts: [...duct.subducts, { id: newOspId('SUB'), label: label.trim(), cableIds: [] }] })) setLabel('');
  };

  const link = (e: typeof start) => (e ? <RecordLink name={e.name} id={e.id} onSelect={() => select({ type: 'equipment', data: e })} /> : NOT_RECORDED);

  return (
    <InspectorLayout
      actions={
        <Button variant="danger" size="sm" icon={Trash2} className="ml-auto" onClick={() => void deleteDuct(duct.id)}>
          Delete
        </Button>
      }
    >
      <InspectorSection title="Duct" icon={Info}>
        {!editing ? (
          <div className="space-y-2">
            <KeyValueList
              items={[
                { label: 'Status', value: STRUCTURE_STATUS_LABELS[duct.status] },
                { label: 'Where it came from', value: LINK_BASIS_LABELS[duct.basis] },
                { label: 'Starts at', value: link(start) },
                ...(start ? [{ label: 'Enters there at', value: orNotRecorded(duct.startEntry) }] : []),
                { label: 'Ends at', value: link(end) },
                ...(end ? [{ label: 'Enters there at', value: orNotRecorded(duct.endEntry) }] : []),
                { label: 'On the map', value: formatMeters(polylineLengthMeters(duct.coordinates)) },
                { label: 'Ducts laid together', value: duct.wayCount ?? NOT_RECORDED },
                { label: 'Outside size', value: duct.diameterMm ? `${duct.diameterMm} mm` : NOT_RECORDED },
                { label: 'Inside diameter', value: duct.innerDiameterMm ? `${duct.innerDiameterMm} mm` : NOT_RECORDED },
                { label: 'Material', value: orNotRecorded(duct.material) },
                { label: 'Depth seen', value: duct.depthObservedMeters ? `${duct.depthObservedMeters} m` : NOT_RECORDED },
                { label: 'Depth in permit', value: duct.permitDepthMeters ? `${duct.permitDepthMeters} m` : NOT_RECORDED },
                { label: 'Owner', value: orNotRecorded(duct.ownerName) },
                {
                  label: 'Condition',
                  value: duct.condition ? `${WAY_CONDITION_LABELS[duct.condition]}${duct.conditionNote ? ` · ${duct.conditionNote}` : ''}` : 'Not checked',
                },
              ]}
            />
            <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} data-testid="duct-details-edit">
              Edit depth, owner and sizes
            </Button>
          </div>
        ) : (
          <DuctDetailsForm duct={duct} onDone={() => setEditing(false)} />
        )}
      </InspectorSection>

      {/* Phase 5: change the duct's line by taps, or turn it round. */}
      <InspectorSection title="Change the route" icon={Route} defaultOpen={false}>
        <DuctRouteTools duct={duct} />
      </InspectorSection>

      <InspectorSection title="Capacity" icon={Gauge}>
        <div className="space-y-1 text-[13px]" data-testid="duct-capacity">
          <p>
            {capacity.wayCount ? `${capacity.wayCount} duct(s) laid together; ` : 'Number laid together not recorded; '}
            {capacity.described} sub-duct(s) described{capacity.undescribed ? `, ${capacity.undescribed} not described` : ''}.
          </p>
          {capacity.described > 0 && (
            <p className="text-slate-700">
              In use {capacity.inUse} · Free {capacity.free} · Blocked {capacity.blocked} · Damaged {capacity.damaged} · Not checked {capacity.notChecked}
            </p>
          )}
          {capacity.microducts.total > 0 && (
            <p className="text-slate-700">
              Microducts: {capacity.microducts.total} (in use {capacity.microducts.inUse}, free {capacity.microducts.free}, blocked {capacity.microducts.blocked})
            </p>
          )}
          <p className="text-[11px] text-slate-500">From the record only. "Free" includes ways nobody has checked.</p>
        </div>
      </InspectorSection>

      <InspectorSection title="Cables inside (occupancy)" icon={Layers} aside={occupied.size || undefined}>
        <div className="space-y-2" data-testid="duct-occupancy">
          {occupied.size === 0 && (
            <p className="text-[12px] text-slate-600" data-testid="duct-occupancy-empty">
              No cables are recorded in this duct.
            </p>
          )}
          {places.map((p) => (
            <PlaceBlock key={p.key} duct={duct} place={p} cableById={cableById} />
          ))}
          <CableDiameterForm cables={withoutDiameter} />
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <Field label="Add a cable">
              <Select value={cableId} onChange={(e) => setCableId(e.target.value)} data-testid="duct-cable-select">
                <option value="">Choose a cable</option>
                {free.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {places.length > 1 && (
              <Field label="In">
                <Select value={place} onChange={(e) => setPlace(e.target.value)} data-testid="duct-cable-place">
                  {places.map((p) => (
                    <option key={p.key} value={p.key} disabled={p.effectiveCondition === 'blocked'}>
                      {p.label}
                      {p.effectiveCondition === 'blocked' ? ' (blocked)' : p.effectiveCondition === 'damaged' ? ' (damaged)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {chosenPlace?.effectiveCondition === 'blocked' && (
              <p className="text-[12px] font-semibold text-red-700">{chosenPlace.label} is recorded as blocked. Mark it clear first if it has been cleared.</p>
            )}
            <Button variant="primary" size="sm" disabled={!cableId || chosenPlace?.effectiveCondition === 'blocked'} onClick={() => void addCable()} data-testid="duct-cable-save">
              Add cable
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="New sub-duct label" hint="As marked, such as Blue or 1" className="flex-1">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="subduct-label" />
            </Field>
            <Button size="sm" icon={Plus} disabled={!label.trim()} onClick={() => void addSubduct()} data-testid="subduct-add">
              Add
            </Button>
          </div>
        </div>
      </InspectorSection>

      <UndergroundTraceSection duct={duct} />
      {/* Network mapping Phase 6: every cable in this duct, read-only. */}
      <CorridorSection kind="duct" id={duct.id} />
      <InspectionsSection targetType="duct" targetId={duct.id} name={duct.name} />
    </InspectorLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Slack loop                                                          */
/* ------------------------------------------------------------------ */

export function SlackLoopInspector({ loop }: { loop: SlackLoop }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const cable = data.cables.find((c) => c.id === loop.cableId);
  const host = loop.structureId ? data.equipment.find((e) => e.id === loop.structureId) : undefined;
  return (
    <InspectorLayout
      actions={
        <Button variant="danger" size="sm" icon={Trash2} className="ml-auto" onClick={() => void deleteSlackLoop(loop.id)}>
          Delete
        </Button>
      }
    >
      <InspectorSection title="Slack loop" icon={Info}>
        <KeyValueList
          items={[
            { label: 'Cable', value: cable ? <RecordLink name={cable.name} id={cable.id} onSelect={() => select({ type: 'cable', data: cable })} /> : `${loop.cableId} (missing)` },
            { label: 'At', value: host ? <RecordLink name={host.name} id={host.id} onSelect={() => select({ type: 'equipment', data: host })} /> : NOT_RECORDED },
            { label: 'Length', value: `${loop.lengthMeters} m` },
            {
              label: 'Length from',
              value:
                loop.lengthSource === 'marks'
                  ? `Cable marks ${loop.markBefore} and ${loop.markAfter} ${loop.markUnit ?? 'm'}`
                  : 'Entered by a person',
            },
            { label: 'Recorded', value: `${formatDateTime(loop.createdAt) ?? ''}${loop.createdBy ? ` by ${loop.createdBy}` : ''}` },
          ]}
        />
      </InspectorSection>
    </InspectorLayout>
  );
}
