import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import {
  AUDIT_ROLE_FOR,
  type AuditLog,
  type ChangeSet,
  changeSetSchema,
  COLLECTION_NAMES,
  createBackup,
  describeRestoreCheck,
  formatLogTimestamp,
  type NetworkSnapshot,
  newRestoreProblems,
  parseBackup,
  randomCode,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { auditActorOf, noStore, ownJobsOf, prepareAuditEntries, redactForViewer, requireSystem, restoreHiddenPersonalData, writeOptionsFor } from '../auth/access';
import { AREA_MAX_LIMIT, type NetworkRepository } from '../db/repository';
import { buildBackupZip, readBackupZip, restorePhotos, writeSafetyCopy } from '../lib/backups';
import { badRequest, HttpError } from '../lib/errors';
import { changeSetGuard } from '../lib/linkGuard';
import { withPlacementWarnings } from '../lib/placementWarnings';
import { boxParam, collectionsParam, idsParam, wholeNumberParam } from '../lib/queryParams';
import { composeGuards, settingsGuard } from '../lib/settingsGuard';

export interface NetworkRouteOptions {
  photosDir: string;
  backupsDir: string;
  backupKeep: number;
  restoreMaxBytes: number;
}

/** Change sets carry whole records; a big KML import or a first upload can be large. */
export const CHANGES_BODY_LIMIT = 10 * 1024 * 1024;

/** Problems listed in a refused restore. The count says how many there are in all. */
const LISTED_PROBLEMS = 50;

/** Whole-network operations: snapshot reads, batched changes, backup/restore and demo reset. */
export const networkRoutes =
  (repository: NetworkRepository, options: NetworkRouteOptions): FastifyPluginAsync =>
  async (app) => {
    app.addContentTypeParser('application/zip', { parseAs: 'buffer', bodyLimit: options.restoreMaxBytes }, (_request, body, done) => done(null, body));

    /** A server-written audit entry, stamped with the person (or setup mode). */
    const auditEntry = (request: FastifyRequest, action: string, details: string): AuditLog => {
      const account = request.auth.account;
      return {
        id: `LOG-${randomCode(10)}`,
        timestamp: formatLogTimestamp(new Date()),
        user: account ? account.displayName : 'Setup mode (login off)',
        role: account ? AUDIT_ROLE_FOR[account.role] : 'Administrator',
        action,
        details: details.slice(0, 1000),
        assetId: 'SYSTEM',
        assetType: 'System',
      };
    };

    const backupJson = async () => {
      const { data } = await repository.getNetwork();
      const exportedAt = new Date().toISOString();
      return { json: JSON.stringify(createBackup(data, exportedAt)), exportedAt, data };
    };

    /** A zip of the whole network and every photo, saved in the backups folder before anything is replaced. */
    const safetyCopy = async (reason: 'before-reset' | 'before-restore') => {
      try {
        const { json } = await backupJson();
        const { zip } = await buildBackupZip(json, options.photosDir);
        return await writeSafetyCopy(options.backupsDir, zip, reason, options.backupKeep);
      } catch (error) {
        app.log.error({ err: error }, 'Safety copy failed');
        throw new HttpError(500, 'safety_copy_failed', 'The server could not save a safety copy first, so nothing was changed. Check the disk space and the backups folder.');
      }
    };

    app.get<{ Querystring: { except?: string } }>('/network', async (request, reply) => {
      noStore(reply);
      // Phase 24b: `except=equipment,cables`: every other collection in full (a device loading the big ones by map area).
      const except = collectionsParam(request.query?.except);
      if (except && repository.getNetworkExcept) {
        const partial = await repository.getNetworkExcept(except);
        return { ...partial, data: redactForViewer(request, partial.data, await ownJobsOf(request, repository)) };
      }
      const network = await repository.getNetwork();
      return { ...network, data: redactForViewer(request, network.data) };
    });

    /**
     * Phase 24b: records by id, with their versions: `ids=a,b` (at most 1000) in `collections=x,y`
     * (default: all). A device loading by map area uses it for records that loaded ones point to.
     */
    app.get<{ Querystring: { ids?: string; collections?: string } }>('/network/records', async (request, reply) => {
      const ids = idsParam(request.query.ids);
      if (!ids) throw badRequest('Send ids=<id>,<id> (at most 1000).');
      if (!repository.getRecordsByIds) throw new HttpError(404, 'not_supported', 'This server cannot read records by id.');
      const collections = collectionsParam(request.query.collections) ?? [...COLLECTION_NAMES];
      noStore(reply);
      const found = await repository.getRecordsByIds(ids, collections);
      return { ...found, data: redactForViewer(request, found.data, await ownJobsOf(request, repository)) };
    });

    /**
     * Phase 24: only the records whose point, line or area touches the box (from the spatial index).
     * Records with no map position (settings, the catalogue, audit entries) are never in it.
     */
    app.get<{ Querystring: { bbox?: string; collections?: string; limit?: string } }>('/network/area', async (request, reply) => {
      const box = boxParam(request.query.bbox);
      if (!box) throw badRequest('Send bbox=south,west,north,east.');
      const collections = collectionsParam(request.query.collections);
      const limit = wholeNumberParam('limit', request.query.limit, { min: 1, max: AREA_MAX_LIMIT });
      noStore(reply);
      const area = await repository.getArea(box, { ...(collections ? { collections } : {}), ...(limit ? { limit } : {}) });
      // Phase 12: personal data by role; a technician's own jobs may not be in the box, so read them.
      return { ...area, data: redactForViewer(request, area.data, await ownJobsOf(request, repository)) };
    });

    /**
     * Phase 24: what was stored or deleted after a revision, so a device that is up to date fetches
     * only that. `reload: true` when the history does not reach back: load `GET /network` instead.
     */
    app.get<{ Querystring: { since?: string } }>('/changes', async (request, reply) => {
      const since = wholeNumberParam('since', request.query.since);
      if (since === undefined) throw badRequest('Send since=<revision>, the revision this device last loaded.');
      noStore(reply);
      const changes = await repository.getChangesSince(since);
      return changes.reload ? changes : { ...changes, upserts: redactForViewer(request, changes.upserts, await ownJobsOf(request, repository)) };
    });

    app.post('/changes', { bodyLimit: CHANGES_BODY_LIMIT }, async (request) => {
      const parsed: ChangeSet = changeSetSchema.parse(request.body ?? {});
      // Phase 12: a value the writer's role could not see is kept as stored, never saved as "Hidden".
      const changes = await restoreHiddenPersonalData(request, await prepareAuditEntries(request, parsed, repository), repository);
      // Phase 3: a new point close to one of the same kind is saved, logged and reported back; never refused.
      const { guard, warnings } = withPlacementWarnings(changes, composeGuards(changeSetGuard(changes), settingsGuard(changes)));
      const result = await repository.applyChanges(changes, guard, writeOptionsFor(request, changes, 'changes'));
      if (warnings.length === 0) return result;
      for (const w of warnings) {
        if (w.rule === 'possible_duplicate_route') {
          // Phase 5: a cable with the same two ends along the same line; saved, logged, never refused.
          request.log[w.overridden ? 'info' : 'warn']({ rule: w.rule, cableId: w.cableId, nearId: w.nearId, overlapPercent: w.overlapPercent, overridden: w.overridden }, 'Possible duplicate route saved');
          continue;
        }
        request.log[w.overridden ? 'info' : 'warn']({ rule: w.rule, equipmentId: w.equipmentId, nearId: w.nearId, distanceMeters: w.distanceMeters, overridden: w.overridden }, 'Possible duplicate point saved');
      }
      return { ...result, warnings };
    });

    /** JSON as before; `?photos=1` gives a zip with every field photo. Administrator only once login is on. */
    app.get<{ Querystring: { photos?: string } }>('/backup', async (request, reply) => {
      requireSystem(request, 'backup');
      const { json, exportedAt } = await backupJson();
      noStore(reply);
      if (request.query.photos === '1' || request.query.photos === 'true') {
        const { zip, photos } = await buildBackupZip(json, options.photosDir);
        reply.header('content-type', 'application/zip');
        reply.header('content-disposition', `attachment; filename="fibergis-backup-${exportedAt.slice(0, 10)}.zip"`);
        reply.header('x-backup-photos', photos);
        return reply.send(Buffer.from(zip));
      }
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="fibergis-backup-${exportedAt.slice(0, 10)}.json"`);
      return reply.send(json);
    });

    /**
     * Replaces only the collections present in the backup, so partial backups merge cleanly. The
     * result is checked against the link, fiber, connection and fault rules; problems the stored
     * network does not already have refuse the restore with a list, unless the administrator
     * restores anyway (`?accept=problems`). A safety copy is always saved first.
     */
    app.post<{ Querystring: { accept?: string } }>('/restore', { bodyLimit: options.restoreMaxBytes }, async (request) => {
      requireSystem(request, 'restore');
      let raw: unknown = request.body;
      let photos: Awaited<ReturnType<typeof readBackupZip>> | undefined;
      if (Buffer.isBuffer(request.body)) {
        photos = readBackupZip(new Uint8Array(request.body), options.restoreMaxBytes * 4);
        if (!photos.ok) throw badRequest(photos.error);
        raw = photos.json;
      }
      const result = parseBackup(raw);
      if (!result.ok) throw badRequest(result.error);
      const { collections, projectStartPoint } = result.backup;

      const { data: current } = await repository.getNetwork();
      const after = { ...current, ...collections } as NetworkSnapshot;
      const check = newRestoreProblems(current, after);
      const accepted = request.query.accept === 'problems';
      if (check.problems.length > 0 && !accepted) {
        throw new HttpError(409, 'restore_refused', `Nothing was restored. ${describeRestoreCheck(check)}`, {
          problems: check.problems.slice(0, LISTED_PROBLEMS).map(({ rule, message, refs }) => ({ rule, message, refs })),
          counts: check.counts,
          total: check.problems.length,
        });
      }

      const copy = await safetyCopy('before-restore');
      const restored = Object.keys(collections);
      const photosAdded = photos?.ok ? await restorePhotos(photos.photos, options.photosDir) : 0;
      const details = `Restored ${restored.length} dataset(s) from a backup${photos ? ' with photos' : ''}. Safety copy first: ${copy}.${
        photosAdded ? ` ${photosAdded} photo(s) added.` : ''
      }${check.problems.length > 0 ? ` Restored with ${check.problems.length} problem(s) the administrator accepted.` : ''}`;
      // The audit trail is never rewound by a restore: entries already stored are kept as they are,
      // older ones from the backup are added, and the restore itself is written in the same step.
      const kept = new Map(current.auditLogs.map((entry) => [entry.id, entry]));
      for (const entry of collections.auditLogs ?? []) if (!kept.has(entry.id)) kept.set(entry.id, entry);
      const auditLogs = [...kept.values(), auditEntry(request, 'BACKUP_RESTORED', details)].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      const revision = await repository.replaceCollections({ ...collections, auditLogs }, undefined, { actor: auditActorOf(request), source: 'restore' });
      request.log.info({ restored: restored.length, problems: check.problems.length, photosAdded }, 'Backup restored');
      return {
        revision,
        restored,
        projectStartPoint,
        safetyCopy: copy,
        photosAdded,
        photosSkipped: photos?.ok ? photos.skipped.length : 0,
        acceptedProblems: check.problems.length,
      };
    });

    /** Reloads the demo network over everything except the custom catalog. Needs `{ "confirm": "reset" }`. */
    app.post<{ Body: { confirm?: string } | undefined }>('/reset', async (request) => {
      requireSystem(request, 'reset');
      // Always, login on or off: a page on another site must never be able to wipe the network.
      if (request.body?.confirm !== 'reset') {
        throw badRequest('Send { "confirm": "reset" } to replace the whole network with the sample. Nothing was changed.');
      }
      const before = await repository.counts();
      const copy = await safetyCopy('before-reset');
      const sample: Partial<NetworkSnapshot> = createSampleNetwork();
      delete sample.catalog;
      await repository.replaceCollections(sample, undefined, { actor: auditActorOf(request), source: 'reset' });
      const lost = COLLECTION_NAMES.filter((name) => name !== 'catalog' && before[name] > 0)
        .map((name) => `${before[name]} ${name}`)
        .join(', ');
      const audit = await repository.applyChanges(
        { upserts: { auditLogs: [auditEntry(request, 'NETWORK_RESET', `Network replaced with the sample. Before: ${lost || 'nothing'}. Safety copy first: ${copy}.`)] } },
        undefined,
        { actor: auditActorOf(request), source: 'reset' },
      );
      request.log.info('Network reset to the sample');
      return { revision: audit.revision, safetyCopy: copy };
    });
  };
