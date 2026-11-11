import type { FastifyPluginAsync } from 'fastify';

import { ACCOUNT_ROLE_LABELS, type ChangeSet, findingCounts, reconcileFindings, roleCan } from '@fibergis/shared';

import { accountOf, forbidden, noStore, writeOptionsFor } from '../auth/access';
import type { NetworkRepository } from '../db/repository';
import { changeSetGuard } from '../lib/linkGuard';
import { runMapCheck } from '../lib/mapCheck';

/**
 * The data-quality summary for the Reports screen: the same rules as the `fibergis-map-check`
 * skill plus the geometry rules (network mapping Phase 15), run on the stored network with the
 * operator's own limits. Only rule, level, count and example ids go back, never the checker's
 * sentences, because some older rules quote customer names.
 *
 * `POST /reports/validation-run` stores what one run finds as findings (`validationFindings`):
 * new problems are opened, problems found again keep their finding, and findings the run did not
 * find are marked "no longer found". Nothing is deleted. It writes through the normal guarded
 * write, so the account needs the right to add and change findings, and every change is audited.
 */
export const reportRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get('/reports/data-quality', async (request, reply) => {
      accountOf(request);
      noStore(reply);
      const { data, revision } = await repository.getNetwork();
      const findings = runMapCheck(data);
      const byRule = new Map<string, { rule: string; severity: string; count: number; ids: Set<string> }>();
      for (const f of findings) {
        const entry = byRule.get(f.rule) ?? { rule: f.rule, severity: f.severity, count: 0, ids: new Set<string>() };
        entry.count += 1;
        if (entry.ids.size < 5) entry.ids.add(f.targetId);
        byRule.set(f.rule, entry);
      }
      const rules = [...byRule.values()].map((r) => ({ rule: r.rule, severity: r.severity, count: r.count, exampleIds: [...r.ids] }));
      return { revision, checkedAt: new Date().toISOString(), rules };
    });

    app.post('/reports/validation-run', async (request, reply) => {
      const account = accountOf(request);
      noStore(reply);
      if (account && !(roleCan(account.role, 'create', 'validationFindings') && roleCan(account.role, 'update', 'validationFindings'))) {
        throw forbidden(`${ACCOUNT_ROLE_LABELS[account.role]} accounts cannot store map check findings. Ask an engineer or the office.`);
      }
      const { data, revision } = await repository.getNetwork();
      const now = new Date();
      const problems = runMapCheck(data);
      const { upserts, summary } = reconcileFindings(data.validationFindings ?? [], problems, { now, actor: account?.displayName ?? 'Setup mode (login off)' });
      let stored = revision;
      if (upserts.length > 0) {
        const changes: ChangeSet = { upserts: { validationFindings: upserts } };
        const result = await repository.applyChanges(changes, changeSetGuard(changes), writeOptionsFor(request, changes, 'changes'));
        stored = result.revision;
      }
      const after = [...new Map([...(data.validationFindings ?? []), ...upserts].map((f) => [f.id, f])).values()];
      return { revision: stored, checkedAt: now.toISOString(), written: upserts.length, summary, counts: findingCounts(after) };
    });
  };
