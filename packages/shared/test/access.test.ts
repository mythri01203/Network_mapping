import { describe, expect, it } from 'vitest';

import { type Account, checkChangeAccess, describeAccessProblems, roleCan, roleMay, type StoredLookup } from '../src/domain/access';
import { newRecordId, nextNumberedName } from '../src/domain/ids';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import type { ChangeSet } from '../src/model/api';
import type { CollectionName } from '../src/model/collections';
import { createSampleNetwork } from '../src/sample';
import { customer, equipment, workOrder } from './fixtures';

const account = (role: Account['role'], displayName = 'Ravi Kumar', id = 'U1'): Account => ({ id, username: 'ravi', displayName, role });

/** A store of records with who first stored each. */
const storeOf = (records: Partial<Record<CollectionName, { id: string }[]>>, createdBy: Record<string, string | null> = {}): StoredLookup => {
  const map = new Map<string, { id: string }>();
  for (const [collection, list] of Object.entries(records)) for (const r of list ?? []) map.set(`${collection}/${r.id}`, r);
  return (collection, id) => {
    const record = map.get(`${collection}/${id}`);
    return record ? { record: record as unknown as Record<string, unknown>, createdBy: createdBy[`${collection}/${id}`] ?? null } : undefined;
  };
};

const pole = equipment({ id: 'POLE-1', type: 'Telecom Pole' });
const capturedPole = { ...equipment({ id: 'POLE-K7Q2M9XP4A', type: 'Telecom Pole' }), captureSource: 'field_capture' as const };

describe('roleCan and roleMay', () => {
  it('lets admins and engineers do everything with records, viewers nothing', () => {
    expect(roleCan('engineer', 'delete', 'equipment')).toBe(true);
    expect(roleCan('viewer', 'update', 'customers')).toBe(false);
    expect(roleCan('office', 'delete', 'cables')).toBe(false);
    expect(roleCan('office', 'update', 'cables')).toBe(true);
    expect(roleCan('office', 'update', 'settings')).toBe(false);
    expect(roleCan('technician', 'delete', 'cables')).toBe(false);
  });

  it('keeps reset, restore, backup and users with the administrator', () => {
    expect(roleMay('admin', 'restore')).toBe(true);
    expect(roleMay('engineer', 'restore')).toBe(false);
    expect(roleMay('engineer', 'change_settings')).toBe(true);
    expect(roleMay('office', 'manage_users')).toBe(false);
    expect(roleMay('viewer', 'upload_photo')).toBe(false);
    expect(roleMay('technician', 'upload_photo')).toBe(true);
  });

  it('never lets anyone change or delete an audit entry', () => {
    expect(roleCan('admin', 'delete', 'auditLogs')).toBe(false);
    expect(roleCan('admin', 'create', 'auditLogs')).toBe(true);
  });
});

