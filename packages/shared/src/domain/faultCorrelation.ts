import type { AlarmKind, Confidence, NetworkElementType } from '../model/enums';
import type { Alarm, NetworkElementRef } from '../model/types';
import {
  affectedByElement,
  type CustomerPathInfo,
  elementKey,
  elementLabel,
  type ImpactIndex,
  pathPassesThrough,
  recommendedChecks,
} from './faultImpact';
import { DEFAULT_FAULT_SETTINGS, type FaultSettings } from './faultSettings';

/**
 * Evidence-based grouping of alarms (Phase 8). Alarms reported on customers are grouped by the
 * element their recorded fiber paths share, and the result is always a suspicion: the screen says
 * how many customers behind the element are reported down, how sure that makes it and what is not
 * recorded. It never claims a cut. There is no live OLT connection, so a customer with no alarm is
 * not proven to be working; the wording says "no alarm", never "up". TEST alarms and real alarms
 * are never mixed in one group.
 */

/** Alarm kinds that say a customer has lost service. */
export const CUSTOMER_DOWN_KINDS: readonly AlarmKind[] = ['ont_los', 'ont_offline', 'low_power'];

export const isOpenAlarm = (a: Pick<Alarm, 'state'>): boolean => a.state !== 'cleared';

export interface Suspicion {
  key: string;
  element: NetworkElementRef;
  label: string;
  isTest: boolean;
  alarmIds: string[];
  /** Customers reported down whose recorded path passes through the element. */
  downCustomerIds: string[];
  /** Customers whose recorded path passes through the element. */
  behindCount: number;
  share: number;
  confidence: Confidence;
  evidence: string[];
  /** Missing links that lowered the confidence, named. */
  missing: string[];
  checks: string[];
  /** The best explanation for its group of alarms. */
  primary: boolean;
  /** Faults already opened for these alarms. */
  faultIds: string[];
  /** Other elements that carry exactly the same customers, so the alarms cannot tell them apart. */
  alsoOnPath?: string[];
  windowStart: string;
  windowEnd: string;
}

export interface CorrelationResult {
  suspicions: Suspicion[];
  notes: string[];
}

/** More specific first: a splitter explains a group better than the cable that feeds it. */
const SPECIFICITY: Record<NetworkElementType, number> = {
  customer: 0,
  ont: 0,
  splitter: 1,
  equipment: 2,
  core: 3,
  closure: 4,
  cable: 5,
  span: 5,
  pon_port: 6,
  olt: 7,
};

const LOWER: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };

const confidenceFor = (share: number, s: FaultSettings): Confidence => (share >= s.highShare ? 'high' : share >= s.mediumShare ? 'medium' : 'low');

const minutesBetween = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 60_000;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Splits alarms into groups whose start times lie within the window of the group's first alarm. */
function clusters(alarms: Alarm[], windowMinutes: number): Alarm[][] {
  const sorted = [...alarms].sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
  const groups: Alarm[][] = [];
  for (const alarm of sorted) {
    const current = groups.at(-1);
    if (current && minutesBetween(current[0].firstSeenAt, alarm.firstSeenAt) <= windowMinutes) current.push(alarm);
    else groups.push([alarm]);
  }
  return groups;
}

/** The customers an alarm is about: the customer itself, or every active customer on the ONT. */
function customersOfAlarm(ix: ImpactIndex, alarm: Alarm): string[] {
  if (alarm.element.type === 'customer') return [alarm.element.id];
  if (alarm.element.type === 'ont') return [...ix.paths.values()].filter((i) => i.customer.ontId === alarm.element.id).map((i) => i.customer.id);
  return [];
}

/** Elements on the recorded part of a customer's path that could be shared with others. */
function sharedCandidates(info: CustomerPathInfo): NetworkElementRef[] {
  const { path } = info;
  const out: NetworkElementRef[] = [];
  for (const id of path.splitterIds) out.push({ type: 'splitter', id });
  for (const id of info.closureIds) out.push({ type: 'closure', id });
  for (const id of path.cableIds) if (id !== info.customer.dropCableId) out.push({ type: 'cable', id });
  for (const key of path.coreKeys) {
    const [cableId, n] = key.split('#');
    if (cableId !== info.customer.dropCableId) out.push({ type: 'core', id: cableId, fiberNumber: Number(n) });
  }
  if (path.olt && path.pon) out.push({ type: 'pon_port', id: path.olt.id, ponPortId: path.pon.id });
  if (path.olt) out.push({ type: 'olt', id: path.olt.id });
  return out;
}

