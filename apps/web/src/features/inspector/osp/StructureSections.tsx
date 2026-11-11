import { useMemo, useState } from 'react';
import { Cable as CableGlyph, FileCheck2, FileDown, Link2, Pencil, Plus, Trash2, UtilityPole, Waypoints } from 'lucide-react';

import {
  ATTACHMENT_STATUSES,
  type AttachmentStatus,
  cablesOnStructure,
  distanceMeters,
  type Duct,
  ductsAt,
  type Equipment,
  hasPlacedPosition,
  inspectionTargetOf,
  isPoleType,
  LINK_BASIS_LABELS,
  type Permission,
  PERMISSION_KIND_LABELS,
  PERMISSION_KINDS,
  type PermissionKind,
  permissionsFor,
  pointToLine,
  POLE_MATERIALS,
  spanBetween,
  spansAt,
  STRUCTURE_STATUS_LABELS,
} from '@fibergis/shared';

import { Button, Field, Input, KeyValueList, Select } from '../../../components/ui';
import { useMapStore } from '../../../stores/mapStore';
import { updateEquipment } from '../../../stores/networkActions';
import { selectOspSettings, useNetworkStore } from '../../../stores/networkStore';
import {
  addAttachments,
  addSpan,
  deletePermission,
  removeAttachment,
  saveDuct,
  savePermission,
} from '../../../stores/ospActions';
import { useUiStore } from '../../../stores/uiStore';
import { NOT_RECORDED, orNotRecorded } from '../format';
import { InspectorSection, RecordLink } from '../sections';
import { InspectionsSection } from './InspectionSection';
import { blankToUndefined, parseOptionalNumber, useOspData } from './ospData';

const MATERIAL_LABELS: Record<string, string> = { concrete: 'Concrete', iron: 'Iron', wood: 'Wood', unknown: 'Not known' };
const OWNER_SUGGESTIONS = ['BESCOM', 'Other DISCOM', 'Own', 'Municipal (BBMP)', 'BSNL', 'Other operator'];

