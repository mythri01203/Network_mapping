import { describe, expect, it } from 'vitest';

import { type Account, ACCOUNT_ROLE_LABELS, ACCOUNT_ROLES, AUDIT_ROLE_FOR, checkChangeAccess, normalizeAccountRole, roleCan, roleMay, type StoredLookup } from '../src/domain/access';
import { type ChangeRequest, changeRequestStepProblem, mayReadChangeRequest, summarizeChangeSet, withoutAuditEntries } from '../src/domain/changeRequests';
import {
  attributeValuesProblem,
  listChangeProblem,
  listSettingId,
  nameRuleWarning,
  nextNameFromRule,
  parseAttributeSetting,
  pickerEntries,
  resolveEditableList,
  ruleSettingProblem,
} from '../src/domain/editableLists';
import { PERMISSION_ACTIONS, permissionsForChange, ROLE_ACTIONS, roleHasAction } from '../src/domain/permissions';
import { diffRecords, sameRecord } from '../src/domain/recordHistory';
import type { CollectionName } from '../src/model/collections';
import { cable, equipment } from './fixtures';

const account = (role: Account['role'], id = 'U1'): Account => ({ id, username: 'u', displayName: 'Ravi Kumar', role });
const storeOf = (records: Partial<Record<CollectionName, { id: string }[]>>, createdBy: Record<string, string> = {}): StoredLookup => (collection, id) => {
  const record = records[collection]?.find((r) => r.id === id);
  return record ? { record: record as unknown as Record<string, unknown>, createdBy: createdBy[`${collection}/${id}`] ?? null } : undefined;
};

describe('eight roles, kept compatible with the five older ones', () => {
  it('keeps the stored names and gives every role a label, duties and an audit role', () => {
    expect(ACCOUNT_ROLES).toEqual(['admin', 'network_admin', 'engineer', 'office', 'technician', 'noc', 'supervisor', 'viewer']);
    expect(ACCOUNT_ROLE_LABELS.admin).toBe('Super Admin');
    expect(ACCOUNT_ROLE_LABELS.office).toBe('Network Planner');
    for (const role of ACCOUNT_ROLES) expect(AUDIT_ROLE_FOR[role]).toBeTruthy();
  });

  it('reads old and new spellings as the stored name, and unknown text as nothing', () => {
    expect(normalizeAccountRole('Super Admin')).toBe('admin');
    expect(normalizeAccountRole('GIS Engineer')).toBe('engineer');
    expect(normalizeAccountRole('network-planner')).toBe('office');
    expect(normalizeAccountRole('Field Technician')).toBe('technician');
    expect(normalizeAccountRole('NOC Operator')).toBe('noc');
    expect(normalizeAccountRole('Read-only')).toBe('viewer');
    expect(normalizeAccountRole('technician')).toBe('technician');
    expect(normalizeAccountRole('king')).toBeUndefined();
    expect(normalizeAccountRole(5)).toBeUndefined();
  });

  it('gives the older roles every right they had (nobody loses access)', () => {
    expect(roleCan('engineer', 'delete', 'equipment')).toBe(true);
    expect(roleCan('office', 'update', 'cables')).toBe(true);
    expect(roleCan('office', 'delete', 'documents')).toBe(true);
    expect(roleMay('engineer', 'change_settings')).toBe(true);
    expect(roleMay('engineer', 'import_monitoring')).toBe(true);
    for (const role of ['admin', 'engineer'] as const) for (const a of PERMISSION_ACTIONS.filter((x) => x !== 'approve')) expect(roleHasAction(role, a)).toBe(true);
    for (const a of ['create', 'edit', 'move', 'connect', 'disconnect', 'allocate', 'deallocate'] as const) expect(roleHasAction('office', a)).toBe(true);
  });

  it('keeps users, reset and restore with the Super Admin only', () => {
    for (const role of ACCOUNT_ROLES) {
      expect(roleMay(role, 'manage_users')).toBe(role === 'admin');
      expect(roleMay(role, 'restore')).toBe(role === 'admin');
    }
    expect(roleMay('network_admin', 'manage_monitoring')).toBe(true);
    expect(roleMay('noc', 'import_monitoring')).toBe(true);
    expect(roleMay('viewer', 'upload_photo')).toBe(false);
  });

  it('lets Read-only only look', () => {
    expect(ROLE_ACTIONS.viewer).toEqual(['view']);
    for (const collection of ['equipment', 'faults', 'settings', 'gpsRoutes'] as const) expect(roleCan('viewer', 'create', collection)).toBe(false);
  });
});

