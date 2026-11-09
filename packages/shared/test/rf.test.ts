import { describe, expect, it } from 'vitest';

import {
  addTvCustomer,
  applyPatch,
  buildRfTree,
  type Cable,
  checkChangeSetRf,
  coaxLossDb,
  createRfElement,
  customerRfPath,
  DEFAULT_RF_SETTINGS,
  disconnectTvCustomer,
  estimateRfLevels,
  findFiberProblems,
  findRfProblems,
  formatRfBoth,
  indexRf,
  linkRf,
  type NetworkData,
  portKey,
  profileWindowDbuv,
  recordRfLevel,
  resolveRfSettings,
  type RfElement,
  type RfElementDraft,
  rfProblemsOf,
  toDbuv,
  traceRfUpstream,
  trueRfLevelDbuv,
  unlinkRf,
} from '../src';

const now = new Date('2026-11-08T10:00:00Z');
const ctx = { now, actor: 'Test Engineer' };

const fiberCable: Cable = {
  id: 'CAB-F1', name: 'Feeder A', type: 'Feeder Cable' as Cable['type'], fiberCount: 12, lengthMeters: 2000, owner: '', installationDate: '2026-01-01',
  status: 'Active', remarks: '', coordinates: [], cableCategory: 'Fiber', cores: [],
} as Cable;

const empty = (): NetworkData => ({
  equipment: [], cables: [fiberCable], splitters: [], closures: [], customers: [], faults: [], workOrders: [], zones: [], documents: [],
  rfElements: [], rfLinks: [], rfLevels: [],
});

