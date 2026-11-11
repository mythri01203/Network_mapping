import { describe, expect, it } from 'vitest';

import { roleCan } from '../src/domain/access';
import {
  boxDemand,
  capacityLines,
  capacityTotals,
  oltCardCapacity,
  planCounts,
  zonesOfLine,
} from '../src/domain/capacityPlanning';
import { capacityPlanningReports } from '../src/domain/capacityReports';
import { CAPACITY_SETTING_DEFS, resolveCapacitySettings } from '../src/domain/capacitySettings';
import { applyPatch, type NetworkData } from '../src/domain/command';
import { createScenario, deleteScenario, evaluateScenario, saveScenario } from '../src/domain/planningScenarios';
import { buildReports, reportToCsv } from '../src/domain/reports';
import { COLLECTION_NAMES } from '../src/model/collections';
import { type PlanningScenario, planningScenarioSchema } from '../src/model/planningSchemas';
import type { Duct, NetworkZone, PonPort, Rack, Site, Splitter } from '../src/model/types';
import { cable, customer, emptyNetwork, equipment, NOW, splitter } from './fixtures';

const pon = (id: string, n: number, extra: Partial<PonPort> = {}): PonPort => ({ id, portNumber: n, status: 'Available', connectedCustomersCount: 0, ...extra });

/** FAT-1 holds SPL-1 (1:8, ports 1-6 recorded); OLT-1 has two PON ports. */
function base(): NetworkData {
  const ports: Splitter['outputPorts'] = Array.from({ length: 6 }, (_, i) => ({ portNumber: i + 1, label: `${i + 1}`, status: 'Available' as const }));
  ports[2] = { portNumber: 3, label: '3', status: 'Reserved' };
  ports[3] = { portNumber: 4, label: '4', status: 'Faulty' };
  return {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', lat: 17.40, lng: 78.40, ponPorts: [pon('PON-1', 1, { maxOnu: 4 }), pon('PON-2', 2)] }),
      equipment({ id: 'FAT-1', type: 'FAT', lat: 17.41, lng: 78.41 }),
    ],
    splitters: [splitter({ id: 'SPL-1', terminalBoxId: 'FAT-1', outputPorts: ports })],
    customers: [
      customer({ id: 'C-1', status: 'Active', terminalBoxId: 'FAT-1', splitterId: 'SPL-1', splitterOutputPort: 1, oltId: 'OLT-1', ponPort: 'PON-1' }),
      customer({ id: 'C-2', status: 'Pending Installation', terminalBoxId: 'FAT-1', splitterId: 'SPL-1', splitterOutputPort: 2, oltId: 'OLT-1', ponPort: 'PON-1' }),
      customer({ id: 'C-3', status: 'Active', oltId: 'OLT-1', ponPort: 'PON-1' }),
    ],
  };
}

const line = (data: NetworkData, id: string, settings = resolveCapacitySettings()) => {
  const found = capacityLines(data, { settings }).find((l) => l.id === id);
  if (!found) throw new Error(`no line ${id}`);
  return found;
};

