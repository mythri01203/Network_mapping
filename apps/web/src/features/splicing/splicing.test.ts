import { describe, expect, it } from 'vitest';

import { type Cable, DEFAULT_COLOR_SCHEMES, type JointClosure, type SpliceRecord } from '@fibergis/shared';

import { layoutSpliceDiagram, shapeOfStatus } from './spliceDiagramLayout';
import { buildSpliceReport } from './spliceReport';
import { historyWords, lossWords } from './spliceWords';

const cable = (id: string, extra: Partial<Cable> = {}): Cable => ({
  id,
  name: id,
  type: 'Distribution Fiber',
  fiberCount: 12,
  lengthMeters: 100,
  installationType: 'Aerial',
  owner: '',
  installationDate: '',
  status: 'Active',
  coordinates: [],
  cores: [],
  cableCategory: 'Fiber',
  ...extra,
});

const splice = (id: string, extra: Partial<SpliceRecord> = {}): SpliceRecord => ({
  id,
  inputCableId: 'IN',
  inputCableName: 'IN',
  inputCore: 1,
  outputCableId: 'OUT',
  outputCableName: 'OUT',
  outputCore: 1,
  status: 'Spliced',
  technician: '',
  date: '',
  ...extra,
});

const closure = (extra: Partial<JointClosure> = {}): JointClosure => ({
  id: 'JC-1',
  name: 'Joint 1',
  closureType: 'Horizontal In-line',
  lat: 0,
  lng: 0,
  area: '',
  entryPortsCount: 0,
  exitPortsCount: 0,
  installationDate: '',
  technician: '',
  splices: [],
  images: [],
  trays: [{ id: 'T1', label: 'Tray 1', capacity: 12 }],
  ...extra,
});

const cables = [cable('IN', { colorScheme: 'tia-598', fibersPerTube: 12, tubeCount: 1 }), cable('OUT')];

describe('splice picture', () => {
  it('puts the OLT side left and the customer side right, with colour only for a known scheme', () => {
    const d = layoutSpliceDiagram(closure({ splices: [splice('S1', { inputCore: 2, outputCore: 5 })] }), cables, DEFAULT_COLOR_SCHEMES);
    expect(d.left.map((f) => [f.cableId, f.core])).toEqual([['IN', 2]]);
    expect(d.right.map((f) => [f.cableId, f.core])).toEqual([['OUT', 5]]);
    expect(d.left[0].colorName).toBe('Orange');
    // OUT has no scheme recorded: no colour, so the picture shows the number.
    expect(d.right[0].colorHex).toBeUndefined();
    expect(d.links).toHaveLength(1);
    expect(d.links[0].fromY).toBe(d.left[0].y);
    expect(d.links[0].toY).toBe(d.right[0].y);
  });

  it('shows state by shape, leaves out splices out of service or entered by mistake, and draws pigtails as connectors', () => {
    const d = layoutSpliceDiagram(
      closure({
        splices: [
          splice('S1', { status: 'Pending' }),
          splice('S2', { inputCore: 2, outputCore: 2, status: 'Failed' }),
          splice('S3', { inputCore: 3, outputCore: 3, retiredAt: '2026-11-01T00:00:00Z', enteredInError: true }),
        ],
        terminations: [{ id: 'P1', cableId: 'IN', cableName: 'IN', core: 9, technician: '', date: '' }],
      }),
      cables,
      DEFAULT_COLOR_SCHEMES,
    );
    expect(d.links.map((l) => [l.id, l.shape])).toEqual([
      ['S1', 'planned'],
      ['S2', 'broken'],
      ['P1', 'solid'],
    ]);
    expect(d.connectors).toEqual([expect.objectContaining({ id: 'P1', text: 'Connector ?' })]);
    expect(shapeOfStatus('Tested')).toBe('tested');
  });

  it('is empty when nothing is in service on the chosen tray', () => {
    expect(layoutSpliceDiagram(closure({ splices: [splice('S1', { trayId: 'T1' })] }), cables, DEFAULT_COLOR_SCHEMES, 'none').empty).toBe(true);
  });
});

describe('splice report', () => {
  it('writes "Not recorded" for every missing value and keeps history with who, when and why', () => {
    const report = buildSpliceReport(
      closure({
        splices: [
          splice('S1', { trayId: 'T1', position: 3, spliceLossDb: 0.04, lossSource: 'device_reported', lossMeter: 'Splicer 9', reportRef: 'JOB-1' }),
          splice('S2', { inputCore: 4, outputCore: 4, retiredAt: '2026-11-02T10:00:00Z', retiredBy: 'Asha', retiredReason: 'Wrong fiber', enteredInError: true }),
        ],
      }),
      cables,
      DEFAULT_COLOR_SCHEMES,
      new Date('2026-11-10T08:00:00Z'),
    );
    const facts = Object.fromEntries(report.facts);
    expect(facts.Position).toBe('Not recorded');
    expect(facts['Installed by']).toBe('Not recorded');
    const [trays, splices, pigtails, history] = report.tables;
    expect(trays.rows).toEqual([['Tray 1', '12', '1', '']]);
    expect(splices.rows[0]).toEqual(expect.arrayContaining(['Tray 1, pos. 3', '0.04 dB (OTDR or splicer reading)', 'Splicer 9', 'Not recorded', 'JOB-1', 'Not recorded, Not recorded']));
    expect(splices.rows[0][2]).toBe('OUT F1 (colour not known)');
    expect(pigtails.rows).toEqual([]);
    expect(history.rows[0][3]).toBe('Entered by mistake, struck out 2026-11-02 by Asha. Reason: Wrong fiber');
    expect(report.footer).toMatch(/2026-11-10 08:00 UTC/);
  });

  it('never shows a default loss', () => {
    expect(lossWords({})).toBe('Loss not recorded');
    expect(lossWords({ spliceLossDb: 0.1 })).toBe('0.1 dB (origin not recorded)');
    expect(historyWords({ retiredAt: '2026-11-01T00:00:00Z' })).toBe('Out of service 2026-11-01');
  });
});
