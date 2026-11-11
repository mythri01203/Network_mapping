import { useState } from 'react';
import { Layers } from 'lucide-react';

import {
  chassisAsWritten,
  type Equipment,
  newRecordId,
  OLT_CARD_KINDS,
  type OltCard,
  type OltChassis,
  oltChassisProblems,
  type OltShelf,
  ponPortsOnNoCard,
} from '@fibergis/shared';

import { Field, Input, Select } from '../../components/ui';
import { requestConfirm } from '../../stores/confirmStore';
import { saveChassis } from '../../stores/fiberActions';
import { InspectorSection } from '../inspector/sections';

const BIG = 'min-h-12 md:min-h-8';
const btn = `${BIG} rounded-lg border px-3 text-[14px] font-semibold md:text-[12px]`;
const MAIN = `${btn} border-blue-700 bg-blue-600 text-white hover:bg-blue-500 disabled:border-blue-300 disabled:bg-blue-300`;
const PLAIN = `${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400`;

const CARD_KIND_LABELS: Record<(typeof OLT_CARD_KINDS)[number], string> = {
  pon: 'PON card (customer ports)',
  uplink: 'Uplink card',
  control: 'Control card',
  power: 'Power card',
  other: 'Other card',
};

const emptyChassis = (): OltChassis => ({ shelves: [] });
const portsText = (ids: readonly string[]) => (ids.length === 0 ? 'no PON ports listed' : ids.length <= 4 ? ids.join(', ') : `${ids[0]} … ${ids.at(-1)} (${ids.length})`);

/**
 * Phase 10: the OLT's shelves, slots and cards, and which PON ports sit on each card. Nothing is
 * filled in for the person: an empty slot stays empty, a blank model shows "Not recorded". When no
 * chassis is recorded, the older free-text rack, shelf and slot are shown "as written".
 */
