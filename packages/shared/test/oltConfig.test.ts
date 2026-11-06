import { describe, expect, it } from 'vitest';
import {
  buildOltLogicalPorts,
  generateOltDescription,
  validateOltConfig,
} from '../src/domain/oltConfig';

describe('oltConfig', () => {
  it('generates a complete formatted description with all modules', () => {
    const desc = generateOltDescription({
      name: 'OLT-HYD-001',
      id: 'OLT-01',
      technology: 'GPON',
      manufacturer: 'Syrotech',
      model: 'GPON 8-Port OLT',
      area: 'Hitec City',
      street: 'Main Blvd',
      totalPorts: 8,
      portColorMap: {
        'PON-01': 'Blue',
        'PON-02': 'Orange',
        'PON-03': 'Green',
        'PON-04': 'Brown',
      },
      splitters: [
        {
          id: 'SPL-001',
          ratio: '1:8',
          inPort: 'IN-01',
          parentPonPort: 'PON-01',
          outPortsCount: 8,
        },
      ],
      cables: [
        {
          id: 'FIBER-001',
          name: 'Main Feeder 01',
          type: 'Single Mode Feeder Fiber',
          coreCount: 12,
          colorHex: '#0284c7',
          ponPort: 'PON-01',
          lengthMeters: 450,
        },
      ],
    });

    expect(desc).toContain('OLT Name: OLT-HYD-001');
    expect(desc).toContain('Technology: GPON');
    expect(desc).toContain('Manufacturer: Syrotech');
    expect(desc).toContain('Model: GPON 8-Port OLT');
    expect(desc).toContain('Total PON Ports: 8');
    expect(desc).toContain('PON-01 to PON-08');
    expect(desc).toContain('PON-01: Blue');
    expect(desc).toContain('Splitter ID: SPL-001');
    expect(desc).toContain('Split Ratio: 1:8');
    expect(desc).toContain('Cable ID: FIBER-001');
  });

  it('builds logical ports with assigned colors and codes', () => {
    const ports = buildOltLogicalPorts('OLT-99', 4, 'EPON', {
      'PON-01': 'Blue',
      'PON-02': 'Orange',
    });

    expect(ports).toHaveLength(4);
    expect(ports[0].id).toBe('OLT-99-PON-01');
    expect(ports[0].slotCardPort).toBe('PON-01');
    expect(ports[0].technology).toBe('EPON');
    expect(ports[0].color).toBe('Blue');
    expect(ports[1].color).toBe('Orange');
  });

  it('validates OLT configuration requirements', () => {
    const invalid = validateOltConfig({ totalPorts: 0 } as any);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);

    const valid = validateOltConfig({
      technology: 'GPON',
      totalPorts: 8,
      oltConfig: { technology: 'GPON', ponPortCount: 8 },
    } as any);
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);
  });
});

