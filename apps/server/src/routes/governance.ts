import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AUDIT_ROLE_FOR,
  type AuditEvent,
  type AuditLog,
  type ChangeRequest,
  type ChangeRequestEventKind,
  type ChangeRequestPerson,
  changeRequestNoteSchema,
  changeRequestRightsProblem,
  changeRequestStatusProblem,
  type ChangeRequestStep,
  CHANGE_REQUEST_MAX_RECORDS,
  CHANGE_REQUEST_STATUSES,
  type ChangeSet,
  changeSetSchema,
  changeSetSize,
  closeChangeRequestSchema,
  type CollectionName,
  createChangeRequestSchema,
  diffRecords,
  formatLogTimestamp,
  isCollectionName,
  mayReadChangeRequest,
  mayRequestChange,
  randomCode,
  type RecordVersions,
  reviewChangeRequestSchema,
  summarizeChangeSet,
  withoutAuditEntries,
} from '@fibergis/shared';

import {
  accountOf,
  auditActorOf,
  forbidden,
  noStore,
  ownJobsOf,
  redactAuditDiff,
  redactRecordForViewer,
  requireAction,
  restoreHiddenPersonalData,
  writeOptionsFor,
} from '../auth/access';
import type { ChangeRequestStore } from '../db/changeRequestStore';
import type { RecordHistoryStore } from '../db/historyStore';
import type { NetworkRepository } from '../db/repository';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { changeSetGuard } from '../lib/linkGuard';
import { composeGuards, settingsGuard } from '../lib/settingsGuard';

export interface GovernanceRouteOptions {
  repository: NetworkRepository;
  history: RecordHistoryStore;
  changeRequests: ChangeRequestStore;
}

/** A proposed change carries whole records, like `POST /changes`, but a request is kept small. */
const CHANGE_REQUEST_BODY_LIMIT = 4 * 1024 * 1024;
const SMALL = { bodyLimit: 16 * 1024 };

const collectionParam = (name: string): CollectionName => {
  if (!isCollectionName(name)) throw notFound(`Unknown collection "${name}".`);
  return name;
};

const isViewer = (request: FastifyRequest) => request.auth.account?.role === 'viewer';