describe('checkChangeAccess', () => {
  it('refuses a viewer any change, in plain words', () => {
    const problems = checkChangeAccess(account('viewer'), { upserts: { equipment: [pole] } }, storeOf({}));
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/can only look/);
  });

  it('refuses a technician deleting a network record with a next action', () => {
    const changes: ChangeSet = { deletes: { cables: ['C-1'] } };
    const problems = checkChangeAccess(account('technician'), changes, storeOf({ cables: [{ id: 'C-1' }] }));
    expect(problems[0]).toMatchObject({ collection: 'cables', id: 'C-1', action: 'delete' });
    expect(describeAccessProblems(problems)).toMatch(/Ask the office or an engineer/);
  });

  it('lets a technician add a field capture but not a pole from the engineer screens', () => {
    const ok = checkChangeAccess(account('technician'), { upserts: { equipment: [capturedPole] } }, storeOf({}));
    expect(ok).toEqual([]);
    const refused = checkChangeAccess(account('technician'), { upserts: { equipment: [pole] } }, storeOf({}));
    expect(refused[0].message).toMatch(/Field capture/);
  });

  it('lets a technician undo their own capture, not somebody else’s', () => {
    const lookup = storeOf({ equipment: [capturedPole] }, { 'equipment/POLE-K7Q2M9XP4A': 'U1' });
    expect(checkChangeAccess(account('technician'), { deletes: { equipment: [capturedPole.id] } }, lookup)).toEqual([]);
    const other = storeOf({ equipment: [capturedPole] }, { 'equipment/POLE-K7Q2M9XP4A': 'U2' });
    expect(checkChangeAccess(account('technician'), { deletes: { equipment: [capturedPole.id] } }, other)).toHaveLength(1);
  });

  it('lets a technician update their own job, not another person’s, and not close it', () => {
    const mine = workOrder({ id: 'WO-1', technicianName: 'Ravi Kumar', status: 'Assigned' });
    const theirs = workOrder({ id: 'WO-2', technicianName: 'Asha', status: 'Assigned' });
    const lookup = storeOf({ workOrders: [mine, theirs] });
    const tech = account('technician');
    expect(checkChangeAccess(tech, { upserts: { workOrders: [{ ...mine, status: 'In Progress' }] } }, lookup)).toEqual([]);
    expect(checkChangeAccess(tech, { upserts: { workOrders: [{ ...theirs, status: 'In Progress' }] } }, lookup)[0].message).toMatch(/not yours/);
    expect(checkChangeAccess(tech, { upserts: { workOrders: [{ ...mine, status: 'Closed' }] } }, lookup)[0].message).toMatch(/office closes/);
    expect(checkChangeAccess(tech, { upserts: { workOrders: [{ ...mine, technicianName: 'Asha' }] } }, lookup)[0].message).toMatch(/Only the office/);
  });

  it('lets a technician record a light reading on a customer, nothing else', () => {
    const c = customer({ id: 'CUST-1' });
    const lookup = storeOf({ customers: [c] });
    const tech = account('technician');
    expect(checkChangeAccess(tech, { upserts: { customers: [{ ...c, rxOpticalPowerDbm: -19.5, rxSource: 'field_measured' }] } }, lookup)).toEqual([]);
    expect(checkChangeAccess(tech, { upserts: { customers: [{ ...c, mobile: '9000000000' }] } }, lookup)).toHaveLength(1);
  });

  it('allows an upsert that changes nothing and ignores audit entries', () => {
    const lookup = storeOf({ equipment: [pole] });
    expect(checkChangeAccess(account('viewer'), { upserts: { equipment: [pole] } }, lookup)).toEqual([]);
    expect(checkChangeAccess(account('technician'), { deletes: { auditLogs: ['LOG-1'] } }, lookup)).toEqual([]);
  });

  it('refuses office staff deleting the network but lets them change it', () => {
    const lookup = storeOf({ equipment: [pole] });
    expect(checkChangeAccess(account('office'), { deletes: { equipment: ['POLE-1'] } }, lookup)).toHaveLength(1);
    expect(checkChangeAccess(account('office'), { upserts: { equipment: [{ ...pole, name: 'Pole by temple' }] } }, lookup)).toEqual([]);
  });

  it('leaves ownership to the server when the browser cannot know it', () => {
    const browser: StoredLookup = (collection, id) => (collection === 'equipment' && id === capturedPole.id ? { record: capturedPole as unknown as Record<string, unknown> } : undefined);
    expect(checkChangeAccess(account('technician'), { deletes: { equipment: [capturedPole.id] } }, browser)).toEqual([]);
  });
});

describe('random record ids (Phase 9)', () => {
  it('makes a prefixed 10-character code that differs each time', () => {
    const a = newRecordId('POLE-');
    const b = newRecordId('POLE');
    expect(a).toMatch(/^POLE-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(b).toMatch(/^POLE-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(a).not.toBe(b);
  });

  it('numbers names after the highest existing name or older id', () => {
    expect(nextNumberedName('FAT-', [{ id: 'FAT-07' }, { id: 'FAT-K7Q2M9XP4A', name: 'FAT-09' }])).toBe('FAT-10');
    expect(nextNumberedName('FAT-', [])).toBe('FAT-01');
  });
});

describe('checkRestoredNetwork', () => {
  it('passes the bundled sample network', () => {
    const check = checkRestoredNetwork(createSampleNetwork());
    expect(check.problems.filter((p) => p.rule === 'links')).toEqual([]);
  });

  it('names broken links in a backup, by id', () => {
    const data = createSampleNetwork();
    data.spans = [{ id: 'SPN-X', name: 'Span X', fromStructureId: 'POLE-MISSING', toStructureId: 'POLE-ALSO-MISSING', status: 'built', basis: 'field_sequence' } as never];
    const check = checkRestoredNetwork(data);
    expect(check.counts.links).toBeGreaterThan(0);
    expect(check.problems[0].refs).toContain('SPN-X');
  });
});