describe('capacity from records (Phase 18)', () => {
  it('splitter: built use, waiting customers, reserved, faulty, free and not recorded are all apart', () => {
    const l = line(base(), 'SPL-1');
    expect(l).toMatchObject({ plan: 'built', capacity: 8, used: 1, heldForPlanned: 1, reserved: 1, faulty: 1, free: 2, notRecorded: 2 });
    // 2 of 8 free: 75% taken or not recorded, under the 80% default.
    expect(l.state).toBe('ok');
    expect(line(base(), 'SPL-1', resolveCapacitySettings([{ id: 'capacity.splitter.nearlyFullPercent', value: 70 }])).state).toBe('nearly_full');
  });

  it('a splitter in a planned or awaiting-review box is planned capacity, never added to built totals', () => {
    const data = base();
    data.equipment.push(equipment({ id: 'FAT-2', type: 'FAT', status: 'Planned' }), equipment({ id: 'FAT-3', type: 'FAT', reviewStatus: 'awaiting_review' }), equipment({ id: 'FAT-4', type: 'FAT', reviewStatus: 'rejected' }));
    data.splitters.push(splitter({ id: 'SPL-2', terminalBoxId: 'FAT-2' }), splitter({ id: 'SPL-3', terminalBoxId: 'FAT-3' }), splitter({ id: 'SPL-4', terminalBoxId: 'FAT-4' }));
    const lines = capacityLines(data);
    expect(lines.find((l) => l.id === 'SPL-2')?.plan).toBe('planned');
    expect(lines.find((l) => l.id === 'SPL-3')?.plan).toBe('awaiting_review');
    expect(lines.find((l) => l.id === 'SPL-4')).toBeUndefined();
    const totals = capacityTotals(lines).filter((t) => t.kind === 'splitter');
    expect(totals.find((t) => t.built)?.capacity).toBe(8);
    expect(totals.find((t) => !t.built)?.capacity).toBe(16);
  });

  it('PON port: ONTs from records, waiting customers held apart, no limit means not known', () => {
    const data = base();
    const p1 = line(data, 'OLT-1 / PON-1');
    expect(p1).toMatchObject({ capacity: 4, used: 2, heldForPlanned: 1, free: 1 });
    const p2 = line(data, 'OLT-1 / PON-2');
    expect(p2.capacity).toBeUndefined();
    expect(p2.state).toBe('not_known');
    expect(p2.notes.join(' ')).toMatch(/ONU limit not recorded/);
  });

  it('ODF adapters: patched used, a fibre behind is still free, unknown state is not recorded', () => {
    const data = emptyNetwork();
    data.equipment.push(
      equipment({
        id: 'ODF-1',
        type: 'ODF',
        odfPanels: [
          {
            id: 'P1',
            label: 'A',
            ports: [
              { id: 'p1', number: 1, status: 'in_use', patch: { oltId: 'OLT-1', ponPortId: 'PON-1', patchedAt: '2026-11-01' } },
              { id: 'p2', number: 2, status: 'available', feederCableId: 'F-1', feederCore: 2 },
              { id: 'p3', number: 3, status: 'damaged' },
              { id: 'p4', number: 4, status: 'unknown' },
            ],
          },
        ],
      }),
      equipment({ id: 'ODF-2', type: 'ODF' }),
    );
    expect(line(data, 'ODF-1')).toMatchObject({ capacity: 4, used: 1, free: 1, faulty: 1, notRecorded: 1 });
    expect(line(data, 'ODF-2').state).toBe('not_known');
  });

  it('pole: cables from attachments, planned apart; no allowed number recorded means not known', () => {
    const data: NetworkData = {
      ...emptyNetwork(),
      equipment: [equipment({ id: 'PL-1', type: 'Electric Pole' }), equipment({ id: 'PL-2', type: 'Electric Pole', attachmentCapacity: 2, attachmentCapacitySource: 'BESCOM letter 12/2026' })],
      cables: [cable({ id: 'CB-1' }), cable({ id: 'CB-2', status: 'Planned' })],
      attachments: [
        { id: 'AT-1', cableId: 'CB-1', structureId: 'PL-1', status: 'built', basis: 'inspected', createdAt: '2026-11-01' },
        { id: 'AT-2', cableId: 'CB-1', structureId: 'PL-2', status: 'built', basis: 'inspected', createdAt: '2026-11-01' },
        { id: 'AT-3', cableId: 'CB-2', structureId: 'PL-2', status: 'planned', basis: 'inspected', createdAt: '2026-11-01' },
      ] as NetworkData['attachments'],
    };
    expect(line(data, 'PL-1')).toMatchObject({ used: 1, state: 'not_known' });
    expect(line(data, 'PL-2')).toMatchObject({ capacity: 2, used: 1, heldForPlanned: 1, free: 0, state: 'full' });
  });

  it('rack units: no height recorded means nothing is free; planned items held apart', () => {
    const site: Site = { id: 'S-1', name: 'CO', createdAt: '2026-11-01' } as Site;
    const racks: Rack[] = [{ id: 'R-1', siteId: 'S-1', name: 'Rack 1', heightUnits: 10 } as Rack, { id: 'R-2', siteId: 'S-1', name: 'Rack 2' } as Rack];
    const data: NetworkData = {
      ...emptyNetwork(),
      sites: [site],
      racks,
      equipment: [equipment({ id: 'OLT-9', type: 'OLT', rackId: 'R-1', rackUnit: 1, rackUnits: 2 }), equipment({ id: 'ODF-9', type: 'ODF', status: 'Planned', rackId: 'R-1', rackUnit: 5, rackUnits: 1 })],
    };
    expect(line(data, 'R-1')).toMatchObject({ capacity: 10, used: 2, heldForPlanned: 1, free: 7 });
    expect(line(data, 'R-2')).toMatchObject({ free: 0, state: 'not_known' });
  });

  it('duct: undescribed ways are not free; described ways counted, planned cables held', () => {
    const duct = (extra: Partial<Duct>): Duct => ({ id: 'D-1', name: 'D-1', coordinates: [[17.4, 78.4], [17.41, 78.41]], status: 'built', basis: 'inspected', cableIds: [], subducts: [], createdAt: '2026-11-01', ...extra }) as Duct;
    const data: NetworkData = { ...emptyNetwork(), cables: [cable({ id: 'CB-1' }), cable({ id: 'CB-2', status: 'Planned' })], ducts: [duct({ wayCount: 4 })] };
    expect(line(data, 'D-1')).toMatchObject({ capacity: 4, free: 0, notRecorded: 4 });
    data.ducts = [
      duct({
        subducts: [
          { id: 'W1', label: '1', cableIds: ['CB-1'] },
          { id: 'W2', label: '2', cableIds: ['CB-2'] },
          { id: 'W3', label: '3', cableIds: [], condition: 'blocked' },
          { id: 'W4', label: '4', cableIds: [] },
        ],
      }),
    ];
    expect(line(data, 'D-1')).toMatchObject({ capacity: 4, used: 1, heldForPlanned: 1, faulty: 1, free: 1 });
  });

  it('OLT chassis: cards with ports listed, ports not described, empty slots', () => {
    const data = base();
    data.equipment[0] = {
      ...data.equipment[0],
      chassis: { shelves: [{ id: 'SH', label: '0', slots: [{ id: 'S1', label: '1', card: { model: 'GPHF', kind: 'pon', portCount: 4, ponPortIds: ['PON-1', 'PON-2'] } }, { id: 'S2', label: '2' }] }] },
    };
    const rows = oltCardCapacity(data);
    const card = rows.find((r) => r.slot === '1')!;
    expect(card.line).toMatchObject({ capacity: 4, used: 1, free: 1, notRecorded: 2 });
    expect(card.ontLimit).toBeUndefined();
    expect(card.limitsMissing).toBe(1);
    expect(rows.find((r) => r.slot === '2')?.what).toMatch(/Empty slot/);
  });

  it('zones: by position inside a drawn boundary; a line crossing an edge belongs to none', () => {
    const zone: NetworkZone = { id: 'Z-1', name: 'Ward 1', areaCode: 'W1', coverageSqKm: 0, homePassed: 0, connectedCustomers: 0, feederCableCount: 0, fatCount: 0, penetrationRatePct: 0, status: 'Operational', boundaryCoords: [[17.405, 78.405], [17.405, 78.415], [17.415, 78.415], [17.415, 78.405]] };
    expect(zonesOfLine({ at: [17.41, 78.41] }, [zone])).toEqual([zone]);
    expect(zonesOfLine({ at: [17.40, 78.40] }, [zone])).toEqual([]);
    expect(zonesOfLine({ line: [[17.41, 78.41], [17.40, 78.40]] }, [zone])).toBe('crosses');
    const data = { ...base(), zones: [zone, { ...zone, id: 'Z-2', name: 'No edge', boundaryCoords: [] }] };
    const report = capacityPlanningReports(data).find((r) => r.id === 'capacity-zones')!;
    expect(report.rows.find((r) => r.zone === 'Ward 1 (W1)' && r.kind === 'Splitter outputs')).toMatchObject({ free: 2 });
    expect(report.notes.join(' ')).toMatch(/1 zone\(s\) have no boundary drawn/);
  });

  it('demand: waiting customers against free outputs per box', () => {
    const data = base();
    data.customers.push(customer({ id: 'C-4', status: 'Pending Installation', terminalBoxId: 'FAT-1', splitterId: '' }), customer({ id: 'C-5', status: 'Pending Installation', terminalBoxId: 'FAT-1', splitterId: '' }));
    let row = boxDemand(data).find((d) => d.boxId === 'FAT-1')!;
    expect(row).toMatchObject({ waiting: 3, holdingOutput: 1, needingOutput: 2, freeOutputs: 2, shortBy: 0, state: 'enough' });
    data.customers.push(customer({ id: 'C-6', status: 'Pending Installation', terminalBoxId: 'FAT-1', splitterId: '' }), customer({ id: 'C-7', status: 'Pending Installation' }));
    row = boxDemand(data).find((d) => d.boxId === 'FAT-1')!;
    expect(row).toMatchObject({ needingOutput: 3, shortBy: 1, state: 'short' });
    expect(boxDemand(data).find((d) => d.boxId === '')?.state).toBe('box_not_recorded');
  });

  it('planned against built counts each record by what it says', () => {
    const data = base();
    data.equipment.push(equipment({ id: 'FAT-9', type: 'FAT', status: 'Planned' }), equipment({ id: 'PL-9', type: 'Electric Pole', reviewStatus: 'awaiting_review' }));
    data.cables.push(cable({ id: 'CB-P', routeStatus: 'Proposed' }));
    const rows = planCounts(data);
    expect(rows[0].counts).toMatchObject({ built: 2, planned: 1, awaiting_review: 1 });
    expect(rows[1].counts.proposed).toBe(1);
    expect(rows.find((r) => r.what.startsWith('Customers'))?.counts).toMatchObject({ built: 2, planned: 1 });
  });
});

