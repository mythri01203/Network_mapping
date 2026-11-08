import { useMemo, useState } from 'react';
import { Cable as CableGlyph, Check, Info, Layers, MapPin, Plus, Trash2, Waypoints, X } from 'lucide-react';

import {
  type AttachmentStatus,
  cablesOnSpan,
  type Duct,
  ductCableIds,
  LINK_BASIS_LABELS,
  newOspId,
  polylineLengthMeters,
  type SlackLoop,
  type Span,
  spanDrawnMeters,
  STRUCTURE_STATUS_LABELS,
} from '@fibergis/shared';

import { Button, Field, Input, KeyValueList, Select } from '../../../components/ui';
import { useMapStore } from '../../../stores/mapStore';
import { addAttachments, deleteDuct, deleteSlackLoop, deleteSpan, removeAttachment, saveDuct, saveSpan, setSpanStatus } from '../../../stores/ospActions';
import { useUiStore } from '../../../stores/uiStore';
import { formatDateTime, NOT_RECORDED, orNotRecorded } from '../format';
import { InspectorLayout, InspectorSection, RecordLink } from '../sections';
import { formatMeters, parseOptionalNumber, useOspData } from './ospData';
import { StatusChoice } from './StructureSections';

/* ------------------------------------------------------------------ */
/* Span                                                                */
/* ------------------------------------------------------------------ */

export function SpanInspector({ span }: { span: Span }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const from = data.equipment.find((e) => e.id === span.fromStructureId);
  const to = data.equipment.find((e) => e.id === span.toStructureId);
  const drawn = spanDrawnMeters(span, data.equipment);
  const onSpan = useMemo(() => cablesOnSpan(data, span.id), [data, span.id]);
  const [measured, setMeasured] = useState(span.measuredLengthMeters?.toString() ?? '');
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
            { label: 'On the map', value: drawn !== undefined ? `${formatMeters(drawn)} (straight line between the pins)` : NOT_RECORDED },
            { label: 'Measured', value: span.measuredLengthMeters !== undefined ? `${span.measuredLengthMeters} m` : NOT_RECORDED },
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
    </InspectorLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Duct                                                                */
/* ------------------------------------------------------------------ */

export function DuctInspector({ duct }: { duct: Duct }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const cableById = useMemo(() => new Map(data.cables.map((c) => [c.id, c])), [data.cables]);
  const start = duct.fromStructureId ? data.equipment.find((e) => e.id === duct.fromStructureId) : undefined;
  const end = duct.toStructureId ? data.equipment.find((e) => e.id === duct.toStructureId) : undefined;
  const occupied = new Set(ductCableIds(duct));
  const free = data.cables.filter((c) => !occupied.has(c.id));
  const [place, setPlace] = useState('duct');
  const [cableId, setCableId] = useState('');
  const [label, setLabel] = useState('');

  const addCable = () => {
    if (!cableId) return;
    const next: Duct =
      place === 'duct'
        ? { ...duct, cableIds: [...duct.cableIds, cableId] }
        : { ...duct, subducts: duct.subducts.map((s) => (s.id === place ? { ...s, cableIds: [...s.cableIds, cableId] } : s)) };
    if (saveDuct(next)) setCableId('');
  };
  const removeCable = (id: string) =>
    saveDuct({ ...duct, cableIds: duct.cableIds.filter((c) => c !== id), subducts: duct.subducts.map((s) => ({ ...s, cableIds: s.cableIds.filter((c) => c !== id) })) });
  const addSubduct = () => {
    if (!label.trim()) return;
    if (saveDuct({ ...duct, subducts: [...duct.subducts, { id: newOspId('SUB'), label: label.trim(), cableIds: [] }] })) setLabel('');
  };

  const cableRow = (id: string) => {
    const cable = cableById.get(id);
    return (
      <li key={id} className="flex items-center gap-2 py-1 text-[13px]">
        <span className="min-w-0 flex-1">
          {cable ? <RecordLink name={cable.name} id={cable.id} onSelect={() => select({ type: 'cable', data: cable })} /> : `${id} (missing)`}
        </span>
        <button
          type="button"
          aria-label="Take this cable out of the duct record"
          onClick={() => removeCable(id)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={14} />
        </button>
      </li>
    );
  };

  return (
    <InspectorLayout
      actions={
        <Button variant="danger" size="sm" icon={Trash2} className="ml-auto" onClick={() => void deleteDuct(duct.id)}>
          Delete
        </Button>
      }
    >
      <InspectorSection title="Duct" icon={Info}>
        <KeyValueList
          items={[
            { label: 'Status', value: STRUCTURE_STATUS_LABELS[duct.status] },
            { label: 'Where it came from', value: LINK_BASIS_LABELS[duct.basis] },
            { label: 'Starts at', value: start ? <RecordLink name={start.name} id={start.id} onSelect={() => select({ type: 'equipment', data: start })} /> : NOT_RECORDED },
            { label: 'Ends at', value: end ? <RecordLink name={end.name} id={end.id} onSelect={() => select({ type: 'equipment', data: end })} /> : NOT_RECORDED },
            { label: 'On the map', value: formatMeters(polylineLengthMeters(duct.coordinates)) },
            { label: 'Ducts laid together', value: duct.wayCount ?? NOT_RECORDED },
            { label: 'Diameter', value: duct.diameterMm ? `${duct.diameterMm} mm` : NOT_RECORDED },
            { label: 'Material', value: orNotRecorded(duct.material) },
            { label: 'Depth seen', value: duct.depthObservedMeters ? `${duct.depthObservedMeters} m` : NOT_RECORDED },
            { label: 'Depth in permit', value: duct.permitDepthMeters ? `${duct.permitDepthMeters} m` : NOT_RECORDED },
          ]}
        />
      </InspectorSection>

      <InspectorSection title="Cables inside (occupancy)" icon={Layers} aside={occupied.size || undefined}>
        <div className="space-y-2" data-testid="duct-occupancy">
          {occupied.size === 0 && (
            <p className="text-[12px] text-slate-600" data-testid="duct-occupancy-empty">
              No cables are recorded in this duct.
            </p>
          )}
          {duct.cableIds.length > 0 && <ul className="divide-y divide-slate-100">{duct.cableIds.map(cableRow)}</ul>}
          {duct.subducts.map((s) => (
            <div key={s.id} className="rounded-md border border-slate-200 p-2">
              <div className="text-[12px] font-semibold text-slate-700">Sub-duct {s.label}</div>
              {s.cableIds.length === 0 ? <p className="text-[11px] text-slate-500">Empty, as recorded.</p> : <ul>{s.cableIds.map(cableRow)}</ul>}
            </div>
          ))}
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
            {duct.subducts.length > 0 && (
              <Field label="In">
                <Select value={place} onChange={(e) => setPlace(e.target.value)} data-testid="duct-cable-place">
                  <option value="duct">The duct itself</option>
                  {duct.subducts.map((s) => (
                    <option key={s.id} value={s.id}>
                      Sub-duct {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Button variant="primary" size="sm" disabled={!cableId} onClick={addCable} data-testid="duct-cable-save">
              Add cable
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="New sub-duct label" hint="As marked, such as Blue or 1" className="flex-1">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="subduct-label" />
            </Field>
            <Button size="sm" icon={Plus} disabled={!label.trim()} onClick={addSubduct} data-testid="subduct-add">
              Add
            </Button>
          </div>
        </div>
      </InspectorSection>
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