const faultIdsOf = (alarms: Alarm[]) => [...new Set(alarms.map((a) => a.faultId).filter((x): x is string => !!x))];

function customerGroups(ix: ImpactIndex, group: Alarm[], s: FaultSettings, isTest: boolean): Suspicion[] {
  const windowStart = group[0].firstSeenAt;
  const windowEnd = group.reduce((m, a) => (Date.parse(a.lastSeenAt) > Date.parse(m) ? a.lastSeenAt : m), group[0].lastSeenAt);
  const alarmsByCustomer = new Map<string, Alarm[]>();
  for (const alarm of group) for (const id of customersOfAlarm(ix, alarm)) alarmsByCustomer.set(id, [...(alarmsByCustomer.get(id) ?? []), alarm]);

  const unplaced: string[] = [];
  const incomplete: string[] = [];
  const placed: CustomerPathInfo[] = [];
  for (const id of alarmsByCustomer.keys()) {
    const info = ix.paths.get(id);
    if (!info) {
      unplaced.push(`Customer ${id} has an alarm but is not an active customer on record, so it cannot be placed on any element.`);
      continue;
    }
    placed.push(info);
    if (!info.path.complete) incomplete.push(`Customer ${id}: ${info.path.gaps[0] ?? 'path not fully recorded'}`);
  }
  const common = [
    ...(isTest ? ['These are TEST events, not real alarms.'] : []),
    'No live connection to the OLT: a customer with no alarm is not proven to be working.',
  ];
  const span = Math.round(minutesBetween(windowStart, group.at(-1)!.firstSeenAt));
  const timing = `The alarms started within ${span} minute(s) of each other (window ${s.correlationWindowMinutes} min, in settings).`;

  const candidates = new Map<string, { el: NetworkElementRef; down: CustomerPathInfo[] }>();
  for (const info of placed) {
    for (const el of sharedCandidates(info)) {
      const key = elementKey(el);
      const entry = candidates.get(key) ?? { el, down: [] };
      if (!entry.down.includes(info)) entry.down.push(info);
      candidates.set(key, entry);
    }
  }

  const out: Suspicion[] = [];
  for (const [key, { el, down }] of candidates) {
    if (down.length < s.minAlarmsForGroup) continue;
    const impact = affectedByElement(ix, el);
    const behind = impact.affected.length;
    if (behind === 0) continue;
    const share = down.length / behind;
    let confidence = confidenceFor(share, s);
    const label = elementLabel(ix.data, el);
    const missing = [...unplaced, ...incomplete];
    if (impact.mayBeAffected.length > 0) {
      missing.push(`${impact.mayBeAffected.length} more customer(s) may be on ${label}, but their path is not fully recorded (${impact.mayBeAffected[0].firstGap})`);
    }
    if (missing.length > 0) confidence = LOWER[confidence];
    const downIds = down.map((i) => i.customer.id);
    const alarmIds = [...new Set(downIds.flatMap((id) => (alarmsByCustomer.get(id) ?? []).map((a) => a.id)))];
    out.push({
      key: `${isTest ? 'test' : 'real'}:${windowStart}:${key}`,
      element: el,
      label,
      isTest,
      alarmIds,
      downCustomerIds: downIds,
      behindCount: behind,
      share,
      confidence,
      evidence: [
        `${down.length} of ${behind} customers recorded on ${label} are reported down (${behind - down.length} have no alarm), ${pct(share)}.`,
        `Their recorded fiber paths all pass through ${label}.`,
        timing,
        ...common,
      ],
      missing,
      checks: recommendedChecks(el.type),
      primary: false,
      faultIds: faultIdsOf(group.filter((a) => alarmIds.includes(a.id))),
      windowStart,
      windowEnd,
    });
  }
  out.sort(
    (a, b) =>
      b.downCustomerIds.length - a.downCustomerIds.length ||
      b.share - a.share ||
      SPECIFICITY[a.element.type] - SPECIFICITY[b.element.type] ||
      a.behindCount - b.behindCount,
  );
  // Elements that carry exactly the same customers cannot be told apart by the alarms: keep the
  // most specific and name the others on it.
  const bySignature = new Map<string, Suspicion>();
  for (const sus of out) {
    const signature = `${[...sus.downCustomerIds].sort().join(',')}|${sus.behindCount}`;
    const kept = bySignature.get(signature);
    if (!kept) {
      bySignature.set(signature, sus);
      continue;
    }
    kept.alsoOnPath = [...(kept.alsoOnPath ?? []), sus.label];
  }
  for (const sus of bySignature.values()) {
    if (sus.alsoOnPath?.length) {
      sus.evidence.splice(2, 0, `The same customers also share ${sus.alsoOnPath.join(', ')}; the alarms cannot tell these apart. ${sus.label} is the one nearest the customers.`);
    }
  }
  const top = [...bySignature.values()].slice(0, 5);
  if (top[0]) top[0].primary = true;

  // A customer down alone, not explained by the best group: suspect their own drop or ONT.
  const explained = new Set(top[0]?.downCustomerIds ?? []);
  for (const info of placed) {
    if (explained.has(info.customer.id)) continue;
    const id = info.customer.id;
    const splitterId = info.path.splitterIds[0];
    const siblings = splitterId ? affectedByElement(ix, { type: 'splitter', id: splitterId }).affected.length - 1 : 0;
    const where = splitterId ? elementLabel(ix.data, { type: 'splitter', id: splitterId }) : undefined;
    const missing = info.path.complete ? [] : [`Customer ${id}: ${info.path.gaps[0] ?? 'path not fully recorded'}`];
    const confidence: Confidence = missing.length > 0 || siblings <= 0 ? 'low' : 'medium';
    const alarms = alarmsByCustomer.get(id) ?? [];
    top.push({
      key: `${isTest ? 'test' : 'real'}:${windowStart}:customer:${id}`,
      element: { type: 'customer', id },
      label: elementLabel(ix.data, { type: 'customer', id }),
      isTest,
      alarmIds: alarms.map((a) => a.id),
      downCustomerIds: [id],
      behindCount: 1,
      share: 1,
      confidence,
      evidence: [
        where
          ? `Only this customer is reported down on ${where}; ${Math.max(0, siblings)} other(s) recorded there have no alarm.`
          : 'Only this customer is reported down, and no splitter is recorded on their path.',
        'One customer alone points at their own house wire or ONT rather than a shared element.',
        ...common,
      ],
      missing,
      checks: recommendedChecks('customer'),
      primary: top.length === 0,
      faultIds: faultIdsOf(alarms),
      windowStart,
      windowEnd,
    });
  }
  return top;
}

