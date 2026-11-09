import React, { useState } from 'react';
import { GitMerge, PlugZap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type Customer, defaultFiberCount, type Equipment, polylineLengthMeters } from '@fibergis/shared';

import { Button, Field, Modal, Select } from '../../components/ui';
import { setSplitterOutput } from '../../stores/fiberActions';
import { addCable, updateCustomer } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

interface Candidate {
  key: string;
  label: string;
  kind: 'olt' | 'splitter' | 'box';
  /** The map pin the new cable starts at. */
  hostId: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  ports: { id: string; label: string }[];
  splitterId?: string;
}

const UPSTREAM_TYPES = /^(OLT|MikroTik Router|FDMS|FDT|FAT|Fiber Distribution Cabinet|Fiber Joint Closure|Splice Closure)$|Terminal Box/;

/**
 * Connects what feeds an item: draws a straight cable from a chosen upstream point. Nothing is
 * chosen for the person (not even the nearest one), only real ports are listed, and a customer is
 * linked to a splitter output only when the person picks that output.
 */
export const SpliceModal: React.FC = () => {
  const { open, setModalOpen, target } = useUiStore(
    useShallow((s) => ({ open: s.modals.spliceModal, setModalOpen: s.setModalOpen, target: s.selectedSpliceTarget })),
  );
  const { equipment, splitters } = useNetworkStore(useShallow((s) => ({ equipment: s.equipment, splitters: s.splitters })));
  const [key, setKey] = useState('');
  const [portId, setPortId] = useState('');
  // Which fiber of the new drop goes to the customer. Never fiber 1 by default: the person picks it.
  const [fiber, setFiber] = useState('');
  if (!open || !target) return null;

  const isCustomer = 'ontSerialNumber' in target;
  const dropFiberCount = defaultFiberCount('Drop Fiber');
  const here: [number, number] = [target.lat, target.lng];
  const distance = (lat: number, lng: number) => Math.round(polylineLengthMeters([here, [lat, lng]]));
  const candidates: Candidate[] = [
    ...equipment
      .filter((e) => e.id !== target.id && UPSTREAM_TYPES.test(e.type))
      .map(
        (e): Candidate => ({
          key: `eq:${e.id}`,
          label: `${e.name} (${e.type})`,
          kind: e.type === 'OLT' || e.type === 'MikroTik Router' ? 'olt' : 'box',
          hostId: e.id,
          lat: e.lat,
          lng: e.lng,
          distanceMeters: distance(e.lat, e.lng),
          ports: (e.ponPorts ?? []).filter((p) => !p.connectedFeederCableId).map((p) => ({ id: p.id, label: `${p.id}${p.vendorAddress ? ` (${p.vendorAddress})` : ''}` })),
        }),
      ),
    ...splitters.flatMap((sp): Candidate[] => {
      const host = equipment.find((e) => e.id === sp.terminalBoxId);
      if (!host) return [];
      return [
        {
          key: `sp:${sp.id}`,
          label: `Splitter ${sp.name} (${sp.ratio}) in ${host.name}`,
          kind: 'splitter',
          hostId: host.id,
          lat: host.lat,
          lng: host.lng,
          distanceMeters: distance(host.lat, host.lng),
          ports: sp.outputPorts.filter((p) => p.status === 'Available' && !p.connectedDropCableId).map((p) => ({ id: String(p.portNumber), label: `Output ${p.portNumber}` })),
          splitterId: sp.id,
        },
      ];
    }),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const chosen = candidates.find((c) => c.key === key);
  /** A customer on a splitter output: the output and the drop fiber are both linked, so both are chosen. */
  const linksOutput = isCustomer && chosen?.kind === 'splitter';
  const close = () => {
    setModalOpen('spliceModal', false);
    setKey('');
    setPortId('');
    setFiber('');
  };

  const save = async () => {
    if (!chosen) return;
    const name = isCustomer ? (target as Customer).name : (target as Equipment).name;
    const created = addCable({
      name: `${isCustomer ? 'Drop' : 'Link'} ${chosen.label.split(' (')[0]} → ${name}`,
      type: isCustomer ? 'Drop Fiber' : 'Distribution Fiber',
      ...(isCustomer ? { fiberCount: dropFiberCount } : {}),
      startEquipmentId: chosen.hostId,
      startPortName: chosen.kind === 'olt' && portId ? portId : undefined,
      endEquipmentId: isCustomer ? undefined : target.id,
      coordinates: [
        [chosen.lat, chosen.lng],
        [target.lat, target.lng],
      ],
      remarks: 'Drawn straight from the connect screen. Draw the real route when known.',
    });
    if (!created) return;
    const core = Number(fiber);
    if (isCustomer && chosen.splitterId && portId && core >= 1) {
      const linked = await setSplitterOutput(chosen.splitterId, Number(portId), { cableId: created.id, core });
      if (linked) {
        updateCustomer(target.id, {
          terminalBoxId: chosen.hostId,
          splitterId: chosen.splitterId,
          splitterOutputPort: Number(portId),
          dropCableId: created.id,
          fiberCore: core,
        });
      }
    }
    close();
  };

  return (
    <Modal open onClose={close} title="Connect what feeds this" description={`A new cable to ${target.name}, drawn straight.`} icon={GitMerge} size="md">
      <div className="space-y-3 text-[13px]" data-testid="connect-modal">
        <Field label="Comes from" hint="Choose it yourself. Being nearest does not make it the feed.">
          <Select data-testid="connect-from" value={key} onChange={(e) => { setKey(e.target.value); setPortId(''); setFiber(''); }}>
            <option value="">Choose what feeds it…</option>
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}, {c.distanceMeters} m away
              </option>
            ))}
          </Select>
        </Field>
        {chosen && chosen.kind !== 'box' && (
          <Field label={chosen.kind === 'olt' ? 'PON port' : 'Splitter output'}>
            <Select data-testid="connect-port" value={portId} onChange={(e) => setPortId(e.target.value)}>
              <option value="">{chosen.ports.length ? 'Choose…' : 'No free port recorded'}</option>
              {chosen.ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {linksOutput && (
          <Field label="Which drop fiber goes to the customer" hint="Look at the drop. Choose the fiber that is joined to this output.">
            <div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Drop fiber">
                {Array.from({ length: dropFiberCount }, (_, i) => String(i + 1)).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={fiber === n}
                    data-testid={`connect-fiber-${n}`}
                    onClick={() => setFiber(n)}
                    className={`min-h-12 rounded-lg border text-base font-bold ${fiber === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}
                  >
                    Fiber {n}
                  </button>
                ))}
              </div>
              {!fiber && (
                <p role="status" className="mt-1.5 text-xs font-semibold text-amber-800">
                  Fiber not chosen. Choose one to save.
                </p>
              )}
            </div>
          </Field>
        )}
        <p className="text-xs text-slate-600">
          The cable is saved with a straight line and its length from the map. Its fibers, colours and splices are recorded on the cable and closure screens.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={PlugZap} data-testid="connect-save" disabled={!chosen || (chosen.kind === 'splitter' && !portId) || (linksOutput && !fiber)} onClick={() => void save()}>
            Save connection
          </Button>
        </div>
      </div>
    </Modal>
  );
};
