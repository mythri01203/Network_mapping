import type { FastifyPluginAsync } from 'fastify';
import { changeSetSchema, createBackup, parseBackup, type ChangeSet, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';
import { badRequest } from '../lib/errors';
import type { NetworkRepository } from '../db/repository';

/** Whole-network operations: snapshot reads, batched changes, backup/restore and demo reset. */
export const networkRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get('/network', async () => repository.getNetwork());

    app.post('/changes', async (request) => {
      const changes: ChangeSet = changeSetSchema.parse(request.body ?? {});
      return repository.applyChanges(changes);
    });

    app.get('/backup', async (_request, reply) => {
      const { data } = await repository.getNetwork();
      const exportedAt = new Date().toISOString();
      reply.header('content-disposition', `attachment; filename="fibergis-backup-${exportedAt.slice(0, 10)}.json"`);
      return createBackup(data, exportedAt);
    });

    /** Replaces only the collections present in the backup, so partial backups merge cleanly. */
    app.post('/restore', async (request) => {
      const result = parseBackup(request.body);
      if (!result.ok) throw badRequest(result.error);
      const { collections, projectStartPoint } = result.backup;
      const revision = await repository.replaceCollections(collections);
      return { revision, restored: Object.keys(collections), projectStartPoint };
    });

    /** Reloads the demo network. The user's custom equipment catalog is kept. */
    app.post('/reset', async () => {
      const sample: Partial<NetworkSnapshot> = createSampleNetwork();
      delete sample.catalog;
      return { revision: await repository.replaceCollections(sample) };
    });
  };
