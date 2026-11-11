import { describe, expect, it } from 'vitest';

import { checkChangeAccess } from '../src/domain/access';
import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { permissionsForChange } from '../src/domain/permissions';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import {
  checkChangeSetSitesRacks,
  createRack,
  createSite,
  deleteRack,
  deleteSite,
  describeUnitRuns,
  findSiteRackProblems,
  placeInRack,
  rackElevation,
  updateRack,
  whereItSits,
} from '../src/domain/sitesRacks';
import { COLLECTION_NAMES } from '../src/model/collections';
import { createSampleNetwork } from '../src/sample';
import { emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm };
}

function setup() {
  let data: NetworkData = {
    ...emptyNetwork(),
    sites: [],
    racks: [],
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office' }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'SW-1', type: 'ODF', category: 'Central Office', site: 'CO-1 old text', rackNumber: 'R3' }),
    ],
  };
  const step = <T>(r: CommandResult<T>) => {
    const done = ok(r);
    data = applyPatch(data, done.patch);
    return done.value;
  };
  const site = step(createSite(data, { name: 'Main exchange', kind: 'Exchange' }, ctx));
  const rack = step(createRack(data, { siteId: site.id, name: 'Rack 1', heightUnits: 12 }, ctx));
  return { get data() { return data; }, site, rack, step };
}

describe('sites and racks collections (Phase 9)', () => {
  it('are registered, empty in the sample and nothing is invented', () => {
    expect(COLLECTION_NAMES).toEqual(expect.arrayContaining(['sites', 'racks']));
    const sample = createSampleNetwork();
    expect(sample.sites).toEqual([]);
    expect(sample.racks).toEqual([]);
    const s = setup();
    expect(s.site).not.toHaveProperty('lat');
    expect(s.site).toMatchObject({ name: 'Main exchange', kind: 'Exchange', createdBy: 'Test Engineer' });
    expect(ok(createRack(s.data, { siteId: s.site.id, name: 'Rack 2' }, ctx)).value).not.toHaveProperty('heightUnits');
  });

  it('refuses a duplicate name and a rack with no site', () => {
    const s = setup();
    expect(createSite(s.data, { name: 'main EXCHANGE' }, ctx).ok).toBe(false);
    expect(createRack(s.data, { siteId: 'SITE-GONE', name: 'R' }, ctx).ok).toBe(false);
    expect(createRack(s.data, { siteId: s.site.id, name: 'rack 1' }, ctx).ok).toBe(false);
    expect(createRack(s.data, { siteId: s.site.id, name: 'Rack 9', heightUnits: 0 }, ctx).ok).toBe(false);
  });
});

describe('placing items in a rack', () => {
  it('records site, rack and units; the rack names its site', () => {
    const s = setup();
    const placed = s.step(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnit: 3, rackUnits: 2 }, ctx));
    expect(placed).toMatchObject({ siteId: s.site.id, rackId: s.rack.id, rackUnit: 3, rackUnits: 2 });
    expect(whereItSits(s.data, placed)).toMatchObject({ siteText: 'Main exchange', rackText: 'Rack 1', unitText: 'Units 3 to 4', fromFreeText: false });
    const cleared = s.step(placeInRack(s.data, 'OLT-1', null, ctx));
    expect(cleared).not.toHaveProperty('rackId');
    expect(cleared).not.toHaveProperty('siteId');
  });

  it('shows the older free text only when no record is linked', () => {
    const s = setup();
    const sw = s.data.equipment.find((e) => e.id === 'SW-1')!;
    expect(whereItSits(s.data, sw)).toMatchObject({ siteText: 'CO-1 old text (as written)', rackText: 'R3 (as written)', unitText: 'Not recorded', fromFreeText: true });
    expect(whereItSits(s.data, s.data.equipment.find((e) => e.id === 'ODF-1')!)).toMatchObject({ siteText: 'Not recorded', rackText: 'Not recorded' });
  });

  it('refuses an item past the top of the rack and warns about two in one unit', () => {
    const s = setup();
    expect(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnit: 11, rackUnits: 3 }, ctx).ok).toBe(false);
    expect(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnits: 3 }, ctx).ok).toBe(false);
    expect(placeInRack(s.data, 'OLT-1', { siteId: s.site.id, rackUnit: 3 }, ctx).ok).toBe(false);
    s.step(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnit: 3, rackUnits: 2 }, ctx));
    const overlap = ok(placeInRack(s.data, 'ODF-1', { rackId: s.rack.id, rackUnit: 4, rackUnits: 1 }, ctx));
    expect(overlap.confirm).toMatch(/both recorded in rack Rack 1 at unit 4/);
    // Lowering the rack below what sits in it is refused.
    expect(updateRack(s.data, s.rack.id, { siteId: s.site.id, name: 'Rack 1', heightUnits: 3 }, ctx).ok).toBe(false);
  });

  it('moving a rack to another site takes its items, after asking', () => {
    const s = setup();
    s.step(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnit: 1 }, ctx));
    const other = s.step(createSite(s.data, { name: 'Hub room' }, ctx));
    const moved = ok(updateRack(s.data, s.rack.id, { siteId: other.id, name: 'Rack 1', heightUnits: 12 }, ctx));
    expect(moved.confirm).toMatch(/1 item\(s\) recorded in it move with it/);
    expect(moved.patch.equipment!.find((e) => e.id === 'OLT-1')!.siteId).toBe(other.id);
  });
});