const csvCell = (value: unknown) => {
  const text = value === undefined || value === null ? '' : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const eventsCsv = (events: readonly AuditEvent[]) =>
  [
    ['Number', 'When', 'Who', 'Role', 'How', 'Collection', 'Record', 'Change', 'Kind of change', 'Network revision', 'Fields changed', 'Note', 'Change request'].join(','),
    ...events.map((e) =>
      [e.seq, e.at, e.actorName, e.actorRole ?? '', e.source, e.collection, e.recordId, e.op, e.actions.join(' '), e.revision, e.diff.map((d) => d.field).join(' '), e.note ?? '', e.changeRequestId ?? '']
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');

/** A request in a list: everything but the records themselves, with how many of each it touches. */
const listed = (request: ChangeRequest) => {
  const { changes, ...rest } = request;
  return { ...rest, summary: summarizeChangeSet(changes) };
};

/**
 * Phase 23: record history, the server's audit events and change requests.
 *
 * - `GET /audit-events`: who changed what (newest first). `?format=csv` needs the `export` right.
 * - `GET /revisions/:collection/:id`: the stored versions of one record; `/:seq` one version;
 *   `/compare?from=<seq>&to=<seq|current>` the fields that differ.
 * - `/change-requests`: ask for a change, approve or reject it, make it, mark it checked, close it.
 */
export const governanceRoutes =
  ({ repository, history, changeRequests }: GovernanceRouteOptions): FastifyPluginAsync =>
  async (app) => {
    const personOf = (request: FastifyRequest): ChangeRequestPerson => {
      const actor = auditActorOf(request);
      return { id: actor.id, name: actor.name };
    };

    /** The account whose rules apply (null in setup mode, where login is off). */
    const enforcedAccount = (request: FastifyRequest) => (request.auth.mode === 'enforced' ? accountOf(request) : null);

    /** A line in the existing audit trail too, so the Audit Trail screen shows the request's steps. */
    const auditLine = async (request: FastifyRequest, action: string, details: string, assetId: string) => {
      const account = request.auth.account;
      const entry: AuditLog = {
        id: `LOG-${randomCode(10)}`,
        timestamp: formatLogTimestamp(new Date()),
        user: account ? account.displayName : 'Setup mode (login off)',
        role: account ? AUDIT_ROLE_FOR[account.role] : 'Administrator',
        action,
        details: details.slice(0, 1000),
        assetId,
        assetType: 'System',
      };
      await repository.applyChanges({ upserts: { auditLogs: [entry] } }, undefined, { actor: auditActorOf(request), source: 'change_request' });
    };

    // --- Audit events --------------------------------------------------------------------------

    app.get<{ Querystring: { collection?: string; id?: string; before?: string; limit?: string; format?: string } }>('/audit-events', async (request, reply) => {
      accountOf(request);
      noStore(reply);
      const q = request.query;
      const query = z
        .object({
          collection: z.string().optional(),
          id: z.string().max(200).optional(),
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(2000).optional(),
          format: z.enum(['json', 'csv']).optional(),
        })
        .parse(q);
      const collection = query.collection ? collectionParam(query.collection) : undefined;
      const events = history.listEvents({
        ...(collection ? { collection } : {}),
        ...(query.id !== undefined ? { recordId: query.id } : {}),
        ...(query.before ? { beforeSeq: query.before } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      // Read-only accounts see who changed what, never the values (they could be phone numbers).
      // Phase 12: other roles do not see the values of customers' personal fields they may not see.
      const ownJobs = await ownJobsOf(request, repository);
      const shown = isViewer(request) ? events.map((e) => ({ ...e, diff: e.diff.map((d) => ({ field: d.field })) })) : events.map((e) => redactAuditDiff(request, e, ownJobs));
      if (query.format === 'csv') {
        requireAction(request, 'export');
        reply.header('content-type', 'text/csv; charset=utf-8');
        reply.header('content-disposition', `attachment; filename="fibergis-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
        return reply.send(eventsCsv(shown));
      }
      return { events: shown, retention: history.getRetention() };
    });

    // --- Record revisions ----------------------------------------------------------------------

    app.get<{ Params: { collection: string; id: string } }>('/revisions/:collection/:id', async (request, reply) => {
      accountOf(request);
      noStore(reply);
      const collection = collectionParam(request.params.collection);
      const id = request.params.id;
      const current = await repository.getVersion(collection, id);
      return { collection, id, currentVersion: current ?? null, revisions: history.listRevisions(collection, id), retention: history.getRetention() };
    });

    const revisionData = async (request: FastifyRequest, collection: CollectionName, id: string, seq: string) => {
      const ownJobs = await ownJobsOf(request, repository);
      if (seq === 'current') {
        const record = await repository.get(collection, id);
        return { seq: 'current' as const, data: record ? (redactRecordForViewer(request, collection, record, ownJobs) as Record<string, unknown> | null) : null };
      }
      if (!/^\d+$/.test(seq)) throw badRequest('A version is a revision number from the list, or "current".');
      const revision = history.getRevision(collection, id, Number(seq));
      if (!revision) throw notFound(`Revision ${seq} of ${collection}/${id} is not kept (it may be older than the retention).`);
      // A delete keeps the record as it was just before; on the "after" side it means "not there".
      return { seq: Number(seq), data: redactRecordForViewer(request, collection, revision.data, ownJobs) as Record<string, unknown> | null, op: revision.op };
    };

    app.get<{ Params: { collection: string; id: string }; Querystring: { from?: string; to?: string } }>('/revisions/:collection/:id/compare', async (request, reply) => {
      accountOf(request);
      noStore(reply);
      const collection = collectionParam(request.params.collection);
      const { id } = request.params;
      const from = request.query.from;
      if (!from) throw badRequest('Say which version to compare from: ?from=<revision number>&to=<revision number or "current">.');
      const before = await revisionData(request, collection, id, from);
      const after = await revisionData(request, collection, id, request.query.to ?? 'current');
      const afterData = 'op' in after && after.op === 'delete' ? null : after.data;
      return { collection, recordId: id, before: { seq: before.seq, data: before.data }, after: { seq: after.seq, data: afterData }, fields: diffRecords(before.data, afterData, { maxFields: 200, maxValueLength: 2000 }) };
    });

    app.get<{ Params: { collection: string; id: string; seq: string } }>('/revisions/:collection/:id/:seq', async (request, reply) => {
      accountOf(request);
      noStore(reply);
      const collection = collectionParam(request.params.collection);
      const revision = history.getRevision(collection, request.params.id, Number(request.params.seq));
      if (!/^\d+$/.test(request.params.seq) || !revision) throw notFound('That revision is not kept (it may be older than the retention).');
      return { ...revision, data: redactRecordForViewer(request, collection, revision.data, await ownJobsOf(request, repository)) };
    });

    // --- Change requests -----------------------------------------------------------------------

    const load = (request: FastifyRequest, id: string) => {
      const found = changeRequests.get(id);
      if (!found) throw notFound('That change request does not exist.');
      // Only Read-only accounts are kept out: a request can hold whole customer records.
      if (!mayReadChangeRequest(found, enforcedAccount(request))) throw forbidden('This account can only look, so it cannot open change requests. Ask the office.');
      return found;
    };

    /** Refuses a step: 403 when the role or person may not take it, 409 when the request is not at that point. */
    const allowStep = (request: FastifyRequest, cr: ChangeRequest, step: ChangeRequestStep) => {
      const rights = changeRequestRightsProblem(cr, step, enforcedAccount(request));
      if (rights) throw forbidden(rights);
      const status = changeRequestStatusProblem(cr, step);
      if (status) throw new HttpError(409, 'change_request_step', status);
    };

    /** Phase 12: a request as this role may see it: records in it lose the personal data the role may not see. */
    const shownRequest = async (request: FastifyRequest, cr: ChangeRequest): Promise<ChangeRequest> => {
      const ownJobs = await ownJobsOf(request, repository);
      const upserts = Object.fromEntries(
        Object.entries(cr.changes.upserts ?? {}).map(([c, records]) => [
          c,
          ((records ?? []) as unknown[]).map((r) => redactRecordForViewer(request, c as CollectionName, r, ownJobs)).filter((r) => r !== null),
        ]),
      );
      return { ...cr, changes: { ...cr.changes, upserts } as ChangeSet };
    };

    const event = (request: FastifyRequest, kind: ChangeRequestEventKind, text?: string) => {
      const who = personOf(request);
      return { at: new Date().toISOString(), byId: who.id, byName: who.name, kind, ...(text ? { text } : {}) };
    };

    app.get<{ Querystring: { status?: string } }>('/change-requests', async (request, reply) => {
      const account = enforcedAccount(request);
      noStore(reply);
      const status = request.query.status ? z.enum(CHANGE_REQUEST_STATUSES).parse(request.query.status) : undefined;
      return { requests: changeRequests.list(status).filter((cr) => mayReadChangeRequest(cr, account)).map(listed) };
    });

    app.get<{ Params: { id: string } }>('/change-requests/:id', async (request, reply) => {
      noStore(reply);
      return shownRequest(request, load(request, request.params.id));
    });

    app.post('/change-requests', { bodyLimit: CHANGE_REQUEST_BODY_LIMIT }, async (request, reply) => {
      const account = enforcedAccount(request);
      if (!mayRequestChange(account)) throw forbidden('This account can only look, so it cannot ask for changes. Ask the office for a working account.');
      const body = createChangeRequestSchema.parse(request.body ?? {});
      // Phase 12: a value the asker's role could not see is kept as stored, never saved as "Hidden".
      const proposed = await restoreHiddenPersonalData(request, withoutAuditEntries(body.changes), repository);
      const size = changeSetSize(proposed);
      if (size === 0) throw badRequest('The request has no changes in it. Nothing was saved.');
      if (size > CHANGE_REQUEST_MAX_RECORDS) throw badRequest(`One request may touch at most ${CHANGE_REQUEST_MAX_RECORDS} records; this one has ${size}. Split it into smaller requests.`);
      // The version of each record now, so making the change later is refused if someone changed it since.
      const baseVersions: RecordVersions = {};
      const touched = [
        ...Object.entries(proposed.upserts ?? {}).flatMap(([c, records]) => (records ?? []).map((r) => [c, (r as { id: string }).id] as const)),
        ...Object.entries(proposed.deletes ?? {}).flatMap(([c, ids]) => (ids ?? []).map((id) => [c, id] as const)),
      ];
      for (const [collection, id] of touched) {
        const version = await repository.getVersion(collection as CollectionName, id);
        if (version !== undefined) (baseVersions[collection as CollectionName] ??= {})[id] = version;
      }
      // A version the asker said they edited wins over the one now stored.
      for (const [collection, expected] of Object.entries(proposed.expect ?? {})) {
        Object.assign((baseVersions[collection as CollectionName] ??= {}), expected);
      }
      const changes: ChangeSet = { upserts: proposed.upserts ?? {}, deletes: proposed.deletes ?? {} };
      const created = changeRequests.create({ title: body.title, reason: body.reason ?? '', changes, baseVersions, requestedBy: personOf(request) });
      await auditLine(request, 'CHANGE_REQUESTED', `${created.title} (${size} record(s)).`, created.id);
      reply.code(201);
      return shownRequest(request, created);
    });

    app.post<{ Params: { id: string } }>('/change-requests/:id/review', SMALL, async (request) => {
      const cr = load(request, request.params.id);
      const body = reviewChangeRequestSchema.parse(request.body ?? {});
      allowStep(request, cr, body.decision);
      const now = new Date().toISOString();
      const next: ChangeRequest = {
        ...cr,
        status: body.decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: personOf(request),
        reviewedAt: now,
        ...(body.note ? { reviewNote: body.note } : {}),
        events: [...cr.events, event(request, body.decision === 'approve' ? 'approved' : 'rejected', body.note)],
      };
      const saved = changeRequests.save(next);
      await auditLine(request, body.decision === 'approve' ? 'CHANGE_REQUEST_APPROVED' : 'CHANGE_REQUEST_REJECTED', `${cr.title}${body.note ? `: ${body.note}` : ''}`, cr.id);
      return shownRequest(request, saved);
    });

    /** Makes an approved request: the same checked write as any change, with the rights of the person applying it. */
    app.post<{ Params: { id: string } }>('/change-requests/:id/apply', SMALL, async (request) => {
      const cr = load(request, request.params.id);
      allowStep(request, cr, 'apply');
      // Checked again against today's rules: a request made under older rules must still pass.
      const changes = await restoreHiddenPersonalData(request, changeSetSchema.parse({ upserts: cr.changes.upserts ?? {}, deletes: cr.changes.deletes ?? {}, expect: cr.baseVersions }), repository);
      try {
        const result = await repository.applyChanges(changes, composeGuards(changeSetGuard(changes), settingsGuard(changes)), {
          ...writeOptionsFor(request, changes, 'change_request'),
          changeRequestId: cr.id,
        });
        const saved = changeRequests.save({
          ...cr,
          status: 'applied',
          appliedBy: personOf(request),
          appliedAt: new Date().toISOString(),
          appliedRevision: result.revision,
          events: [...cr.events, event(request, 'applied')],
        });
        await auditLine(request, 'CHANGE_REQUEST_APPLIED', `${cr.title}: ${result.upserted} saved, ${result.deleted} deleted.`, cr.id);
        return { request: await shownRequest(request, saved), revision: result.revision, upserted: result.upserted, deleted: result.deleted };
      } catch (error) {
        // Nothing was written. The request stays approved, with the reason in its steps.
        if (error instanceof HttpError || error instanceof z.ZodError) {
          changeRequests.save({ ...cr, events: [...cr.events, event(request, 'apply_failed', error instanceof HttpError ? error.message : 'A record no longer passes the checks.')] });
        }
        throw error;
      }
    });

    app.post<{ Params: { id: string } }>('/change-requests/:id/verify', SMALL, async (request) => {
      const cr = load(request, request.params.id);
      const body = closeChangeRequestSchema.parse(request.body ?? {});
      allowStep(request, cr, 'verify');
      const saved = changeRequests.save({ ...cr, status: 'verified', verifiedBy: personOf(request), verifiedAt: new Date().toISOString(), events: [...cr.events, event(request, 'verified', body.note)] });
      await auditLine(request, 'CHANGE_REQUEST_VERIFIED', `${cr.title}${body.note ? `: ${body.note}` : ''}`, cr.id);
      return shownRequest(request, saved);
    });

    app.post<{ Params: { id: string } }>('/change-requests/:id/close', SMALL, async (request) => {
      const cr = load(request, request.params.id);
      const body = closeChangeRequestSchema.parse(request.body ?? {});
      allowStep(request, cr, 'close');
      const saved = changeRequests.save({ ...cr, status: 'closed', closedAt: new Date().toISOString(), events: [...cr.events, event(request, 'closed', body.note)] });
      await auditLine(request, 'CHANGE_REQUEST_CLOSED', `${cr.title}${body.note ? `: ${body.note}` : ''}`, cr.id);
      return shownRequest(request, saved);
    });

    app.post<{ Params: { id: string } }>('/change-requests/:id/comments', SMALL, async (request) => {
      const cr = load(request, request.params.id);
      const body = changeRequestNoteSchema.parse(request.body ?? {});
      allowStep(request, cr, 'comment');
      return shownRequest(request, changeRequests.save({ ...cr, events: [...cr.events, event(request, 'comment', body.text)] }));
    });
  };
