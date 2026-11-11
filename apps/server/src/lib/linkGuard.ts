import {
  type ChangeSet,
  changeSetTouchesCatalog,
  changeSetTouchesConnections,
  changeSetTouchesFaults,
  changeSetTouchesFiber,
  changeSetTouchesLinks,
  changeSetTouchesMonitoring,
  changeSetTouchesRf,
  changeSetTouchesSegments,
  changeSetTouchesSitesRacks,
  changeSetTouchesValidationFindings,
  changeSetTouchesBudgetRuns,
  changeSetTouchesImports,
  checkChangeSetBudgetRuns,
  checkChangeSetImports,
  checkChangeSetCableBuild,
  checkChangeSetLinkVerifications,
  checkChangeSetCatalog,
  checkChangeSetConnections,
  checkChangeSetFaults,
  checkChangeSetFiber,
  checkChangeSetLinks,
  checkChangeSetMonitoring,
  checkChangeSetRf,
  checkChangeSetSegments,
  checkChangeSetSitesRacks,
  checkChangeSetValidationFindings,
  type ConnectionData,
  describeFiberProblems,
  describeLinkProblems,
  type FaultCheckData,
  type FiberData,
  findBrokenLinks,
  type LinkCheckData,
  type NetworkSnapshot,
  resolveOspSettings,
  type RfCheckData,
} from '@fibergis/shared';

import type { CollectionReader, WriteGuard } from '../db/repository';
import { catalogCheckReader, collectionsRead, linkCheckReader, segmentCheckData, storedAlarmsFor, storedBudgetRunsFor, storedFindingsFor, storedImportsFor } from './targetedReads';
import { linkError } from './errors';
import { isPlainEquipmentEdit } from './plainEdits';

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
  inspections: read('inspections'),
  cableSegments: read('cableSegments'),
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
  monitoringSources: read('monitoringSources'),
});

