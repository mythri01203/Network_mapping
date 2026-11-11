import type { NetworkSnapshot } from '../model/collections';
import { findSegmentErrors } from './cableSegments';
import { findCatalogProblems } from './catalog';
import { findConnectionProblems } from './connectionRules';
import { findFaultProblems } from './faultRules';
import { findFiberProblems } from './fiberRules';
import { findLinkVerificationErrors } from './linkVerifications';
import { resolveOspSettings } from './ospSettings';
import { findBrokenLinks } from './outsidePlant';
import { findRfProblems } from './rfRules';
import { findSiteRackProblems } from './sitesRacks';
import { findValidationFindingErrors } from './validationFindings';

/**
 * Phase 9: a restore is checked against the same rules every change is checked against (Phases 3
 * to 8): outside-plant links, fiber links, customer connections, faults and jobs. Only errors
 * (broken data, physical impossibilities) are listed; warnings never stop a restore.
 */

export type RestoreRule = 'links' | 'fiber' | 'connections' | 'faults' | 'rf' | 'catalog' | 'sites' | 'segments' | 'checks' | 'findings';

export const RESTORE_RULE_LABELS: Record<RestoreRule, string> = {
  links: 'Poles, spans, ducts and attachments',
  fiber: 'Fibers, splices, splitters and ports',
  connections: 'Customers, ONTs, services and buildings',
  faults: 'Alarms, faults and jobs',
  rf: 'Cable TV items, links and levels',
  catalog: 'Equipment and its catalogue models',
  sites: 'Sites, racks and what sits in them',
  segments: 'Cable stretches (where each part of a cable runs)',
  checks: 'Checks of links (OTDR, red light, meter)',
  findings: 'Map check findings',
};

export interface RestoreProblem {
  rule: RestoreRule;
  /** Stable across runs, so the problems a restore would add can be told from those already stored. */
  key: string;
  message: string;
  /** Record ids involved. Ids only, never names or phone numbers. */
  refs: string[];
}

export interface RestoreCheck {
  problems: RestoreProblem[];
  /** Problems per rule, so the report can say where they are. */
  counts: Record<RestoreRule, number>;
}

/** The network as it would be after the restore. */
export function checkRestoredNetwork(data: NetworkSnapshot): RestoreCheck {
  const problems: RestoreProblem[] = [];
  for (const p of findBrokenLinks(data)) {
    problems.push({ rule: 'links', key: `links:${p.collection}/${p.id}/${p.missingId ?? ''}/${p.message}`, message: p.message, refs: [p.id, ...(p.missingId ? [p.missingId] : [])] });
  }
  for (const p of findFiberProblems(data)) if (p.severity === 'error') problems.push({ rule: 'fiber', key: `fiber:${p.key}`, message: p.message, refs: p.refs });
  for (const p of findConnectionProblems(data)) if (p.severity === 'error') problems.push({ rule: 'connections', key: `connections:${p.key}`, message: p.message, refs: p.refs });
  for (const p of findFaultProblems(data)) if (p.severity === 'error') problems.push({ rule: 'faults', key: `faults:${p.key}`, message: p.message, refs: p.refs });
  // Backups made before Phase 6 have no Cable TV records.
  const rf = { rfElements: data.rfElements ?? [], rfLinks: data.rfLinks ?? [], rfLevels: data.rfLevels ?? [], cables: data.cables, customers: data.customers, equipment: data.equipment };
  for (const p of findRfProblems(rf, { warnings: false })) problems.push({ rule: 'rf', key: `rf:${p.key}`, message: p.message, refs: p.refs });
  // Backups made before Phase 2 have no catalogue links, so nothing is found in them.
  for (const p of findCatalogProblems({ equipment: data.equipment, catalog: data.catalog ?? [] })) problems.push({ rule: 'catalog', key: `catalog:${p.key}`, message: p.message, refs: p.refs });
  // Phase 9: backups made before sites and racks existed have none, so nothing is found in them.
  for (const p of findSiteRackProblems({ sites: data.sites ?? [], racks: data.racks ?? [], equipment: data.equipment })) {
    if (p.severity === 'error') problems.push({ rule: 'sites', key: `sites:${p.key}`, message: p.message, refs: p.refs });
  }
  // Network mapping Phase 6: backups made before cable stretches existed have none.
  for (const p of findSegmentErrors(data, resolveOspSettings(data.settings ?? []))) {
    const refs = [p.cableId, ...(p.segmentId ? [p.segmentId] : []), ...(p.otherSegmentId ? [p.otherSegmentId] : [])];
    problems.push({ rule: 'segments', key: `segments:${p.code}:${refs.join('/')}`, message: p.message, refs });
  }
  // Network mapping Phase 13: broken checks only. A check of a link that is gone is kept, never a problem.
  for (const p of findLinkVerificationErrors(data)) problems.push({ rule: 'checks', key: `checks:${p.id}:${p.message}`, message: p.message, refs: [p.id] });
  // Network mapping Phase 15: a decision with no who, when or note. Backups made before it have no findings.
  for (const p of findValidationFindingErrors(data)) problems.push({ rule: 'findings', key: `findings:${p.id}:${p.message}`, message: p.message, refs: [p.id] });
  const counts: Record<RestoreRule, number> = { links: 0, fiber: 0, connections: 0, faults: 0, rf: 0, catalog: 0, sites: 0, segments: 0, checks: 0, findings: 0 };
  for (const p of problems) counts[p.rule] += 1;
  return { problems, counts };
}

/**
 * The problems a restore would add: those in the restored network that the stored network does not
 * already have. A problem already stored is not blamed on the backup, as with every other change.
 */
export function newRestoreProblems(before: NetworkSnapshot, after: NetworkSnapshot): RestoreCheck {
  const known = new Set(checkRestoredNetwork(before).problems.map((p) => p.key));
  const problems = checkRestoredNetwork(after).problems.filter((p) => !known.has(p.key));
  const counts: Record<RestoreRule, number> = { links: 0, fiber: 0, connections: 0, faults: 0, rf: 0, catalog: 0, sites: 0, segments: 0, checks: 0, findings: 0 };
  for (const p of problems) counts[p.rule] += 1;
  return { problems, counts };
}

/** One plain paragraph for a refused restore. */
export function describeRestoreCheck(check: RestoreCheck, shown = 3): string {
  if (check.problems.length === 0) return 'The backup passed every check.';
  const where = (Object.keys(check.counts) as RestoreRule[])
    .filter((rule) => check.counts[rule] > 0)
    .map((rule) => `${RESTORE_RULE_LABELS[rule]}: ${check.counts[rule]}`)
    .join('; ');
  const examples = check.problems
    .slice(0, shown)
    .map((p) => p.message)
    .join(' ');
  return `The backup has ${check.problems.length} problem(s) (${where}). ${examples}`;
}