/** Runs a command and applies it, failing the test when it is refused. Warnings are accepted. */
function must<T>(data: NetworkData, result: ReturnType<typeof createRfElement> | { ok: boolean }): { data: NetworkData; value: T } {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify((result as { error: unknown }).error)}`);
  const ok = result as unknown as { value: T; patch: Partial<NetworkData> };
  return { data: applyPatch(data, ok.patch), value: ok.value };
}

function add(data: NetworkData, draft: RfElementDraft): { data: NetworkData; el: RfElement } {
  const r = must<RfElement>(data, createRfElement(data, draft, ctx));
  return { data: r.data, el: r.value };
}

/** Example D: headend → transmitter → EDFA → fiber → node → amplifier → coax → tap → set top box. */
export function exampleD() {
  let d = empty();
  const he = add(d, { kind: 'headend', name: 'HE-1' }); d = he.data;
  const tx = add(d, { kind: 'optical_transmitter', name: 'TX-1', wavelengthNm: 1550 }); d = tx.data;
  const edfa = add(d, { kind: 'edfa', name: 'EDFA-1', edfaKind: 'plain', outputs: 2 }); d = edfa.data;
  const node = add(d, { kind: 'mini_node', name: 'MN-1', powered: true, ratedOutputDbuv: 80, ratedAtInputDbm: -8, tiltDb: 0 }); d = node.data;
  const amp = add(d, { kind: 'rf_amplifier', name: 'AMP-1', gainDb: 20, tiltDb: 12, powerFeed: 'local' }); d = amp.data;
  const tap = add(d, { kind: 'tap', name: 'TAP-1', outputs: 4, tapValueDb: 26, throughLossDb: 1.5 }); d = tap.data;
  const link = (from: [RfElement, string], to: [RfElement, string], extra: Record<string, unknown>) => {
    d = must(d, linkRf(d, { from: { elementId: from[0].id, portId: from[1] }, to: { elementId: to[0].id, portId: to[1] }, medium: 'coax', ...extra } as never, ctx)).data;
  };
  link([he.el, 'OUT'], [tx.el, 'RFIN'], { medium: 'jumper' });
  link([tx.el, 'OPTOUT'], [edfa.el, 'OPTIN'], { medium: 'jumper' });
  link([edfa.el, 'OUT1'], [node.el, 'OPTIN'], { medium: 'fiber', cableId: 'CAB-F1', fiberNumber: 3, wavelengthsNm: [1550], lengthM: 2000 });
  link([node.el, 'RFOUT1'], [amp.el, 'IN'], { coaxType: 'RG11', lengthM: 100, lengthSource: 'sheath' });
  link([amp.el, 'OUT1'], [tap.el, 'IN'], { coaxType: 'RG11', lengthM: 100, lengthSource: 'sheath' });
  // Light out of the EDFA, as designed.
  d = must(d, recordRfLevel(d, { elementId: edfa.el.id, portId: 'OUT1', value: 3, unit: 'dBm', origin: 'designed', source: 'Design sheet' }, ctx)).data;
  return { d, he: he.el, tx: tx.el, edfa: edfa.el, node: node.el, amp: amp.el, tap: tap.el };
}

describe('RF units', () => {
  it('converts dBmV to dBµV by adding 60, and dBm at 75 ohm by 108.75', () => {
    expect(toDbuv(12, 'dBmV')).toBe(72);
    expect(toDbuv(0, 'dBm')).toBeCloseTo(108.75);
    expect(toDbuv(-10, 'dBm', 'optical')).toBeUndefined();
    expect(formatRfBoth(72)).toBe('72.0 dBµV (12.0 dBmV)');
    expect(formatRfBoth(undefined)).toBe('Not recorded');
  });
  it('adds the test point offset to a reading', () => {
    expect(trueRfLevelDbuv({ value: 80, unit: 'dBuV', testPointOffsetDb: 20 })).toBe(100);
    expect(trueRfLevelDbuv({ value: 20, unit: 'dBmV', testPointOffsetDb: 20 })).toBe(100);
  });
  it('scales coax loss with the square root of frequency', () => {
    const at750 = coaxLossDb({ coaxType: 'RG11', lengthM: 100 }, 750) as number;
    expect(at750).toBeCloseTo(11.9);
    expect(coaxLossDb({ coaxType: 'RG11', lengthM: 100 }, 3000)).toBeCloseTo(23.8);
    expect(coaxLossDb({ coaxType: 'RG11' }, 750)).toBe('coax length not recorded');
    expect(coaxLossDb({ lengthM: 10 }, 750)).toBe('coax type not recorded');
  });
});

describe('RF settings', () => {
  it('marks every value as proposed and lets the profile be switched', () => {
    const s = resolveRfSettings([{ id: 'rf.profile.active', value: 'docsis30' }]);
    expect(s.activeProfile).toBe('docsis30');
    expect(profileWindowDbuv(s.profiles.docsis30, 600)).toEqual({ min: 45, max: 75 });
    expect(profileWindowDbuv(DEFAULT_RF_SETTINGS.profiles.indian_stb, 100).min).toBe(60);
    expect(profileWindowDbuv(DEFAULT_RF_SETTINGS.profiles.indian_stb, 600).min).toBe(57);
    expect(resolveRfSettings([{ id: 'rf.profile.active', value: 'made_up' }]).activeProfile).toBe('indian_stb');
  });
});

const tvCustomer = (d: NetworkData, tap: RfElement, portId = 'DROP1') =>
  addTvCustomer(d, { name: 'Test TV customer', tap: { elementId: tap.id, portId }, device: { kind: 'stb' }, drop: { coaxType: 'RG6', lengthM: 20, lengthSource: 'estimate' } }, ctx);

describe('Example D: the RF tree', () => {
  it('traces a set top box up to the headend through every recorded link', () => {
    const x = exampleD();
    const r = must<{ customer: { id: string }; device: RfElement }>(x.d, tvCustomer(x.d, x.tap));
    const path = customerRfPath(r.data as never, r.value.customer.id);
    expect(path.gap).toBeUndefined();
    expect(path.trace?.complete).toBe(true);
    expect(path.trace?.steps.map((s) => s.element.name)).toEqual(['HE-1', 'TX-1', 'EDFA-1', 'MN-1', 'AMP-1', 'TAP-1', r.value.device.name]);
    const tree = buildRfTree(r.data as never);
    expect(tree.roots).toHaveLength(1);
    expect(tree.detached).toHaveLength(0);
    expect(tree.counts.passive).toBe(1);
    expect(tree.counts.customerDevices).toBe(1);
  });

  it('estimates levels down the tree and keeps the unit right', () => {
    const x = exampleD();
    const r = must<{ device: RfElement }>(x.d, tvCustomer(x.d, x.tap));
    const est = estimateRfLevels(r.data as never);
    const nodeOut = est.get(portKey(x.node.id, 'RFOUT1'))!;
    // 3 dBm out of the EDFA, 2 km of fiber and one connector pair in Optical settings, then 2 dB RF per dB of light.
    expect(nodeOut.stop).toBeUndefined();
    expect(nodeOut.high).toBeGreaterThan(90);
    const stb = est.get(portKey(r.value.device.id, 'IN'))!;
    expect(stb.stop).toBeUndefined();
    expect(stb.low! - stb.high!).toBeGreaterThan(5);
    expect(stb.basis.join(' ')).toContain('TAP-1 DROP 1: −26 dB (as entered)');
  });

  it('names the exact gap when a link is taken out, and keeps the old link', () => {
    const x = exampleD();
    const r = must<{ customer: { id: string } }>(x.d, tvCustomer(x.d, x.tap));
    const ampToTap = r.data.rfLinks!.find((l) => l.to.elementId === x.tap.id)!;
    const cut = must(r.data, unlinkRf(r.data, ampToTap.id, 'Cable cut by road work', ctx)).data;
    const path = customerRfPath(cut as never, r.value.customer.id);
    expect(path.trace?.complete).toBe(false);
    expect(path.gap).toContain('Tap TAP-1 has no recorded link on its IN port.');
    expect(path.gap).toContain('RF amplifier AMP-1, OUT 1 was taken out on 2026-11-08: Cable cut by road work');
    expect(cut.rfLinks!.find((l) => l.id === ampToTap.id)?.status).toBe('removed');
    expect(estimateRfLevels(cut as never).get(portKey(x.tap.id, 'DROP1'))?.stop).toContain('TAP-1 IN has no recorded link');
  });

  it('refuses a second house wire on one tap port, in the command and in the server check', () => {
    const x = exampleD();
    const first = must<{ device: RfElement }>(x.d, tvCustomer(x.d, x.tap));
    const again = tvCustomer(first.data, x.tap);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain('TAP-1, DROP 1 already feeds');
    // A change set sent straight to the server with a second link from the same port.
    const extra = { ...first.data.rfLinks!.at(-1)!, id: 'RFL-SECOND', to: { elementId: x.amp.id, portId: 'IN' } };
    const errors = checkChangeSetRf(first.data as never, { upserts: { rfLinks: [extra] } });
    expect(errors.map((e) => e.code)).toContain('rf_tap_port_used');
  });

  it('refuses a loop, light into an RF port, a link from an input, and PON light through a plain EDFA', () => {
    const x = exampleD();
    const a2 = add(x.d, { kind: 'rf_amplifier', name: 'AMP-L2', gainDb: 20 });
    const a3 = add(a2.data, { kind: 'rf_amplifier', name: 'AMP-L3', gainDb: 20 });
    const half = must(a3.data, linkRf(a3.data, { from: { elementId: a2.el.id, portId: 'OUT1' }, to: { elementId: a3.el.id, portId: 'IN' }, medium: 'jumper' }, ctx)).data;
    const loop = linkRf(half, { from: { elementId: a3.el.id, portId: 'OUT1' }, to: { elementId: a2.el.id, portId: 'IN' }, medium: 'jumper' }, ctx);
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.error.message).toContain('loop');
    const loopCheck = checkChangeSetRf(x.d as never, { upserts: { rfLinks: [{ id: 'L', from: { elementId: x.tap.id, portId: 'OUT' }, to: { elementId: x.node.id, portId: 'OPTIN' }, medium: 'jumper', status: 'active', createdAt: '' }] } });
    expect(loopCheck.map((e) => e.code)).toContain('rf_signal_mismatch');
    const amp2 = add(x.d, { kind: 'rf_amplifier', name: 'AMP-2', gainDb: 20 });
    const wrongWay = linkRf(amp2.data, { from: { elementId: amp2.el.id, portId: 'IN' }, to: { elementId: x.tap.id, portId: 'DROP2' }, medium: 'coax' }, ctx);
    expect(wrongWay.ok).toBe(false);
    const fiberLink = x.d.rfLinks!.find((l) => l.medium === 'fiber')!;
    const pon = checkChangeSetRf(x.d as never, { upserts: { rfLinks: [{ ...fiberLink, wavelengthsNm: [1550, 1490, 1310] }] } });
    expect(pon.map((e) => e.code)).toContain('rf_pon_through_edfa');
  });

  it('refuses a 1310 nm transmitter into an EDFA', () => {
    let d = empty();
    const tx = add(d, { kind: 'optical_transmitter', name: 'TX-13', wavelengthNm: 1310 }); d = tx.data;
    const edfa = add(d, { kind: 'edfa', name: 'EDFA-9', edfaKind: 'plain' }); d = edfa.data;
    const r = linkRf(d, { from: { elementId: tx.el.id, portId: 'OPTOUT' }, to: { elementId: edfa.el.id, portId: 'OPTIN' }, medium: 'jumper' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('1310 nm');
  });
});

describe('RF levels and checks', () => {
  it('stores a dBmV reading with its unit and checks it as dBµV against the profile', () => {
    const x = exampleD();
    const r = must<{ device: RfElement }>(x.d, tvCustomer(x.d, x.tap));
    const low = recordRfLevel(r.data, { elementId: r.value.device.id, portId: 'IN', value: -5, unit: 'dBmV', origin: 'field_measured', frequencyMhz: 600, technician: 'Ravi' }, ctx);
    expect(low.ok).toBe(true);
    const after = must(r.data, low).data;
    expect(after.rfLevels!.at(-1)).toMatchObject({ value: -5, unit: 'dBmV', origin: 'field_measured' });
    const codes = findRfProblems(after as never).map((p) => p.code);
    expect(codes).toContain('rf_level_outside_profile'); // 55 dBµV is below 57.
  });

  it('flags a reading above the estimate, refuses a measured level with no source and a stored estimate', () => {
    const x = exampleD();
    const r = must<{ device: RfElement }>(x.d, tvCustomer(x.d, x.tap));
    const high = must(r.data, recordRfLevel(r.data, { elementId: r.value.device.id, portId: 'IN', value: 130, unit: 'dBuV', origin: 'field_measured', frequencyMhz: 862, technician: 'Ravi' }, ctx)).data;
    expect(findRfProblems(high as never).map((p) => p.code)).toContain('rf_level_above_estimate');
    const noSource = recordRfLevel(r.data, { elementId: r.value.device.id, portId: 'IN', value: 70, unit: 'dBuV', origin: 'field_measured', frequencyMhz: 600 }, ctx);
    expect(noSource.ok).toBe(false);
    const calc = recordRfLevel(r.data, { elementId: r.value.device.id, portId: 'IN', value: 70, unit: 'dBuV', origin: 'calculated' as never, frequencyMhz: 600 }, ctx);
    expect(calc.ok).toBe(false);
  });

  it('never applies PON splitter rules to RF parts', () => {
    // A 3-way RF splitter with a 3.5 dB leg is below 10·log10(3) = 4.8 dB, which a PON rule refuses.
    const x = exampleD();
    const sp = add(x.d, { kind: 'rf_splitter', name: 'SPL-3', outputs: 3, portLosses: { OUT1: 3.5, OUT2: 7, OUT3: 7 } });
    expect(findRfProblems(sp.data as never).filter((p) => p.severity === 'error')).toHaveLength(0);
    expect(findFiberProblems(sp.data as never)).toHaveLength(0);
  });

  it('asks whether a mini-node is powered, and says so when a passive node has no light recorded', () => {
    const r = createRfElement(empty(), { kind: 'mini_node', name: 'MN-X' }, ctx);
    expect(r.ok).toBe(false);
    const passive = add(empty(), { kind: 'mini_node', name: 'MN-P', powered: false });
    expect(findRfProblems(passive.data as never).map((p) => p.code)).toContain('rf_passive_node_no_light');
  });

  it('frees the tap port on disconnect and keeps the old link as history', () => {
    const x = exampleD();
    const r = must<{ customer: { id: string } }>(x.d, tvCustomer(x.d, x.tap));
    const off = must(r.data, disconnectTvCustomer(r.data, r.value.customer.id, 'Moved away', ctx)).data;
    expect(off.customers[0].status).toBe('Disconnected');
    expect(tvCustomer(off, x.tap).ok).toBe(true);
    expect(traceRfUpstream(indexRf(off as never), x.tap.id).complete).toBe(true);
  });
});

describe('Adding a new Cable TV item', () => {
  it('does not ask "Save anyway?" just because a new item is not linked yet', () => {
    const he = add(empty(), { kind: 'headend', name: 'HE-1' });
    const r = createRfElement(he.data, { kind: 'optical_transmitter', name: 'TX-1', wavelengthNm: 1550 }, ctx);
    expect(r.ok).toBe(true);
    expect((r as { confirm?: string }).confirm).toBeUndefined();
    // The gap is still reported on the Checks tab.
    const after = applyPatch(he.data, (r as unknown as { patch: Partial<NetworkData> }).patch);
    expect(rfProblemsOf(after).some((p) => p.code === 'rf_not_linked')).toBe(true);
  });

  it('still asks about other warnings, such as an amplifier with no gain recorded', () => {
    const r = createRfElement(empty(), { kind: 'rf_amplifier', name: 'AMP-9', powerFeed: 'local' }, ctx);
    expect(r.ok).toBe(true);
    expect((r as { confirm?: string }).confirm).toMatch(/gain not recorded/);
  });
});
