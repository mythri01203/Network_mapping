import { describe, expect, it } from 'vitest';

import { generateLogicalPorts, setPortUsage, summarizePorts } from '../src/domain/ports';
import { equipment } from './fixtures';

describe('generateLogicalPorts', () => {
  it('derives statuses from the recorded counts without inventing damage', () => {
    const fat = equipment({ id: 'FAT-01', type: 'FAT', totalPorts: 8, usedPorts: 3, availablePorts: 4 });
    const ports = generateLogicalPorts(fat);
    expect(ports).toHaveLength(8);
    expect(summarizePorts(ports)).toMatchObject({ used: 3, available: 4, reserved: 1, damaged: 0 });
    expect(ports[0]).toMatchObject({ id: 'FAT-01-P001', portType: 'Terminal', status: 'Used' });
  });

  it('builds OLT ports from PON ports', () => {
    const olt = equipment({
      id: 'OLT-01',
      type: 'OLT',
      ponPorts: [
        {
          id: 'PON-1',
          portNumber: 1,
          technology: 'GPON',
          status: 'Active',
          connectedCustomersCount: 10,
          txPowerDbm: 3,
          rxPowerDbm: -20,
        },
        {
          id: 'PON-2',
          portNumber: 2,
          technology: 'GPON',
          status: 'Faulty',
          connectedCustomersCount: 0,
          txPowerDbm: 3,
          rxPowerDbm: -20,
        },
      ],
    });
    const ports = generateLogicalPorts(olt);
    expect(ports.map((p) => p.status)).toEqual(['Used', 'Damaged']);
  });

  it('returns nothing for equipment without ports', () => {
    expect(generateLogicalPorts(equipment({ id: 'POLE-01', type: 'Telecom Pole' }))).toEqual([]);
  });
});

describe('setPortUsage', () => {
  const fat = equipment({ id: 'FAT-02', type: 'FAT', totalPorts: 4, usedPorts: 1, availablePorts: 3 });

  it('falls back to the first available port when the requested one is taken', () => {
    const updated = setPortUsage(fat, 1, true, 'CUST-1');
    expect(updated.usedPorts).toBe(2);
    expect(updated.availablePorts).toBe(2);
    expect(updated.logicalPorts?.find((p) => p.customerId === 'CUST-1')?.portNumber).toBe(2);
  });

  it('releases a port by customer id', () => {
    const assigned = setPortUsage(fat, 3, true, 'CUST-9');
    const released = setPortUsage(assigned, undefined, false, 'CUST-9');
    expect(released.usedPorts).toBe(1);
    expect(released.logicalPorts?.some((p) => p.customerId === 'CUST-9')).toBe(false);
  });
});