export function OltChassisSection({ olt }: { olt: Equipment }) {
  const [draft, setDraft] = useState<OltChassis | null>(null);
  const [slotEdit, setSlotEdit] = useState<{ shelfId: string; slotId: string } | null>(null);
  const chassis = draft ?? olt.chassis;
  const written = chassisAsWritten(olt);
  const problems = oltChassisProblems({ ...olt, chassis: chassis ?? undefined });
  const editing = draft !== null;

  const change = (fn: (c: OltChassis) => OltChassis) => setDraft((d) => fn(structuredClone(d ?? olt.chassis ?? emptyChassis())));
  const addShelf = () =>
    change((c) => ({ ...c, shelves: [...c.shelves, { id: newRecordId('SHF-'), label: String(c.shelves.length), slots: [] }] }));
  const addSlot = (shelfId: string) => {
    const slotId = newRecordId('SLT-');
    change((c) => ({ ...c, shelves: c.shelves.map((s) => (s.id === shelfId ? { ...s, slots: [...s.slots, { id: slotId, label: String(s.slots.length + 1) }] } : s)) }));
    setSlotEdit({ shelfId, slotId });
  };
  const save = async () => {
    if (!draft) return;
    const done = await saveChassis(olt.id, draft.shelves.length === 0 && !draft.model ? null : draft);
    if (done) {
      setDraft(null);
      setSlotEdit(null);
    }
  };
  const remove = async () => {
    const yes = await requestConfirm({
      title: 'Remove the chassis record?',
      message: `The shelves, slots and cards recorded for ${olt.name} will be removed. The PON ports, their customers and the older rack and slot text stay.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (yes && (await saveChassis(olt.id, null))) setDraft(null);
  };

  return (
    <InspectorSection title="Chassis: shelves, slots and cards" icon={Layers} defaultOpen={!!olt.chassis || written.length > 0}>
      <div className="space-y-2 text-[13px]" data-testid="olt-chassis-section">
        {!chassis || chassis.shelves.length === 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-slate-600">No shelves or cards recorded.</p>
            {written.length > 0 && (
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs" data-testid="olt-chassis-as-written">
                {written.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-slate-500">{r.label}</dt>
                    <dd className="font-semibold text-slate-800">
                      {r.value} <span className="font-normal text-slate-500">(as written)</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {editing ? (
              <Field label="Chassis model (as printed)">
                <Input className={BIG} value={chassis.model ?? ''} placeholder="Not recorded" onChange={(e) => change((c) => ({ ...c, model: e.target.value || undefined }))} />
              </Field>
            ) : (
              <p className="text-xs text-slate-600">
                Chassis model: <span className="font-semibold text-slate-800">{chassis.model || 'Not recorded'}</span>
              </p>
            )}
            {chassis.shelves.map((shelf) => (
              <ShelfBlock
                key={shelf.id}
                olt={olt}
                chassis={chassis}
                shelf={shelf}
                editing={editing}
                slotEdit={slotEdit}
                onEditSlot={(slotId) => setSlotEdit({ shelfId: shelf.id, slotId })}
                onDoneSlot={() => setSlotEdit(null)}
                onAddSlot={() => addSlot(shelf.id)}
                change={change}
              />
            ))}
          </div>
        )}

        {problems.length > 0 && (
          <ul className="space-y-1" data-testid="olt-chassis-problems">
            {problems.map((p) => (
              <li key={p.key} className={p.severity === 'error' ? 'text-xs text-red-700' : 'text-xs text-amber-800'}>
                {p.severity === 'error' ? 'Cannot save: ' : 'Check: '}
                {p.message}
              </li>
            ))}
          </ul>
        )}

        {editing ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`${PLAIN} col-span-2`} data-testid="olt-chassis-add-shelf" onClick={addShelf}>
              Add a shelf
            </button>
            <button type="button" className={PLAIN} onClick={() => { setDraft(null); setSlotEdit(null); }}>
              Cancel
            </button>
            <button type="button" className={MAIN} data-testid="olt-chassis-save" disabled={problems.some((p) => p.severity === 'error')} onClick={() => void save()}>
              Save chassis
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PLAIN} data-testid="olt-chassis-edit" onClick={() => setDraft(structuredClone(olt.chassis ?? emptyChassis()))}>
              {olt.chassis ? 'Change shelves and cards' : 'Record shelves and cards'}
            </button>
            {olt.chassis && (
              <button type="button" className={PLAIN} onClick={() => void remove()}>
                Remove chassis record
              </button>
            )}
          </div>
        )}
      </div>
    </InspectorSection>
  );
}

function ShelfBlock({
  olt,
  chassis,
  shelf,
  editing,
  slotEdit,
  onEditSlot,
  onDoneSlot,
  onAddSlot,
  change,
}: {
  olt: Equipment;
  chassis: OltChassis;
  shelf: OltShelf;
  editing: boolean;
  slotEdit: { shelfId: string; slotId: string } | null;
  onEditSlot: (slotId: string) => void;
  onDoneSlot: () => void;
  onAddSlot: () => void;
  change: (fn: (c: OltChassis) => OltChassis) => void;
}) {
  const setShelf = (fn: (s: OltShelf) => OltShelf) => change((c) => ({ ...c, shelves: c.shelves.map((s) => (s.id === shelf.id ? fn(s) : s)) }));
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2" data-testid="olt-chassis-shelf">
      {editing ? (
        <div className="flex items-end gap-2">
          <Field label="Shelf (as the OLT names it)" className="flex-1">
            <Input className={BIG} value={shelf.label} onChange={(e) => setShelf((s) => ({ ...s, label: e.target.value }))} />
          </Field>
          <button type="button" className={PLAIN} onClick={() => change((c) => ({ ...c, shelves: c.shelves.filter((s) => s.id !== shelf.id) }))}>
            Remove shelf
          </button>
        </div>
      ) : (
        <p className="text-xs font-bold text-slate-800">Shelf {shelf.label}</p>
      )}
      <ul className="mt-1 divide-y divide-slate-100">
        {shelf.slots.length === 0 && <li className="py-1 text-xs text-slate-500">No slots recorded.</li>}
        {shelf.slots.map((slot) =>
          editing && slotEdit?.shelfId === shelf.id && slotEdit.slotId === slot.id ? (
            <li key={slot.id} className="py-2">
              <SlotEditor
                olt={{ ...olt, chassis }}
                label={slot.label}
                card={slot.card}
                slotId={slot.id}
                onChange={(label, card) => setShelf((s) => ({ ...s, slots: s.slots.map((x) => (x.id === slot.id ? { id: x.id, label, ...(card ? { card } : {}) } : x)) }))}
                onRemove={() => {
                  setShelf((s) => ({ ...s, slots: s.slots.filter((x) => x.id !== slot.id) }));
                  onDoneSlot();
                }}
                onDone={onDoneSlot}
              />
            </li>
          ) : (
            <li key={slot.id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="w-16 shrink-0 font-mono font-semibold text-slate-700">Slot {slot.label}</span>
              <span className="min-w-0 flex-1 text-slate-700">
                {slot.card ? (
                  <>
                    {slot.card.model || 'Model not recorded'} · {slot.card.kind ? CARD_KIND_LABELS[slot.card.kind] : 'Kind not recorded'}
                    {' · '}
                    {slot.card.portCount !== undefined ? `${slot.card.portCount} ports` : 'port count not recorded'}
                    {(slot.card.kind === 'pon' || (slot.card.ponPortIds?.length ?? 0) > 0) && <span className="block text-slate-500">{portsText(slot.card.ponPortIds ?? [])}</span>}
                  </>
                ) : (
                  <span className="text-slate-500">Empty slot</span>
                )}
              </span>
              {editing && (
                <button type="button" className={PLAIN} onClick={() => onEditSlot(slot.id)}>
                  Change
                </button>
              )}
            </li>
          ),
        )}
      </ul>
      {editing && (
        <button type="button" className={`${PLAIN} mt-1 w-full`} data-testid="olt-chassis-add-slot" onClick={onAddSlot}>
          Add a slot to shelf {shelf.label}
        </button>
      )}
    </div>
  );
}

function SlotEditor({
  olt,
  slotId,
  label,
  card,
  onChange,
  onRemove,
  onDone,
}: {
  olt: Equipment;
  slotId: string;
  label: string;
  card?: OltCard;
  onChange: (label: string, card: OltCard | undefined) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  // Ports offered: this card's own and those on no other card.
  const free = ponPortsOnNoCard(olt, slotId);
  const ticked = card?.ponPortIds ?? [];
  const sortIds = (ids: string[]) => {
    const order = new Map((olt.ponPorts ?? []).map((p) => [p.id, p.portNumber]));
    return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  };
  const setCard = (patch: Partial<OltCard> | null) => {
    if (patch === null) return onChange(label, undefined);
    const next: OltCard = { ...(card ?? {}), ...patch };
    for (const key of Object.keys(next) as (keyof OltCard)[]) if (next[key] === undefined || next[key] === '') delete next[key];
    onChange(label, next);
  };
  const toggle = (id: string) => setCard({ ponPortIds: ticked.includes(id) ? ticked.filter((x) => x !== id) : sortIds([...ticked, id]) });
  const room = card?.portCount !== undefined ? Math.max(0, card.portCount - ticked.length) : 0;
  const nextFree = free.filter((id) => !ticked.includes(id)).slice(0, room);

  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-2" data-testid="olt-slot-editor">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Slot (as the OLT names it)">
          <Input className={BIG} value={label} onChange={(e) => onChange(e.target.value, card)} />
        </Field>
        <Field label="What is in the slot">
          <Select
            className={BIG}
            data-testid="olt-slot-kind"
            value={card ? (card.kind ?? 'unknown') : 'empty'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'empty') setCard(null);
              else setCard({ kind: v === 'unknown' ? undefined : (v as OltCard['kind']) });
            }}
          >
            <option value="empty">Empty slot</option>
            <option value="unknown">A card (kind not known)</option>
            {OLT_CARD_KINDS.map((k) => (
              <option key={k} value={k}>
                {CARD_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {card && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Card model (as printed)">
              <Input className={BIG} value={card.model ?? ''} placeholder="Not recorded" onChange={(e) => setCard({ model: e.target.value })} />
            </Field>
            <Field label="Ports on the card" hint="Count them on the card, 1 to 128">
              <Input
                className={BIG}
                data-testid="olt-slot-port-count"
                inputMode="numeric"
                value={card.portCount?.toString() ?? ''}
                placeholder="Not recorded"
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, '').slice(0, 3));
                  setCard({ portCount: n > 0 ? n : undefined });
                }}
              />
            </Field>
          </div>
          {card.kind !== 'uplink' && card.kind !== 'control' && card.kind !== 'power' && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-700">
                PON ports on this card ({ticked.length}
                {card.portCount !== undefined ? ` of ${card.portCount}` : ''})
              </p>
              {(olt.ponPorts ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">This OLT has no PON ports yet. Set the port count in Configure OLT first.</p>
              ) : (
                <div className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto sm:grid-cols-4">
                  {[...ticked, ...free.filter((id) => !ticked.includes(id))].map((id) => (
                    <label key={id} className={`flex ${BIG} cursor-pointer items-center gap-1.5 rounded border px-2 text-xs ${ticked.includes(id) ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                      <input type="checkbox" checked={ticked.includes(id)} onChange={() => toggle(id)} />
                      <span className="font-mono">{id}</span>
                    </label>
                  ))}
                </div>
              )}
              {nextFree.length > 0 && (
                <button type="button" className={`${PLAIN} w-full`} onClick={() => setCard({ ponPortIds: sortIds([...ticked, ...nextFree]) })}>
                  Tick the next {nextFree.length} free port(s): {portsText(nextFree)}
                </button>
              )}
            </div>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={PLAIN} onClick={onRemove}>
          Remove slot
        </button>
        <button type="button" className={PLAIN} data-testid="olt-slot-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
