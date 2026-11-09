import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { openFault, raiseTestEvent } from '../src/domain/faultCommands';
import { correlateAlarms } from '../src/domain/faultCorrelation';
import { affectedByElement, buildImpactIndex } from '../src/domain/faultImpact';
import { addOdfPanel, createClosure, patchOdfPort, recordSplice, setOdfPortFeeder } from '../src/domain/fiberCommands';
import { buildHazardFault } from '../src/domain/fieldCapture';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { addTvCustomer, createRfElement, linkRf, type RfElementDraft } from '../src/domain/rfCommands';
import type { RfElement } from '../src/model/rfSchemas';
import type { Cable } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Office Tester' };

function ok<T>(result: CommandResult<T>): { value: T; patch: Partial<NetworkData> } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as Partial<NetworkData> };
}

const line = (id: string, fiberCount: number, from: string, to: string, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters: 500, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** A fiber splitter with 6 PON customers, and a Cable TV line (headend to a tap on a pole) with 2 TV customers. */
function network() {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 2 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'POLE-N', type: 'Telecom Pole', lat: 17.42, lng: 78.42 }),
      equipment({ id: 'POLE-T', type: 'Telecom Pole', lat: 17.421, lng: 78.421 }),
    ],
    cables: [line('FDR-1', 24, 'ODF-1', 'JC-1', { type: 'Main Feeder Fiber' }), line('DST-1', 12, 'JC-1', 'FAT-1'), line('CAB-TV', 12, 'ODF-1', 'POLE-N')],
    rfElements: [],
    rfLinks: [],
    rfLevels: [],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 12 }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 1 }, ctx));
  step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3 }, ctx));
  const splitter = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const pon: string[] = [];
  for (let n = 1; n <= 6; n += 1) {
    pon.push(step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: n, name: `Home ${n}`, lat: 17.411, lng: 78.411 + n / 10000 }, ctx)).customer.id);
  }
  const add = (draft: RfElementDraft): RfElement => step(createRfElement(data, draft, ctx));
  const he = add({ kind: 'headend', name: 'HE-1' });
  const tx = add({ kind: 'optical_transmitter', name: 'TX-1', wavelengthNm: 1550 });
  const edfa = add({ kind: 'edfa', name: 'EDFA-1', edfaKind: 'plain', outputs: 2 });
  const node = add({ kind: 'mini_node', name: 'MN-1', powered: true, siteEquipmentId: 'POLE-N' });
  const tap = add({ kind: 'tap', name: 'TAP-1', outputs: 4, tapValueDb: 26, throughLossDb: 1.5, siteEquipmentId: 'POLE-T' });
  const link = (from: [RfElement, string], to: [RfElement, string], extra: Record<string, unknown>) =>
    step(linkRf(data, { from: { elementId: from[0].id, portId: from[1] }, to: { elementId: to[0].id, portId: to[1] }, medium: 'coax', ...extra } as never, ctx));
  link([he, 'OUT'], [tx, 'RFIN'], { medium: 'jumper' });
  link([tx, 'OPTOUT'], [edfa, 'OPTIN'], { medium: 'jumper' });
  link([edfa, 'OUT1'], [node, 'OPTIN'], { medium: 'fiber', cableId: 'CAB-TV', fiberNumber: 3, wavelengthsNm: [1550], lengthM: 2000 });
  link([node, 'RFOUT1'], [tap, 'IN'], { coaxType: 'RG11', lengthM: 100, lengthSource: 'sheath' });
  const tv = ['DROP1', 'DROP2'].map(
    (portId, i) => step(addTvCustomer(data, { name: `TV ${i + 1}`, tap: { elementId: tap.id, portId }, device: { kind: 'stb' }, drop: { coaxType: 'RG6', lengthM: 20, lengthSource: 'estimate' } }, ctx)).customer.id,
  );
  return { data, splitter, pon, tv };
}

