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

  const numberProblem = [ways, diameter].some((v) => v.trim() !== '' && !(Number(v) > 0));

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
        <Field label="Sub-ducts" hint="Labels as marked, separated by commas, such as Blue, Orange. Leave empty if none.">
          <Input value={subducts} onChange={(e) => setSubducts(e.target.value)} data-testid="duct-subducts" />
        </Field>
        {numberProblem && <p className="text-[12px] font-semibold text-red-700">Counts and diameters must be numbers above 0, or empty.</p>}
      </div>
    </Modal>
  );
}
