import { useMemo, useState } from 'react';
import { Scissors } from 'lucide-react';

import { type Cable, cableIdPrefix, equipmentNearPoint, newRecordId, polylineLengthMeters } from '@fibergis/shared';

import { Button, Input, Modal } from '../../components/ui';
import { selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { splitCableAt } from './cableRouteActions';

/**
 * Phase 5: the two questions before a cable is split at a point: what the second part is called,
 * and whether a closure or box is at that point (the parts then end and start there). Nothing is
 * chosen for the person: "No box here" is the starting answer. The next screen says what moves to
 * which part before anything is saved.
 */
export function SplitCableDialog({ cable, index, onClose }: { cable: Cable; index: number; onClose: () => void }) {
  const equipment = useNetworkStore((s) => s.equipment);
  const settings = useNetworkStore(selectOspSettings);
  // Made once, so the question and the saved record name the same id.
  const [newCableId] = useState(() => newRecordId(cableIdPrefix(cable.type)));
  const [name, setName] = useState(`${cable.name} (2)`);
  const [junction, setJunction] = useState('');
  const [busy, setBusy] = useState(false);

  const point = cable.coordinates[index];
  const isEnd = index <= 0 || index >= cable.coordinates.length - 1;
  const nearby = useMemo(
    () => (point ? equipmentNearPoint({ equipment }, point, settings.attachmentCorridorMeters).filter((e) => e.id !== cable.startEquipmentId && e.id !== cable.endEquipmentId) : []),
    [equipment, point, settings.attachmentCorridorMeters, cable.startEquipmentId, cable.endEquipmentId],
  );
  const firstLength = Math.round(polylineLengthMeters(cable.coordinates.slice(0, index + 1)));
  const secondLength = Math.round(polylineLengthMeters(cable.coordinates.slice(index)));

  const split = async () => {
    setBusy(true);
    try {
      const done = await splitCableAt({ cableId: cable.id, index, newCableId, newName: name.trim() || undefined, junctionEquipmentId: junction || undefined });
      if (done) onClose();
    } finally {
      setBusy(false);
    }
  };

  const choice = (id: string, label: string, detail?: string) => (
    <label
      key={id || 'none'}
      className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${junction === id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}
    >
      <input type="radio" name="split-junction" className="h-5 w-5" checked={junction === id} onChange={() => setJunction(id)} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-slate-900">{label}</span>
        {detail && <span className="block text-[12px] text-slate-500">{detail}</span>}
      </span>
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Split ${cable.name} at point ${index + 1}`}
      icon={Scissors}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Keep it as one cable</Button>
          <Button variant="primary" onClick={() => void split()} disabled={isEnd || busy} data-testid="split-continue">
            Next: check what moves
          </Button>
        </>
      }
    >
      {isEnd ? (
        <p className="text-[14px] text-amber-800">A cable cannot be split at its end. Tap a point between the two ends.</p>
      ) : (
        <div className="space-y-4 text-[14px] text-slate-700">
          <p>
            The first part keeps the id {cable.id} ({firstLength} m). The second part ({secondLength} m) becomes a new cable. Every fibre keeps its number on both.
          </p>
          <div>
            <label htmlFor="split-name" className="mb-1 block text-[13px] font-semibold text-slate-700">
              Name of the second part
            </label>
            <Input id="split-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-[48px]" />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-semibold text-slate-700">Is there a closure or box at this point?</legend>
            {choice('', 'No box here, or not recorded', 'The new ends stay not connected.')}
            {nearby.map((e) => choice(e.id, e.name, `${e.type} · ${e.id}`))}
            {nearby.length === 0 && <p className="text-[12px] text-slate-500">No equipment is placed near this point.</p>}
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
