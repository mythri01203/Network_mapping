import type { FastifyPluginAsync } from 'fastify';

import { type ChangeSet, COLLECTION_SCHEMAS, type CollectionName, isCollectionName } from '@fibergis/shared';

import type { NetworkRepository } from '../db/repository';
import { badRequest, notFound } from '../lib/errors';

interface CollectionParams {
  collection: string;
}

interface RecordParams extends CollectionParams {
  id: string;
}

const resolveCollection = (name: string): CollectionName => {
  if (!isCollectionName(name)) throw notFound(`Unknown collection "${name}".`);
  return name;
};

/**
 * Record-level REST access: `/<collection>` and `/<collection>/<id>`. Writes respond with the new
 * network revision in the `x-network-revision` header.
 */
export const collectionRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: CollectionParams }>('/:collection', async (request) =>
      repository.list(resolveCollection(request.params.collection)),
    );

    app.get<{ Params: RecordParams }>('/:collection/:id', async (request) => {
      const collection = resolveCollection(request.params.collection);
      const record = await repository.get(collection, request.params.id);
      if (!record) throw notFound(`${collection}/${request.params.id} does not exist.`);
      return record;
    });

    app.put<{ Params: RecordParams }>('/:collection/:id', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const record = COLLECTION_SCHEMAS[collection].parse(request.body);
      if (record.id !== request.params.id) throw badRequest('The record id must match the id in the URL.');
      const existed = (await repository.get(collection, record.id)) !== undefined;
      const { revision } = await repository.applyChanges({ upserts: { [collection]: [record] } } as ChangeSet);
      reply.code(existed ? 200 : 201).header('x-network-revision', revision);
      return record;
    });

    app.delete<{ Params: RecordParams }>('/:collection/:id', async (request, reply) => {
      const collection = resolveCollection(request.params.collection);
      const { revision, deleted } = await repository.applyChanges({ deletes: { [collection]: [request.params.id] } });
      if (deleted === 0) throw notFound(`${collection}/${request.params.id} does not exist.`);
      return reply.code(204).header('x-network-revision', revision).send();
    });
  };
