import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AUDIT_ROLE_FOR,
  columnMappingSchema,
  formatLogTimestamp,
  ingestBodySchema,
  ingestRowSchema,
  MAX_INGEST_ROWS,
  type MonitoringSource,
  monitoringSourceKindSchema,
  randomCode,
  roleMay,
} from '@fibergis/shared';

import { auditActorOf, noStore, requireSystem } from '../auth/access';
import { hashToken } from '../auth/passwords';
import type { NetworkRepository } from '../db/repository';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { type IngestActor, ingestRows } from '../monitoring/ingestService';
import type { RetentionLimits } from '../monitoring/retention';
import type { MonitoringTokenStore } from '../monitoring/tokenStore';

/**
 * Live monitoring routes (Phase 7). Sources and push tokens are for the administrator only; a file
 * import for the administrator and engineers; the push endpoint takes only a source's token and can
 * do nothing else. Every stored row goes through `ingestRows`.
 */

export interface MonitoringRouteOptions {
  repository: NetworkRepository;
  tokens: MonitoringTokenStore;
  ingestPerMinute: number;
  retention?: RetentionLimits;
}

/** A push carries at most `MAX_INGEST_ROWS` small rows. */
export const INGEST_BODY_LIMIT = 512 * 1024;

const createSourceSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  kind: monitoringSourceKindSchema,
  description: z.string().trim().max(300).optional(),
});
const patchSourceSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().optional(),
  columnMapping: columnMappingSchema.optional(),
});
const importSchema = z.strictObject({
  sourceId: z.string().min(1),
  rows: z.array(ingestRowSchema).min(1).max(MAX_INGEST_ROWS),
  columnMapping: columnMappingSchema.optional(),
  dryRun: z.boolean().optional(),
});

const actorOf = (request: FastifyRequest): IngestActor => {
  const account = request.auth.account;
  return account ? { user: account.displayName, role: AUDIT_ROLE_FOR[account.role], actorId: account.id } : { user: 'Setup mode (login off)', role: 'Administrator' };
};

const bearer = (request: FastifyRequest): string | undefined => {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
};

