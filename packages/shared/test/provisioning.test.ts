import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import { allocateIpAddress, provisionCustomer } from '../src/domain/provisioning';
import { customer, NOW, smallNetwork } from './fixtures';

const ctx = { now: NOW };
const target = { terminalBoxId: 'FAT-01', splitterId: 'SPL-01', splitterOutputPort: 2 };

describe('allocateIpAddress', () => {
  it('keeps a free preferred address', () => {
    expect(allocateIpAddress([], '10.0.0.9')).toBe('10.0.0.9');
  });

  it('skips addresses that are already taken', () => {
    const taken = [customer({ id: 'A', ipAddress: '100.64.0.5' }), customer({ id: 'B', ipAddress: '100.64.0.6' })];
    const ip = allocateIpAddress(taken, '100.64.0.5');
    expect(ip).toMatch(/^100\.64\.\d+\.\d+$/);
    expect(['100.64.0.5', '100.64.0.6']).not.toContain(ip);
  });
});

describe('provisionCustomer', () => {
  it('connects a subscriber end to end', () => {
    const data = smallNetwork();
    const result = provisionCustomer(data, { ...target, name: 'Asha', lat: 17.421, lng: 78.421 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    const { customer: created, dropCable } = result.value;

    expect(created).toMatchObject({
      id: 'CUST-002',
      name: 'Asha',
      oltId: 'OLT-01',
      ponPort: 'PON-01',
      feederCableId: 'FEED-01',
      distributionCableId: 'DIST-01',
      splitterOutputPort: 2,
      dropCableId: 'DROP-001',
      installationDate: '2026-11-04',
    });
    expect(created.ipAddress).not.toBe('100.64.0.5');
    expect(created.rxOpticalPowerDbm).toBeLessThan(0);
    expect(dropCable).toMatchObject({ type: 'Drop Fiber', startEquipmentId: 'FAT-01', fiberCount: 2 });
    expect(dropCable.cores[0]).toMatchObject({ status: 'In Use', customerId: 'CUST-002' });

    const next = applyPatch(data, result.patch);
    const port = next.splitters[0].outputPorts.find((p) => p.portNumber === 2)!;
    expect(port).toMatchObject({
      status: 'Occupied',
      connectedCustomerId: 'CUST-002',
      connectedDropCableId: 'DROP-001',
    });
    expect(next.equipment.find((e) => e.id === 'OLT-01')!.ponPorts![0].connectedCustomersCount).toBe(2);
    const fat = next.equipment.find((e) => e.id === 'FAT-01')!;
    expect(fat.usedPorts).toBe(1);
    expect(fat.logicalPorts![1]).toMatchObject({ status: 'Used', customerId: 'CUST-002', assignedDate: '2026-11-04' });
    expect(next.customers).toHaveLength(2);
    expect(next.cables.map((c) => c.id)).toContain('DROP-001');
    expect(result.notice?.tone).toBe('success');
  });

  it('places the subscriber near the FAT when no location is given', () => {
    const result = provisionCustomer(smallNetwork(), target, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(Math.abs(result.value.customer.lat - 17.42)).toBeLessThan(0.001);
    expect(Math.abs(result.value.customer.lng - 78.42)).toBeLessThan(0.001);
  });

  it('warns when no upstream OLT can be traced', () => {
    const data = { ...smallNetwork(), cables: smallNetwork().cables.filter((c) => c.id !== 'FEED-01') };
    const result = provisionCustomer(data, target, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.notice?.tone).toBe('warning');
    expect(result.value.customer.oltId).toBe('');
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