describe('what a change does', () => {
  const pole = equipment({ id: 'P-1', type: 'Telecom Pole' }) as unknown as Record<string, unknown>;

  it('tells create, delete, edit and move apart', () => {
    expect(permissionsForChange('equipment', undefined, pole)).toEqual(['create']);
    expect(permissionsForChange('equipment', pole, undefined)).toEqual(['delete']);
    expect(permissionsForChange('equipment', pole, { ...pole, name: 'x' })).toEqual(['edit']);
    expect(permissionsForChange('equipment', pole, { ...pole, lat: (pole.lat as number) + 0.001 })).toEqual(['edit', 'move']);
  });

  it('sees a new or removed link as connect or disconnect, and a changed one as both', () => {
    const linked = { ...pole, customerId: 'CUST-1' };
    expect(permissionsForChange('equipment', pole, linked)).toEqual(['edit', 'connect']);
    expect(permissionsForChange('equipment', linked, pole)).toEqual(['edit', 'disconnect']);
    expect(permissionsForChange('equipment', linked, { ...pole, customerId: 'CUST-2' })).toEqual(['edit', 'connect', 'disconnect']);
    // An item that only follows another in a walk is not linked to it.
    expect(permissionsForChange('equipment', pole, { ...pole, previousAssetId: 'P-0' })).toEqual(['edit']);
  });

  it('sees a core given to a use as allocate, and released as deallocate', () => {
    const cores = [1, 2].map((coreNumber) => ({ coreNumber, status: 'Available' as const }));
    const c = cable({ id: 'C-1', fiberCount: 2, cores }) as unknown as { cores: Record<string, unknown>[] } & Record<string, unknown>;
    const assignment = { id: 'A-1', kind: 'in_use', use: 'PON 1', effectiveFrom: '2026-01-01', createdAt: '2026-01-01' };
    const given = { ...c, cores: c.cores.map((core, i) => (i === 0 ? { ...core, assignments: [assignment] } : core)) };
    expect(permissionsForChange('cables', c, given)).toEqual(['edit', 'allocate']);
    const released = { ...c, cores: c.cores.map((core, i) => (i === 0 ? { ...core, assignments: [{ ...assignment, releasedAt: '2026-02-01' }] } : core)) };
    expect(permissionsForChange('cables', given, released)).toEqual(['edit', 'deallocate']);
  });

  it('never calls a fault naming a cable a connection, and makes settings need configure', () => {
    expect(permissionsForChange('faults', { id: 'F' }, { id: 'F', affectedCableId: 'C-1' })).toEqual(['edit']);
    expect(permissionsForChange('settings', undefined, { id: 's', value: 1 })).toEqual(['create', 'configure']);
  });
});

describe('access with the new roles', () => {
  const pole = equipment({ id: 'P-1', type: 'Telecom Pole' });

  it('refuses a NOC operator or supervisor network items, allows faults', () => {
    for (const role of ['noc', 'supervisor'] as const) {
      expect(checkChangeAccess(account(role), { upserts: { equipment: [{ ...pole, name: 'x' }] } }, storeOf({ equipment: [pole] }))).toHaveLength(1);
      expect(roleCan(role, 'create', 'faults')).toBe(true);
      expect(roleCan(role, 'delete', 'faults')).toBe(false);
    }
    expect(roleCan('noc', 'update', 'alarms')).toBe(true);
    expect(roleCan('supervisor', 'create', 'alarms')).toBe(false);
  });

  it('refuses a field technician an allocation even on their own capture, naming the right', () => {
    const captured = { ...equipment({ id: 'P-K7', type: 'Telecom Pole' }), captureSource: 'field_capture' as const, ponPorts: [] };
    const lookup = storeOf({ equipment: [captured] }, { 'equipment/P-K7': 'U1' });
    const port = { id: 'PON-1', portNumber: 1, status: 'Reserved' } as never;
    const problems = checkChangeAccess(account('technician'), { upserts: { equipment: [{ ...captured, ponPorts: [port] }] } }, lookup);
    expect(problems[0]).toMatchObject({ permission: 'allocate' });
    expect(problems[0].message).toMatch(/Field Technician accounts cannot give a core or port/);
    expect(checkChangeAccess(account('technician'), { upserts: { equipment: [{ ...captured, lat: captured.lat + 0.001 }] } }, lookup)).toEqual([]);
  });

  it('lets a Network Admin change someone else’s trip, like an engineer', () => {
    const trip = { id: 'T-1' };
    const lookup = storeOf({ agentTrips: [trip] }, { 'agentTrips/T-1': 'U9' });
    expect(checkChangeAccess(account('network_admin'), { deletes: { agentTrips: ['T-1'] } }, lookup)).toEqual([]);
    expect(checkChangeAccess(account('noc'), { deletes: { agentTrips: ['T-1'] } }, lookup)).toHaveLength(1);
  });
});

