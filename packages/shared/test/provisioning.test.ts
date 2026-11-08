import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import { type NetworkData } from '../src/domain/command';
import { resolveOpticalSettings } from '../src/domain/opticalSettings';
import { provisionCustomer, relinkCustomer, setCustomerLocation } from '../src/domain/provisioning';
import { rxReadingOf } from '../src/domain/rxReading';
import { customerSchema } from '../src/model/schemas';
import { cable, NOW, smallNetwork } from './fixtures';

const ctx = { now: NOW };
const target = { terminalBoxId: 'FAT-01', splitterId: 'SPL-01', splitterOutputPort: 2 };

/** The small network with a real launch power recorded on its PON port. */
const withLaunch = (txPowerDbm = 3): NetworkData => {
  const data = smallNetwork();
  return {
    ...data,
    equipment: data.equipment.map((e) =>
      e.id === 'OLT-01' ? { ...e, ponPorts: e.ponPorts?.map((p) => ({ ...p, txPowerDbm })) } : e,
    ),
  };
};

describe('provisionCustomer', () => {
  it('connects a subscriber end to end', () => {
    const data = smallNetwork();
    const result = provisionCustomer(data, { ...target, name: 'Asha', lat: 17.421, lng: 78.421 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    const { customer: created, dropCable } = result.value;

    expect(created.id).toMatch(/^CUST-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(created.dropCableId).toMatch(/^DROP-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(created).toMatchObject({
      name: 'Asha',
      oltId: 'OLT-01',
      ponPort: 'PON-01',
      feederCableId: 'FEED-01',
      distributionCableId: 'DIST-01',
      splitterOutputPort: 2,
      dropCableId: dropCable.id,
      installationDate: '2026-11-04',
    });
    expect(created.ipAddress).toBe('');
    expect(dropCable).toMatchObject({ type: 'Drop Fiber', startEquipmentId: 'FAT-01', fiberCount: 2 });
    expect(dropCable.cores[0]).toMatchObject({ status: 'In Use', customerId: created.id });

    const next = applyPatch(data, result.patch);
    const port = next.splitters[0].outputPorts.find((p) => p.portNumber === 2)!;
    expect(port).toMatchObject({
      status: 'Occupied',
      connectedCustomerId: created.id,
      connectedDropCableId: dropCable.id,
    });
    expect(next.equipment.find((e) => e.id === 'OLT-01')!.ponPorts![0].connectedCustomersCount).toBe(2);
    const fat = next.equipment.find((e) => e.id === 'FAT-01')!;
    expect(fat.usedPorts).toBe(1);
    expect(fat.logicalPorts![1]).toMatchObject({ status: 'Used', customerId: created.id, assignedDate: '2026-11-04' });
    expect(next.customers).toHaveLength(2);
    expect(next.cables.map((c) => c.id)).toContain(dropCable.id);
    expect(result.notice?.tone).toBe('success');
  });

  it('saves no made-up house position when none is given', () => {
    const result = provisionCustomer(smallNetwork(), target, ctx);
    if (!result.ok) throw new Error(result.error.message);
    const { customer: created, dropCable } = result.value;
    expect(created).toMatchObject({ lat: 0, lng: 0 });
    expect(dropCable.coordinates).toEqual([]);
    expect(dropCable.lengthMeters).toBe(0);
    expect(result.notice?.tone).toBe('warning');
    expect(result.notice?.message).toContain('house location is not recorded');
  });

  it('warns when no upstream OLT can be traced, and names the consequence', () => {
    const data = { ...smallNetwork(), cables: smallNetwork().cables.filter((c) => c.id !== 'FEED-01') };
    const result = provisionCustomer(data, { ...target, lat: 17.421, lng: 78.421 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.notice?.tone).toBe('warning');
    expect(result.notice?.title).toBe('Customer Saved, Not Linked');
    expect(result.notice?.message).toContain('cannot be traced');
    expect(result.value.customer.oltId).toBe('');
  });

  it('stores an estimate only as calculated, with the real launch it used', () => {
    const result = provisionCustomer(withLaunch(3), { ...target, lat: 17.421, lng: 78.421 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    const { customer: created } = result.value;
    expect(created.rxOpticalPowerDbm).toBeLessThan(0);
    expect(created.rxSource).toBe('calculated');
    expect(created.rxLaunchDbm).toBe(3);
    expect(rxReadingOf(created).originLabel).toBe('Estimated');
  });

  it('stores no reading at all when there is no estimate, never 0', () => {
    const noLaunch = provisionCustomer(smallNetwork(), { ...target, lat: 17.421, lng: 78.421 }, ctx);
    if (!noLaunch.ok) throw new Error(noLaunch.error.message);
    expect(noLaunch.value.customer.rxOpticalPowerDbm).toBeUndefined();
    expect(noLaunch.value.customer.rxSource).toBeUndefined();
    expect(rxReadingOf(noLaunch.value.customer).text).toBe('Not recorded');
    expect(customerSchema.safeParse(noLaunch.value.customer).success).toBe(true);

    const data = { ...withLaunch(), cables: smallNetwork().cables.filter((c) => c.id !== 'FEED-01') };
    const noOlt = provisionCustomer(data, target, ctx);
    if (!noOlt.ok) throw new Error(noOlt.error.message);
    expect(noOlt.value.customer.rxOpticalPowerDbm).toBeUndefined();
  });

  it('keeps a given reading with its stated origin', () => {
    const result = provisionCustomer(
      withLaunch(),
      { ...target, rxOpticalPowerDbm: -21.5, rxSource: 'field_measured', rxMeasuredAt: '2026-11-04' },
      ctx,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(rxReadingOf(result.value.customer)).toMatchObject({ valueDbm: -21.5, isMeasured: true });
  });

  it('allows blank serials and generates no serial or IP', () => {
    const first = provisionCustomer(smallNetwork(), target, ctx);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.customer.ontSerialNumber).toBe('');
    expect(first.value.customer.ipAddress).toBe('');
    expect(first.value.customer.routerModel).toBe('');
    expect(first.value.customer.plan).toBe('');

    // A second blank serial is not a duplicate.
    const next = applyPatch(smallNetwork(), first.patch);
    const second = provisionCustomer(next, { ...target, splitterOutputPort: 3 }, ctx);
    expect(second.ok).toBe(true);
  });

  it('uses overridden splitter and fiber values from the context', () => {
    const optical = resolveOpticalSettings([{ id: 'optical.fiber.1490', value: 5 }]);
    const plain = provisionCustomer(withLaunch(), { ...target, lat: 17.421, lng: 78.421 }, ctx);
    const changed = provisionCustomer(withLaunch(), { ...target, lat: 17.421, lng: 78.421 }, { ...ctx, optical });
    if (!plain.ok || !changed.ok) throw new Error('provisioning failed');
    expect(changed.value.customer.rxOpticalPowerDbm!).toBeLessThan(plain.value.customer.rxOpticalPowerDbm!);
  });

  it.each([
    [{}, 'Missing Connection Target'],
    [{ ...target, terminalBoxId: 'FAT-99' }, 'Terminal Not Found'],
    [{ ...target, splitterId: 'SPL-99' }, 'Splitter Not Found'],
    [{ ...target, terminalBoxId: 'FDT-01' }, 'Splitter Mismatch'],
    [{ ...target, splitterOutputPort: 42 }, 'Invalid Port'],
    [{ ...target, splitterOutputPort: 1 }, 'Port Already Occupied'],
    [{ ...target, ontSerialNumber: 'ont-cust-001' }, 'Duplicate ONT Serial'],
    [{ ...target, id: 'cust-001' }, 'Duplicate Customer ID'],
  ])('rejects %o with "%s"', (draft, title) => {
    expect(provisionCustomer(smallNetwork(), draft, ctx)).toMatchObject({ ok: false, error: { title } });
  });

  it('rejects faulty splitters and ports', () => {
    const faultySplitter = smallNetwork();
    faultySplitter.splitters[0] = { ...faultySplitter.splitters[0], status: 'Faulty' };
    expect(provisionCustomer(faultySplitter, target, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Splitter Faulty' },
    });

    const faultyPort = smallNetwork();
    faultyPort.splitters[0] = {
      ...faultyPort.splitters[0],
      outputPorts: faultyPort.splitters[0].outputPorts.map((p) =>
        p.portNumber === 2 ? { ...p, status: 'Faulty' as const } : p,
      ),
    };
    expect(provisionCustomer(faultyPort, target, ctx)).toMatchObject({ ok: false, error: { title: 'Port Faulty' } });
  });
});

describe('setCustomerLocation', () => {
  it('saves the position and redraws the drop as one step', () => {
    const data = smallNetwork();
    const added = provisionCustomer(data, target, ctx);
    if (!added.ok) throw new Error(added.error.message);
    const next = applyPatch(data, added.patch);
    const id = added.value.customer.id;

    const result = setCustomerLocation(next, id, { lat: 17.421, lng: 78.421, method: 'gps', accuracyMeters: 6 });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ lat: 17.421, lng: 78.421, locationMethod: 'gps', locationAccuracyMeters: 6 });
    const drop = result.patch.cables!.find((c) => c.id === added.value.dropCable.id)!;
    expect(drop.coordinates).toEqual([
      [17.42, 78.42],
      [17.421, 78.421],
    ]);
    expect(drop.lengthMeters).toBeGreaterThan(0);
  });

  it('refuses a position that is not real', () => {
    expect(setCustomerLocation(smallNetwork(), 'CUST-001', { lat: 0, lng: 0, method: 'typed' })).toMatchObject({
      ok: false,
      error: { title: 'Invalid Location' },
    });
  });
});

describe('relinkCustomer', () => {
  const beforeCable = () => {
    const base = withLaunch();
    const noFeeder = { ...base, cables: base.cables.filter((c) => c.id !== 'FEED-01') };
    const added = provisionCustomer(noFeeder, { ...target, lat: 17.421, lng: 78.421 }, ctx);
    if (!added.ok) throw new Error(added.error.message);
    return { data: applyPatch(noFeeder, added.patch), id: added.value.customer.id };
  };

  it('says what is missing while the box still reaches no OLT', () => {
    const { data, id } = beforeCable();
    expect(data.customers.find((c) => c.id === id)?.oltId).toBe('');
    const result = relinkCustomer(data, id, ctx);
    expect(result).toMatchObject({ ok: false, error: { title: 'Cannot Link Yet', tone: 'warning' } });
  });

  it('links a customer added before the cable, once a person asks', () => {
    const { data, id } = beforeCable();
    const withCable = {
      ...data,
      cables: [
        ...data.cables,
        cable({ id: 'FEED-01', type: 'Main Feeder Fiber', startEquipmentId: 'OLT-01', endEquipmentId: 'FDT-01' }),
      ],
    };
    const before = withCable.equipment.find((e) => e.id === 'OLT-01')!.ponPorts![0].connectedCustomersCount;
    const result = relinkCustomer(withCable, id, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ oltId: 'OLT-01', ponPort: 'PON-01', feederCableId: 'FEED-01', rxSource: 'calculated' });
    const next = applyPatch(withCable, result.patch);
    expect(next.equipment.find((e) => e.id === 'OLT-01')!.ponPorts![0].connectedCustomersCount).toBe(before + 1);
  });

  it('keeps a real meter reading', () => {
    const { data, id } = beforeCable();
    const measured = {
      ...data,
      customers: data.customers.map((c) => (c.id === id ? { ...c, rxOpticalPowerDbm: -19, rxSource: 'field_measured' as const } : c)),
      cables: [...data.cables, cable({ id: 'FEED-01', startEquipmentId: 'OLT-01', endEquipmentId: 'FDT-01' })],
    };
    const result = relinkCustomer(measured, id, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ rxOpticalPowerDbm: -19, rxSource: 'field_measured' });
  });
});
