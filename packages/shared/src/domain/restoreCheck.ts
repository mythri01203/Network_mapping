import type { NetworkSnapshot } from '../model/collections';
import { findConnectionProblems } from './connectionRules';
import { findFaultProblems } from './faultRules';
import { findFiberProblems } from './fiberRules';
import { findBrokenLinks } from './outsidePlant';

/**
 * Phase 9: a restore is checked against the same rules every change is checked against (Phases 3
 * to 8): outside-plant links, fiber links, customer connections, faults and jobs. Only errors
 * (broken data, physical impossibilities) are listed; warnings never stop a restore.
 */

export type RestoreRule = 'links' | 'fiber' | 'connections' | 'faults';

export const RESTORE_RULE_LABELS: Record<RestoreRule, string> = {
  links: 'Poles, spans, ducts and attachments',
  fiber: 'Fibers, splices, splitters and ports',
  connections: 'Customers, ONTs, services and buildings',
  faults: 'Alarms, faults and jobs',
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
  const counts: Record<RestoreRule, number> = { links: 0, fiber: 0, connections: 0, faults: 0 };
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
  const counts: Record<RestoreRule, number> = { links: 0, fiber: 0, connections: 0, faults: 0 };
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
