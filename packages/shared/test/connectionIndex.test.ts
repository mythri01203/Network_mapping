import { describe, expect, it } from 'vitest';

import { type Account,checkChangeAccess } from '../src/domain/access';
import { applyPatch, type NetworkData } from '../src/domain/command';
import {
  buildConnectionIndex,
  checkStanding,
  CONNECTION_KINDS,
  type ConnectionIndexData,
  type ConnectionKind,
  connectionKindOfId,
  connectionsForCore,
  connectionsForElement,
  linkCheckCounts,
  linkCheckSummary,
} from '../src/domain/connectionIndex';
import { buildCores } from '../src/domain/defaults';
import { checkChangeSetLinkVerifications, createLinkCheck, deleteLinkCheck, findLinkVerificationErrors, linkCheckError } from '../src/domain/linkVerifications';
import { permissionsForChange } from '../src/domain/permissions';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import type { LinkVerification } from '../src/model/linkVerificationSchemas';
import { linkVerificationSchema } from '../src/model/linkVerificationSchemas';
import type { RfElement, RfLink } from '../src/model/rfSchemas';
import type { Ont } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, closure, customer, emptyNetwork, equipment, NOW, splice, splitter } from './fixtures';

/** Network mapping Phase 13: one index over every kind of link recorded today. */

const ont = (o: Partial<Ont> & Pick<Ont, 'id'>): Ont => ({ arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: '2026-01-01', ...o });

