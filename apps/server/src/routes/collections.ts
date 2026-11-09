import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { type ChangeSet, COLLECTION_SCHEMAS, type CollectionName, isCollectionName } from '@fibergis/shared';

import { noStore, prepareAuditEntries, redactRecordForViewer, writeOptionsFor } from '../auth/access';
import type { NetworkRepository } from '../db/repository';
import { badRequest, notFound } from '../lib/errors';
import { changeSetGuard } from '../lib/linkGuard';

interface CollectionParams {
  collection: string;
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
    app.get<{ Params: CollectionParams }>('/:collection', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      noStore(reply);
      return (await repository.list(collection)).map((record) => redactRecordForViewer(request, collection, record)).filter((record) => record !== null);
    });

    app.get<{ Params: RecordParams }>('/:collection/:id', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const record = await repository.get(collection, request.params.id);
      if (!record) throw notFound(`${collection}/${request.params.id} does not exist.`);
      const version = await repository.getVersion(collection, request.params.id);
      noStore(reply);
      if (version !== undefined) reply.header('x-record-version', version).header('etag', `"${version}"`);
      return redactRecordForViewer(request, collection, record);
    });

    app.put<{ Params: RecordParams }>('/:collection/:id', { bodyLimit: RECORD_BODY_LIMIT }, async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const record = COLLECTION_SCHEMAS[collection].parse(request.body);
      if (record.id !== request.params.id) throw badRequest('The record id must match the id in the URL.');
      const expected = expectedVersion(request);
      const existed = (await repository.get(collection, record.id)) !== undefined;
      const changes = await prepareAuditEntries(
        request,
        {
          upserts: { [collection]: [record] },
          ...(expected !== undefined ? { expect: { [collection]: { [record.id]: expected } } } : {}),
        } as ChangeSet,
        repository,
      );
      const { revision, versions } = await repository.applyChanges(changes, changeSetGuard(changes), writeOptionsFor(request, changes));
      const version = versions?.[collection]?.[record.id];
      reply.code(existed ? 200 : 201).header('x-network-revision', revision);
      if (version !== undefined) reply.header('x-record-version', version).header('etag', `"${version}"`);
      return record;
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
      const { revision, deleted } = await repository.applyChanges(changes, changeSetGuard(changes), writeOptionsFor(request, changes));
      if (deleted === 0) throw notFound(`${collection}/${request.params.id} does not exist.`);
      return reply.code(204).header('x-network-revision', revision).send();
    });
  };
