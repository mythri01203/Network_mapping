import { type PlanningScenario, planningScenarioSchema, type ScenarioItem, type ScenarioStatus } from '../model/planningSchemas';
import type { Equipment, PonPort, Splitter } from '../model/types';
import { cablesOnPoles, type CapacityData, equipmentPlanState, PLAN_STATE_WORDS } from './capacityPlanning';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { buildFiberIndex, type FiberIndex, splitterCapacity } from './fiberIndex';
import { newRecordId } from './ids';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { ductPlaces, fillLimit, formatFill } from './ospDucts';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { ponPortUsage } from './ponUsage';
import { splitterChain, splitterOutputUse, splitterPlace } from './splitterManagement';

/**
 * Network mapping Phase 18: expansion scenarios. A scenario holds planned additions in its own
 * collection (`planningScenarios`); nothing here writes or changes a network record. The "if built"
 * figures are worked out on top of the records each time, never stored and never added into the
 * built network's counts. A record a scenario names that is not on record is said so and not counted.
 */

const scenariosOf = (data: Partial<Pick<NetworkData, 'planningScenarios'>>): PlanningScenario[] => data.planningScenarios ?? [];

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export interface ScenarioDraft {
  name: string;
  purpose?: string;
  status?: ScenarioStatus;
  items?: ScenarioItem[];
}

/** A new id for a line of a scenario. */
export const newScenarioItemId = (random?: (bytes: Uint8Array) => Uint8Array): string => newRecordId('PLI-', random);

function checked(scenario: PlanningScenario): PlanningScenario | string {
  const parsed = planningScenarioSchema.safeParse(scenario);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return issue ? issue.message : 'The scenario is not complete.';
}

export function createScenario(data: NetworkData, draft: ScenarioDraft, ctx: CommandContext = {}): CommandResult<PlanningScenario> {
  const name = draft.name.trim();
  if (!name) return fail('Name needed', 'Give the scenario a name, such as "Ward 12 next 100 homes".');
  const now = (ctx.now ?? new Date()).toISOString();
  const scenario = checked({
    id: newRecordId('PLN-'),
    name,
    ...(draft.purpose?.trim() ? { purpose: draft.purpose.trim() } : {}),
    status: draft.status ?? 'open',
    items: draft.items ?? [],
    createdAt: now,
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
  });
  if (typeof scenario === 'string') return fail('Scenario not saved', scenario);
  return succeed(
    scenario,
    { planningScenarios: [...scenariosOf(data), scenario] },
    {
      notice: notice('success', 'Scenario saved', `${scenario.name} is a plan only. Nothing on the network was changed.`),
      audit: [{ action: 'SCENARIO_CREATED', details: `Planning scenario "${scenario.name}" (plan only)`, assetId: scenario.id, assetType: 'Scenario' }],
    },
  );
}

/** Saves a changed scenario (name, purpose, status, lines). */
export function saveScenario(data: NetworkData, scenario: PlanningScenario, ctx: CommandContext = {}): CommandResult<PlanningScenario> {
  const list = scenariosOf(data);
  if (!list.some((s) => s.id === scenario.id)) return fail('Scenario not found', `Scenario ${scenario.id} is not on record. It may have been deleted on another device.`);
  const next = checked({ ...scenario, name: scenario.name.trim(), updatedAt: (ctx.now ?? new Date()).toISOString(), ...(ctx.actor ? { updatedBy: ctx.actor } : {}) });
  if (typeof next === 'string') return fail('Scenario not saved', next);
  return succeed(
    next,
    { planningScenarios: list.map((s) => (s.id === next.id ? next : s)) },
    {
      notice: notice('success', 'Scenario saved', `${next.name}: ${next.items.length} planned line(s). Nothing on the network was changed.`),
      audit: [{ action: 'SCENARIO_UPDATED', details: `Planning scenario "${next.name}": ${next.items.length} line(s)`, assetId: next.id, assetType: 'Scenario' }],
    },
  );
}