/** A network that records every kind of link at least once. */
function everyKind(): NetworkData {
  const data = emptyNetwork();
  return {
    ...data,
    equipment: [
      equipment({
        id: 'OLT-1',
        type: 'OLT',
        ponPorts: [
          { id: 'PON-1', portNumber: 1, status: 'Active', connectedCustomersCount: 0 },
          { id: 'PON-2', portNumber: 2, status: 'Active', connectedCustomersCount: 0, connectedFeederCableId: 'FDR', feederCore: 2, connectedSplitterId: 'SPL-A' },
        ],
      }),
      equipment({
        id: 'ODF-1',
        type: 'ODF',
        odfPanels: [
          {
            id: 'P1',
            label: 'Panel 1',
            connectorType: 'SC/APC',
            ports: [
              {
                id: 'P1-1',
                number: 1,
                status: 'in_use',
                feederCableId: 'FDR',
                feederCore: 1,
                pigtail: { connectorType: 'SC/APC' },
                patch: { oltId: 'OLT-1', ponPortId: 'PON-1', patchedAt: '2026-02-01', patchedBy: 'Ravi', cordConnectorOdf: 'SC/UPC', cordConnectorPon: 'SC/UPC' },
              },
            ],
          },
        ],
      }),
      equipment({
        id: 'FAT-1',
        type: 'FAT',
        logicalPorts: [
          { id: 'FAT-1-P001', portNumber: 1, portType: 'Terminal', status: 'Used', customerId: 'CUST-1', assignedDate: '2026-03-01' },
          { id: 'FAT-1-P002', portNumber: 2, portType: 'Terminal', status: 'Used', connectedCableId: 'DROP', connectedCore: 2 },
          { id: 'FAT-1-P003', portNumber: 3, portType: 'Terminal', status: 'Used', connectedEquipmentId: 'OLT-1', connectedSplitterId: 'SPL-B' },
        ],
      }),
      equipment({ id: 'CLO-PIN', type: 'Splice Closure' }),
    ],
    cables: [
      cable({ id: 'FDR', type: 'Main Feeder Fiber', startEquipmentId: 'ODF-1', startPortName: 'P1-1', endEquipmentId: 'CLO-PIN', cores: buildCores(12) }),
      cable({
        id: 'DIST',
        startEquipmentId: 'CLO-PIN',
        endEquipmentId: 'FAT-1',
        cores: buildCores(12).map((c) =>
          c.coreNumber === 5 ? { ...c, connectedToEquipmentId: 'FAT-1', connectedPort: 'PORT-5' } : c.coreNumber === 6 ? { ...c, spliceTargetCableId: 'FDR', spliceTargetCore: 6 } : c,
        ),
      }),
      cable({ id: 'DROP', type: 'Drop Fiber', fiberCount: 2, startEquipmentId: 'FAT-1', cores: buildCores(2) }),
    ],
    closures: [
      closure({
        id: 'CLO-1',
        equipmentId: 'CLO-PIN',
        cableEntries: [
          { cableId: 'FDR', role: 'in' },
          { cableId: 'DIST', role: 'out' },
        ],
        splices: [
          splice({ id: 'SPC-1', inputCableId: 'FDR', inputCore: 1, outputCableId: 'DIST', outputCore: 1, technician: 'Asha', date: '2026-02-03' }),
          splice({ id: 'SPC-OLD', inputCableId: 'FDR', inputCore: 3, outputCableId: 'DIST', outputCore: 3, retiredAt: '2026-04-01', retiredBy: 'Asha', retiredReason: 'Re-spliced' }),
          splice({ id: 'SPC-ERR', inputCableId: 'FDR', inputCore: 4, outputCableId: 'DIST', outputCore: 4, enteredInError: true, retiredAt: '2026-04-02' }),
          // Recorded against the closure's sides: the customer-side cable written as coming in.
          splice({ id: 'SPC-BACK', inputCableId: 'DIST', inputCore: 7, outputCableId: 'FDR', outputCore: 7 }),
        ],
        terminations: [{ id: 'TRM-1', cableId: 'FDR', cableName: 'FDR', core: 8, connectorType: 'LC/UPC', connectsTo: 'Tower radio', technician: 'Asha', date: '2026-02-04' }],
      }),
    ],
    splitters: [
      splitter({
        id: 'SPL-A',
        terminalBoxId: 'FAT-1',
        inputPort: { id: 'SPL-A-IN', connectedCableId: 'DIST', connectedCore: 1, linkedBy: 'Asha', linkedAt: '2026-02-05' },
        outputPorts: Array.from({ length: 8 }, (_, i) =>
          i === 0
            ? { portNumber: 1, label: 'OUT-1', status: 'Occupied' as const, connectedDropCableId: 'DROP', connectedCore: 1, connectedCustomerId: 'CUST-1', connectedAt: '2026-02-06' }
            : i === 1
              ? { portNumber: 2, label: 'OUT-2', status: 'Occupied' as const, connectedEquipmentId: 'FAT-1' }
              : { portNumber: i + 1, label: `OUT-${i + 1}`, status: 'Available' as const },
        ),
      }),
      splitter({ id: 'SPL-B', terminalBoxId: 'FAT-1', inputPort: { id: 'SPL-B-IN', connectedSplitterId: 'SPL-A', connectedSplitterPort: 3 } }),
    ],
    customers: [customer({ id: 'CUST-1', name: 'Lakshmi', dropCableId: 'DROP', fiberCore: 1, splitterId: 'SPL-A', splitterOutputPort: 1, ontId: 'ONT-1' })],
    onts: [ont({ id: 'ONT-1', serialNumber: 'HWTC1234', oltId: 'OLT-1', ponPortId: 'PON-1', splitterId: 'SPL-A', splitterOutputPort: 1, dropCableId: 'DROP', dropCore: 1 })],
    rfElements: [
      { id: 'RF-TX', name: 'TX-1', kind: 'optical_transmitter', status: 'built', ports: [{ id: 'RFIN', label: 'RF IN', direction: 'in', signal: 'rf' }, { id: 'OPTOUT', label: 'OPT OUT', direction: 'out', signal: 'optical' }], createdAt: '2026-01-01' },
      { id: 'RF-NODE', name: 'Node-1', kind: 'optical_node', status: 'built', siteEquipmentId: 'FAT-1', ports: [{ id: 'OPTIN', label: 'OPT IN', direction: 'in', signal: 'optical' }], createdAt: '2026-01-01' },
    ] satisfies RfElement[],
    rfLinks: [
      { id: 'RFL-1', from: { elementId: 'RF-TX', portId: 'OPTOUT' }, to: { elementId: 'RF-NODE', portId: 'OPTIN' }, medium: 'fiber', cableId: 'DIST', fiberNumber: 9, status: 'active', createdAt: '2026-01-02', createdBy: 'Office' },
    ] satisfies RfLink[],
  };
}

const index = (data: NetworkData) => buildConnectionIndex(data as ConnectionIndexData);

