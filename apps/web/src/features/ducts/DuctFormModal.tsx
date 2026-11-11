import { useMemo, useState } from 'react';
import { Waypoints } from 'lucide-react';

import { type AttachmentStatus, distanceMeters, hasPlacedPosition, polylineLengthMeters } from '@fibergis/shared';

import { Button, Field, Input, Modal, Select } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { addDuct } from '../../stores/ospActions';
import { useUiStore } from '../../stores/uiStore';
import { StatusChoice } from '../inspector/osp/StructureSections';

/** Structures a duct can end at. Poles count too: a duct often rises up a pole. */
const DUCT_END_TYPES = /Manhole|Handhole|Chamber|Building Entry|Junction|Pole/i;

/** Saves the line just drawn as a duct. The end is chosen by the person, never taken from the nearest pin. */
export function DuctFormModal() {
  const open = useUiStore((s) => s.modals.ductForm);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  if (!open) return null;
  return <DuctForm onClose={() => setModalOpen('ductForm', false)} />;
}

function DuctForm({ onClose }: { onClose: () => void }) {
  const points = useMapStore((s) => s.drawingPoints);
  const startId = useMapStore((s) => s.ductStartId);
  const equipment = useNetworkStore((s) => s.equipment);
  const start = equipment.find((e) => e.id === startId);
  const last = points.at(-1);
  const [name, setName] = useState(start ? `Duct from ${start.name}` : '');
  const [endId, setEndId] = useState('');
  const [status, setStatus] = useState<AttachmentStatus>();
  const [ways, setWays] = useState('');
  const [diameter, setDiameter] = useState('');
  const [inner, setInner] = useState('');
  const [depthSeen, setDepthSeen] = useState('');
  const [depthPermit, setDepthPermit] = useState('');
  const [owner, setOwner] = useState('');
  const [startEntry, setStartEntry] = useState('');
  const [endEntry, setEndEntry] = useState('');
  const [subducts, setSubducts] = useState('');

  const ends = useMemo(() => {
    if (!last) return [];
    return equipment
      .filter((e) => e.id !== startId && DUCT_END_TYPES.test(e.type) && hasPlacedPosition(e))
      .map((e) => ({ e, meters: distanceMeters(last, [e.lat, e.lng]) }))
      .filter((x) => x.meters <= 50)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 10);
  }, [equipment, last, startId]);

  const save = () => {
    if (!status) return;
    const duct = addDuct({
      name,
      coordinates: points,
      ...(startId ? { fromStructureId: startId } : {}),
      ...(endId ? { toStructureId: endId } : {}),
      status,
      basis: 'office_drawn',
      ...(ways.trim() ? { wayCount: Math.round(Number(ways)) } : {}),
      ...(diameter.trim() ? { diameterMm: Number(diameter) } : {}),
      ...(inner.trim() ? { innerDiameterMm: Number(inner) } : {}),
      ...(depthSeen.trim() ? { depthObservedMeters: Number(depthSeen) } : {}),
      ...(depthPermit.trim() ? { permitDepthMeters: Number(depthPermit) } : {}),
      ownerName: owner,
      startEntry,
      endEntry,
      subductLabels: subducts.split(',').map((l) => l.trim()).filter(Boolean),
    });
    if (!duct) return;
    const map = useMapStore.getState();
    map.resetSketches();
    map.setActiveTool('select');
    onClose();
    useUiStore.getState().select({ type: 'duct', data: duct });
    if (window.innerWidth >= 768) useUiStore.getState().setPanelOpen('right', true);
  };

  const numberProblem =
    [ways, diameter, inner, depthSeen, depthPermit].some((v) => v.trim() !== '' && !(Number(v) > 0)) ||
    [depthSeen, depthPermit].some((v) => v.trim() !== '' && Number(v) > 20);

  return (
    <Modal
      open
      onClose={onClose}
      title="Save duct"
      icon={Waypoints}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back to the map</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || !status || numberProblem} data-testid="duct-save">
            Save duct
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="duct-form">
        <p className="text-[12px] text-slate-600">
          {points.length} points, about {Math.round(polylineLengthMeters(points))} m on the map. A duct is a structure: cables are added to it afterwards.
        </p>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="duct-name" />
        </Field>
        <Field label="Starts at">
          <Input value={start ? start.name : 'Not recorded'} disabled />
        </Field>
        <Field label="Ends at" hint="Only places within 50 m of the last point are listed. Leave it if you are not sure.">
          <Select value={endId} onChange={(e) => setEndId(e.target.value)} data-testid="duct-end">
            <option value="">Not recorded</option>
            {ends.map(({ e, meters }) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.type}, {Math.round(meters)} m)
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-700">How sure</span>
          <StatusChoice value={status} onChange={setStatus} testId="duct-status" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ducts laid together">
            <Input inputMode="numeric" value={ways} onChange={(e) => setWays(e.target.value)} />
          </Field>
          <Field label="Diameter (mm)">
            <Input inputMode="decimal" value={diameter} onChange={(e) => setDiameter(e.target.value)} />
          </Field>
        </div>
        <Field label="Inside diameter (mm)" hint="Used to work out how full it is. Leave empty if nobody measured it.">
          <Input inputMode="decimal" value={inner} onChange={(e) => setInner(e.target.value)} data-testid="duct-form-inner" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Depth seen (m)">
            <Input inputMode="decimal" value={depthSeen} onChange={(e) => setDepthSeen(e.target.value)} data-testid="duct-form-depth" />
          </Field>
          <Field label="Depth in permit (m)">
            <Input inputMode="decimal" value={depthPermit} onChange={(e) => setDepthPermit(e.target.value)} />
          </Field>
        </div>
        <Field label="Owner" hint="As written, such as Own, BSNL or the city. Leave empty if not known.">
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="duct-form-owner" />
        </Field>
        {start && (
          <Field label={`Where it leaves ${start.name}`} hint='As written, such as "north wall, hole 2"'>
            <Input value={startEntry} onChange={(e) => setStartEntry(e.target.value)} />
          </Field>
        )}
        {endId && (
          <Field label="Where it comes into the end">
            <Input value={endEntry} onChange={(e) => setEndEntry(e.target.value)} />
          </Field>
        )}
        <Field label="Sub-ducts" hint="Labels as marked, separated by commas, such as Blue, Orange. Leave empty if none.">
          <Input value={subducts} onChange={(e) => setSubducts(e.target.value)} data-testid="duct-subducts" />
        </Field>
        {numberProblem && <p className="text-[12px] font-semibold text-red-700">Counts, sizes and depths must be numbers above 0 (depth 20 m or less), or empty.</p>}
      </div>
    </Modal>
  );
}
