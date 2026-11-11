import { describe, expect, it } from 'vitest';

import { roleCan } from '../src/domain/access';
import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import {
  addOdfPanel,
  createClosure,
  patchOdfPort,
  recordSplice,
  setCableLayout,
  setOdfPortFeeder,
  updatePonPort,
} from '../src/domain/fiberCommands';
import { traceCustomerCores } from '../src/domain/fiberPath';
import { calculateOpticalLossBudget } from '../src/domain/lossEngine';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { BUDGET_FORMULA, budgetRunsFor, checkChangeSetBudgetRuns, fibrePathBudget, storeBudgetRun } from '../src/domain/opticalBudget';
import { traceOpticalPath } from '../src/domain/opticalPathTrace';
import { resolveOpticalSettings } from '../src/domain/opticalSettings';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { COLLECTION_NAMES } from '../src/model/collections';
import { type OpticalBudgetRun, opticalBudgetRunSchema } from '../src/model/opticalBudgetSchemas';
import type { Cable } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

/** Network mapping Phase 17: every budget input says where it came from; no verdict on a guess; stored runs. */

const ctx = { now: NOW, actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData };
}

const fiberCable = (id: string, fiberCount: number, from: string, to: string, lengthMeters: number, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** OLT → patch → ODF → feeder (OTDR length) → measured splice → distribution (drawn) → splitter → drop → ONT, built with the real commands. */
function network(opts: { opticsClass?: boolean } = {}) {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
    ],
    cables: [fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', 3000, { type: 'Main Feeder Fiber', opticalLengthMeters: 3120 }), fiberCable('DST-1', 12, 'JC-1', 'FAT-1', 1500)],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  if (opts.opticsClass !== false) step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+', txPowerDbm: 3 }, ctx));
  step(setCableLayout(data, 'FDR-1', { colorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 24 }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 1 }, ctx));
  step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3, spliceLossDb: 0.05, lossSource: 'field_measured' }, ctx));
  const splitter = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const provisioned = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: 2, name: 'Asha Rani', lat: 17.411, lng: 78.411 }, ctx));
  return { data, splitter, customer: provisioned.customer };
}

const line = (budget: ReturnType<typeof fibrePathBudget>, key: string) => budget.inputs.find((l) => l.key === key || l.key.startsWith(`${key}:`) || l.key.startsWith(key));

