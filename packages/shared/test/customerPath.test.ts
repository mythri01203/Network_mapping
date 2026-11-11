import { describe, expect, it } from 'vitest';

import type { NetworkData } from '../src/domain/command';
import { linkCustomerDrop, reconcileCustomerPaths } from '../src/domain/connectionCommands';
import { checkChangeSetConnections } from '../src/domain/connectionRules';
import { customerPathCache, customerPathFromLinks, findCustomerPathFindings, proposeCustomerPathFixes } from '../src/domain/customerPath';
import {
  CUSTOMER_HIDDEN_TEXT,
  hiddenDiffFields,
  hiddenPersonalFields,
  ownJobCustomerIds,
  redactNetworkForRole,
  redactRecordForRole,
  restoreHiddenCable,
  restoreHiddenCustomer,
  restoreHiddenSplitter,
} from '../src/domain/customerPrivacy';
import { buildCores } from '../src/domain/defaults';
import { provisionCustomer } from '../src/domain/provisioning';
import type { Customer } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, closure, customer, emptyNetwork, equipment, NOW, splice, splitter, workOrder } from './fixtures';

const ctx = { now: NOW, actor: 'Tester' };

/**
 * OLT-1 PON-01 → FEED fiber 1 → splice in CLO-1 → DIST fiber 3 → SPL-1 input; SPL-1 output 2 →
 * DROP fiber 1 → C1. Every link is recorded fiber by fiber.
 */
function linkedNetwork(c1: Partial<Customer> = {}): NetworkData {
  return {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active', connectedFeederCableId: 'FEED', feederCore: 1, connectedCustomersCount: 1 }] }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'FAT-2', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'OLT-2', type: 'OLT' }),
    ],
    cables: [
      cable({ id: 'FEED', type: 'Main Feeder Fiber', cores: buildCores(12) }),
      cable({ id: 'DIST', cores: buildCores(12) }),
      cable({ id: 'DROP', type: 'Drop Fiber', fiberCount: 2, lengthMeters: 50, cores: buildCores(2) }),
      cable({ id: 'DROP2', type: 'Drop Fiber', fiberCount: 2, lengthMeters: 50, cores: buildCores(2) }),
      cable({ id: 'OTHER', cores: buildCores(12) }),
    ],
    closures: [closure({ id: 'CLO-1', splices: [splice({ id: 'SPC-1', inputCableId: 'FEED', inputCore: 1, outputCableId: 'DIST', outputCore: 3 })] })],
    splitters: [
      splitter({
        id: 'SPL-1',
        terminalBoxId: 'FAT-1',
        inputPort: { id: 'SPL-1-IN', connectedCableId: 'DIST', connectedCore: 3 },
        outputPorts: Array.from({ length: 8 }, (_, i) => ({
          portNumber: i + 1,
          label: `OUT-${i + 1}`,
          status: i === 1 ? ('Occupied' as const) : ('Available' as const),
          ...(i === 1 ? { connectedCustomerId: 'C1', connectedCustomerName: 'Asha', connectedDropCableId: 'DROP', connectedCore: 1 } : {}),
        })),
      }),
      splitter({ id: 'SPL-2', terminalBoxId: 'FAT-2' }),
    ],
    customers: [
      customer({
        id: 'C1',
        name: 'Asha',
        mobile: '98450 11111',
        address: '12 Lake Road',
        oltId: 'OLT-1',
        ponPort: 'PON-01',
        feederCableId: 'FEED',
        distributionCableId: 'DIST',
        terminalBoxId: 'FAT-1',
        splitterId: 'SPL-1',
        splitterOutputPort: 2,
        dropCableId: 'DROP',
        fiberCore: 1,
        ...c1,
      }),
    ],
  };
}

const connectionData = (d: NetworkData) => ({ equipment: d.equipment, cables: d.cables, splitters: d.splitters, customers: d.customers, closures: d.closures, onts: [], services: [], buildings: [] });
const fiberData = (d: NetworkData) => ({ equipment: d.equipment, cables: d.cables, splitters: d.splitters, closures: d.closures, customers: d.customers });