export const monitoringRoutes =
  ({ repository, tokens, ingestPerMinute, retention }: MonitoringRouteOptions): FastifyPluginAsync =>
  async (app) => {
    const keep = retention ? { retention } : {};
    const sourceById = async (id: string): Promise<MonitoringSource> => {
      const source = await repository.get('monitoringSources', id);
      if (!source) throw notFound(`Monitoring source ${id} is not on record.`);
      return source;
    };
    /** Phase 23: who the server's audit events name for a source change. */
    const trace = (request: FastifyRequest) => ({ actor: auditActorOf(request), source: 'monitoring' as const });
    const audit = (request: FastifyRequest, action: string, details: string, assetId: string) => {
      const actor = actorOf(request);
      return { id: `LOG-${randomCode(10)}`, timestamp: formatLogTimestamp(new Date()), user: actor.user, role: actor.role, action, details, assetId, assetType: 'System' as const };
    };

    app.get('/monitoring/sources', async (request, reply) => {
      noStore(reply);
      const sources = await repository.list('monitoringSources');
      const admin = request.auth.mode === 'setup' || (!!request.auth.account && roleMay(request.auth.account.role, 'manage_monitoring'));
      return { sources: sources.map((s) => ({ ...s, ...(admin ? { token: tokens.info(s.id) ?? null } : {}) })) };
    });

    app.post('/monitoring/sources', async (request) => {
      requireSystem(request, 'manage_monitoring');
      const body = createSourceSchema.parse(request.body ?? {});
      const now = new Date();
      const isTest = body.kind === 'test_simulator';
      const source: MonitoringSource = {
        id: `MON-${randomCode(10)}`,
        name: isTest && !/test/i.test(body.name) ? `TEST ${body.name}` : body.name,
        kind: body.kind,
        isTest,
        enabled: !isTest,
        ...(body.description ? { description: body.description } : {}),
        createdAt: now.toISOString(),
        ...(request.auth.account ? { createdBy: request.auth.account.displayName } : {}),
      };
      const token = body.kind === 'push' ? tokens.issue(source.id, request.auth.account?.id ?? null, now) : undefined;
      if (token) source.tokenCreatedAt = now.toISOString();
      const result = await repository.applyChanges({
        upserts: { monitoringSources: [source], auditLogs: [audit(request, 'MONITORING_SOURCE_ADDED', `${source.name} (${source.kind})${isTest ? ', TEST, switched off until the administrator switches it on' : ''}`, source.id)] },
      }, undefined, trace(request));
      return { revision: result.revision, source, ...(token ? { token, tokenNote: 'Shown once. Copy it now: the server keeps only a hash.' } : {}) };
    });

    app.patch<{ Params: { id: string } }>('/monitoring/sources/:id', async (request) => {
      requireSystem(request, 'manage_monitoring');
      const body = patchSourceSchema.parse(request.body ?? {});
      const source = { ...(await sourceById(request.params.id)), ...body };
      const changed = Object.keys(body).join(', ') || 'nothing';
      const result = await repository.applyChanges({ upserts: { monitoringSources: [source], auditLogs: [audit(request, 'MONITORING_SOURCE_CHANGED', `${source.name}: ${changed}${body.enabled !== undefined ? ` (now ${body.enabled ? 'on' : 'off'})` : ''}`, source.id)] } }, undefined, trace(request));
      return { revision: result.revision, source };
    });

    app.post<{ Params: { id: string } }>('/monitoring/sources/:id/token', async (request) => {
      requireSystem(request, 'manage_monitoring');
      const source = await sourceById(request.params.id);
      if (source.kind !== 'push') throw badRequest('Only a push source has a token.');
      const now = new Date();
      const token = tokens.issue(source.id, request.auth.account?.id ?? null, now);
      const result = await repository.applyChanges({ upserts: { monitoringSources: [{ ...source, tokenCreatedAt: now.toISOString() }], auditLogs: [audit(request, 'MONITORING_TOKEN_ISSUED', `New push token for ${source.name}; any older token stops working.`, source.id)] } }, undefined, trace(request));
      return { revision: result.revision, token, tokenNote: 'Shown once. Copy it now: the server keeps only a hash.' };
    });

    app.delete<{ Params: { id: string } }>('/monitoring/sources/:id/token', async (request) => {
      requireSystem(request, 'manage_monitoring');
      const source = await sourceById(request.params.id);
      const revoked = tokens.revoke(source.id);
      const { tokenCreatedAt: _gone, ...rest } = source;
      const result = await repository.applyChanges({ upserts: { monitoringSources: [rest], auditLogs: [audit(request, 'MONITORING_TOKEN_REVOKED', `Push token for ${source.name} ${revoked ? 'revoked' : 'was not set'}.`, source.id)] } }, undefined, trace(request));
      return { revision: result.revision, revoked };
    });

    app.post('/monitoring/import', async (request) => {
      requireSystem(request, 'import_monitoring');
      const body = importSchema.parse(request.body ?? {});
      const source = await sourceById(body.sourceId);
      if (source.kind !== 'file_import') throw badRequest(`${source.name} is not a file import source.`);
      if (!source.enabled) throw new HttpError(409, 'source_off', `${source.name} is switched off. Nothing was imported.`);
      return ingestRows(repository, source, body.rows, actorOf(request), { dryRun: body.dryRun, via: 'file import', ...keep, ...(body.columnMapping ? { sourcePatch: { columnMapping: body.columnMapping } } : {}) });
    });

    app.post('/monitoring/simulate', async (request) => {
      requireSystem(request, 'manage_monitoring');
      const body = importSchema.omit({ columnMapping: true }).parse(request.body ?? {});
      const source = await sourceById(body.sourceId);
      if (source.kind !== 'test_simulator' || !source.isTest) throw badRequest('Only the TEST simulator source can make simulated rows.');
      if (!source.enabled) throw new HttpError(409, 'source_off', 'The TEST simulator is switched off. Switch it on first (administrator).');
      return ingestRows(repository, source, body.rows, actorOf(request), { dryRun: body.dryRun, via: 'TEST simulator', ...keep });
    });

    /** For a script or NMS on the owner's network: `Authorization: Bearer <token>`. Can do nothing else. */
    app.post(
      '/monitoring/ingest',
      {
        bodyLimit: INGEST_BODY_LIMIT,
        // Per source for a known token; per address otherwise, so guessing with made-up tokens is limited too.
        config: {
          rateLimit: {
            max: ingestPerMinute,
            timeWindow: 60_000,
            keyGenerator: (request: FastifyRequest) => {
              const token = bearer(request);
              const sourceId = token ? tokens.sourceFor(token) : undefined;
              return sourceId ? `source:${sourceId}` : `address:${hashToken(request.ip)}`;
            },
          },
        },
      },
      async (request) => {
        const token = bearer(request);
        const sourceId = token ? tokens.sourceFor(token) : undefined;
        if (!sourceId) throw new HttpError(401, 'bad_token', 'Missing or unknown monitoring token. Nothing was stored.');
        const source = await repository.get('monitoringSources', sourceId);
        if (!source || source.kind !== 'push' || source.isTest) throw new HttpError(401, 'bad_token', 'This token is not for a push source. Nothing was stored.');
        if (!source.enabled) throw new HttpError(409, 'source_off', `${source.name} is switched off. Nothing was stored.`);
        const body = ingestBodySchema.parse(request.body ?? {});
        // Phase 20: OLT, card, PON port and interface rows come in `devices`, on the same token.
        return ingestRows(repository, source, body.rows ?? [], { user: `Monitoring source ${source.name}`, role: 'Administrator' }, { via: 'push', ...keep, ...(body.devices?.length ? { devices: body.devices } : {}) });
      },
    );
  };