describe('budget inputs and where they came from', () => {
  it('labels each input: record, drawn line, setting copy, default', () => {
    const { data, customer } = network();
    const path = traceCustomerCores(customer, data);
    expect(path.complete).toBe(true);
    const budget = fibrePathBudget(path, { splitters: data.splitters, customer });
    expect(line(budget, 'opticsClass')).toMatchObject({ value: 'GPON B+', origin: 'record' });
    expect(line(budget, 'launch')).toMatchObject({ value: '3 dBm', origin: 'record' });
    // Lengths: OTDR on the feeder, the drawn line elsewhere.
    expect(budget.inputs.find((l) => l.key.startsWith('length:FDR-1'))).toMatchObject({ number: 3120, origin: 'record' });
    expect(budget.inputs.find((l) => l.key.startsWith('length:DST-1'))).toMatchObject({ number: 1500, origin: 'map' });
    // The splice loss was measured; the splitter loss was copied from the settings when it was added.
    expect(budget.inputs.find((l) => l.key.startsWith('splice:'))).toMatchObject({ number: 0.05, origin: 'record' });
    expect(budget.inputs.find((l) => l.key.startsWith('splice:'))!.source).toContain('measured on site');
    const sp = budget.inputs.find((l) => l.key.startsWith('splitter:'))!;
    expect(sp).toMatchObject({ number: 10.4, origin: 'default' });
    expect(sp.source).toContain('Replace it with the datasheet value');
    // Settings nobody changed are built-in defaults, named with their setting id.
    expect(line(budget, 'fiber.1490')).toMatchObject({ origin: 'default', settingId: 'optical.fiber.1490' });
    expect(line(budget, 'connectors.loss')).toMatchObject({ origin: 'default', settingId: 'optical.connector.pair' });
    expect(line(budget, 'connectors.count')).toMatchObject({ number: 4, origin: 'record' });
    expect(line(budget, 'reading')).toMatchObject({ origin: 'not_recorded' });
    expect(budget.flagged.every((l) => l.origin !== 'record')).toBe(true);
    expect(budget.flagged.map((l) => l.key)).toEqual(expect.arrayContaining(['fiber.1490', 'fiber.1310', 'connectors.loss', 'margin']));
  });

  it('names the operator setting and the source they wrote', () => {
    const { data, customer } = network();
    const overrides = [{ id: 'optical.connector.pair', value: 0.5, source: 'Our 2026 acceptance test' }];
    const settings = resolveOpticalSettings(overrides);
    const path = traceCustomerCores(customer, data, { settings });
    const budget = fibrePathBudget(path, { settings, overrides, splitters: data.splitters });
    expect(line(budget, 'connectors.loss')).toMatchObject({ value: '0.5 dB', origin: 'setting' });
    expect(line(budget, 'connectors.loss')!.source).toContain('Our 2026 acceptance test');
    expect(budget.directions[0].connectorLossDb).toBe(2);
  });

  it('writes the sum out with the numbers it used, from the one calculation', () => {
    const { data, customer } = network();
    const path = traceCustomerCores(customer, data);
    const budget = fibrePathBudget(path, { splitters: data.splitters });
    const down = budget.directions.find((d) => d.direction === 'downstream')!;
    // Same totals as the fibre path's own call to calculateOpticalLossBudget: nothing is summed twice.
    expect(down.totalLossDb).toBe(path.directions[0].budget.totalLossDb);
    expect(down.formula).toContain(`= ${down.totalLossDb.toFixed(2)} dB.`);
    expect(down.formula).toContain('0.25 dB/km');
    expect(down.formula).toContain('splitters 10.4');
    expect(down.formula).toContain('splices 0.05');
    expect(down.formula).toContain('4 connector pairs × 0.3 dB');
    expect(down.formula).toContain('launch 3 dBm (recorded)');
    expect(budget.formula).toBe(BUDGET_FORMULA);
    expect(['fits_with_margin', 'fits_under_margin', 'too_little_loss', 'over_budget']).toContain(budget.outcome);
  });
});

describe('no verdict on an assumed optics class', () => {
  it('says "Estimated with default class" and gives no pass or fail', () => {
    const { data, customer } = network({ opticsClass: false });
    const path = traceCustomerCores(customer, data);
    expect(path.complete).toBe(true);
    expect(path.opticsClassRecorded).toBe(false);
    expect(path.verdict).toBeUndefined();
    expect(path.directions[0].budget).toMatchObject({ verdict: 'Estimated With Default Class', verdictWithheld: 'default_class', opticsClassRecorded: false });
    const budget = fibrePathBudget(path, { splitters: data.splitters });
    expect(budget.outcome).toBe('estimated_default_class');
    expect(budget.directions.every((d) => d.outcome === 'estimated_default_class')).toBe(true);
    expect(line(budget, 'opticsClass')).toMatchObject({ origin: 'default', value: 'GPON B+ (assumed)' });
    expect(budget.outcomeText).toContain('Estimated with default class');
    expect(budget.outcomeText).not.toMatch(/fits|over budget/i);
    // The route trace screen says the same.
    expect(traceOpticalPath(customer.id, data)!.budget.verdict).toBe('Estimated With Default Class');
  });

  it('keeps the old behaviour when the caller states the class', () => {
    const r = calculateOpticalLossBudget({ totalDistanceMeters: 2000, splitters: ['1:8'], opticsClass: 'GPON B+' });
    expect(r.verdictWithheld).toBeUndefined();
    expect(r.verdict).not.toBe('Estimated With Default Class');
    const assumed = calculateOpticalLossBudget({ totalDistanceMeters: 2000, splitters: ['1:8'], opticsClass: 'GPON B+', opticsClassRecorded: false });
    expect(assumed.verdict).toBe('Estimated With Default Class');
    expect(assumed.totalLossDb).toBe(r.totalLossDb);
  });
});