describe('the customer path from the fibre links (Phase 12)', () => {
  it('works out every path field from the links, through a splice', () => {
    const data = linkedNetwork();
    const linked = customerPathFromLinks(data.customers[0], customerPathCache(fiberData(data)));
    expect(linked.reachesPon).toBe(true);
    expect(linked.values).toEqual({
      oltId: 'OLT-1',
      ponPort: 'PON-01',
      feederCableId: 'FEED',
      distributionCableId: 'DIST',
      terminalBoxId: 'FAT-1',
      splitterId: 'SPL-1',
      splitterOutputPort: 2,
      dropCableId: 'DROP',
      fiberCore: 1,
    });
    expect(findCustomerPathFindings(fiberData(data))).toEqual([]);
  });

  it('decides nothing past where the links stop, and never guesses', () => {
    const data = linkedNetwork({ oltId: 'OLT-2', ponPort: 'PON-09', feederCableId: 'OTHER' });
    data.closures = []; // The splice is not recorded: the links stop at DIST.
    const linked = customerPathFromLinks(data.customers[0], customerPathCache(fiberData(data)));
    expect(linked.reachesPon).toBe(false);
    expect(linked.values.oltId).toBeUndefined();
    expect(linked.values.feederCableId).toBeUndefined();
    expect(linked.values.distributionCableId).toBe('DIST');
    expect(linked.gaps[0]).toMatch(/no recorded link on its OLT side/);
    // The OLT the person chose cannot be checked, so it is not blamed.
    expect(findCustomerPathFindings(fiberData(data))).toEqual([]);
  });

  it('lists a field that disagrees and one left blank', () => {
    const data = linkedNetwork({ oltId: 'OLT-2', ponPort: '' });
    const findings = findCustomerPathFindings(fiberData(data));
    expect(findings.map((f) => [f.field, f.state, f.recorded, f.fromLinks])).toEqual([
      ['oltId', 'disagrees', 'OLT-2', 'OLT-1'],
      ['ponPort', 'missing', undefined, 'PON-01'],
    ]);
    expect(findings[0].message).toBe('Asha is recorded on OLT OLT-2, but the fibre links lead to OLT-1.');
  });
});

