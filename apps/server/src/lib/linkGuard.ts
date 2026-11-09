import {
  type ChangeSet,
  changeSetTouchesConnections,
  changeSetTouchesFaults,
  changeSetTouchesFiber,
  changeSetTouchesLinks,
  changeSetTouchesRf,
  checkChangeSetConnections,
  checkChangeSetFaults,
  checkChangeSetFiber,
  checkChangeSetLinks,
  checkChangeSetRf,
  type ConnectionData,
  describeFiberProblems,
  describeLinkProblems,
  type FaultCheckData,
  type FiberData,
  findBrokenLinks,
  type LinkCheckData,
  type NetworkSnapshot,
  type RfCheckData,
} from '@fibergis/shared';

import type { CollectionReader, WriteGuard } from '../db/repository';
import { linkError } from './errors';

/**
 * Server-side link checks. The browser runs the same rules (`@fibergis/shared`) before it saves, but
 * the server is the last line: a span, attachment, duct, slack loop or permission that would point
 * to a missing record is refused with a plain message, and nothing in that write is stored.
 */

const readLinked = (read: CollectionReader): LinkCheckData => ({
  equipment: read('equipment'),
  cables: read('cables'),
  spans: read('spans'),
  attachments: read('attachments'),
  ducts: read('ducts'),
  slackLoops: read('slackLoops'),
  permissions: read('permissions'),
});

const readFiber = (read: CollectionReader): FiberData => ({
  equipment: read('equipment'),
  cables: read('cables'),
  splitters: read('splitters'),
  closures: read('closures'),
  customers: read('customers'),
});

const readFaults = (read: CollectionReader): FaultCheckData => ({
  equipment: read('equipment'),
  cables: read('cables'),
  splitters: read('splitters'),
  closures: read('closures'),
  customers: read('customers'),
  spans: read('spans'),
  attachments: read('attachments'),
  onts: read('onts'),
  services: read('services'),
  faults: read('faults'),
  workOrders: read('workOrders'),
  alarms: read('alarms'),
});

const readConnections = (read: CollectionReader): ConnectionData => ({
  equipment: read('equipment'),
  cables: read('cables'),
  splitters: read('splitters'),
  customers: read('customers'),
  onts: read('onts'),
  services: read('services'),
  buildings: read('buildings'),
});

const readRf = (read: CollectionReader): RfCheckData => ({
  rfElements: read('rfElements'),
  rfLinks: read('rfLinks'),
  rfLevels: read('rfLevels'),
  cables: read('cables'),
  customers: read('customers'),
  equipment: read('equipment'),
});

/**
 * A guard for a change set, or none when the change cannot affect a link. Outside-plant links must
 * point to existing records. Fiber records (cores, splices, ODF ports and patches, PON ports,
 * splitter ports, assignments) must not add a physical impossibility or broken data: two feeds or
 * two continuations on one fiber, a fiber that does not exist, two active assignments on one core,
 * a splitter output beyond its ratio or below the loss physics allows, a second patch on one PON
 * port, optics that do not fit the port technology. Customer connections (ONTs, services,
 * buildings) must point to existing records, one serial per live ONT, one customer on a one-customer
 * ONT. Alarms, faults and work orders (Phase 8) must not be a device alarm while no OLT is
 * connected, a TEST not labelled TEST, TEST and real alarms in one fault, a link to a missing
 * record, or a fault or job verified or closed without a check. Problems already stored are not
 * blamed on the change. Warnings never block here. Cable TV records (Phase 6) must not link an input
 * to an output, light to an RF port, two feeds to one input, one port (such as a tap drop port) to two
 * places, or make a loop, and a measured level must say who read it. No PON rule is applied to them.
 */
export function changeSetGuard(changes: ChangeSet): WriteGuard | undefined {
  const osp = changeSetTouchesLinks(changes);
  const fiber = changeSetTouchesFiber(changes);
  const connections = changeSetTouchesConnections(changes);
  const faults = changeSetTouchesFaults(changes);
  const rf = changeSetTouchesRf(changes);
  if (!osp && !fiber && !connections && !faults && !rf) return undefined;
  return (read) => {
    if (faults) {
      const errors = checkChangeSetFaults(readFaults(read), changes);
      if (errors.length > 0) throw linkError(`${describeFiberProblems(errors)} Nothing was saved.`);
    }
    if (osp) {
      const problems = checkChangeSetLinks(readLinked(read), changes);
      if (problems.length > 0) throw linkError(describeLinkProblems(problems));
    }
    if (fiber) {
      const errors = checkChangeSetFiber(readFiber(read), changes);
      if (errors.length > 0) throw linkError(`${describeFiberProblems(errors)} Nothing was saved.`);
    }
    if (connections) {
      const errors = checkChangeSetConnections(readConnections(read), changes);
      if (errors.length > 0) throw linkError(`${describeFiberProblems(errors)} Nothing was saved.`);
    }
    if (rf) {
      const errors = checkChangeSetRf(readRf(read), changes);
      if (errors.length > 0) throw linkError(`${describeFiberProblems(errors)} Nothing was saved.`);
    }
  };
}

const LINKED = ['equipment', 'cables', 'spans', 'attachments', 'ducts', 'slackLoops', 'permissions'] as const;

/**
 * A restore replaces whole collections, so every outside-plant link is checked against the result.
 * Fiber rules are not applied to a restore: an older backup made before they existed must still
 * load. The map check reports any fiber problems it contains.
 */
export function replacementGuard(collections: Partial<NetworkSnapshot>): WriteGuard | undefined {
  if (!LINKED.some((name) => name in collections)) return undefined;
  return (read) => {
    const current = readLinked(read);
    const after = { ...current, ...Object.fromEntries(LINKED.filter((name) => name in collections).map((name) => [name, collections[name]])) };
    const problems = findBrokenLinks(after as LinkCheckData);
    if (problems.length > 0) throw linkError(`The backup has broken links. ${describeLinkProblems(problems)}`);
  };
}