export function deleteScenario(data: NetworkData, id: string): CommandResult<PlanningScenario> {
  const scenario = scenariosOf(data).find((s) => s.id === id);
  if (!scenario) return fail('Scenario not found', `Scenario ${id} is not on record.`);
  return succeed(
    scenario,
    { planningScenarios: scenariosOf(data).filter((s) => s.id !== id) },
    {
      notice: notice('info', 'Scenario deleted', `${scenario.name} was deleted. The network was not changed.`),
      audit: [{ action: 'SCENARIO_DELETED', details: `Planning scenario "${scenario.name}"`, assetId: id, assetType: 'Scenario' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* If built                                                            */
/* ------------------------------------------------------------------ */

export type ScenarioLineState = 'fits' | 'tight' | 'short' | 'not_known' | 'broken_ref';

export const SCENARIO_LINE_STATE_WORDS: Record<ScenarioLineState, string> = {
  fits: 'Fits',
  tight: 'Fits, with a warning',
  short: 'Short',
  not_known: 'Not known',
  broken_ref: 'Names a record not on file',
};

const RANK: Record<ScenarioLineState, number> = { fits: 0, tight: 1, not_known: 2, short: 3, broken_ref: 4 };

export interface ScenarioResultLine {
  itemId: string;
  /** The planned line in words. */
  what: string;
  /** The element looked at, such as "Splitter SPL-3 outputs" or "PON port OLT-1 port 2". */
  element: string;
  /** As recorded today. */
  now: string;
  /** If the scenario were built. */
  ifBuilt: string;
  shortBy?: number;
  state: ScenarioLineState;
  notes: string[];
}

export interface ScenarioResult {
  scenario: PlanningScenario;
  lines: ScenarioResultLine[];
  /** The worst state of any line ("fits" for an empty scenario). */
  worst: ScenarioLineState;
}

interface VirtualSplitter {
  id: string;
  name: string;
  capacity: number;
  free: number;
  boxId: string;
  root?: { oltId: string; ponPortId: string };
  /** Split product down to it, and whether every stage above is known. */
  product?: number;
  complete: boolean;
}

export interface ScenarioOptions {
  optical?: OpticalSettings;
  osp?: OspSettings;
}

/** "40 more customers on splitter SPL-3", "new 1:8 splitter in FAT-2", "24-fibre cable in duct D-1". */
export function describeScenarioItem(item: ScenarioItem, data?: Pick<CapacityData, 'equipment' | 'splitters' | 'ducts'>): string {
  const eq = (id: string) => data?.equipment.find((e) => e.id === id)?.name ?? id;
  if (item.kind === 'customers') {
    const where = item.splitterId
      ? `splitter ${data?.splitters.find((s) => s.id === item.splitterId)?.name ?? item.splitterId}`
      : item.boxId
        ? `box ${eq(item.boxId)}`
        : `${eq(item.oltId ?? '')} PON port ${item.ponPortId}`;
    return `${item.count} more customer(s) on ${where}`;
  }
  if (item.kind === 'splitter') {
    const feed = item.feed.kind === 'splitter' ? `fed from ${item.feed.splitterId}${item.feed.output ? ` output ${item.feed.output}` : ''}` : item.feed.kind === 'pon' ? `fed from ${eq(item.feed.oltId)} ${item.feed.ponPortId}` : 'feed not decided';
    return `New ${item.ratio} splitter${item.name ? ` "${item.name}"` : ''} in ${eq(item.boxId)}, ${feed}`;
  }
  const duct = item.ductId ? ` in duct ${data?.ducts?.find((d) => d.id === item.ductId)?.name ?? item.ductId}` : '';
  const poles = item.poleIds?.length ? ` on ${item.poleIds.length} pole(s)` : '';
  return `New ${item.fiberCount}-fibre cable${item.name ? ` "${item.name}"` : ''}${duct}${poles}`;
}

/**
 * The capacity "if built" for one scenario, line by line, on top of the records as they are. Lines
 * are taken in order, so a planned splitter can be used by customers listed after it, and two
 * planned cables do not both get the same free way. Nothing here is stored or changes a record.
 */
export function evaluateScenario(data: CapacityData, scenario: PlanningScenario, options: ScenarioOptions = {}): ScenarioResult {
  const optical = options.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const osp = options.osp ?? DEFAULT_OSP_SETTINGS;
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const splitters = new Map(data.splitters.map((s) => [s.id, s]));
  let index: FiberIndex | undefined;
  const fiberIndex = () => (index ??= buildFiberIndex({ equipment: data.equipment, cables: data.cables, splitters: data.splitters, closures: data.closures ?? [], customers: data.customers }));
  const virtual = new Map<string, VirtualSplitter>();
  const freeNow = new Map<string, number>();
  const ponExtra = new Map<string, number>();
  const ponTaken = new Set<string>();
  const ductTaken = new Map<string, Set<string>>();
  const ductExtra = new Map<string, Map<string, number[]>>();
  const poleExtra = new Map<string, number>();
  let poles: ReturnType<typeof cablesOnPoles> | undefined;

  const productionFree = (sp: Splitter) => {
    if (!freeNow.has(sp.id)) freeNow.set(sp.id, splitterOutputUse(data, sp).counts.free);
    return freeNow.get(sp.id)!;
  };
  const splitterFacts = (id: string): VirtualSplitter | undefined => {
    const v = virtual.get(id);
    if (v) return v;
    const sp = splitters.get(id);
    if (!sp) return undefined;
    const place = splitterPlace({ equipment: data.equipment, cables: data.cables, splitters: data.splitters, closures: data.closures ?? [], customers: data.customers }, sp.id, { index: fiberIndex(), settings: optical });
    const chain = place ?? splitterChain(fiberIndex(), sp);
    return {
      id: sp.id,
      name: sp.name,
      capacity: splitterCapacity(sp),
      free: productionFree(sp),
      boxId: sp.terminalBoxId,
      ...(chain.root ? { root: { oltId: chain.root.oltId, ponPortId: chain.root.ponPortId } } : {}),
      ...(place ? { product: place.split.product } : {}),
      complete: !!place?.split.complete,
    };
  };
  const takeOutputs = (id: string, n: number) => {
    if (virtual.has(id)) virtual.get(id)!.free -= n;
    else freeNow.set(id, (freeNow.get(id) ?? 0) - n);
  };
  const findPon = (oltId: string, ponPortId: string): { olt: Equipment; port: PonPort } | undefined => {
    const olt = byId.get(oltId);
    const port = olt?.ponPorts?.find((p) => p.id === ponPortId);
    return olt && port ? { olt, port } : undefined;
  };
  const ponLine = (itemId: string, what: string, oltId: string, ponPortId: string, adding: number): ScenarioResultLine => {
    const found = findPon(oltId, ponPortId);
    if (!found) return { itemId, what, element: `PON port ${oltId} ${ponPortId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`${oltId} ${ponPortId} is not a PON port on record.`] };
    const key = `${oltId}#${ponPortId}`;
    const base = (ponPortUsage(data, oltId, ponPortId)?.ontCount ?? 0) + (ponExtra.get(key) ?? 0);
    ponExtra.set(key, (ponExtra.get(key) ?? 0) + adding);
    const after = base + adding;
    const limit = found.port.maxOnu;
    const element = `PON port ${found.olt.name} port ${found.port.portNumber}`;
    const notes: string[] = [];
    if (equipmentPlanState(found.olt) !== 'built') notes.push(`${found.olt.name} is itself ${PLAN_STATE_WORDS[equipmentPlanState(found.olt)].toLowerCase()}, not built.`);
    if (found.port.status === 'Faulty') notes.push('The port is marked faulty.');
    if (limit === undefined) {
      notes.push('The ONU limit of this port is not recorded, so whether it fits is not known.');
      return { itemId, what, element, now: `${base} ONT(s)`, ifBuilt: `${after} ONT(s) · limit not recorded`, state: 'not_known', notes };
    }
    const short = after - limit;
    return {
      itemId,
      what,
      element,
      now: `${base} of ${limit} ONTs`,
      ifBuilt: short > 0 ? `${after} of ${limit} ONTs: over by ${short}` : `${after} of ${limit} ONTs (${limit - after} left)`,
      ...(short > 0 ? { shortBy: short } : {}),
      state: short > 0 || found.port.status === 'Faulty' ? 'short' : 'fits',
      notes,
    };
  };

  const lines: ScenarioResultLine[] = [];
  for (const item of scenario.items) {
    const what = describeScenarioItem(item, data);
    if (item.kind === 'splitter') {
      const box = byId.get(item.boxId);
      const capacity = splitterCapacity({ ratio: item.ratio });
      const name = item.name ?? `planned ${item.ratio} (${item.id})`;
      if (!box) {
        lines.push({ itemId: item.id, what, element: `Box ${item.boxId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`Box ${item.boxId} is not on record.`] });
        continue;
      }
      const v: VirtualSplitter = { id: item.id, name, capacity, free: capacity, boxId: box.id, complete: false };
      const notes: string[] = [];
      if (equipmentPlanState(box) !== 'built') notes.push(`${box.name} is itself ${PLAN_STATE_WORDS[equipmentPlanState(box)].toLowerCase()}, not built.`);
      if (item.feed.kind === 'not_decided') {
        notes.push('What feeds it is not decided, so its PON port and split are not known.');
        lines.push({ itemId: item.id, what, element: `New splitter in ${box.name}`, now: '—', ifBuilt: `${capacity} new outputs (if fed)`, state: 'not_known', notes });
      } else if (item.feed.kind === 'pon') {
        const found = findPon(item.feed.oltId, item.feed.ponPortId);
        if (!found) {
          lines.push({ itemId: item.id, what, element: `PON port ${item.feed.oltId} ${item.feed.ponPortId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`${item.feed.oltId} ${item.feed.ponPortId} is not a PON port on record.`] });
          continue;
        }
        const key = `${found.olt.id}#${found.port.id}`;
        const usage = ponPortUsage(data, found.olt.id, found.port.id);
        const odfPatched = data.equipment.some((e) => (e.odfPanels ?? []).some((p) => p.ports.some((x) => x.patch?.oltId === found.olt.id && x.patch.ponPortId === found.port.id)));
        const busy = ponTaken.has(key) || (usage?.ontCount ?? 0) > 0 || !!found.port.connectedFeederCableId || !!found.port.connectedSplitterId || odfPatched;
        if (found.port.status === 'Faulty') notes.push('The port is marked faulty.');
        if (busy) notes.push('This PON port already carries a tree (ONTs, a feeder, a patch or another planned splitter); a splitter straight on it needs a free port, or a place lower in its tree.');
        ponTaken.add(key);
        v.root = { oltId: found.olt.id, ponPortId: found.port.id };
        v.product = capacity;
        v.complete = true;
        lines.push({
          itemId: item.id,
          what,
          element: `PON port ${found.olt.name} port ${found.port.portNumber}`,
          now: busy ? 'Already in use' : found.port.status === 'Reserved' ? 'Reserved' : 'Free as recorded',
          ifBuilt: `Feeds the new splitter: ${capacity} new outputs`,
          state: busy || found.port.status === 'Faulty' ? 'short' : found.port.status === 'Reserved' ? 'tight' : 'fits',
          notes,
        });
      } else {
        const parent = splitterFacts(item.feed.splitterId);
        if (!parent) {
          lines.push({ itemId: item.id, what, element: `Splitter ${item.feed.splitterId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`Splitter ${item.feed.splitterId} is not on record or earlier in this scenario.`] });
          continue;
        }
        let state: ScenarioLineState = 'fits';
        const before = parent.free;
        const output = item.feed.output;
        if (output !== undefined && output > parent.capacity) {
          state = 'broken_ref';
          notes.push(`${parent.name} has ${parent.capacity} outputs; there is no output ${output}.`);
        } else if (output !== undefined && splitters.has(parent.id)) {
          const o = splitterOutputUse(data, splitters.get(parent.id)!).outputs[output - 1];
          if (o?.state === 'free') takeOutputs(parent.id, 1);
          else if (o?.state === 'not_recorded') {
            state = 'not_known';
            notes.push(`Output ${output} of ${parent.name} has no port record, so whether it is free is not known.`);
          } else {
            state = 'short';
            notes.push(`Output ${output} of ${parent.name} is ${o?.state === 'used' ? 'in use' : o?.state ?? 'not free'}${o?.reason ? ` (${o.reason})` : ''}.`);
          }
        } else if (parent.free > 0) takeOutputs(parent.id, 1);
        else {
          state = 'short';
          notes.push(`${parent.name} has no free output left.`);
        }
        if (parent.root) v.root = parent.root;
        else notes.push(`The PON port above ${parent.name} is not recorded.`);
        if (parent.product !== undefined) {
          v.product = parent.product * capacity;
          v.complete = parent.complete;
          const limit = optical.limits.splitProduct;
          if (limit > 0 && v.product > limit) {
            notes.push(`Split down to it would be ${v.complete ? '' : 'at least '}1:${v.product}, above the 1:${limit} limit in Optical settings.`);
            if (state === 'fits') state = 'tight';
          }
        }
        const after = splitterFacts(parent.id)!.free;
        lines.push({
          itemId: item.id,
          what,
          element: `Splitter ${parent.name} outputs`,
          now: `${before} of ${parent.capacity} free`,
          ifBuilt: state === 'short' ? `No free output for it: short by 1` : `${Math.max(0, after)} free; ${capacity} new outputs below`,
          ...(state === 'short' ? { shortBy: 1 } : {}),
          state,
          notes,
        });
      }
      virtual.set(item.id, v);
      continue;
    }

    if (item.kind === 'customers') {
      if (item.splitterId) {
        const sp = splitterFacts(item.splitterId);
        if (!sp) {
          lines.push({ itemId: item.id, what, element: `Splitter ${item.splitterId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`Splitter ${item.splitterId} is not on record or earlier in this scenario.`] });
          continue;
        }
        const before = sp.free;
        takeOutputs(sp.id, item.count);
        const short = item.count - Math.max(0, before);
        const notes: string[] = [];
        if (virtual.has(sp.id)) notes.push('This splitter is planned earlier in this scenario.');
        lines.push({
          itemId: item.id,
          what,
          element: `Splitter ${sp.name} outputs`,
          now: `${Math.max(0, before)} of ${sp.capacity} free`,
          ifBuilt: short > 0 ? `Short by ${short} output(s)` : `${before - item.count} free`,
          ...(short > 0 ? { shortBy: short } : {}),
          state: short > 0 ? 'short' : 'fits',
          notes,
        });
        if (sp.root) lines.push(ponLine(item.id, what, sp.root.oltId, sp.root.ponPortId, item.count));
        else lines.push({ itemId: item.id, what, element: 'PON port', now: 'Not known', ifBuilt: 'Not worked out', state: 'not_known', notes: [`Which PON port feeds ${sp.name} is not recorded, so the ONT count there is not worked out.`] });
        continue;
      }
      if (item.boxId) {
        const box = byId.get(item.boxId);
        if (!box) {
          lines.push({ itemId: item.id, what, element: `Box ${item.boxId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`Box ${item.boxId} is not on record.`] });
          continue;
        }
        const inBox = [...data.splitters.filter((s) => s.terminalBoxId === box.id).map((s) => s.id), ...[...virtual.values()].filter((v) => v.boxId === box.id).map((v) => v.id)];
        const facts = inBox.map((id) => splitterFacts(id)!).filter(Boolean);
        const before = facts.reduce((s, f) => s + Math.max(0, f.free), 0);
        let left = item.count;
        const roots = new Set<string>();
        for (const f of facts) {
          const take = Math.min(left, Math.max(0, f.free));
          if (take > 0) {
            takeOutputs(f.id, take);
            left -= take;
            roots.add(f.root ? `${f.root.oltId}#${f.root.ponPortId}` : 'unknown');
          }
        }
        const notes: string[] = [];
        if (facts.length === 0) notes.push(`No splitter is recorded in ${box.name}, nor planned earlier in this scenario.`);
        lines.push({
          itemId: item.id,
          what,
          element: `Free outputs in ${box.name}`,
          now: `${before} free on ${facts.length} splitter(s)`,
          ifBuilt: left > 0 ? `Short by ${left} output(s)` : `${before - item.count} free`,
          ...(left > 0 ? { shortBy: left } : {}),
          state: left > 0 ? 'short' : 'fits',
          notes,
        });
        if (roots.size === 1 && !roots.has('unknown')) {
          const [oltId, ponPortId] = [...roots][0].split('#');
          lines.push(ponLine(item.id, what, oltId, ponPortId, item.count - left));
        } else if (roots.size > 0) {
          lines.push({ itemId: item.id, what, element: 'PON port', now: 'Not known', ifBuilt: 'Not worked out', state: 'not_known', notes: ['The outputs used sit under more than one PON port, or one not recorded, so the ONT count per port is not worked out.'] });
        }
        continue;
      }
      lines.push(ponLine(item.id, what, item.oltId ?? '', item.ponPortId ?? '', item.count));
      continue;
    }

    // A planned cable: a way in a duct, and the load on poles.
    if (!item.ductId && !item.poleIds?.length) {
      lines.push({ itemId: item.id, what, element: 'Route', now: '—', ifBuilt: 'Not worked out', state: 'not_known', notes: ['Neither a duct nor poles are given for this cable.'] });
      continue;
    }
    if (item.ductId) {
      const duct = (data.ducts ?? []).find((d) => d.id === item.ductId);
      if (!duct) {
        lines.push({ itemId: item.id, what, element: `Duct ${item.ductId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`Duct ${item.ductId} is not on record.`] });
      } else {
        const taken = ductTaken.get(duct.id) ?? ductTaken.set(duct.id, new Set()).get(duct.id)!;
        const extra = ductExtra.get(duct.id) ?? ductExtra.set(duct.id, new Map()).get(duct.id)!;
        const ways = ductPlaces(duct).filter((p) => p.innerWays === 0 && (p.kind !== 'duct' || duct.subducts.length === 0));
        const freeWays = ways.filter((p) => p.cableIds.length === 0 && p.effectiveCondition !== 'blocked' && !taken.has(p.key));
        const notes: string[] = [];
        const cableById = new Map(data.cables.map((c) => [c.id, c]));
        if (duct.subducts.length === 0 && duct.wayCount && duct.wayCount > 1) {
          notes.push(`The ${duct.wayCount} ways of ${duct.name} are not described one by one, so a free way cannot be found from the records.`);
          lines.push({ itemId: item.id, what, element: `Duct ${duct.name}`, now: 'Ways not described', ifBuilt: 'Not known', state: 'not_known', notes });
        } else if (freeWays.length > 0) {
          const way = freeWays[0];
          taken.add(way.key);
          extra.set(way.key, [...(extra.get(way.key) ?? []), item.outerDiameterMm ?? Number.NaN]);
          let state: ScenarioLineState = 'fits';
          let fillText = 'fill not known';
          if (!way.effectiveCondition) notes.push(`${way.label} was never checked; it may be blocked.`);
          if (way.effectiveCondition === 'damaged') {
            notes.push(`${way.label} is recorded as damaged.`);
            state = 'tight';
          }
          if (item.outerDiameterMm && way.innerDiameterMm) {
            const ratio = item.outerDiameterMm ** 2 / way.innerDiameterMm ** 2;
            const limit = fillLimit(1, osp);
            fillText = `${formatFill(ratio)} full`;
            if (ratio > limit) {
              notes.push(`${formatFill(ratio)} full is above the ${formatFill(limit)} level for one cable (Poles and routes settings).`);
              state = 'tight';
            }
          } else notes.push(item.outerDiameterMm ? `The inside diameter of ${way.label} is not recorded, so its fill is not known.` : 'The planned cable has no outside diameter, so the fill is not known.');
          lines.push({ itemId: item.id, what, element: `Duct ${duct.name}`, now: `${freeWays.length} free way(s)`, ifBuilt: `Takes ${way.label} (${fillText}); ${freeWays.length - 1} free way(s) left`, state, notes });
        } else {
          // No empty way: could it share one, from recorded diameters only?
          let best: { label: string; ratio: number; limit: number } | undefined;
          for (const way of ways) {
            if (way.effectiveCondition === 'blocked' || !way.innerDiameterMm || !item.outerDiameterMm) continue;
            const diameters = [...way.cableIds.map((id) => cableById.get(id)?.outerDiameterMm), ...(extra.get(way.key) ?? []), item.outerDiameterMm];
            if (diameters.some((d) => d === undefined || Number.isNaN(d))) continue;
            const ratio = diameters.reduce<number>((s, d) => s + (d as number) ** 2, 0) / way.innerDiameterMm ** 2;
            const limit = fillLimit(diameters.length, osp);
            if (!best || ratio / limit < best.ratio / best.limit) best = { label: way.label, ratio, limit };
          }
          if (!best) {
            notes.push('No empty way is recorded, and the fill of the ways with cables cannot be worked out (a diameter is not recorded).');
            lines.push({ itemId: item.id, what, element: `Duct ${duct.name}`, now: 'No empty way', ifBuilt: 'Not known', state: 'not_known', notes });
          } else {
            const fits = best.ratio <= best.limit;
            notes.push(`Would share ${best.label}: ${formatFill(best.ratio)} full against the ${formatFill(best.limit)} level (Poles and routes settings).`);
            lines.push({ itemId: item.id, what, element: `Duct ${duct.name}`, now: 'No empty way', ifBuilt: fits ? `Shares ${best.label} (${formatFill(best.ratio)} full)` : `Too full: ${best.label} would be ${formatFill(best.ratio)}`, ...(fits ? {} : { shortBy: 1 }), state: fits ? 'tight' : 'short', notes });
          }
        }
      }
    }
    for (const poleId of item.poleIds ?? []) {
      const pole = byId.get(poleId);
      if (!pole) {
        lines.push({ itemId: item.id, what, element: `Pole ${poleId}`, now: 'Not on record', ifBuilt: 'Not worked out', state: 'broken_ref', notes: [`Pole ${poleId} is not on record.`] });
        continue;
      }
      poles ??= cablesOnPoles(data);
      const on = poles.get(pole.id);
      const base = (on?.built.length ?? 0) + (on?.planned.length ?? 0) + (poleExtra.get(pole.id) ?? 0);
      poleExtra.set(pole.id, (poleExtra.get(pole.id) ?? 0) + 1);
      const cap = pole.attachmentCapacity;
      if (cap === undefined) {
        lines.push({ itemId: item.id, what, element: `Pole ${pole.name}`, now: `${base} cable(s)`, ifBuilt: `${base + 1} cable(s) · allowed number not recorded`, state: 'not_known', notes: ['How many cables the owner allows on this pole is not recorded.'] });
        continue;
      }
      const short = base + 1 - cap;
      lines.push({
        itemId: item.id,
        what,
        element: `Pole ${pole.name}`,
        now: `${base} of ${cap} cables allowed`,
        ifBuilt: short > 0 ? `${base + 1} of ${cap}: over by ${short}` : `${base + 1} of ${cap} cables allowed`,
        ...(short > 0 ? { shortBy: short } : {}),
        state: short > 0 ? 'short' : 'fits',
        notes: on?.planned.length ? [`${on.planned.length} cable(s) already on it are only planned.`] : [],
      });
    }
  }
  const worst = lines.reduce<ScenarioLineState>((w, l) => (RANK[l.state] > RANK[w] ? l.state : w), 'fits');
  return { scenario, lines, worst };
}