describe('record history helpers', () => {
  it('lists only the fields that changed, short', () => {
    expect(diffRecords({ a: 1, b: 'x', c: [1] }, { a: 1, b: 'y', d: true })).toEqual([
      { field: 'b', before: '"x"', after: '"y"' },
      { field: 'c', before: '[1]' },
      { field: 'd', after: 'true' },
    ]);
    const long = diffRecords({ t: 'a'.repeat(500) }, { t: 'b' }, { maxValueLength: 20 });
    expect(long[0].before?.length).toBe(20);
    expect(diffRecords({}, Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, i])), { maxFields: 2 }).at(-1)?.after).toMatch(/3 more/);
    expect(sameRecord({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});

describe('change requests', () => {
  const request = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
    id: 'CR-1',
    title: 't',
    reason: '',
    status: 'requested',
    changes: {},
    baseVersions: {},
    requestedBy: { id: 'U1', name: 'Ravi' },
    requestedAt: '2026-11-10T00:00:00Z',
    events: [],
    ...over,
  });

  it('needs the approve right and someone other than the asker', () => {
    expect(changeRequestStepProblem(request(), 'approve', account('engineer', 'U2'))).toMatch(/cannot approve/);
    expect(changeRequestStepProblem(request(), 'approve', account('supervisor', 'U1'))).toMatch(/Someone else/);
    expect(changeRequestStepProblem(request(), 'approve', account('supervisor', 'U2'))).toBeNull();
    expect(changeRequestStepProblem(request(), 'approve', null)).toBeNull();
  });

  it('follows the order requested, approved, applied, verified, closed', () => {
    expect(changeRequestStepProblem(request(), 'apply', account('engineer', 'U2'))).toMatch(/Only an approved/);
    expect(changeRequestStepProblem(request({ status: 'approved' }), 'apply', account('engineer', 'U2'))).toBeNull();
    expect(changeRequestStepProblem(request({ status: 'approved' }), 'verify', account('network_admin', 'U2'))).toMatch(/has been made/);
    expect(changeRequestStepProblem(request({ status: 'applied' }), 'verify', account('network_admin', 'U2'))).toBeNull();
    expect(changeRequestStepProblem(request({ status: 'closed' }), 'close', account('admin', 'U2'))).toMatch(/already closed/);
    expect(changeRequestStepProblem(request(), 'close', account('technician', 'U1'))).toBeNull();
    expect(changeRequestStepProblem(request(), 'close', account('technician', 'U3'))).toMatch(/Only the person who asked/);
  });

  it('keeps Read-only accounts out, strips audit entries and counts records', () => {
    expect(mayReadChangeRequest(request(), account('viewer', 'U5'))).toBe(false);
    expect(mayReadChangeRequest(request(), account('office', 'U5'))).toBe(true);
    const stripped = withoutAuditEntries({ upserts: { auditLogs: [{ id: 'L' } as never], equipment: [{ id: 'E' } as never] }, deletes: { cables: ['C'] } });
    expect(stripped.upserts?.auditLogs).toBeUndefined();
    expect(summarizeChangeSet(stripped)).toEqual([
      { collection: 'equipment', upserts: 1, deletes: 0 },
      { collection: 'cables', upserts: 0, deletes: 1 },
    ]);
  });
});