describe('unknown splitters', () => {
  it('shows a splitter with no loss as unknown and gives no budget', () => {
    const { data, customer, splitter } = network();
    const unknown = { ...data, splitters: data.splitters.map((s) => (s.id === splitter.id ? { ...s, insertionLossDb: 0, lossSource: undefined } : s)) };
    const path = traceCustomerCores(customer, unknown);
    const budget = fibrePathBudget(path, { splitters: unknown.splitters });
    expect(budget.inputs.find((l) => l.key.startsWith('splitter:'))).toMatchObject({ value: 'Unknown', origin: 'not_recorded' });
    expect(budget.inputs.find((l) => l.key.startsWith('splitter:'))!.number).toBeUndefined();
    expect(budget.complete).toBe(false);
    expect(budget.directions).toEqual([]);
    expect(budget.outcome).toBeUndefined();
    expect(budget.outcomeText).toContain('No budget');
    expect(storeBudgetRun(unknown, { path }, ctx).ok).toBe(false);
  });

  it('never gives a pass or fail when a ratio has no loss anywhere', () => {
    const r = calculateOpticalLossBudget({ totalDistanceMeters: 1000, splitters: ['1:7'], opticsClass: 'GPON B+' });
    expect(r.unknownSplitters).toEqual(['1:7']);
    expect(r.verdict).toBe('Incomplete');
    expect(r.verdictWithheld).toBe('unknown_splitter');
    expect(r.verdictDescription).toContain('1:7');
  });
});

describe('stored budget runs', () => {
  it('stores a run with time, who, inputs, result and formula, and changes no network record', () => {
    const { data, customer } = network();
    const path = traceCustomerCores(customer, data);
    const r = ok(storeBudgetRun(data, { path, note: 'Before handover' }, ctx));
    expect(Object.keys(r.patch)).toEqual(['opticalBudgetRuns']);
    const run = r.value;
    expect(opticalBudgetRunSchema.safeParse(run).success).toBe(true);
    expect(run).toMatchObject({ ranAt: NOW.toISOString(), ranBy: 'Test Engineer', target: { kind: 'customer', id: customer.id }, oltId: 'OLT-1', ponPortId: 'PON-01', opticsClassRecorded: true, note: 'Before handover' });
    expect(run.inputs.length).toBeGreaterThan(8);
    expect(run.directions).toHaveLength(2);
    expect(run.formula).toBe(BUDGET_FORMULA);
    // A run is read by every role: never the customer's name.
    expect(JSON.stringify(run)).not.toContain('Asha Rani');
    const after = applyPatch(data, r.patch);
    expect(budgetRunsFor(after, customer.id).map((x) => x.id)).toEqual([run.id]);
    expect(after.customers).toBe(data.customers);
    expect(after.cables).toBe(data.cables);
  });

  it('refuses a delete, a change, and a pass or fail with an assumed class', () => {
    const { data, customer } = network();
    const run = ok(storeBudgetRun(data, { path: traceCustomerCores(customer, data) }, ctx)).value;
    const stored = (id: string) => (id === run.id ? run : undefined);
    expect(checkChangeSetBudgetRuns({ upserts: { opticalBudgetRuns: [run] } }, stored)).toEqual([]);
    expect(checkChangeSetBudgetRuns({ upserts: { opticalBudgetRuns: [run] } }, () => undefined)).toEqual([]);
    expect(checkChangeSetBudgetRuns({ deletes: { opticalBudgetRuns: [run.id] } }, stored)[0].message).toContain('cannot be deleted');
    const edited: OpticalBudgetRun = { ...run, ranBy: 'Someone else' };
    expect(checkChangeSetBudgetRuns({ upserts: { opticalBudgetRuns: [edited] } }, stored)[0].message).toContain('never changed');
    const guessed: OpticalBudgetRun = { ...run, id: 'OBR-X', opticsClassRecorded: false };
    expect(opticalBudgetRunSchema.safeParse(guessed).success).toBe(false);
    expect(checkChangeSetBudgetRuns({ upserts: { opticalBudgetRuns: [guessed] } }, () => undefined)).toHaveLength(1);
  });

  it('is a collection of its own that engineers and planners write', () => {
    expect(COLLECTION_NAMES).toContain('opticalBudgetRuns');
    expect(createSampleNetwork().opticalBudgetRuns).toEqual([]);
    expect(roleCan('engineer', 'create', 'opticalBudgetRuns')).toBe(true);
    expect(roleCan('office', 'create', 'opticalBudgetRuns')).toBe(true);
    expect(roleCan('office', 'delete', 'opticalBudgetRuns')).toBe(false);
    expect(roleCan('technician', 'create', 'opticalBudgetRuns')).toBe(false);
    expect(roleCan('viewer', 'create', 'opticalBudgetRuns')).toBe(false);
  });
});