describe('expansion scenarios (Phase 18)', () => {
  const ctx = { now: NOW, actor: 'Planner' };

  it('is a registered collection with its own schema', () => {
    expect(COLLECTION_NAMES).toContain('planningScenarios');
    const bad = planningScenarioSchema.safeParse({ id: 'X', name: 'x', status: 'open', createdAt: 'now', items: [{ id: 'a', kind: 'customers', count: 3 }] });
    expect(bad.success).toBe(false);
  });

  it('planners may write scenarios; technicians, NOC and viewers may not', () => {
    expect(roleCan('office', 'create', 'planningScenarios')).toBe(true);
    expect(roleCan('office', 'delete', 'planningScenarios')).toBe(true);
    expect(roleCan('engineer', 'create', 'planningScenarios')).toBe(true);
    expect(roleCan('technician', 'create', 'planningScenarios')).toBe(false);
    expect(roleCan('noc', 'create', 'planningScenarios')).toBe(false);
    expect(roleCan('viewer', 'create', 'planningScenarios')).toBe(false);
  });

  it('works out "if built" without touching the network or its counts', () => {
    let data: NetworkData = { ...base(), ducts: [{ id: 'D-1', name: 'Duct 1', coordinates: [[17.4, 78.4], [17.41, 78.41]], status: 'built', basis: 'inspected', cableIds: [], createdAt: '2026-11-01', subducts: [{ id: 'W1', label: '1', cableIds: [], innerDiameterMm: 32, condition: 'clear' }] }] as Duct[] };
    const before = capacityLines(data);
    const created = createScenario(data, { name: 'Ward 1 growth' }, ctx);
    if (!created.ok) throw new Error(created.error.message);
    data = applyPatch(data, created.patch);
    const scenario: PlanningScenario = {
      ...created.value,
      items: [
        { id: 'i1', kind: 'customers', count: 3, splitterId: 'SPL-1' },
        { id: 'i2', kind: 'splitter', ratio: '1:8', boxId: 'FAT-1', feed: { kind: 'splitter', splitterId: 'SPL-1', output: 6 } },
        { id: 'i3', kind: 'customers', count: 6, splitterId: 'i2' },
        { id: 'i4', kind: 'cable', fiberCount: 24, ductId: 'D-1', outerDiameterMm: 14 },
        { id: 'i5', kind: 'cable', fiberCount: 12, ductId: 'D-1' },
        { id: 'i6', kind: 'customers', count: 1, splitterId: 'SPL-404' },
        { id: 'i7', kind: 'customers', count: 3, oltId: 'OLT-1', ponPortId: 'PON-1' },
      ],
    };
    const saved = saveScenario(data, scenario, ctx);
    if (!saved.ok) throw new Error(saved.error.message);
    data = applyPatch(data, saved.patch);
    // Production figures are the same with the scenario stored.
    expect(capacityLines(data)).toEqual(before);
    const result = evaluateScenario(data, saved.value);
    const of = (id: string) => result.lines.filter((l) => l.itemId === id);
    expect(of('i1')[0]).toMatchObject({ state: 'short', shortBy: 1 });
    // The fibre above SPL-1 is not recorded, so its PON port is not guessed from the customers.
    expect(of('i1')[1]).toMatchObject({ element: 'PON port', state: 'not_known' });
    // PON-1 has 3 ONTs on record (limit 4): 3 more straight on the port is over by 2.
    expect(of('i7')[0]).toMatchObject({ state: 'short', shortBy: 2, ifBuilt: '6 of 4 ONTs: over by 2' });
    // Output 6 is free as recorded; the new splitter then takes 6 of its own 8 outputs.
    expect(of('i2')[0].state).toBe('fits');
    expect(of('i3')[0]).toMatchObject({ state: 'fits', ifBuilt: '2 free' });
    expect(of('i4')[0]).toMatchObject({ element: 'Duct Duct 1' });
    expect(of('i4')[0].ifBuilt).toMatch(/19.1% full/);
    // The one way is taken by i4, and i5 has no diameter: not known, never assumed.
    expect(of('i5')[0].state).toBe('not_known');
    expect(of('i6')[0].state).toBe('broken_ref');
    expect(result.worst).toBe('broken_ref');
    const removed = deleteScenario(data, saved.value.id);
    expect(removed.ok).toBe(true);
  });

  it('refuses a scenario with no name, and a line with two places', () => {
    expect(createScenario(emptyNetwork(), { name: '  ' }, ctx).ok).toBe(false);
    const bad = createScenario(emptyNetwork(), { name: 'x', items: [{ id: 'a', kind: 'customers', count: 2, splitterId: 'S', boxId: 'B' }] }, ctx);
    expect(bad.ok).toBe(false);
  });
});