describe('a write that disagrees with the links is refused (Phase 12)', () => {
  it('refuses a customer whose OLT is not where the fibres go', () => {
    const data = linkedNetwork();
    const errors = checkChangeSetConnections(connectionData(data), { upserts: { customers: [{ ...data.customers[0], oltId: 'OLT-2' }] } });
    expect(errors.map((e) => e.code)).toEqual(['customer_path_mismatch']);
    expect(errors[0].message).toMatch(/^Broken data: Asha is recorded on OLT OLT-2, but the fibre links lead to OLT-1/);
  });

  it('refuses a wrong splitter output and a wrong box', () => {
    const data = linkedNetwork();
    const errors = checkChangeSetConnections(connectionData(data), { upserts: { customers: [{ ...data.customers[0], splitterId: 'SPL-2', terminalBoxId: 'FAT-2' }] } });
    expect(errors.map((e) => e.code)).toEqual(['customer_path_mismatch', 'customer_path_mismatch']);
  });

  it('accepts blank fields, a light reading on a customer already stored wrong, and a path the links do not reach', () => {
    const data = linkedNetwork();
    expect(checkChangeSetConnections(connectionData(data), { upserts: { customers: [{ ...data.customers[0], oltId: '', ponPort: '', feederCableId: '' }] } })).toEqual([]);
    const stored = linkedNetwork({ oltId: 'OLT-2' });
    expect(checkChangeSetConnections(connectionData(stored), { upserts: { customers: [{ ...stored.customers[0], rxOpticalPowerDbm: -21.4, rxSource: 'field_measured' }] } })).toEqual([]);
    // Changing it to another wrong value is a new disagreement.
    expect(checkChangeSetConnections(connectionData(stored), { upserts: { customers: [{ ...stored.customers[0], oltId: 'FAT-2' }] } }).map((e) => e.code)).toEqual(['customer_path_mismatch']);
    const noSplice = { ...linkedNetwork(), closures: [] };
    expect(checkChangeSetConnections(connectionData(noSplice), { upserts: { customers: [{ ...noSplice.customers[0], oltId: 'OLT-2' }] } })).toEqual([]);
  });

  it('refuses a splitter output that names a customer its fibre does not reach', () => {
    const data = linkedNetwork();
    data.customers.push(customer({ id: 'C2', name: 'Ravi', dropCableId: 'DROP2', fiberCore: 1 }));
    const sp = data.splitters[0];
    const wrong = { ...sp, outputPorts: sp.outputPorts.map((p) => (p.portNumber === 2 ? { ...p, connectedCustomerId: 'C2', connectedCustomerName: 'Ravi' } : p)) };
    const errors = checkChangeSetConnections(connectionData(data), { upserts: { splitters: [wrong] } });
    expect(errors.map((e) => e.code)).toEqual(['splitter_owner_mismatch']);
    expect(errors[0].message).toMatch(/Output 2 of splitter SPL-1 is recorded for Ravi, but its fibre leads to Asha/);
    const ghost = { ...sp, outputPorts: sp.outputPorts.map((p) => (p.portNumber === 5 ? { ...p, connectedCustomerId: 'NOBODY' } : p)) };
    expect(checkChangeSetConnections(connectionData(data), { upserts: { splitters: [ghost] } }).map((e) => e.code)).toEqual(['splitter_owner_mismatch']);
  });

  it('accepts an output that names the customer whose own record is still blank (found in the integration walkthrough)', () => {
    // The output names Asha and carries her drop fibre; her record has no path yet. The links lead
    // her to this very output, so nothing disagrees: her blank fields are "not recorded", to fix later.
    const blank = linkedNetwork({ oltId: '', ponPort: '', feederCableId: '', distributionCableId: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 0, dropCableId: '', fiberCore: 0 });
    const writeAll = { upserts: { splitters: blank.splitters, customers: blank.customers } };
    expect(checkChangeSetConnections(connectionData({ ...blank, splitters: [], customers: [] }), writeAll)).toEqual([]);
    const findings = findCustomerPathFindings(fiberData(blank));
    expect(findings.some((f) => f.kind === 'splitter_owner')).toBe(false);
    // But a customer with no drop of their own, named on an output whose fibre leads to someone
    // else, is still refused (the server test that caught the first version of this fix).
    const data = linkedNetwork();
    data.customers.push(customer({ id: 'C3', name: 'Meena' }));
    const sp = data.splitters[0];
    const taken = { ...sp, outputPorts: sp.outputPorts.map((p) => (p.portNumber === 2 ? { ...p, connectedCustomerId: 'C3', connectedCustomerName: 'Meena' } : p)) };
    expect(checkChangeSetConnections(connectionData(data), { upserts: { splitters: [taken] } }).map((e) => e.code)).toEqual(['splitter_owner_mismatch']);
    expect(findings.filter((f) => f.kind === 'customer_field').every((f) => f.state === 'missing')).toBe(true);
  });
});

