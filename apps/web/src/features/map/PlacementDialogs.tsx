import { useEffect, useMemo, useState } from 'react';
import { Keyboard, MapPin, Spline, UtilityPole } from 'lucide-react';

import {
  checkTypedCoordinates,
  type Equipment,
  type EquipmentType,
  type LatLng,
  LINE_PLACEMENT_MAX,
  pointsAlongLine,
  polylineLengthMeters,
} from '@fibergis/shared';

import { Button, Checkbox, Field, Input, Modal, Select } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { DEFAULT_TOOLBOX_ITEMS } from './EquipmentToolbox';
import { placementTemplate } from './placement';
import { usePlacementDialog } from './placementDialogStore';
import { placeAlongLine, placeAtStructure, placeAtTyped, type PlacementChoice, previewNames, structuresNear } from './placementModes';

/** Big enough for a finger on a phone; the usual size on a desk. */
const PHONE = 'max-md:h-12 max-md:text-[15px]';

/** The item chosen in the toolbox or toolbar, if any. */
function useChosenItem(): PlacementChoice | null {
  const type = useMapStore((s) => s.equipmentTypeToAdd);
  const template = useMapStore((s) => s.equipmentDraftTemplate);
  return type ? { type, template } : null;
}

/** A list of kinds, for when the dialog was opened from a pole with nothing chosen yet. */
function KindPicker({ value, onChange }: { value: string; onChange: (choice: PlacementChoice | null, key: string) => void }) {
  const catalog = useNetworkStore((s) => s.catalog);
  const options = useMemo(
    () => [
      ...DEFAULT_TOOLBOX_ITEMS.filter((i) => !i.type.includes('Pole') && i.type !== 'Manhole').map((i) => ({
        key: i.id,
        label: i.name,
        choice: { type: i.type, template: placementTemplate({ id: i.id, type: i.type, category: i.category, defaultPorts: i.defaultPorts }) },
      })),
      ...catalog.map((c) => ({
        key: c.id,
        label: c.manufacturer && c.model ? `${c.manufacturer} ${c.model} (${c.name})` : c.name,
        choice: { type: c.type as EquipmentType, template: placementTemplate(c) },
      })),
    ],
    [catalog],
  );
  return (
    <Field label="What to put here" required>
      <Select
        value={value}
        controlSize="lg"
        className={PHONE}
        data-testid="place-kind"
        onChange={(e) => {
          const option = options.find((o) => o.key === e.target.value);
          onChange(option?.choice ?? null, e.target.value);
        }}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function TypedDialog({ choice, onClose }: { choice: PlacementChoice; onClose: () => void }) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [busy, setBusy] = useState(false);
  const check = lat.trim() || lng.trim() ? checkTypedCoordinates(lat, lng) : null;

  const place = async (point: LatLng) => {
    setBusy(true);
    try {
      const created = await placeAtTyped(choice, point);
      if (created) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={Keyboard}
      title={`Type the position of the ${choice.type}`}
      description="Decimal degrees, as a GPS app shows them. Latitude first."
      footer={
        <>
          <Button variant="ghost" className={PHONE} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className={PHONE}
            disabled={!check?.ok || busy}
            loading={busy}
            data-testid="place-typed-save"
            onClick={() => check?.ok && void place([check.lat!, check.lng!])}
          >
            Place it here
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude" hint="Like 12.971599">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" autoComplete="off" controlSize="lg" className={PHONE} data-testid="place-lat" data-autofocus />
          </Field>
          <Field label="Longitude" hint="Like 77.594566">
            <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" autoComplete="off" controlSize="lg" className={PHONE} data-testid="place-lng" />
          </Field>
        </div>
        <p className="text-[11px] text-slate-500">You can also paste both numbers into the first box, like "12.971599, 77.594566".</p>
        {check?.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800" data-testid="place-typed-error">
            {check.error}
          </p>
        )}
        {check?.warnings.map((w) => (
          <p key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-testid="place-typed-warning">
            {w}
          </p>
        ))}
        {check?.swapped && (
          <Button
            fullWidth
            className={PHONE}
            data-testid="place-typed-swap"
            onClick={() => {
              setLat(String(check.swapped!.lat));
              setLng(String(check.swapped!.lng));
            }}
          >
            Swap them: latitude {check.swapped.lat}, longitude {check.swapped.lng}
          </Button>
        )}
        <p className="text-[11px] text-slate-500">Saved as "Typed", with no accuracy. "Same one?" is asked if one is already this close.</p>
      </div>
    </Modal>
  );
}

function StructureDialog({ chosen, structureId, onClose }: { chosen: PlacementChoice | null; structureId?: string; onClose: () => void }) {
  const equipment = useNetworkStore((s) => s.equipment);
  const viewport = useMapStore((s) => s.viewport);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | undefined>(structureId);
  const [kind, setKind] = useState<{ choice: PlacementChoice | null; key: string }>({ choice: chosen, key: '' });
  const [busy, setBusy] = useState(false);
  const structure = picked ? equipment.find((e) => e.id === picked) : undefined;
  const list = useMemo(() => structuresNear(equipment, [viewport.lat, viewport.lng], query), [equipment, viewport.lat, viewport.lng, query]);
  const choice = chosen ?? kind.choice;

  const place = async (target: Equipment) => {
    if (!choice) return;
    setBusy(true);
    try {
      const created = await placeAtStructure(choice, target);
      if (created) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={UtilityPole}
      title={choice ? `Put the ${choice.type} at a pole or manhole` : 'Put an item at this place'}
      description="The new item takes the exact recorded position of the one you pick. Nothing is connected."
      footer={
        <>
          <Button variant="ghost" className={PHONE} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className={PHONE}
            disabled={!structure || !choice || busy}
            loading={busy}
            data-testid="place-structure-save"
            onClick={() => structure && void place(structure)}
          >
            {structure ? `Put it at ${structure.name}` : 'Pick one first'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!chosen && <KindPicker value={kind.key} onChange={(c, key) => setKind({ choice: c, key })} />}
        {structureId && structure ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800">
            At <strong>{structure.name}</strong> ({structure.type})
          </p>
        ) : (
          <>
            <Field label="Find a pole or manhole" hint="Nearest to the middle of the map first">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, number or tag" controlSize="lg" className={PHONE} data-testid="place-structure-search" />
            </Field>
            {list.length === 0 && <p className="text-[13px] text-slate-500">No pole, manhole or chamber with a confirmed position matches.</p>}
            <ul className="max-h-64 space-y-1 overflow-y-auto" data-testid="place-structure-list">
              {list.map(({ equipment: e, distanceMeters }) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(e.id)}
                    aria-pressed={picked === e.id}
                    className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                      picked === e.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <MapPin size={16} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-900">{e.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">{e.type}</span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{distanceMeters < 1000 ? `${Math.round(distanceMeters)} m` : `${(distanceMeters / 1000).toFixed(1)} km`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function LineDialog({ choice, points, onClose }: { choice: PlacementChoice; points: LatLng[]; onClose: () => void }) {
  const equipment = useNetworkStore((s) => s.equipment);
  const radius = useNetworkStore((s) => selectOspSettings(s).duplicateRadiusMeters);
  const [spacing, setSpacing] = useState('');
  const [includeEnd, setIncludeEnd] = useState(true);
  const [busy, setBusy] = useState(false);
  const meters = spacing.trim() ? Number(spacing) : Number.NaN;
  const plan = spacing.trim() ? pointsAlongLine(points, meters, includeEnd) : null;
  const names = plan?.ok ? previewNames(choice, plan.points.length, equipment) : [];

  const place = async () => {
    if (!plan?.ok) return;
    setBusy(true);
    try {
      const result = await placeAlongLine(choice, plan.points, meters, plan.lengthMeters);
      showToast(
        result.created.length ? 'success' : 'info',
        `${result.created.length} of ${plan.points.length} placed`,
        result.sameOne ? `${result.sameOne} were the same as one already on the map, so nothing new was added there.` : 'Each has its own name. Nothing was connected.',
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={Spline}
      title={`Place ${choice.type} items along the line`}
      description={`The line is ${Math.round(polylineLengthMeters(points))} m long. It is only a guide and is not saved.`}
      footer={
        <>
          <Button variant="ghost" className={PHONE} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className={PHONE} disabled={!plan?.ok || busy} loading={busy} data-testid="place-line-save" onClick={() => void place()}>
            {plan?.ok ? `Place ${plan.points.length}` : 'Type the gap first'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Gap between items, in metres" hint="Measured along the line. Type what is on the ground, such as 40.">
          <Input value={spacing} onChange={(e) => setSpacing(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" controlSize="lg" className={PHONE} data-testid="place-line-spacing" data-autofocus />
        </Field>
        <Checkbox label="Also put one at the end of the line" checked={includeEnd} onChange={(e) => setIncludeEnd(e.target.checked)} className="min-h-12" />
        {plan && !plan.ok && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{plan.error}</p>}
        {plan?.ok && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800" data-testid="place-line-preview">
            <p>
              <strong>{plan.points.length}</strong> new: one at the start, then one every {meters} m
              {plan.endAdded ? `, and one at the end (last gap ${Math.round(plan.lastGapMeters)} m)` : plan.lastGapMeters > 0.5 ? `. The last ${Math.round(plan.lastGapMeters)} m has none` : ''}.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Names: {names.length > 4 ? `${names[0]}, ${names[1]} … ${names[names.length - 1]}` : names.join(', ')}</p>
          </div>
        )}
        {plan?.ok && meters < radius && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Items closer than {radius} m apart will each ask "Is this the same one?".
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Each is placed in turn and asks "same one?" if one is already that close. Positions come from the drawing, not a survey. At most {LINE_PLACEMENT_MAX}.
        </p>
      </div>
    </Modal>
  );
}

/** Ends the placing tool after a dialog is closed without placing. */
function leavePlacing() {
  const map = useMapStore.getState();
  if (map.drawTarget === 'placement_line') {
    map.resetSketches();
    map.setActiveTool('select');
    map.setEquipmentTypeToAdd(null);
    map.setEquipmentDraftTemplate(null);
  }
}

/** The "other ways to place" dialogs. Mounted once beside the map tools. */
export function PlacementDialogs() {
  const dialog = usePlacementDialog((s) => s.dialog);
  const close = usePlacementDialog((s) => s.close);
  const chosen = useChosenItem();
  const orphaned = Boolean(dialog && dialog.kind !== 'structure' && !chosen);
  // The placing tool was left (Esc, Cancel): a dialog for its item has nothing to place any more.
  useEffect(() => {
    if (orphaned) close();
  }, [orphaned, close]);
  if (!dialog) return null;
  const closeAndLeave = () => {
    close();
    leavePlacing();
  };
  if (dialog.kind === 'structure') return <StructureDialog chosen={chosen} structureId={dialog.structureId} onClose={close} />;
  if (!chosen) return null;
  if (dialog.kind === 'typed') return <TypedDialog choice={chosen} onClose={close} />;
  return <LineDialog choice={chosen} points={dialog.points} onClose={closeAndLeave} />;
}