const readConnections = (read: CollectionReader): ConnectionData => ({
  equipment: read('equipment'),
  cables: read('cables'),
  splitters: read('splitters'),
  customers: read('customers'),
  onts: read('onts'),
  services: read('services'),
  buildings: read('buildings'),
  // Phase 12: splices, so a customer's path is followed through closures.
  closures: read('closures'),
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
  // Phase 5: a cable recorded as G.652D multimode (or any build that contradicts itself) is broken data.
  const buildProblems = checkChangeSetCableBuild(changes);
  if (buildProblems.length > 0) {
    return () => {
      throw linkError(`${buildProblems[0]}${buildProblems.length > 1 ? ` (and ${buildProblems.length - 1} more)` : ''} Nothing was saved.`);
    };
  }
  // Network mapping Phase 13: a check of a link that is broken data (no reading on a meter check, a
  // day in the future, a photo that is not a saved photo, an id naming no kind of link). Reads
  // nothing stored: a check naming a link that is gone is kept and flagged, never refused.
  const checkProblems = checkChangeSetLinkVerifications(changes);
  if (checkProblems.length > 0) {
    return () => {
      throw linkError(`${checkProblems[0].message}${checkProblems.length > 1 ? ` (and ${checkProblems.length - 1} more)` : ''} Nothing was saved.`);
    };
  }
  const osp = changeSetTouchesLinks(changes);
  const fiber = changeSetTouchesFiber(changes);
  const connections = changeSetTouchesConnections(changes);
  const faults = changeSetTouchesFaults(changes);
  const rf = changeSetTouchesRf(changes);
  const monitoring = changeSetTouchesMonitoring(changes);
  const catalog = changeSetTouchesCatalog(changes);
  const sitesRacks = changeSetTouchesSitesRacks(changes);
  const segments = changeSetTouchesSegments(changes);
  const findings = changeSetTouchesValidationFindings(changes);
  const budgetRuns = changeSetTouchesBudgetRuns(changes);
  const imports = changeSetTouchesImports(changes);
  if (!osp && !fiber && !connections && !faults && !rf && !monitoring && !catalog && !sitesRacks && !segments && !findings && !budgetRuns && !imports) return undefined;
  return (read) => {
    if (imports) {
      // Network mapping Phase 21: an import record is history. What it made and who made it is never
      // rewritten; an undo (who, when) is added once, and an undone import is kept.
      const stored = new Map(storedImportsFor(read, changes).map((r) => [r.id, r]));
      const errors = checkChangeSetImports(changes, (id) => stored.get(id));
      if (errors.length > 0) throw linkError(`${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
    }
    if (budgetRuns) {
      // Network mapping Phase 17: a stored optical budget run is history. It is never changed or
      // deleted, and never gives a pass or fail with an assumed optics class.
      const stored = new Map(storedBudgetRunsFor(read, changes).map((r) => [r.id, r]));
      const errors = checkChangeSetBudgetRuns(changes, (id) => stored.get(id));
      if (errors.length > 0) throw linkError(`${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
    }
    if (findings) {
      // Network mapping Phase 15: a map check finding is never deleted, its history only grows, and
      // a decision (fine as it is, fixed) needs who, when and a note. Reads only the stored findings
      // this change names.
      const stored = new Map(storedFindingsFor(read, changes).map((f) => [f.id, f]));
      const errors = checkChangeSetValidationFindings(changes, (id) => stored.get(id));
      if (errors.length > 0) throw linkError(`${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
    }
    if (faults) {
      const errors = checkChangeSetFaults(readFaults(read), changes);
      if (errors.length > 0) throw linkError(`${describeFiberProblems(errors)} Nothing was saved.`);
    }
    if (monitoring) {
      // Phase 7: monitoring rows, sources and device alarms come only through the monitoring routes.
      const alarms = new Map(storedAlarmsFor(read, changes).map((a) => [a.id, a]));
      const errors = checkChangeSetMonitoring(changes, (id) => alarms.get(id));
      if (errors.length > 0) throw linkError(errors[0].message);
    }
    if (osp) {
      // Phase 24: only the records this change can affect, when that gives the same answer (see targetedReads).
      const problems = checkChangeSetLinks(readLinked(linkCheckReader(read, changes, collectionsRead(readLinked)) ?? read), changes);
      if (problems.length > 0) throw linkError(describeLinkProblems(problems));
    }
    if (segments) {
      // Network mapping Phase 6: a cable stretch must lie on its cable, not overlap another stretch
      // of it, and not contradict itself (an aerial stretch in a duct). Warnings never block here.
      const errors = checkChangeSetSegments(segmentCheckData(read, changes), changes, resolveOspSettings(read('settings')));
      if (errors.length > 0) throw linkError(`${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
    }
    // Phase 24b: an edit of plain details only (a pole renamed) cannot add a fibre or site/rack problem (see plainEdits).
    const plain = (fiber || sitesRacks) && isPlainEquipmentEdit(read, changes);
    if (fiber && !plain) {
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
    if (catalog) {
      // Phase 2: an item must not name a catalogue model that is not on record (nor lose it to a delete).
      const catalogRead = catalogCheckReader(read, changes) ?? read;
      const errors = checkChangeSetCatalog({ equipment: catalogRead('equipment'), catalog: catalogRead('catalog') }, changes);
      if (errors.length > 0) throw linkError(`${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
    }
    if (sitesRacks && !plain) {
      // Phase 9: an item or rack must not name a site or rack that is not on record (nor lose it to
      // a delete), sit in a rack at another site, or reach past the top of its rack.
      const errors = checkChangeSetSitesRacks({ sites: read('sites'), racks: read('racks'), equipment: read('equipment') }, changes);
      if (errors.length > 0) throw linkError(`${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`);
    }
  };
}

const LINKED = ['equipment', 'cables', 'spans', 'attachments', 'ducts', 'slackLoops', 'permissions', 'inspections', 'cableSegments'] as const;

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