describe('the connection index', () => {
  it('lists every kind of link recorded today, each with the right ends', () => {
    const ix = index(everyKind());
    const kinds = new Set(ix.connections.map((c) => c.kind));
    expect([...CONNECTION_KINDS].filter((k) => !kinds.has(k))).toEqual([]);

    const get = (id: string) => ix.byId.get(id)!;
    expect(get('splice:CLO-1:SPC-1')).toMatchObject({
      kind: 'splice',
      from: { ref: { type: 'core', cableId: 'FDR', core: 1 }, onRecord: true },
      to: { ref: { type: 'core', cableId: 'DIST', core: 1 } },
      state: 'current',
      recordedBy: 'Asha',
      recordedAt: '2026-02-03',
      recordedIn: { collection: 'closures', recordId: 'CLO-1', field: 'splices[SPC-1]' },
      place: { ids: ['CLO-1', 'CLO-PIN'] },
    });
    expect(get('splice:CLO-1:SPC-OLD').state).toBe('retired');
    expect(get('splice:CLO-1:SPC-ERR').state).toBe('mistake');
    expect(get('pigtail:CLO-1:TRM-1')).toMatchObject({ from: { ref: { type: 'core', cableId: 'FDR', core: 8 } }, to: { ref: { type: 'connector', connectorType: 'LC/UPC', connectsTo: 'Tower radio' } } });
    expect(get('odf-rear:ODF-1:P1:P1-1')).toMatchObject({ from: { ref: { type: 'odf_port', side: 'rear' } }, to: { ref: { type: 'core', cableId: 'FDR', core: 1 } }, connectors: { from: 'SC/APC', adapter: 'SC/APC' } });
    expect(get('odf-patch:ODF-1:P1:P1-1')).toMatchObject({ from: { ref: { type: 'pon_port', oltId: 'OLT-1', ponPortId: 'PON-1' } }, to: { ref: { type: 'odf_port', side: 'front' } }, recordedBy: 'Ravi' });
    expect(get('pon-feeder:OLT-1:PON-2').to.ref).toEqual({ type: 'core', cableId: 'FDR', core: 2 });
    expect(get('pon-splitter:OLT-1:PON-2').to.ref).toEqual({ type: 'splitter', splitterId: 'SPL-A' });
    expect(get('splitter-in:SPL-A')).toMatchObject({ from: { ref: { type: 'core', cableId: 'DIST', core: 1 } }, recordedBy: 'Asha', recordedAt: '2026-02-05' });
    expect(get('splitter-cascade:SPL-B').from.ref).toEqual({ type: 'splitter_output', splitterId: 'SPL-A', port: 3 });
    expect(get('splitter-out:SPL-A:1').to.ref).toEqual({ type: 'core', cableId: 'DROP', core: 1 });
    expect(get('splitter-customer:SPL-A:1').to.ref).toEqual({ type: 'customer', customerId: 'CUST-1' });
    expect(get('splitter-box:SPL-A:2').to.ref).toEqual({ type: 'equipment', equipmentId: 'FAT-1' });
    expect(get('customer-drop:CUST-1').from.ref).toEqual({ type: 'core', cableId: 'DROP', core: 1 });
    expect(get('customer-splitter:CUST-1').from.ref).toEqual({ type: 'splitter_output', splitterId: 'SPL-A', port: 1 });
    expect(get('customer-ont:CUST-1').from.ref).toEqual({ type: 'ont', ontId: 'ONT-1' });
    expect(get('ont-drop:ONT-1').from.ref).toEqual({ type: 'core', cableId: 'DROP', core: 1 });
    expect(get('ont-splitter:ONT-1').from.ref).toEqual({ type: 'splitter_output', splitterId: 'SPL-A', port: 1 });
    expect(get('ont-pon:ONT-1').from.ref).toEqual({ type: 'pon_port', oltId: 'OLT-1', ponPortId: 'PON-1' });
    expect(get('cable-end:FDR:start').to.ref).toEqual({ type: 'equipment', equipmentId: 'ODF-1', port: 'P1-1' });
    expect(get('cable-end:FDR:end').to.ref).toEqual({ type: 'equipment', equipmentId: 'CLO-PIN' });
    expect(get('port:FAT-1:FAT-1-P001:customer').to.ref).toEqual({ type: 'customer', customerId: 'CUST-1' });
    expect(get('port:FAT-1:FAT-1-P002:cable').to.ref).toEqual({ type: 'core', cableId: 'DROP', core: 2 });
    expect(get('port:FAT-1:FAT-1-P003:equipment').to.ref).toEqual({ type: 'equipment', equipmentId: 'OLT-1' });
    expect(get('port:FAT-1:FAT-1-P003:splitter').to.ref).toEqual({ type: 'splitter', splitterId: 'SPL-B' });
    expect(get('core-equipment:DIST:5').to.ref).toEqual({ type: 'equipment', equipmentId: 'FAT-1', port: 'PORT-5' });
    expect(get('core-splice:DIST:6').to.ref).toEqual({ type: 'core', cableId: 'FDR', core: 6 });
    expect(get('rf:RFL-1')).toMatchObject({ from: { ref: { type: 'rf_port', elementId: 'RF-TX', portId: 'OPTOUT' } }, via: { cableId: 'DIST', core: 9 }, recordedBy: 'Office' });
  });

  it('never makes a link from position, and leaves out what is not recorded', () => {
    const data = everyKind();
    // Two cables end at the same box, but no splice or splitter record joins them.
    const ix = index({ ...data, closures: [], splitters: [], customers: [], onts: [], rfLinks: [] });
    expect(ix.connections.some((c) => c.kind === 'splice' || c.kind.startsWith('splitter') || c.kind.startsWith('customer'))).toBe(false);
    // Nobody recorded who made a feeder link on an ODF port: nothing is filled in.
    const rear = ix.byId.get('odf-rear:ODF-1:P1:P1-1')!;
    expect(rear.recordedBy).toBeUndefined();
    expect(rear.recordedAt).toBeUndefined();
  });

  it('looks links up by element and by fibre, current first', () => {
    const ix = index(everyKind());
    const fdr1 = connectionsForCore(ix, 'FDR', 1).map((c) => c.id);
    expect(fdr1).toEqual(expect.arrayContaining(['splice:CLO-1:SPC-1', 'odf-rear:ODF-1:P1:P1-1']));
    const fdr3 = connectionsForCore(ix, 'FDR', 3);
    expect(fdr3.map((c) => c.state)).toEqual(['retired']);
    // A splitter's links are listed under the box it sits in; a splice under its closure and the closure's pin.
    const fat = connectionsForElement(ix, 'FAT-1').map((c) => c.id);
    expect(fat).toEqual(expect.arrayContaining(['splitter-in:SPL-A', 'splitter-out:SPL-A:1', 'port:FAT-1:FAT-1-P001:customer', 'cable-end:DIST:end', 'rf:RFL-1']));
    expect(connectionsForElement(ix, 'CLO-PIN').map((c) => c.id)).toEqual(expect.arrayContaining(['splice:CLO-1:SPC-1', 'pigtail:CLO-1:TRM-1']));
    const list = connectionsForElement(ix, 'CLO-1');
    const firstHistory = list.findIndex((c) => c.state !== 'current');
    expect(list.slice(firstHistory).every((c) => c.state !== 'current')).toBe(true);
    // A Cable TV link in a fibre shows on that fibre.
    expect(connectionsForCore(ix, 'DIST', 9).map((c) => c.id)).toEqual(['rf:RFL-1']);
  });

  it('warns on connectors that do not mate, splices against the closure sides, and missing ends', () => {
    const data = everyKind();
    const ix = index({ ...data, customers: [...data.customers, customer({ id: 'CUST-2', dropCableId: 'GONE', fiberCore: 1 })] });
    const patch = ix.byId.get('odf-patch:ODF-1:P1:P1-1')!;
    expect(patch.warnings.map((w) => w.code)).toEqual(['connector_mismatch']);
    expect(patch.warnings[0].message).toMatch(/APC/);
    expect(ix.byId.get('odf-rear:ODF-1:P1:P1-1')!.warnings).toEqual([]);
    expect(ix.byId.get('splice:CLO-1:SPC-BACK')!.warnings.map((w) => w.code)).toContain('direction');
    expect(ix.byId.get('splice:CLO-1:SPC-1')!.warnings).toEqual([]);
    const gone = ix.byId.get('customer-drop:CUST-2')!;
    expect(gone.from.onRecord).toBe(false);
    expect(gone.warnings.map((w) => w.code)).toEqual(['end_not_on_record']);
    // Retired and mistaken splices are history: no direction warning on them.
    expect(ix.byId.get('splice:CLO-1:SPC-OLD')!.warnings).toEqual([]);
  });

  it('warns on a Cable TV link recorded backwards, without any PON rule', () => {
    const data = everyKind();
    const back = { ...data.rfLinks![0], id: 'RFL-BACK', from: { elementId: 'RF-NODE', portId: 'OPTIN' }, to: { elementId: 'RF-TX', portId: 'OPTOUT' } };
    const ix = index({ ...data, rfLinks: [back] });
    expect(ix.byId.get('rf:RFL-BACK')!.warnings.map((w) => w.code)).toEqual(['direction']);
  });

  it('warns when two links feed one fibre', () => {
    const data = everyKind();
    // The OLT port also feeds fibre 1 of FDR straight, while the ODF port feeds it.
    const olt = data.equipment[0];
    const twice = { ...olt, ponPorts: [{ ...olt.ponPorts![0], connectedFeederCableId: 'FDR', feederCore: 1 }, olt.ponPorts![1]] };
    const ix = index({ ...data, equipment: [twice, ...data.equipment.slice(1)] });
    expect(ix.byId.get('pon-feeder:OLT-1:PON-1')!.warnings.map((w) => w.code)).toContain('two_feeds');
    expect(ix.byId.get('odf-rear:ODF-1:P1:P1-1')!.warnings.map((w) => w.code)).toContain('two_feeds');
  });

  it('matches the existing links of the sample network', () => {
    const sample = createSampleNetwork();
    const ix = buildConnectionIndex(sample);
    for (const cl of sample.closures) {
      for (const s of cl.splices) {
        const c = ix.byId.get(`splice:${cl.id}:${s.id}`)!;
        expect(c.from.ref).toEqual({ type: 'core', cableId: s.inputCableId, core: s.inputCore });
        expect(c.to.ref).toEqual({ type: 'core', cableId: s.outputCableId, core: s.outputCore });
      }
    }
    for (const cable of sample.cables) {
      if (cable.startEquipmentId) expect(ix.byId.get(`cable-end:${cable.id}:start`)!.to.ref).toMatchObject({ equipmentId: cable.startEquipmentId });
      if (cable.endEquipmentId) expect(ix.byId.get(`cable-end:${cable.id}:end`)!.to.ref).toMatchObject({ equipmentId: cable.endEquipmentId });
      for (const core of cable.cores) {
        if (core.connectedToEquipmentId) expect(ix.byId.get(`core-equipment:${cable.id}:${core.coreNumber}`)!.to.ref).toMatchObject({ equipmentId: core.connectedToEquipmentId });
      }
    }
    for (const sp of sample.splitters) {
      if (sp.inputPort.connectedCableId && sp.inputPort.connectedCore) {
        expect(ix.byId.get(`splitter-in:${sp.id}`)!.from.ref).toEqual({ type: 'core', cableId: sp.inputPort.connectedCableId, core: sp.inputPort.connectedCore });
      }
      for (const p of sp.outputPorts) {
        if (p.connectedDropCableId && p.connectedCore) expect(ix.byId.get(`splitter-out:${sp.id}:${p.portNumber}`)!.to.ref).toEqual({ type: 'core', cableId: p.connectedDropCableId, core: p.connectedCore });
        if (p.connectedCustomerId) expect(ix.byId.get(`splitter-customer:${sp.id}:${p.portNumber}`)!.to.ref).toEqual({ type: 'customer', customerId: p.connectedCustomerId });
      }
    }
    for (const eq of sample.equipment) {
      for (const pon of eq.ponPorts ?? []) {
        if (pon.connectedFeederCableId && pon.feederCore) expect(ix.byId.has(`pon-feeder:${eq.id}:${pon.id}`)).toBe(true);
      }
    }
    for (const c of sample.customers) {
      if (c.dropCableId && c.fiberCore > 0) expect(ix.byId.get(`customer-drop:${c.id}`)!.from.ref).toEqual({ type: 'core', cableId: c.dropCableId, core: c.fiberCore });
      if (c.splitterId && c.splitterOutputPort > 0) expect(ix.byId.get(`customer-splitter:${c.id}`)!.from.ref).toEqual({ type: 'splitter_output', splitterId: c.splitterId, port: c.splitterOutputPort });
    }
    // Every id names its own kind, and none repeats.
    expect(ix.byId.size).toBe(ix.connections.length);
    for (const c of ix.connections) expect(connectionKindOfId(c.id)).toBe(c.kind satisfies ConnectionKind);
    // Nothing on the sample is checked yet, and it says so.
    expect(linkCheckCounts(ix, ix.connections).not_checked).toBe(ix.connections.length);
  });

  it('builds in one pass on a large network', () => {
    const data = everyKind();
    const many = Array.from({ length: 2000 }, (_, i) => splice({ id: `S-${i}`, inputCableId: 'FDR', inputCore: 9, outputCableId: 'DIST', outputCore: 10 + (i % 2) }));
    const start = Date.now();
    const ix = index({ ...data, closures: [closure({ id: 'BIG', splices: many })] });
    expect(ix.connections.length).toBeGreaterThan(2000);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('checks of links (linkVerifications)', () => {
  const draft = { connectionId: 'splice:CLO-1:SPC-1', method: 'power_reading' as const, result: 'pass' as const, checkedOn: '2026-11-04', technician: 'Asha', readingDbm: -19.4, wavelengthNm: 1490, photoIds: ['PHOTO-123456'], instrument: 'JDSU OLP-85' };

  it('records the evidence, and the link shows as checked', () => {
    const data = everyKind();
    const result = createLinkCheck(data, draft, { now: NOW, actor: 'Asha' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirm).toBeUndefined();
    const check = result.value;
    expect(linkVerificationSchema.parse(check)).toEqual(check);
    expect(check).toMatchObject({ connectionId: 'splice:CLO-1:SPC-1', readingDbm: -19.4, wavelengthNm: 1490, photoIds: ['PHOTO-123456'], instrument: 'JDSU OLP-85', technician: 'Asha', createdBy: 'Asha' });
    expect(check.connectionLabel).toMatch(/FDR.*→.*DIST/);
    expect(result.audit[0]).toMatchObject({ action: 'LINK_CHECK_RECORDED', assetType: 'LinkCheck' });
    expect(result.audit[0].details).toMatch(/-19.4 dBm at 1490 nm \(measured\)/);

    const after = applyPatch(data, result.patch);
    const ix = index(after);
    const summary = linkCheckSummary(ix, ix.byId.get('splice:CLO-1:SPC-1')!);
    expect(summary).toMatchObject({ state: 'passed', hasEvidence: true });
    expect(summary.label).toMatch(/2026-11-04 by Asha/);
    // Every other link still says "Not checked".
    expect(linkCheckSummary(ix, ix.byId.get('splitter-in:SPL-A')!).state).toBe('not_checked');
  });

  it('marks a check out of date when the link is changed, and keeps a check of a link that is gone', () => {
    const data = everyKind();
    const r = createLinkCheck(data, draft, { now: NOW });
    if (!r.ok) throw new Error(r.error.message);
    const checked = applyPatch(data, r.patch);
    // The splice is edited to join another fibre: same record, other ends.
    const moved = { ...checked, closures: checked.closures.map((cl) => ({ ...cl, splices: cl.splices.map((s) => (s.id === 'SPC-1' ? { ...s, outputCore: 2 } : s)) })) };
    const ix = index(moved);
    expect(linkCheckSummary(ix, ix.byId.get('splice:CLO-1:SPC-1')!).state).toBe('changed_since_check');
    expect(checkStanding(ix, r.value)).toBe('link_changed');
    // The splice record is deleted outright: the check stays, listed apart, and blocks nothing.
    const gone = index({ ...checked, closures: [] });
    expect(gone.orphanChecks.map((v) => v.id)).toEqual([r.value.id]);
    expect(checkStanding(gone, r.value)).toBe('link_gone');
    expect(checkChangeSetLinkVerifications({ upserts: { linkVerifications: [r.value] } }, NOW)).toEqual([]);
  });

  it('refuses broken checks and warns (with Save anyway) on checks without evidence', () => {
    const data = everyKind();
    expect(createLinkCheck(data, { ...draft, readingDbm: undefined }, { now: NOW })).toMatchObject({ ok: false, error: { message: /needs the reading/ } });
    expect(createLinkCheck(data, { ...draft, connectionId: 'nonsense' }, { now: NOW })).toMatchObject({ ok: false });
    expect(createLinkCheck(data, { ...draft, checkedOn: '2026-12-25' }, { now: NOW })).toMatchObject({ ok: false, error: { message: /future/ } });
    expect(createLinkCheck(data, { ...draft, photoIds: ['../etc'] }, { now: NOW })).toMatchObject({ ok: false });
    expect(createLinkCheck(data, { ...draft, result: undefined }, { now: NOW })).toMatchObject({ ok: false });

    const bare = createLinkCheck(data, { connectionId: 'splitter-in:SPL-A', method: 'visual', result: 'pass', checkedOn: '2026-11-04', technician: 'Asha' }, { now: NOW });
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.confirm).toMatch(/no photo, OTDR reference or reading/);
    expect(bare.audit.map((a) => a.action)).toEqual(['LINK_CHECK_RECORDED', 'WARNING_ACCEPTED']);
    const ix = index(applyPatch(data, bare.patch));
    expect(linkCheckSummary(ix, ix.byId.get('splitter-in:SPL-A')!)).toMatchObject({ state: 'passed', hasEvidence: false });

    // A check of a link not on record is a warning, not a refusal.
    const stale = createLinkCheck(data, { ...draft, connectionId: 'splice:CLO-1:GONE' }, { now: NOW });
    expect(stale.ok && stale.confirm).toMatch(/not on record any more/);
  });

  it('is checked on the server and on restore', () => {
    const bad: LinkVerification = { id: 'LCK-1', connectionId: 'splice:A:B', connectionLabel: 'x', method: 'power_reading', result: 'pass', checkedOn: '2026-11-04', technician: 'Asha', createdAt: '2026-11-04' };
    expect(checkChangeSetLinkVerifications({ upserts: { linkVerifications: [bad] } }, NOW)[0].message).toMatch(/needs the reading/);
    expect(findLinkVerificationErrors({ linkVerifications: [bad] })).toHaveLength(1);
    const restored = checkRestoredNetwork({ ...createSampleNetwork(), linkVerifications: [bad] });
    expect(restored.counts.checks).toBe(1);
    expect(linkCheckError({ ...bad, readingDbm: -20 })).toBeNull();
  });

  it('lets a technician add a check and change only their own, and recording one connects nothing', () => {
    const tech: Account = { id: 'U-T', username: 'tech', displayName: 'Asha', role: 'technician', active: true, createdAt: '2026-01-01' } as Account;
    const check: LinkVerification = { id: 'LCK-2', connectionId: 'splice:CLO-1:SPC-1', connectionLabel: 'x', method: 'visual', result: 'pass', checkedOn: '2026-11-04', technician: 'Asha', createdAt: '2026-11-04' };
    expect(checkChangeAccess(tech, { upserts: { linkVerifications: [check] } }, () => undefined)).toEqual([]);
    const someoneElses = () => ({ record: check as unknown as Record<string, unknown>, createdBy: 'U-OTHER' });
    expect(checkChangeAccess(tech, { upserts: { linkVerifications: [{ ...check, result: 'fail' }] } }, someoneElses)).toHaveLength(1);
    const viewer = { ...tech, role: 'viewer' } as Account;
    expect(checkChangeAccess(viewer, { upserts: { linkVerifications: [check] } }, () => undefined)).toHaveLength(1);
    expect(permissionsForChange('linkVerifications', check as never, { ...check, connectionId: 'splice:CLO-1:SPC-OLD' } as never)).toEqual(['edit']);
  });

  it('stores what was checked without the customer name, so every role may read it', () => {
    const r = createLinkCheck(everyKind(), { ...draft, connectionId: 'customer-drop:CUST-1' }, { now: NOW });
    expect(r.ok && r.value.connectionLabel).toMatch(/customer CUST-1/);
    expect(r.ok && r.value.connectionLabel).not.toMatch(/Lakshmi/);
    // The screens (built for the role reading them) still name the customer.
    expect(index(everyKind()).byId.get('customer-drop:CUST-1')!.to.label).toMatch(/Lakshmi/);
  });

  it('deletes a check entered by mistake only after asking', () => {
    const data = everyKind();
    const r = createLinkCheck(data, draft, { now: NOW });
    if (!r.ok) throw new Error(r.error.message);
    const d = deleteLinkCheck(applyPatch(data, r.patch), r.value.id);
    expect(d.ok && d.confirm).toMatch(/entered by mistake/);
    expect(d.ok && d.patch.linkVerifications).toEqual([]);
  });
});