describe('reconcile: the fix from the links, confirmed by a person (Phase 12)', () => {
  it('proposes the fix and applies it only for the chosen customers, with history', () => {
    const data = linkedNetwork({ oltId: 'OLT-2', ponPort: '', distributionCableId: 'OTHER' });
    data.customers.push(customer({ id: 'C2', name: 'Ravi', oltId: 'OLT-2', dropCableId: '', fiberCore: 0, splitterId: '', splitterOutputPort: 0 }));
    const fixes = proposeCustomerPathFixes(fiberData(data));
    expect(fixes.map((f) => [f.customerId, f.customerPatch])).toEqual([['C1', { oltId: 'OLT-1', ponPort: 'PON-01', distributionCableId: 'DIST' }]]);
    // Nothing is changed until a person confirms.
    expect(data.customers[0].oltId).toBe('OLT-2');
    const result = reconcileCustomerPaths(data, ['C1'], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fixed = result.patch.customers!.find((c) => c.id === 'C1')!;
    expect(fixed).toMatchObject({ oltId: 'OLT-1', ponPort: 'PON-01', distributionCableId: 'DIST' });
    expect(fixed.history?.at(-1)?.details).toMatch(/OLT OLT-2 → OLT-1; PON port not recorded → PON-01; distribution cable OTHER → DIST/);
    expect(result.audit?.[0]).toMatchObject({ action: 'CUSTOMER_PATH_FROM_LINKS', assetId: 'C1' });
    // C2 has no links at all: nothing to take from them.
    expect(result.patch.customers!.find((c) => c.id === 'C2')!.oltId).toBe('OLT-2');
  });

  it('names an output owner from its fibre, and clears an owner the fibre does not reach', () => {
    const data = linkedNetwork();
    const sp = data.splitters[0];
    data.splitters[0] = { ...sp, outputPorts: sp.outputPorts.map((p) => (p.portNumber === 2 ? { ...p, connectedCustomerId: undefined, connectedCustomerName: undefined } : p.portNumber === 6 ? { ...p, connectedCustomerId: 'GONE', status: 'Occupied' as const } : p)) };
    const fixes = proposeCustomerPathFixes(fiberData(data));
    expect(fixes.flatMap((f) => f.outputFixes)).toEqual([{ splitterId: 'SPL-1', port: 2, customerId: 'C1' }, { splitterId: 'SPL-1', port: 6 }]);
    const result = reconcileCustomerPaths(data, ['C1', 'GONE'], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ports = result.patch.splitters!.find((s) => s.id === 'SPL-1')!.outputPorts;
    expect(ports[1]).toMatchObject({ connectedCustomerId: 'C1', connectedCustomerName: 'Asha', status: 'Occupied' });
    expect(ports[5].connectedCustomerId).toBeUndefined();
    expect(ports[5].status).toBe('Available');
  });

  it('linking a drop takes the OLT side from the links and blanks old values the links do not give', () => {
    const data = linkedNetwork();
    data.customers.push(customer({ id: 'C2', name: 'Ravi', oltId: 'OLT-2', ponPort: 'PON-07', dropCableId: '', fiberCore: 0, splitterId: '' }));
    const sp = data.splitters[0];
    data.splitters[0] = { ...sp, outputPorts: sp.outputPorts.map((p) => (p.portNumber === 3 ? { ...p, connectedDropCableId: 'DROP2', connectedCore: 1 } : p)) };
    const result = linkCustomerDrop(data, 'C2', { splitterId: 'SPL-1', port: 3, cableId: 'DROP2', core: 1 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: 'FEED', distributionCableId: 'DIST', splitterId: 'SPL-1', splitterOutputPort: 3, terminalBoxId: 'FAT-1' });
  });

  it('refuses a new customer whose chosen OLT the links contradict', () => {
    const data = linkedNetwork();
    const refused = provisionCustomer(data, { name: 'New', terminalBoxId: 'FAT-1', splitterId: 'SPL-1', splitterOutputPort: 4, oltId: 'OLT-2' }, ctx);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/fibre links from SPL-1 lead to OLT-1/);
    const made = provisionCustomer(data, { name: 'New', terminalBoxId: 'FAT-1', splitterId: 'SPL-1', splitterOutputPort: 4, fiberCore: 1 }, ctx);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const after = { ...data, ...made.patch };
    expect(findCustomerPathFindings(fiberData(after as NetworkData)).filter((f) => f.state === 'disagrees')).toEqual([]);
  });

  it('the sample network has no disagreement a write would be refused for', () => {
    const sample = createSampleNetwork();
    const fiber = { equipment: sample.equipment, cables: sample.cables, splitters: sample.splitters, closures: sample.closures, customers: sample.customers };
    // Existing data is only listed, never blocked; this keeps the demo honest.
    const disagreeing = findCustomerPathFindings(fiber).filter((f) => f.state === 'disagrees');
    expect(disagreeing.map((f) => f.key)).toEqual([]);
  });
});

describe('personal data by role (Phase 12)', () => {
  const data = linkedNetwork();
  const asha = data.customers[0];
  const tech = { role: 'technician' as const, displayName: 'Kiran' };
  const viewer = { role: 'viewer' as const, displayName: 'Look' };

  it('hides name, address, position and mobile from Read-only, and marks what was hidden', () => {
    const shown = redactNetworkForRole({ customers: data.customers, splitters: data.splitters, cables: data.cables }, viewer);
    expect(shown.customers![0]).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, address: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT, lat: 0, lng: 0, hiddenFields: ['name', 'address', 'mobile', 'gps'] });
    // Links stay: the path is not personal.
    expect(shown.customers![0].splitterId).toBe('SPL-1');
    expect(shown.splitters![0].outputPorts[1]).toMatchObject({ connectedCustomerId: 'C1', connectedCustomerName: CUSTOMER_HIDDEN_TEXT });
    expect(redactRecordForRole('syncConflicts', { id: 'X', collection: 'customers', mine: asha, theirs: null }, viewer)).toBeNull();
  });

  it('shows a technician their own job customers in full, and only the position for others', () => {
    const jobs = [workOrder({ id: 'WO-1', technicianName: 'Kiran', customerId: 'C1', status: 'Assigned' }), workOrder({ id: 'WO-2', technicianName: 'Kiran', customerId: 'C9', status: 'Closed' })];
    const own = ownJobCustomerIds(jobs, 'Kiran');
    expect([...own]).toEqual(['C1']);
    expect(hiddenPersonalFields(tech, 'C1', own)).toEqual([]);
    expect(hiddenPersonalFields(tech, 'C2', own)).toEqual(['name', 'address', 'mobile']);
    const other = redactRecordForRole('customers', asha, tech, new Set()) as Customer;
    expect(other).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT, lat: asha.lat, lng: asha.lng });
    expect(hiddenPersonalFields({ role: 'engineer', displayName: 'E' }, 'C1')).toEqual(['mobile']);
    expect(hiddenPersonalFields({ role: 'office', displayName: 'O' }, 'C1')).toEqual([]);
    expect([...hiddenDiffFields('customers', 'C1', viewer)]).toEqual(expect.arrayContaining(['name', 'mobile', 'lat', 'lng', 'address']));
    expect([...hiddenDiffFields('customers', 'C1', tech, own)]).toEqual([]);
  });

  it('never stores a hidden value back', () => {
    const redacted = redactRecordForRole('customers', asha, viewer) as Customer;
    const back = restoreHiddenCustomer({ ...redacted, rxOpticalPowerDbm: -19 }, asha);
    expect(back).toMatchObject({ name: 'Asha', mobile: '98450 11111', address: '12 Lake Road', lat: asha.lat, lng: asha.lng, rxOpticalPowerDbm: -19 });
    expect(back.hiddenFields).toBeUndefined();
    // A value the writer did change is kept, for the permission check to judge.
    expect(restoreHiddenCustomer({ ...redacted, name: 'Asha K' }, asha).name).toBe('Asha K');
    const sp = restoreHiddenSplitter(redactNetworkForRole({ splitters: data.splitters }, viewer).splitters![0], data.splitters[0], (id) => (id === 'C1' ? 'Asha' : undefined));
    expect(sp.outputPorts[1].connectedCustomerName).toBe('Asha');
    const named = { ...data.cables[2], cores: data.cables[2].cores.map((k) => (k.coreNumber === 1 ? { ...k, customerId: 'C1', customerName: 'Asha' } : k)) };
    const hiddenCable = redactNetworkForRole({ cables: [named] }, viewer).cables![0];
    expect(hiddenCable.cores[0].customerName).toBe(CUSTOMER_HIDDEN_TEXT);
    expect(restoreHiddenCable(hiddenCable, named, () => 'Asha').cores[0].customerName).toBe('Asha');
  });
});