describe('deleting a site or rack in use', () => {
  it('is refused by the command and by the server rule', () => {
    const s = setup();
    s.step(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnit: 1 }, ctx));
    const r = deleteRack(s.data, s.rack.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/still holds 1 item/);
    expect(deleteSite(s.data, s.site.id).ok).toBe(false);
    const current = { sites: s.data.sites!, racks: s.data.racks!, equipment: s.data.equipment };
    expect(checkChangeSetSitesRacks(current, { deletes: { racks: [s.rack.id] } }).map((p) => p.code)).toEqual(['equipment_rack_missing']);
    expect(checkChangeSetSitesRacks(current, { deletes: { sites: [s.site.id] } }).map((p) => p.code)).toEqual(expect.arrayContaining(['rack_site_missing', 'equipment_site_missing']));
    // Empty, it goes.
    s.step(placeInRack(s.data, 'OLT-1', null, ctx));
    expect(ok(deleteRack(s.data, s.rack.id)).confirm).toMatch(/Delete rack Rack 1/);
  });

  it('an item in a rack at another site than it names is broken data', () => {
    const s = setup();
    const other = s.step(createSite(s.data, { name: 'Hub room' }, ctx));
    const bad = { ...s.data.equipment[0], siteId: other.id, rackId: s.rack.id };
    expect(findSiteRackProblems({ sites: s.data.sites!, racks: s.data.racks!, equipment: [bad] }).map((p) => p.code)).toEqual(['equipment_rack_other_site']);
  });

  it('a restore with broken site links is refused; older backups without sites pass', () => {
    const sample = createSampleNetwork();
    expect(checkRestoredNetwork(sample).counts.sites).toBe(0);
    const broken = { ...sample, equipment: [{ ...sample.equipment[0], rackId: 'RACK-GONE' }, ...sample.equipment.slice(1)] };
    expect(checkRestoredNetwork(broken).counts.sites).toBe(1);
  });
});

describe('rack elevation', () => {
  it('shows what fills each unit and which are free, from records only', () => {
    const s = setup();
    s.step(placeInRack(s.data, 'OLT-1', { rackId: s.rack.id, rackUnit: 3, rackUnits: 2 }, ctx));
    s.step(placeInRack(s.data, 'ODF-1', { rackId: s.rack.id, rackUnit: 8 }, ctx));
    s.step(placeInRack(s.data, 'SW-1', { rackId: s.rack.id }, ctx));
    const view = rackElevation(s.data.racks![0], s.data.equipment);
    expect(view.slots.map((x) => [x.equipment.id, x.from, x.to, x.heightKnown])).toEqual([
      ['OLT-1', 3, 4, true],
      ['ODF-1', 8, 8, false],
    ]);
    expect(view.unplaced.map((e) => e.id)).toEqual(['SW-1']);
    expect(view.heightUnknown).toBe(1);
    expect(describeUnitRuns(view.freeUnits!)).toBe('1 to 2, 5 to 7, 9 to 12');
    expect(view.numberingRecorded).toBe(false);
  });

  it('calls nothing free when the rack height is not recorded', () => {
    const s = setup();
    const rack = s.step(createRack(s.data, { siteId: s.site.id, name: 'Wall frame' }, ctx));
    s.step(placeInRack(s.data, 'OLT-1', { rackId: rack.id, rackUnit: 30, rackUnits: 2 }, ctx));
    const view = rackElevation(rack, s.data.equipment);
    expect(view.height).toBeUndefined();
    expect(view.freeUnits).toBeUndefined();
    expect(view.slots).toHaveLength(1);
  });
});

describe('who may change sites and racks', () => {
  it('engineers and planners may add; technicians and viewers may not; moving a rack is a link change', () => {
    const s = setup();
    const site = s.data.sites![0];
    const lookup = () => undefined;
    const as = (role: 'engineer' | 'office' | 'technician' | 'viewer' | 'noc') => ({ id: role, username: role, displayName: role, role });
    expect(checkChangeAccess(as('engineer'), { upserts: { sites: [site] } }, lookup)).toEqual([]);
    expect(checkChangeAccess(as('office'), { upserts: { sites: [site] } }, lookup)).toEqual([]);
    expect(checkChangeAccess(as('technician'), { upserts: { sites: [site] } }, lookup)).toHaveLength(1);
    expect(checkChangeAccess(as('noc'), { upserts: { racks: [s.rack] } }, lookup)).toHaveLength(1);
    expect(checkChangeAccess(as('viewer'), { upserts: { racks: [s.rack] } }, lookup)).toHaveLength(1);
    expect(checkChangeAccess(as('office'), { deletes: { racks: [s.rack.id] } }, () => ({ record: s.rack as unknown as Record<string, unknown> }))).toHaveLength(1);
    expect(permissionsForChange('racks', s.rack as unknown as Record<string, unknown>, { ...s.rack, siteId: 'SITE-2' })).toEqual(expect.arrayContaining(['edit', 'connect', 'disconnect']));
  });
});