/** PON port faults grouped by OLT, and OLT-unreachable reports. */
function oltGroups(ix: ImpactIndex, group: Alarm[], s: FaultSettings, isTest: boolean): Suspicion[] {
  const out: Suspicion[] = [];
  const common = isTest ? ['These are TEST events, not real alarms.'] : [];
  const byOlt = new Map<string, Alarm[]>();
  for (const a of group) if (a.element.type === 'pon_port') byOlt.set(a.element.id, [...(byOlt.get(a.element.id) ?? []), a]);
  for (const a of group) {
    if (a.element.type !== 'olt' || a.kind !== 'olt_unreachable') continue;
    const el: NetworkElementRef = { type: 'olt', id: a.element.id };
    const impact = affectedByElement(ix, el);
    out.push(suspicionFromReport(ix, el, [a], impact.affected.length, isTest, [`${elementLabel(ix.data, el)} was reported not reachable (${a.source === 'test' ? 'TEST' : 'reported by a person'}).`, ...common]));
  }
  for (const [oltId, alarms] of byOlt) {
    const olt = ix.data.equipment.find((e) => e.id === oltId);
    const ports = new Set(alarms.map((a) => a.element.ponPortId));
    const total = olt?.ponPorts?.length ?? 0;
    if (ports.size >= s.ponPortsForOlt) {
      const el: NetworkElementRef = { type: 'olt', id: oltId };
      const share = total > 0 ? ports.size / total : 0;
      const sus = suspicionFromReport(ix, el, alarms, affectedByElement(ix, el).affected.length, isTest, [
        `${ports.size} of ${total || '?'} PON ports on ${elementLabel(ix.data, el)} report a fault${total ? `, ${pct(share)}` : ''}.`,
        'Several ports failing together points at the OLT card, power or uplink rather than the street.',
        ...common,
      ]);
      sus.confidence = total > 0 ? confidenceFor(share, s) : 'low';
      out.push(sus);
    }
    for (const a of alarms) {
      const el: NetworkElementRef = { type: 'pon_port', id: oltId, ponPortId: a.element.ponPortId };
      out.push(suspicionFromReport(ix, el, [a], affectedByElement(ix, el).affected.length, isTest, [`${elementLabel(ix.data, el)} reports a fault (${a.source === 'test' ? 'TEST' : 'reported by a person'}).`, ...common]));
    }
  }
  return out;
}

