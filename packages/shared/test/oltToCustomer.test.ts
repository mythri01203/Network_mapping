import { describe, expect, it } from 'vitest';

import { buildCoresWithCapacity, createCable, deleteCable } from '../src/domain/cables';
import { applyPatch, type NetworkData } from '../src/domain/command';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { traceCustomer } from '../src/domain/trace';
import { emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW };

/** A freshly placed OLT (no PON port records yet) and terminal box. */
const newNetwork = (): NetworkData => ({
  ...emptyNetwork(),
  equipment: [
    equipment({ id: 'OLT-01', type: 'OLT', lat: 17.4, lng: 78.4, totalPorts: 8 }),
    equipment({ id: 'FAT-01', type: 'FAT', lat: 17.41, lng: 78.41, totalPorts: 8 }),
  ],
});

const feeder = (data: NetworkData, startPortName = 'PON-02') =>
  createCable(
    data,
    {
      name: 'Feeder',
      type: 'Main Feeder Fiber',
      startEquipmentId: 'OLT-01',
      startPortName,
      endEquipmentId: 'FAT-01',
      coordinates: [
        [17.4, 78.4],
        [17.41, 78.41],
      ],
    },
    ctx,
  );

const unwrap = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

describe('OLT to customer workflow', () => {
  it('adds a customer on newly placed equipment without guessing the OLT path from the cable', () => {
    let data = newNetwork();
    const cable = unwrap(feeder(data));
    data = applyPatch(data, cable.patch);
    data = applyPatch(data, unwrap(createSplitter(data, { terminalBoxId: 'FAT-01', ratio: '1:8' })).patch);

    const splitter = data.splitters[0];
    expect(splitter.terminalBoxId).toBe('FAT-01');
    expect(splitter.outputPorts).toHaveLength(8);
    // The input is never inferred from the cable that ends at the box: a person links the fiber.
    expect(splitter.inputPort.connectedCableId).toBeUndefined();

    const provisioned = unwrap(
      provisionCustomer(
        data,
        { terminalBoxId: 'FAT-01', splitterId: splitter.id, splitterOutputPort: 1, name: 'Asha', lat: 17.411, lng: 78.411 },
        ctx,
      ),
    );
    // The splitter input is not linked to a fiber, so the path is not recorded: nothing is guessed
    // from the one cable that reaches the box, and the notice says what is missing.
    expect(provisioned.value.customer).toMatchObject({ oltId: '', ponPort: '', feederCableId: '' });
    expect(provisioned.notice?.message).toContain('not linked to a fiber');

    data = applyPatch(data, provisioned.patch);
    const pon = data.equipment[0].ponPorts?.find((p) => p.id === 'PON-02');
    expect(pon?.connectedCustomersCount ?? 0).toBe(0);

    // The cable-level picture still shows the port the feeder is plugged into, as an incomplete trace.
    const trace = traceCustomer(provisioned.value.customer, data);
    expect(trace.nodes.some((n) => n.id === 'OLT-01/PON-02')).toBe(true);
    expect(trace.summary.pathComplete).toBe(false);
    expect(trace.summary.warnings.join(' ')).toContain('Fiber by fiber');
  });

  it('allows one feeder per PON port and frees the port when the cable is deleted', () => {
    let data = newNetwork();
    const cable = unwrap(feeder(data));
    data = applyPatch(data, cable.patch);
    expect(feeder(data).ok).toBe(false);

    data = applyPatch(data, unwrap(deleteCable(data, cable.value.id)).patch);
    expect(data.equipment[0].ponPorts?.find((p) => p.id === 'PON-02')?.connectedFeederCableId).toBeUndefined();
    expect(feeder(data).ok).toBe(true);
  });

  it('keeps existing PON connections when an OLT is resized', () => {
    const ports = buildOltPonPorts(
      {
        totalPorts: 2,
        ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active', connectedFeederCableId: 'F-1', connectedCustomersCount: 3 }],
      },
      4,
    );
    expect(ports).toHaveLength(4);
    expect(ports[0]).toMatchObject({ connectedFeederCableId: 'F-1', connectedCustomersCount: 3 });
    expect(ports[3]).toMatchObject({ id: 'PON-04', status: 'Available' });
  });

  it('marks reserved and damaged cores on a new cable', () => {
    const statuses = buildCoresWithCapacity(6, 2, 1).map((c) => c.status);
    expect(statuses).toEqual(['Available', 'Available', 'Available', 'Damaged', 'Reserved', 'Reserved']);
  });

  it('rejects a splitter for a terminal box that does not exist', () => {
    expect(createSplitter(newNetwork(), { terminalBoxId: 'NOPE', ratio: '1:8' }).ok).toBe(false);
  });
});