describe('Cable TV customers in fault impact (recorded RF links only)', () => {
  it('keeps TV customers off the PON paths and lists them behind the RF items and cables they hang on', () => {
    const { data, splitter, tv } = network();
    const ix = buildImpactIndex(data);
    expect(tv.every((id) => ix.tv.has(id) && !ix.paths.has(id))).toBe(true);
    for (const el of [{ type: 'equipment' as const, id: 'POLE-T' }, { type: 'equipment' as const, id: 'POLE-N' }, { type: 'cable' as const, id: 'CAB-TV' }, { type: 'core' as const, id: 'CAB-TV', fiberNumber: 3 }]) {
      const impact = affectedByElement(ix, el);
      expect(impact.affected.map((a) => a.customerId).sort(), `${el.type} ${el.id}`).toEqual([...tv].sort());
      expect(impact.affected.every((a) => a.network === 'hfc' && a.pathComplete)).toBe(true);
    }
    expect(affectedByElement(ix, { type: 'core', id: 'CAB-TV', fiberNumber: 4 }).affected).toEqual([]);
    // A PON splitter carries no TV customer, and they are not "may be affected" there either.
    const onSplitter = affectedByElement(ix, { type: 'splitter', id: splitter.id });
    expect([...onSplitter.affected, ...onSplitter.mayBeAffected].some((c) => tv.includes(c.customerId))).toBe(false);
    // A fault opened on the tap's pole stores the TV customers from the RF links.
    expect(ok(openFault(data, { element: { type: 'equipment', id: 'POLE-T' } }, ctx)).value.affectedCustomerIds.sort()).toEqual([...tv].sort());
  });

  it('a TV customer with an alarm does not lower the confidence of a fiber suspicion, and TV alarms group on the tap', () => {
    const { data, splitter, pon, tv } = network();
    const alarms = ok(raiseTestEvent(data, { kind: 'ont_los', elements: [...pon.slice(0, 5), ...tv].map((id) => ({ type: 'customer' as const, id })) }, ctx));
    const d = applyPatch(data, alarms.patch);
    const result = correlateAlarms(buildImpactIndex(d), d.alarms ?? []);
    const fiber = result.suspicions.find((s) => s.element.type === 'splitter' && s.element.id === splitter.id)!;
    expect(fiber.confidence).toBe('high');
    expect(fiber.missing.join(' ')).not.toContain(tv[0]);
    const onTap = result.suspicions.find((s) => s.element.type === 'equipment' && s.element.id === 'POLE-T')!;
    expect(onTap.downCustomerIds.sort()).toEqual([...tv].sort());
    expect(onTap.evidence.join(' ')).toContain('Cable TV links');
  });
});

describe('danger reports from the field in the alarm grouping', () => {
  it('names an open danger report with no element in a note, and lists one with an element as evidence', () => {
    const { data, tv } = network();
    const ix = buildImpactIndex(data);
    const hazard = buildHazardFault({ id: 'FLT-HAZ1', photoId: 'PH-1', location: { lat: 17.421, lng: 78.421, accuracyMeters: 5, method: 'gps', samples: 3 } as never, now: NOW, capturedBy: 'Ravi' });
    expect(hazard.source).toBe('field_report');
    const loose = correlateAlarms(ix, [], undefined, [hazard]);
    expect(loose.suspicions).toEqual([]);
    expect(loose.notes.join(' ')).toContain('FLT-HAZ1');
    expect(loose.notes.join(' ')).toContain('nothing is placed by distance');
    const placed = correlateAlarms(ix, [], undefined, [{ ...hazard, element: { type: 'equipment', id: 'POLE-T' } }]);
    expect(placed.suspicions).toHaveLength(1);
    expect(placed.suspicions[0]).toMatchObject({ faultIds: ['FLT-HAZ1'], behindCount: tv.length, isTest: false });
    expect(placed.suspicions[0].evidence[0]).toContain('Danger reported from the field');
    // A closed one is not evidence any more.
    expect(correlateAlarms(ix, [], undefined, [{ ...hazard, status: 'Closed' }]).notes).toEqual([]);
  });
});