describe('capacity settings and reports (Phase 18)', () => {
  it('every level has a source; bad values are ignored', () => {
    expect(CAPACITY_SETTING_DEFS.every((d) => d.source.length > 20)).toBe(true);
    expect(resolveCapacitySettings([{ id: 'capacity.pole.nearlyFullPercent', value: 500 }]).nearlyFull.pole).toBe(0.8);
    expect(resolveCapacitySettings([{ id: 'capacity.pole.nearlyFullPercent', value: 60 }]).nearlyFull.pole).toBe(0.6);
  });

  it('the new reports are in buildReports and export through the safe CSV writer', () => {
    const reports = buildReports({ ...base(), faults: [], workOrders: [], spans: [], ducts: [], slackLoops: [], onts: [], alarms: [], permissions: [] }, {}, '2026-11-11');
    const ids = reports.map((r) => r.id);
    for (const id of ['capacity-use', 'olt-chassis-capacity', 'capacity-zones', 'capacity-demand', 'planned-vs-built', 'planned-vs-built-capacity', 'capacity-scenarios']) expect(ids).toContain(id);
    const use = reports.find((r) => r.id === 'capacity-use')!;
    const csv = reportToCsv(use);
    expect(csv.split('\r\n')[0]).toContain('Held for planned');
    expect(use.rows.find((r) => r.id === 'OLT-1 / PON-2')?.free).toBe('Not known');
  });
});
