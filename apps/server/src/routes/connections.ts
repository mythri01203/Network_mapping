import type { FastifyPluginAsync } from 'fastify';

import { buildConnectionIndex, connectionsForCore, connectionsForElement, linkCheckSummary, orphanChecksFor, resolveColorSchemes } from '@fibergis/shared';

import { accountOf, noStore, redactForViewer } from '../auth/access';
import type { NetworkRepository } from '../db/repository';
import { badRequest } from '../lib/errors';
import { wholeNumberParam } from '../lib/queryParams';

/**
 * Network mapping Phase 13: the connection index, read-only. `GET /connections?element=<id>` lists
 * every recorded link of one record (equipment, cable, splitter, closure, customer, ONT, Cable TV
 * item); `GET /connections?cable=<id>&core=<n>` lists the links of one fibre. Each link comes with
 * where it is recorded, who and when (only when recorded), its warnings and its check state
 * ("Not checked" is a state, never left out). Built from this organisation's records only (the
 * repository is the request's own), after the same personal-data hiding as every other answer.
 */
export const connectionRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Querystring: { element?: string; cable?: string; core?: string } }>('/connections', async (request, reply) => {
      accountOf(request);
      const element = request.query.element?.trim();
      const cable = request.query.cable?.trim();
      const core = wholeNumberParam('core', request.query.core, { min: 1, max: 10_000 });
      if (element ? cable || core !== undefined : !cable || core === undefined) {
        throw badRequest('Send element=<record id>, or cable=<cable id>&core=<fibre number>.');
      }
      if ((element ?? cable ?? '').length > 200) throw badRequest('That id is too long.');
      noStore(reply);
      const { data: stored, revision } = await repository.getNetwork();
      // Phase 12: names a role may not see are hidden before any words are made from them.
      const data = redactForViewer(request, stored);
      const index = buildConnectionIndex(data, resolveColorSchemes(data.settings));
      const list = element ? connectionsForElement(index, element) : connectionsForCore(index, cable!, core!);
      const orphans = orphanChecksFor(index, element ? { elementId: element } : { cableId: cable!, core: core! });
      return {
        revision,
        ...(element ? { element } : { cable, core }),
        connections: list.map((c) => {
          const { checks, ...summary } = linkCheckSummary(index, c);
          return { ...c, check: { ...summary, count: checks.length }, checks };
        }),
        /** Checks of links that are no longer on record. Kept, shown, never an error. */
        checksOfLinksNotOnRecord: orphans,
      };
    });
  };
