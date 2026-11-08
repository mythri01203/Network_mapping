import type { FastifyPluginAsync } from 'fastify';

import { accountOf, noStore } from '../auth/access';
import type { NetworkRepository } from '../db/repository';
import { checkNetwork } from '../lib/mapCheck';

/**
 * The data-quality summary for the Reports screen: the same rules as the `fibergis-map-check`
 * skill, run on the stored network. Only rule, level, count and example ids go back, never the
 * checker's sentences, because some older rules quote customer names.
 */
export const reportRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get('/reports/data-quality', async (request, reply) => {
      accountOf(request);
      noStore(reply);
      const { data, revision } = await repository.getNetwork();
      const findings = checkNetwork(data);
      const byRule = new Map<string, { rule: string; severity: string; count: number; ids: Set<string> }>();
      for (const f of findings) {
        const entry = byRule.get(f.rule) ?? { rule: f.rule, severity: f.severity, count: 0, ids: new Set<string>() };
        entry.count += 1;
        if (entry.ids.size < 5) entry.ids.add(f.id);
        byRule.set(f.rule, entry);
      }
      const rules = [...byRule.values()].map((r) => ({ rule: r.rule, severity: r.severity, count: r.count, exampleIds: [...r.ids] }));
      return { revision, checkedAt: new Date().toISOString(), rules };
    });
  };