/** One required choice of how sure we are. Nothing is pre-selected. */
export function StatusChoice({
  value,
  onChange,
  testId,
}: {
  value: AttachmentStatus | undefined;
  onChange: (value: AttachmentStatus) => void;
  testId?: string;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="How sure" data-testid={testId}>
      {ATTACHMENT_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={value === status}
          onClick={() => onChange(status)}
          data-testid={testId ? `${testId}-${status}` : undefined}
          className={`h-12 flex-1 rounded-md border text-[13px] font-medium md:h-8 md:text-[12px] ${
            value === status ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {STRUCTURE_STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pole details                                                        */
/* ------------------------------------------------------------------ */

export function PoleDetailsSection({ equipment }: { equipment: Equipment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    material: equipment.material ?? '',
    height: equipment.heightMeters?.toString() ?? '',
    owner: equipment.ownerName ?? '',
    ownerPoleNumber: equipment.ownerPoleNumber ?? '',
    poleNumber: equipment.poleNumber ?? '',
    tagCode: equipment.tagCode ?? '',
    // Network mapping Phase 18: cables the owner allows on the pole, from the permission.
    allowed: equipment.attachmentCapacity?.toString() ?? '',
    allowedSource: equipment.attachmentCapacitySource ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const height = parseOptionalNumber(draft.height);
    if (height !== undefined && !(Number.isFinite(height) && height > 0 && height <= 100)) {
      setError('Height must be a number of metres between 0 and 100, or empty.');
      return;
    }
    const allowed = parseOptionalNumber(draft.allowed);
    if (allowed !== undefined && !(Number.isInteger(allowed) && allowed > 0 && allowed <= 100)) {
      setError('Cables allowed must be a whole number from 1 to 100, or empty.');
      return;
    }
    const next: Equipment = { ...equipment };
    const set = <K extends keyof Equipment>(key: K, value: Equipment[K] | undefined) => {
      if (value === undefined) delete next[key];
      else next[key] = value;
    };
    set('material', (draft.material || undefined) as Equipment['material']);
    set('heightMeters', height);
    set('ownerName', blankToUndefined(draft.owner));
    set('ownerPoleNumber', blankToUndefined(draft.ownerPoleNumber));
    set('poleNumber', blankToUndefined(draft.poleNumber));
    set('tagCode', blankToUndefined(draft.tagCode)?.toUpperCase());
    set('attachmentCapacity', allowed);
    set('attachmentCapacitySource', allowed !== undefined ? blankToUndefined(draft.allowedSource) : undefined);
    updateEquipment(next);
    setError(null);
    setEditing(false);
  };

  const ownerKind =
    equipment.ownerType === 'electricity' ? 'Electricity pole' : equipment.ownerType === 'telecom' ? 'Telecom pole' : undefined;

  return (
    <InspectorSection title="Pole details" icon={UtilityPole}>
      {!editing ? (
        <div className="space-y-2">
          <KeyValueList
            items={[
              { label: 'Material', value: equipment.material ? MATERIAL_LABELS[equipment.material] : NOT_RECORDED },
              { label: 'Height', value: equipment.heightMeters !== undefined ? `${equipment.heightMeters} m` : NOT_RECORDED },
              { label: 'Owner', value: orNotRecorded(equipment.ownerName) },
              ...(ownerKind ? [{ label: 'Seen in the field as', value: ownerKind }] : []),
              { label: "Owner's pole number", value: orNotRecorded(equipment.ownerPoleNumber), mono: true },
              { label: 'Our pole number', value: orNotRecorded(equipment.poleNumber), mono: true },
              { label: 'QR tag', value: orNotRecorded(equipment.tagCode), mono: true },
              {
                label: 'Cables allowed by the owner',
                value: equipment.attachmentCapacity !== undefined ? `${equipment.attachmentCapacity}${equipment.attachmentCapacitySource ? ` (from ${equipment.attachmentCapacitySource})` : ''}` : NOT_RECORDED,
              },
            ]}
          />
          <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} data-testid="pole-details-edit">
            Edit pole details
          </Button>
        </div>
      ) : (
        <div className="space-y-2" data-testid="pole-details-form">
          <Field label="Material">
            <Select value={draft.material} onChange={(e) => setDraft({ ...draft, material: e.target.value })} data-testid="pole-material">
              <option value="">Not recorded</option>
              {POLE_MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Height (m)" hint="Leave empty if nobody measured it.">
            <Input inputMode="decimal" value={draft.height} onChange={(e) => setDraft({ ...draft, height: e.target.value })} data-testid="pole-height" />
          </Field>
          <Field label="Owner" hint="As written on the pole or the permission, such as BESCOM.">
            <Input list="pole-owner-suggestions" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} data-testid="pole-owner" />
          </Field>
          <datalist id="pole-owner-suggestions">
            {OWNER_SUGGESTIONS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <Field label="Owner's pole number" hint="The number the owner painted. It can repeat or be repainted.">
            <Input value={draft.ownerPoleNumber} onChange={(e) => setDraft({ ...draft, ownerPoleNumber: e.target.value })} data-testid="pole-owner-number" />
          </Field>
          <Field label="Our pole number">
            <Input value={draft.poleNumber} onChange={(e) => setDraft({ ...draft, poleNumber: e.target.value })} />
          </Field>
          <Field label="QR tag code">
            <Input value={draft.tagCode} onChange={(e) => setDraft({ ...draft, tagCode: e.target.value })} />
          </Field>
          <Field label="Cables allowed on this pole" hint="The number the owner allows, from the permission or agreement. Leave empty if you do not know.">
            <Input inputMode="numeric" value={draft.allowed} onChange={(e) => setDraft({ ...draft, allowed: e.target.value })} data-testid="pole-allowed-cables" />
          </Field>
          {draft.allowed.trim() !== '' && (
            <Field label="Where this number comes from" hint="Such as the permission letter number and date.">
              <Input value={draft.allowedSource} onChange={(e) => setDraft({ ...draft, allowedSource: e.target.value })} data-testid="pole-allowed-source" />
            </Field>
          )}
          {error && <p className="text-[12px] font-semibold text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={save} data-testid="pole-details-save">
              Save details
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Cables on this pole                                                 */
/* ------------------------------------------------------------------ */

export function CablesOnPoleSection({ equipment }: { equipment: Equipment }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const settings = useNetworkStore(selectOspSettings);
  const onPole = useMemo(() => cablesOnStructure(data, equipment.id), [data, equipment.id]);
  const [adding, setAdding] = useState(false);
  const [cableId, setCableId] = useState('');
  const [status, setStatus] = useState<AttachmentStatus>();

  // Cables whose drawn line passes near the pole first, then the rest. A list to choose from, never a link.
  const choices = useMemo(() => {
    const recorded = new Set(onPole.map((c) => c.cable.id));
    return data.cables
      .filter((c) => !recorded.has(c.id))
      .map((c) => ({ cable: c, gap: pointToLine([equipment.lat, equipment.lng], c.coordinates)?.distanceMeters ?? Infinity }))
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 30);
  }, [data.cables, onPole, equipment.lat, equipment.lng]);

  const save = () => {
    if (!cableId || !status) return;
    if (addAttachments([{ cableId, structureId: equipment.id, status, basis: 'office_confirmed' }]) > 0) {
      setAdding(false);
      setCableId('');
      setStatus(undefined);
    }
  };

  return (
    <InspectorSection title="Cables on this pole" icon={CableGlyph} aside={onPole.length || undefined}>
      <div className="space-y-2" data-testid="cables-on-pole">
        {onPole.length === 0 ? (
          <p className="text-[12px] text-slate-600" data-testid="cables-on-pole-empty">
            No cables are recorded on this pole. A cable drawn past it on the map is not proof that it is attached.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {onPole.map((item) => (
              <li key={item.cable.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <RecordLink name={item.cable.name} id={item.cable.id} onSelect={() => select({ type: 'cable', data: item.cable })} />
                  <span className="block text-[11px] text-slate-500">
                    {item.via === 'pole' ? 'On this pole' : `On span ${item.span?.name ?? ''}`} · {STRUCTURE_STATUS_LABELS[item.attachment.status]} ·{' '}
                    {LINK_BASIS_LABELS[item.attachment.basis]}
                  </span>
                </span>
                {item.via === 'pole' && (
                  <button
                    type="button"
                    aria-label={`Remove ${item.cable.name} from this pole`}
                    onClick={() => removeAttachment(item.attachment.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!adding ? (
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)} data-testid="pole-add-cable">
            Record a cable on this pole
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <Field label="Cable" hint={`Cables drawn within ${settings.attachmentCorridorMeters} m are listed first. Choose only one you know is on this pole.`}>
              <Select value={cableId} onChange={(e) => setCableId(e.target.value)} data-testid="pole-add-cable-select">
                <option value="">Choose a cable</option>
                {choices.map(({ cable, gap }) => (
                  <option key={cable.id} value={cable.id}>
                    {cable.name}
                    {Number.isFinite(gap) ? ` (line ${Math.round(gap)} m away)` : ' (no line drawn)'}
                  </option>
                ))}
              </Select>
            </Field>
            <StatusChoice value={status} onChange={setStatus} testId="pole-add-cable-status" />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={!cableId || !status} onClick={save} data-testid="pole-add-cable-save">
                Save
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
/* Spans at this pole                                                  */
/* ------------------------------------------------------------------ */

export function SpansSection({ equipment }: { equipment: Equipment }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const spans = useMemo(() => spansAt(data, equipment.id), [data, equipment.id]);
  const byId = useMemo(() => new Map(data.equipment.map((e) => [e.id, e])), [data.equipment]);
  const [adding, setAdding] = useState(false);
  const [toId, setToId] = useState('');
  const [status, setStatus] = useState<AttachmentStatus>();

  const nearby = useMemo(
    () =>
      data.equipment
        .filter((e) => e.id !== equipment.id && isPoleType(e.type) && hasPlacedPosition(e) && !spanBetween(data.spans ?? [], equipment.id, e.id))
        .map((e) => ({ pole: e, meters: distanceMeters([equipment.lat, equipment.lng], [e.lat, e.lng]) }))
        .sort((a, b) => a.meters - b.meters)
        .slice(0, 15),
    [data.equipment, data.spans, equipment.id, equipment.lat, equipment.lng],
  );

  const save = () => {
    if (!toId || !status) return;
    if (addSpan({ fromStructureId: equipment.id, toStructureId: toId, status, basis: 'office_drawn' })) {
      setAdding(false);
      setToId('');
      setStatus(undefined);
    }
  };

  return (
    <InspectorSection title="Spans" icon={Waypoints} aside={spans.length || undefined}>
      <div className="space-y-2" data-testid="pole-spans">
        {spans.length === 0 ? (
          <p className="text-[12px] text-slate-600">No spans recorded from this pole.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {spans.map((span) => {
              const other = byId.get(span.fromStructureId === equipment.id ? span.toStructureId : span.fromStructureId);
              return (
                <li key={span.id} className="py-1.5 text-[13px]">
                  <RecordLink name={`To ${other?.name ?? 'missing pole'}`} id={span.id} onSelect={() => select({ type: 'span', data: span })} />
                  <span className={`block text-[11px] ${span.status === 'proposed' ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                    {STRUCTURE_STATUS_LABELS[span.status]}
                    {span.basis === 'field_sequence' ? ' · from the field order' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!adding ? (
          <Button size="sm" icon={Link2} onClick={() => setAdding(true)} data-testid="pole-add-span">
            Add span to another pole
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <Field label="Other pole" hint="Nearest first. Choose the pole the span really reaches.">
              <Select value={toId} onChange={(e) => setToId(e.target.value)} data-testid="pole-add-span-select">
                <option value="">Choose a pole</option>
                {nearby.map(({ pole, meters }) => (
                  <option key={pole.id} value={pole.id}>
                    {pole.name} ({Math.round(meters)} m)
                  </option>
                ))}
              </Select>
            </Field>
            <StatusChoice value={status} onChange={setStatus} testId="pole-add-span-status" />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={!toId || !status} onClick={save} data-testid="pole-add-span-save">
                Add span
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
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

const emptyPermission = { authority: '', kind: '' as PermissionKind | '', permitNumber: '', validFrom: '', validUntil: '', rentAmount: '', rentTerms: '', notes: '' };

function PermissionForm({ equipment, permission, onDone }: { equipment: Equipment; permission?: Permission; onDone: () => void }) {
  const [draft, setDraft] = useState(
    permission
      ? {
          authority: permission.authority,
          kind: permission.kind ?? '',
          permitNumber: permission.permitNumber ?? '',
          validFrom: permission.validFrom ?? '',
          validUntil: permission.validUntil ?? '',
          rentAmount: permission.rentAmount?.toString() ?? '',
          rentTerms: permission.rentTerms ?? '',
          notes: permission.notes ?? '',
        }
      : { ...emptyPermission, authority: equipment.ownerName ?? '' },
  );
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  const save = () => {
    const rent = parseOptionalNumber(draft.rentAmount);
    if (rent !== undefined && !(Number.isFinite(rent) && rent >= 0)) {
      setError('Rent must be a number, or empty.');
      return;
    }
    const saved = savePermission({
      ...(permission ? { id: permission.id } : {}),
      authority: draft.authority,
      ...(draft.kind ? { kind: draft.kind as PermissionKind } : {}),
      permitNumber: draft.permitNumber,
      structureIds: permission ? permission.structureIds : [equipment.id],
      ...(permission?.cableIds ? { cableIds: permission.cableIds } : {}),
      validFrom: draft.validFrom,
      validUntil: draft.validUntil,
      ...(rent !== undefined ? { rentAmount: rent } : {}),
      rentTerms: draft.rentTerms,
      notes: draft.notes,
    });
    if (saved) onDone();
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="permission-form">
      <Field label="Given by" required hint="The owner or authority, as written on the paper.">
        <Input value={draft.authority} onChange={set('authority')} data-testid="permission-authority" />
      </Field>
      <Field label="Kind">
        <Select value={draft.kind} onChange={set('kind')}>
          <option value="">Not recorded</option>
          {PERMISSION_KINDS.map((k) => (
            <option key={k} value={k}>
              {PERMISSION_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Permit number">
        <Input value={draft.permitNumber} onChange={set('permitNumber')} data-testid="permission-number" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <Input type="date" value={draft.validFrom} onChange={set('validFrom')} data-testid="permission-from" />
        </Field>
        <Field label="Until">
          <Input type="date" value={draft.validUntil} onChange={set('validUntil')} data-testid="permission-until" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rent (₹)" hint="As on the paper">
          <Input inputMode="decimal" value={draft.rentAmount} onChange={set('rentAmount')} data-testid="permission-rent" />
        </Field>
        <Field label="Rent terms" hint="e.g. per pole per year">
          <Input value={draft.rentTerms} onChange={set('rentTerms')} data-testid="permission-rent-terms" />
        </Field>
      </div>
      <Field label="Notes">
        <Input value={draft.notes} onChange={set('notes')} />
      </Field>
      {error && <p className="text-[12px] font-semibold text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={save} disabled={!draft.authority.trim()} data-testid="permission-save">
          Save permission
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PermissionsSection({ equipment }: { equipment: Equipment }) {
  const data = useOspData();
  const permissions = useMemo(() => permissionsFor(data, equipment.id), [data, equipment.id]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <>
    <InspectorSection title="Permission and right of way" icon={FileCheck2} aside={permissions.length || undefined}>
      <div className="space-y-2" data-testid="pole-permissions">
        {permissions.length === 0 && editing === null && (
          <p className="text-[12px] text-slate-600" data-testid="pole-permissions-empty">
            No permission recorded for this pole.
          </p>
        )}
        {permissions.map((p) =>
          editing === p.id ? (
            <PermissionForm key={p.id} equipment={equipment} permission={p} onDone={() => setEditing(null)} />
          ) : (
            <div key={p.id} className="rounded-lg border border-slate-200 p-2 text-[12px]">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{p.authority}</div>
                  <KeyValueList
                    className="mt-1"
                    items={[
                      { label: 'Kind', value: p.kind ? PERMISSION_KIND_LABELS[p.kind] : NOT_RECORDED },
                      { label: 'Permit number', value: orNotRecorded(p.permitNumber), mono: true },
                      { label: 'Valid', value: p.validFrom || p.validUntil ? `${p.validFrom || '?'} to ${p.validUntil || '?'}` : NOT_RECORDED },
                      {
                        label: 'Rent, as entered',
                        value: p.rentAmount !== undefined ? `₹${p.rentAmount}${p.rentTerms ? ` ${p.rentTerms}` : ''}` : orNotRecorded(p.rentTerms),
                      },
                      ...(p.structureIds.length > 1 ? [{ label: 'Covers', value: `${p.structureIds.length} poles` }] : []),
                    ]}
                  />
                </div>
                <button type="button" aria-label="Edit permission" onClick={() => setEditing(p.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Delete permission"
                  onClick={() => void deletePermission(p.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ),
        )}
        {editing === 'new' ? (
          <PermissionForm equipment={equipment} onDone={() => setEditing(null)} />
        ) : (
          <Button size="sm" icon={Plus} onClick={() => setEditing('new')} data-testid="permission-add">
            Add permission
          </Button>
        )}
        <p className="text-[11px] text-slate-500">
          Amounts and dates are kept as typed. Rates differ by owner and are not worked out by the app.
        </p>
      </div>
    </InspectorSection>
    {/* Phase 4: a pole's inspections follow its permissions, so the pole panel needs no other change. */}
    {inspectionTargetOf(equipment) === 'pole' && <InspectionsSection targetType="pole" targetId={equipment.id} name={equipment.name} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ducts at a chamber                                                  */
/* ------------------------------------------------------------------ */

/** Phase 4: where one duct end comes into this chamber, as written, with a small edit. */
function DuctEntryRow({ duct, end }: { duct: Duct; end: 'start' | 'end' }) {
  const current = end === 'start' ? duct.startEntry : duct.endEntry;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(current ?? '');
  const save = async () => {
    const next: Duct = { ...duct };
    const key = end === 'start' ? 'startEntry' : 'endEntry';
    const value = blankToUndefined(text);
    if (value) next[key] = value;
    else delete next[key];
    if (await saveDuct(next)) setEditing(false);
  };
  return !editing ? (
    <span className="flex items-center gap-1 text-[11px] text-slate-600">
      {end === 'start' ? 'Leaves' : 'Comes in'} through: {orNotRecorded(current)}
      <button type="button" aria-label={`Change where ${duct.name} comes in`} onClick={() => setEditing(true)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
        <Pencil size={12} />
      </button>
    </span>
  ) : (
    <span className="mt-1 flex items-end gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="North wall, hole 2" aria-label="Where it comes in" data-testid={`duct-entry-${duct.id}-${end}`} />
      <Button size="sm" onClick={() => void save()} data-testid={`duct-entry-save-${duct.id}-${end}`}>
        Save
      </Button>
      <Button size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function DuctsAtSection({ equipment }: { equipment: Equipment }) {
  const data = useOspData();
  const select = useUiStore((s) => s.select);
  const ducts = useMemo(() => ductsAt(data, equipment.id), [data, equipment.id]);
  const startDuct = () => {
    useMapStore.getState().startDuct(equipment);
    if (window.innerWidth < 768) useUiStore.getState().setPanelOpen('right', false);
  };
  return (
    <>
    <InspectorSection title="Ducts, entries and exits" icon={Waypoints} aside={ducts.length || undefined}>
      <div className="space-y-2" data-testid="structure-ducts">
        {ducts.length === 0 ? (
          <p className="text-[12px] text-slate-600">No ducts recorded at this {equipment.type.toLowerCase()}.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ducts.map((duct) => (
              <li key={duct.id} className="py-1.5 text-[13px]">
                <RecordLink name={duct.name} id={duct.id} onSelect={() => select({ type: 'duct', data: duct })} />
                <span className="block text-[11px] text-slate-500">{STRUCTURE_STATUS_LABELS[duct.status]}</span>
                {duct.fromStructureId === equipment.id && <DuctEntryRow duct={duct} end="start" />}
                {duct.toStructureId === equipment.id && <DuctEntryRow duct={duct} end="end" />}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">
          A duct is listed here only when it is recorded as starting or ending at this {equipment.type.toLowerCase()}; a line passing near it does not count.
        </p>
        <Button size="sm" icon={Waypoints} onClick={startDuct} data-testid="start-duct">
          Start duct here
        </Button>
      </div>
    </InspectorSection>
    {/* Phase 4: a chamber's inspections, beside its ducts. */}
    {inspectionTargetOf(equipment) === 'chamber' && <InspectionsSection targetType="chamber" targetId={equipment.id} name={equipment.name} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Where an imported record came from                                  */
/* ------------------------------------------------------------------ */

export function ImportInfoSection({ info }: { info: NonNullable<Equipment['importInfo']> }) {
  const extended = Object.entries(info.extendedData ?? {});
  return (
    <InspectorSection title="From imported file" icon={FileDown} defaultOpen={false}>
      <KeyValueList
        items={[
          { label: 'File', value: info.fileName },
          { label: 'Imported', value: info.importedAt.slice(0, 10) },
          { label: 'Folder', value: orNotRecorded(info.folderPath) },
          { label: 'Name in file', value: orNotRecorded(info.originalName) },
          { label: 'Description in file', value: orNotRecorded(info.description) },
          ...extended.map(([key, value]) => ({ label: key, value })),
        ]}
      />
      <p className="mt-2 text-[11px] text-slate-500">
        Kept exactly as the file had it. Position accuracy is not known, and nothing was connected on import.
      </p>
    </InspectorSection>
  );
}
