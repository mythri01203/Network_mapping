import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { type ChangeSet, COLLECTION_SCHEMAS, type CollectionName, isCollectionName } from '@fibergis/shared';

import { noStore, ownJobsOf, prepareAuditEntries, redactRecordForViewer, restoreHiddenPersonalData, writeOptionsFor } from '../auth/access';
import { type NetworkRepository, PAGE_MAX_LIMIT } from '../db/repository';
import { badRequest, notFound } from '../lib/errors';
import { changeSetGuard } from '../lib/linkGuard';
import { boxParam, idsParam, wholeNumberParam } from '../lib/queryParams';
import { composeGuards, settingsGuard } from '../lib/settingsGuard';

/** Every guard a record write passes, the same as `POST /changes`. */
const guardFor = (changes: ChangeSet) => composeGuards(changeSetGuard(changes), settingsGuard(changes));

interface CollectionParams {
  collection: string;
}

/** Phase 24: paging and filters for `GET /<collection>`; all optional. */
interface ListQuery {
  limit?: string;
  cursor?: string;
  ids?: string;
  bbox?: string;
  changedSince?: string;
}

interface RecordParams extends CollectionParams {
  id: string;
}

/** One record is small; this leaves room for a work order with its whole history. */
const RECORD_BODY_LIMIT = 2 * 1024 * 1024;

const resolveCollection = (name: string): CollectionName => {
  if (!isCollectionName(name)) throw notFound(`Unknown collection "${name}".`);
  return name;
};

/**
 * The version this client says it edited, from `If-Match` (a number, optionally quoted as an
 * ETag). Without it the write is last-write-wins, as before Phase 9.
 */
function expectedVersion(request: FastifyRequest): number | undefined {
  const header = request.headers['if-match'];
  if (header === undefined) return undefined;
  const text = String(Array.isArray(header) ? header[0] : header)
    .trim()
    .replace(/^W\//, '')
    .replace(/^"|"$/g, '');
  if (!/^\d+$/.test(text)) throw badRequest('If-Match must be the record version, a whole number (as sent in x-record-version or ETag).');
  return Number(text);
}

/**
 * Record-level REST access: `/<collection>` and `/<collection>/<id>`. Writes respond with the new
 * network revision in the `x-network-revision` header and the record's version in
 * `x-record-version`. Since Phase 9 a write may send `If-Match: <version>`: if someone else changed
 * the record since, it is refused with `version_conflict` (HTTP 409) and the current record, exactly
 * as `POST /changes` does.
 */
export const collectionRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    /**
     * The whole collection, as before, when no query is given. Phase 24: `limit` and `cursor` page
     * it (stored order; the next cursor is in `x-next-cursor`, absent on the last page), and `ids`,
     * `bbox=south,west,north,east` and `changedSince=<revision>` filter it. The answer is always
     * the array of records; `x-network-revision` says which revision it was read at.
     */
    app.get<{ Params: CollectionParams; Querystring: ListQuery }>('/:collection', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      noStore(reply);
      const query = request.query ?? {};
      const paged = (['limit', 'cursor', 'ids', 'bbox', 'changedSince'] as const).some((key) => query[key] !== undefined);
      // Phase 12: personal data by role (a technician's own job customers are shown in full).
      const ownJobs = await ownJobsOf(request, repository);
      const redact = (records: readonly unknown[]) => records.map((record) => redactRecordForViewer(request, collection, record, ownJobs)).filter((record) => record !== null);
      if (!paged) return redact(await repository.list(collection));
      const ids = idsParam(query.ids);
      const bbox = boxParam(query.bbox);
      const after = wholeNumberParam('cursor', query.cursor);
      const changedSince = wholeNumberParam('changedSince', query.changedSince);
      const limit = wholeNumberParam('limit', query.limit, { min: 1, max: PAGE_MAX_LIMIT }) ?? PAGE_MAX_LIMIT;
      const page = await repository.listPage(collection, {
        limit,
        ...(after !== undefined ? { after } : {}),
        ...(ids ? { ids } : {}),
        ...(bbox ? { bbox } : {}),
        ...(changedSince !== undefined ? { changedSince } : {}),
      });
      reply.header('x-network-revision', page.revision);
      if (page.next !== undefined) reply.header('x-next-cursor', page.next);
      return redact(page.records);
    });

    app.get<{ Params: RecordParams }>('/:collection/:id', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const record = await repository.get(collection, request.params.id);
      if (!record) throw notFound(`${collection}/${request.params.id} does not exist.`);
      const version = await repository.getVersion(collection, request.params.id);
      noStore(reply);
      if (version !== undefined) reply.header('x-record-version', version).header('etag', `"${version}"`);
      return redactRecordForViewer(request, collection, record, await ownJobsOf(request, repository));
    });

    app.put<{ Params: RecordParams }>('/:collection/:id', { bodyLimit: RECORD_BODY_LIMIT }, async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const record = COLLECTION_SCHEMAS[collection].parse(request.body);
      if (record.id !== request.params.id) throw badRequest('The record id must match the id in the URL.');
      const expected = expectedVersion(request);
      const existed = (await repository.get(collection, record.id)) !== undefined;
      // Phase 12: a value the writer's role could not see is kept as stored, never saved as "Hidden".
      const changes = await restoreHiddenPersonalData(
        request,
        await prepareAuditEntries(
          request,
          {
            upserts: { [collection]: [record] },
            ...(expected !== undefined ? { expect: { [collection]: { [record.id]: expected } } } : {}),
          } as ChangeSet,
          repository,
        ),
        repository,
      );
      const { revision, versions } = await repository.applyChanges(changes, guardFor(changes), writeOptionsFor(request, changes, 'record'));
      const version = versions?.[collection]?.[record.id];
      reply.code(existed ? 200 : 201).header('x-network-revision', revision);
      if (version !== undefined) reply.header('x-record-version', version).header('etag', `"${version}"`);
      // The stored record, as this role may see it (never a value the role could not see).
      const stored = (changes.upserts?.[collection] as unknown[] | undefined)?.[0] ?? record;
      return redactRecordForViewer(request, collection, stored, await ownJobsOf(request, repository));
    });

    app.delete<{ Params: RecordParams }>('/:collection/:id', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const expected = expectedVersion(request);
      const changes: ChangeSet = await prepareAuditEntries(
        request,
        {
          deletes: { [collection]: [request.params.id] },
          ...(expected !== undefined ? { expect: { [collection]: { [request.params.id]: expected } } } : {}),
        },
        repository,
      );
      const { revision, deleted } = await repository.applyChanges(changes, guardFor(changes), writeOptionsFor(request, changes, 'record'));
      if (deleted === 0) throw notFound(`${collection}/${request.params.id} does not exist.`);
      return reply.code(204).header('x-network-revision', revision).send();
    });
  };
