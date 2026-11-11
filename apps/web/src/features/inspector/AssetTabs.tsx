import { useState } from 'react';
import { ClipboardList, Copy, FileText, History, Plus, UserRound, UtilityPole, Wrench } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type AssetHistoryLine,
  COPYABLE_SETTING_LABELS,
  copySettingsPlan,
  duplicateTemplate,
  type Equipment,
  EQUIPMENT_CONDITION_LABELS,
  type MaintenanceEntry,
  maintenanceProblems,
  nextMaintenanceDue,
  sameKind,
} from '@fibergis/shared';

import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { updateEquipment } from '../../stores/networkActions';
import { MAX_AUDIT_LOGS, useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { usePlacementDialog } from '../map/placementDialogStore';
import { isStructureType } from '../map/placementModes';
import { useCustomersOnItem, useItemHistory } from './assetTabData';
import { formatDate, NOT_RECORDED } from './format';
import { ActionRow, InspectorSection } from './sections';

/** Big enough for a finger on a phone; the usual size on a desk. */
const PHONE = 'max-md:h-12 max-md:text-[15px]';

/** "EQUIPMENT_UPDATED" → "Equipment updated". The code itself is kept beside it for the office. */
const plainAction = (action: string) => {
  const words = action.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

/** Customers whose recorded path names this item (see `customersOnItem`). */
export function CustomersOnItemSection({ equipment }: { equipment: Equipment }) {
  const rows = useCustomersOnItem(equipment.id);
  return (
    <InspectorSection title="Customers" icon={UserRound} aside={String(rows.length)}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-slate-500" data-testid="item-customers-empty">
          No customer record names this item. Customers are linked only when their connection is recorded.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="item-customers">
          {rows.map(({ customer, how }) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => useUiStore.getState().select({ type: 'customer', data: customer })}
                className="flex min-h-12 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-[13px] hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{customer.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{how}</span>
                </span>
                <span className="shrink-0 text-[11px] text-slate-500">{customer.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export function DocumentsOnItemSection({ equipment }: { equipment: Equipment }) {
  const documents = useNetworkStore(useShallow((s) => s.documents.filter((d) => d.equipmentId === equipment.id)));
  const photos = equipment.images.length + (equipment.photoIds?.length ?? 0);
  return (
    <InspectorSection title="Documents and photos" icon={FileText} aside={String(documents.length)}>
      <div className="space-y-2 text-[13px]">
        <p className="text-slate-700">{photos === 0 ? 'No photos on record.' : `${photos} photo${photos === 1 ? '' : 's'} on record.`}</p>
        {documents.length === 0 ? (
          <p className="text-slate-500" data-testid="item-documents-empty">No documents linked to this item.</p>
        ) : (
          <ul className="space-y-1" data-testid="item-documents">
            {documents.map((d) => (
              <li key={d.id} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                <div className="truncate font-semibold text-slate-900">{d.title}</div>
                <div className="text-[11px] text-slate-500">
                  {d.category} · {formatDate(d.uploadDate) ?? NOT_RECORDED} · {d.uploadedBy || 'who added it is not recorded'}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">Documents keep their details only; the file itself is not stored yet.</p>
        <Button className={PHONE} size="sm" icon={FileText} onClick={() => useUiStore.getState().setModalOpen('documents', true)}>
          Open documents
        </Button>
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

const emptyEntry = { date: '', by: '', what: '', nextDue: '' };

export function MaintenanceSection({ equipment }: { equipment: Equipment }) {
  const [draft, setDraft] = useState<typeof emptyEntry | null>(null);
  const entries = [...(equipment.maintenance ?? [])].reverse();
  const nextDue = nextMaintenanceDue(equipment.maintenance);
  const today = new Date().toISOString().slice(0, 10);

  const save = () => {
    if (!draft) return;
    const problems = maintenanceProblems(draft);
    if (problems.length) {
      showToast('error', 'Not saved yet', problems.join(' '));
      return;
    }
    const entry: MaintenanceEntry = {
      date: draft.date,
      by: draft.by.trim(),
      what: draft.what.trim(),
      ...(draft.nextDue ? { nextDue: draft.nextDue } : {}),
    };
    if (updateEquipment({ ...equipment, maintenance: [...(equipment.maintenance ?? []), entry] })) setDraft(null);
  };

  return (
    <InspectorSection title="Maintenance" icon={Wrench} aside={entries.length ? String(entries.length) : undefined}>
      <div className="space-y-2 text-[13px]" data-testid="item-maintenance">
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
            <dt className="text-[11px] text-slate-500">Condition</dt>
            <dd className="font-semibold text-slate-900">{equipment.condition ? EQUIPMENT_CONDITION_LABELS[equipment.condition] : NOT_RECORDED}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
            <dt className="text-[11px] text-slate-500">Warranty until</dt>
            <dd className="font-semibold text-slate-900">
              {equipment.warrantyUntil ? `${formatDate(equipment.warrantyUntil)}${equipment.warrantyUntil < today ? ' (ended)' : ''}` : NOT_RECORDED}
            </dd>
          </div>
        </dl>
        <p className="text-[11px] text-slate-500">Change condition and warranty with Edit details on the Details tab.</p>
        <p className="text-slate-700">
          Next check: <strong>{nextDue ? formatDate(nextDue) : NOT_RECORDED}</strong>
          {nextDue && nextDue < today ? <span className="text-amber-700"> (date has passed)</span> : null}
        </p>
        {entries.length === 0 ? (
          <p className="text-slate-500" data-testid="item-maintenance-empty">No maintenance recorded.</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((e, i) => (
              <li key={`${e.date}-${i}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5" data-testid="item-maintenance-entry">
                <div className="font-semibold text-slate-900">{e.what}</div>
                <div className="text-[11px] text-slate-500">
                  {formatDate(e.date)} · {e.by}
                  {e.nextDue ? ` · next check ${formatDate(e.nextDue)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
        {draft ? (
          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2" data-testid="item-maintenance-form">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Day of the work" required>
                <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={PHONE} data-testid="maint-date" />
              </Field>
              <Field label="Next check" hint="Empty: none set">
                <Input type="date" value={draft.nextDue} onChange={(e) => setDraft({ ...draft, nextDue: e.target.value })} className={PHONE} data-testid="maint-next" />
              </Field>
            </div>
            <Field label="Who did it" required>
              <Input value={draft.by} onChange={(e) => setDraft({ ...draft, by: e.target.value })} placeholder="Name" className={PHONE} data-testid="maint-by" />
            </Field>
            <Field label="What was done" required>
              <Textarea value={draft.what} onChange={(e) => setDraft({ ...draft, what: e.target.value })} rows={2} placeholder="Such as: cleaned connectors, replaced lid" data-testid="maint-what" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className={PHONE} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" className={PHONE} onClick={save} data-testid="maint-save">
                Save work
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" icon={Plus} className={PHONE} onClick={() => setDraft(emptyEntry)} data-testid="maint-add">
            Record work done
          </Button>
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function HistorySection({ equipment }: { equipment: Equipment }) {
  return <HistoryList lines={useItemHistory(equipment)} />;
}

/** The History tab's list: only the lines given (from `assetHistory`), or an honest "nothing on record". */
export function HistoryList({ lines }: { lines: readonly AssetHistoryLine[] }) {
  return (
    <InspectorSection title="History" icon={History} aside={String(lines.length)}>
      <div className="space-y-2 text-[13px]">
        {lines.length === 0 ? (
          <p className="text-slate-500" data-testid="item-history-empty">Nothing on record for this item on this device.</p>
        ) : (
          <ol className="space-y-1" data-testid="item-history">
            {lines.map((l, i) => (
              <li key={`${l.at}-${i}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5" data-testid="item-history-line">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-900">{plainAction(l.action)}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{l.at}</span>
                </div>
                <div className="break-words text-slate-700">{l.details}</div>
                <div className="text-[11px] text-slate-500">
                  {l.by || 'Who did it is not recorded'}
                  {l.part ? ` · ${l.part}` : ''}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] text-slate-500">
          From the change log ({MAX_AUDIT_LOGS} newest lines are kept on this device) and the history kept in the record. Maintenance work is on the Maintenance tab.
        </p>
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Copy, copy settings, put an item here                               */
/* ------------------------------------------------------------------ */

function CopySettingsDialog({ equipment, onClose }: { equipment: Equipment; onClose: () => void }) {
  const candidates = useNetworkStore(
    useShallow((s) => s.equipment.filter((e) => e.id !== equipment.id && sameKind(e.type, equipment.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))),
  );
  const [sourceId, setSourceId] = useState('');
  const source = candidates.find((e) => e.id === sourceId);
  const plan = source ? copySettingsPlan(equipment, source) : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={ClipboardList}
      title={`Copy settings to ${equipment.name}`}
      description="Make, model, catalogue model, spec changes and status only. Never the serial, tag, place, photos or connections."
      footer={
        <>
          <Button variant="ghost" className={PHONE} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className={PHONE}
            disabled={!plan?.changed}
            data-testid="copy-settings-save"
            onClick={() => {
              if (plan && updateEquipment(plan.next)) onClose();
            }}
          >
            {plan && !plan.changed ? 'Nothing to change' : 'Copy these'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <Field label={`Copy from another ${equipment.type}`} hint={candidates.length === 0 ? `No other ${equipment.type} on the map` : undefined}>
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} controlSize="lg" className={PHONE} data-testid="copy-settings-source">
            <option value="">Choose…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.manufacturer || c.model ? ` (${[c.manufacturer, c.model].filter(Boolean).join(' ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {plan && (
          <ul className="space-y-1" data-testid="copy-settings-preview">
            {plan.lines.map((l) => (
              <li key={l.field} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                <div className="text-[11px] text-slate-500">{COPYABLE_SETTING_LABELS[l.field]}</div>
                {l.change === 'set' ? (
                  <div>
                    <span className="text-slate-500 line-through">{l.before ?? NOT_RECORDED}</span> → <strong>{l.after}</strong>
                  </div>
                ) : l.change === 'same' ? (
                  <div className="text-slate-700">{l.after} (already the same)</div>
                ) : l.change === 'removed' ? (
                  <div className="text-amber-800">Link removed. {l.reason}</div>
                ) : (
                  <div className="text-slate-700">
                    {l.before ?? NOT_RECORDED}. {l.reason}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Tools rows for Phase 3: place a copy, copy settings, and (on a pole or chamber) put an item here. */
export function PlacementToolRows({ equipment }: { equipment: Equipment }) {
  const [copying, setCopying] = useState(false);
  const placeCopy = () => {
    const map = useMapStore.getState();
    map.setActiveTool('add_equipment');
    map.setEquipmentTypeToAdd(equipment.type);
    map.setEquipmentDraftTemplate(duplicateTemplate(equipment));
    if (window.innerWidth < 768) useUiStore.getState().setPanelOpen('right', false);
    showToast('info', `Place a copy of ${equipment.name}`, 'Tap the map where it goes, or use Type position, At a pole or Along a line. It gets its own name; no serial, tag, photos or connections are copied.');
  };
  return (
    <>
      <ActionRow icon={Copy} label="Place a copy" hint="Same kind, make and model; new name; nothing connected" onClick={placeCopy} />
      <ActionRow icon={ClipboardList} label="Copy settings from another item" hint="Make, model, specs and status" onClick={() => setCopying(true)} />
      {isStructureType(equipment.type) && (
        <ActionRow
          icon={UtilityPole}
          label={`Put an item at this ${equipment.type.toLowerCase()}`}
          hint="Same position; asks “same one?”; nothing connected"
          onClick={() => usePlacementDialog.getState().open({ kind: 'structure', structureId: equipment.id })}
        />
      )}
      {copying && <CopySettingsDialog equipment={equipment} onClose={() => setCopying(false)} />}
    </>
  );
}