describe('editable lists, naming rules, custom fields', () => {
  const list = (value: unknown) => [{ id: listSettingId('equipmentTypes'), value: JSON.stringify(value) }];

  it('lays added, renamed and hidden values over the built-in ones', () => {
    const settings = list({ added: [{ value: 'Wall box', group: 'Fiber Distribution' }], labels: { FAT: 'FAT box' }, hidden: ['FDMS'] });
    const entries = resolveEditableList('equipmentTypes', settings).entries;
    expect(entries.find((e) => e.value === 'FAT')?.label).toBe('FAT box');
    expect(entries.find((e) => e.value === 'FDMS')?.hidden).toBe(true);
    expect(entries.find((e) => e.value === 'Wall box')).toMatchObject({ builtIn: false, group: 'Fiber Distribution' });
    // A hidden value stays offered to the item that already has it.
    expect(pickerEntries('equipmentTypes', settings).some((e) => e.value === 'FDMS')).toBe(false);
    expect(pickerEntries('equipmentTypes', settings, 'FDMS').some((e) => e.value === 'FDMS')).toBe(true);
    // A broken setting falls back to the built-in list.
    expect(resolveEditableList('equipmentTypes', [{ id: listSettingId('equipmentTypes'), value: 'not json' }]).entries.length).toBeGreaterThan(5);
  });

  it('refuses new values on a fixed list and removing a value in use', () => {
    expect(listChangeProblem('splitterRatios', undefined, JSON.stringify({ added: [{ value: '1:3' }] }), new Set())).toMatch(/fixed list/);
    expect(listChangeProblem('splitterRatios', undefined, JSON.stringify({ labels: { '1:8': 'One to eight' }, hidden: ['1:64'] }), new Set())).toBeNull();
    const before = JSON.stringify({ added: [{ value: 'Wall box' }] });
    expect(listChangeProblem('equipmentTypes', before, '{}', new Set(['Wall box']))).toMatch(/used by records/);
    expect(listChangeProblem('equipmentTypes', before, '{}', new Set())).toBeNull();
    expect(listChangeProblem('connectorTypes', undefined, JSON.stringify({ added: [{ value: 'A connector name that is too long' }] }), new Set())).toMatch(/too long/);
  });

  it('gives the next name from a rule and warns about names that do not fit', () => {
    const rule = { pattern: 'FAT-{area}-{n:3}' };
    expect(nextNameFromRule(rule, ['FAT-KORA-001', 'FAT-KORA-007', 'FAT-HSR-020'], { area: 'Kora' })).toBe('FAT-KORA-008');
    expect(nextNameFromRule(rule, [], { area: 'hsr layout' })).toBe('FAT-HSRLAYOUT-001');
    expect(nameRuleWarning(rule, 'FAT-KORA-012', { area: 'kora' })).toBeNull();
    expect(nameRuleWarning(rule, 'Box 12', { area: 'kora' })).toMatch(/does not follow/);
    expect(ruleSettingProblem('naming.equipment', JSON.stringify({ pattern: 'FAT' }))).toMatch(/number part/);
    expect(ruleSettingProblem('naming.zones', JSON.stringify({ pattern: 'Z-{n}' }))).toMatch(/only/);
  });

  it('checks custom field values against their definitions', () => {
    const parsed = parseAttributeSetting('attr.equipment.heightClass', JSON.stringify({ label: 'Height class', type: 'choice', choices: ['A', 'B'] }));
    expect(parsed.ok).toBe(true);
    const defs = parsed.ok ? [parsed.def] : [];
    expect(attributeValuesProblem(defs, { heightClass: 'A', retiredField: 3 })).toBeNull();
    expect(attributeValuesProblem(defs, { heightClass: 'Z' })).toMatch(/one of/);
    expect(parseAttributeSetting('attr.equipment.Bad Key', JSON.stringify({ label: 'x', type: 'text' })).ok).toBe(false);
    expect(parseAttributeSetting('attr.equipment.size', JSON.stringify({ label: 'Size', type: 'choice' })).ok).toBe(false);
  });
});
