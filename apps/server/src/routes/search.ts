import type { FastifyPluginAsync } from 'fastify';

import { isSearchKind, SEARCH_MAX_LIMIT, SEARCH_MAX_QUERY, type SearchKind, searchNetwork } from '@fibergis/shared';

import { accountOf, noStore, redactForViewer } from '../auth/access';
import type { NetworkRepository } from '../db/repository';
import { badRequest } from '../lib/errors';
import { wholeNumberParam } from '../lib/queryParams';

/** The furthest a page may start, so a cursor cannot ask the server to walk for ever. */
const MAX_OFFSET = 100_000;

/**
 * Phase 16: `GET /search?q=` over the network of the request's organisation (Phase 23b: the
 * repository is scoped to it). The same search the web app runs (`searchNetwork`), on the network
 * as this person may see it: the data is passed through the same redaction as `GET /network`
 * first, so a hidden value can never be found by searching for it.
 */
export const searchRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Querystring: { q?: string; kinds?: string; limit?: string; cursor?: string } }>('/search', async (request, reply) => {
      accountOf(request);
      const q = (request.query.q ?? '').trim();
      if (!q) throw badRequest('Send q=<what to look for>, such as a name, id, serial, tag, pole number, cable/fibre or port.');
      if (q.length > SEARCH_MAX_QUERY) throw badRequest(`q may be at most ${SEARCH_MAX_QUERY} characters.`);
      let kinds: SearchKind[] | undefined;
      if (request.query.kinds !== undefined) {
        const names = request.query.kinds.split(',').map((k) => k.trim()).filter(Boolean);
        const unknown = names.find((k) => !isSearchKind(k));
        if (unknown) throw badRequest(`Unknown kind "${unknown}".`);
        kinds = names as SearchKind[];
      }
      const limit = wholeNumberParam('limit', request.query.limit, { min: 1, max: SEARCH_MAX_LIMIT }) ?? 50;
      const offset = wholeNumberParam('cursor', request.query.cursor, { min: 0, max: MAX_OFFSET }) ?? 0;
      noStore(reply);
      const { data, revision } = await repository.getNetwork();
      const visible = redactForViewer(request, data);
      const result = searchNetwork(visible, q, { ...(kinds ? { kinds } : {}), limit, offset });
      const next = offset + result.hits.length < result.total ? offset + result.hits.length : undefined;
      if (next !== undefined) reply.header('x-next-cursor', String(next));
      return { revision, ...result, ...(next !== undefined ? { nextCursor: String(next) } : {}) };
    });
  };