function suspicionFromReport(ix: ImpactIndex, el: NetworkElementRef, alarms: Alarm[], behind: number, isTest: boolean, evidence: string[]): Suspicion {
  const impact = affectedByElement(ix, el);
  const missing = impact.mayBeAffected.length > 0 ? [`${impact.mayBeAffected.length} customer(s) may be on it, but their path is not fully recorded (${impact.mayBeAffected[0].firstGap})`] : [];
  return {
    key: `${isTest ? 'test' : 'real'}:${alarms[0].firstSeenAt}:report:${elementKey(el)}:${alarms.map((a) => a.id).join(',')}`,
    element: el,
    label: elementLabel(ix.data, el),
    isTest,
    alarmIds: alarms.map((a) => a.id),
    downCustomerIds: [],
    behindCount: behind,
    share: 0,
    confidence: missing.length > 0 ? 'low' : 'medium',
    evidence: [...evidence, `${behind} customer(s) are recorded behind it.`],
    missing,
    checks: recommendedChecks(el.type),
    primary: true,
    faultIds: faultIdsOf(alarms),
    windowStart: alarms[0].firstSeenAt,
    windowEnd: alarms.at(-1)!.lastSeenAt,
  };
}

/** Damage or danger reported on a cable, pole, span, closure or box: listed with who is behind it. */
function reportedDamage(ix: ImpactIndex, alarms: Alarm[], downAlarms: Alarm[], s: FaultSettings, isTest: boolean): Suspicion[] {
  const out: Suspicion[] = [];
  const downCustomers = new Set(downAlarms.flatMap((a) => customersOfAlarm(ix, a)));
  for (const a of alarms) {
    if (CUSTOMER_DOWN_KINDS.includes(a.kind) || a.element.type === 'pon_port' || a.kind === 'olt_unreachable') continue;
    if (a.element.type === 'customer' || a.element.type === 'ont') continue;
    const el = a.element;
    const impact = affectedByElement(ix, el);
    const crossing = impact.affected.filter((c) => downCustomers.has(c.customerId)).length;
    const sus = suspicionFromReport(ix, el, [a], impact.affected.length, isTest, [
      `${a.kind === 'hazard_reported' ? 'Danger' : 'Damage'} reported on ${elementLabel(ix.data, el)} (${a.source === 'test' ? 'TEST' : a.source === 'field_report' ? 'from the field' : 'by a person'}).`,
      ...(crossing > 0 ? [`${crossing} customer(s) reported down have recorded paths through it.`] : []),
      ...(isTest ? ['These are TEST events, not real alarms.'] : []),
    ]);
    if (crossing >= s.minAlarmsForGroup && sus.missing.length === 0) sus.confidence = 'high';
    out.push(sus);
  }
  return out;
}

/** Groups open alarms into suspected causes, TEST and real apart, using recorded paths only. */
export function correlateAlarms(ix: ImpactIndex, alarms: readonly Alarm[], settings: FaultSettings = DEFAULT_FAULT_SETTINGS): CorrelationResult {
  const open = alarms.filter(isOpenAlarm);
  const notes: string[] = [];
  const suspicions: Suspicion[] = [];
  for (const isTest of [false, true]) {
    const set = open.filter((a) => a.isTest === isTest);
    if (set.length === 0) continue;
    for (const group of clusters(set, settings.correlationWindowMinutes)) {
      const down = group.filter((a) => CUSTOMER_DOWN_KINDS.includes(a.kind) && (a.element.type === 'customer' || a.element.type === 'ont'));
      if (down.length > 0) suspicions.push(...customerGroups(ix, down, settings, isTest));
      suspicions.push(...oltGroups(ix, group, settings, isTest));
      suspicions.push(...reportedDamage(ix, group, down, settings, isTest));
    }
  }
  if (suspicions.length > 0) notes.push('Every result is a suspected shared fault, not proof of a physical cut. Send someone to check before telling customers.');
  return { suspicions, notes };
}

/** True when the suspicion's element still sits on the recorded path of a customer. Used by tests and the map check. */
export const isOnRecordedPath = (ix: ImpactIndex, customerId: string, el: NetworkElementRef): boolean => {
  const info = ix.paths.get(customerId);
  return !!info && pathPassesThrough(ix, info, el);
};
