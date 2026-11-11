import {
  API_PREFIX,
  type AuditEvent,
  type ChangeRequest,
  type ChangeRequestStatus,
  type ChangeRequestSummaryLine,
  type ChangeSet,
  type CollectionName,
  type RecordRevisionSummary,
  type RevisionComparison,
  type RevisionRetention,
} from '@fibergis/shared';

import { type ApiClient, createApiClient, type RawRequest } from './client';

/**
 * Phase 23: the server's audit events, record revisions and change requests. The server decides
 * who may do what; these calls only ask.
 */

export type ListedChangeRequest = Omit<ChangeRequest, 'changes'> & { summary: ChangeRequestSummaryLine[] };

const call = (createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' }) as ApiClient & { raw: RawRequest }).raw;
const enc = encodeURIComponent;
const crPath = (id: string) => `/change-requests/${enc(id)}`;

export const governanceClient = {
  auditEvents: (query: { collection?: CollectionName; id?: string; before?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.collection) params.set('collection', query.collection);
    if (query.id) params.set('id', query.id);
    if (query.before) params.set('before', String(query.before));
    if (query.limit) params.set('limit', String(query.limit));
    const q = params.toString();
    return call<{ events: AuditEvent[]; retention: RevisionRetention }>('GET', `/audit-events${q ? `?${q}` : ''}`);
  },
  /** Where the server's audit file is downloaded from (needs the export right). */
  auditCsvUrl: () => `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}${API_PREFIX}/audit-events?format=csv&limit=2000`,
  revisions: (collection: CollectionName, id: string) =>
    call<{ collection: CollectionName; id: string; currentVersion: number | null; revisions: RecordRevisionSummary[]; retention: RevisionRetention }>('GET', `/revisions/${enc(collection)}/${enc(id)}`),
  compare: (collection: CollectionName, id: string, from: number, to: number | 'current') =>
    call<RevisionComparison>('GET', `/revisions/${enc(collection)}/${enc(id)}/compare?from=${from}&to=${to}`),
  changeRequests: (status?: ChangeRequestStatus) => call<{ requests: ListedChangeRequest[] }>('GET', `/change-requests${status ? `?status=${status}` : ''}`),
  changeRequest: (id: string) => call<ChangeRequest>('GET', crPath(id)),
  requestChange: (input: { title: string; reason?: string; changes: ChangeSet }) => call<ChangeRequest>('POST', '/change-requests', input),
  review: (id: string, decision: 'approve' | 'reject', note?: string) => call<ChangeRequest>('POST', `${crPath(id)}/review`, { decision, ...(note ? { note } : {}) }),
  apply: (id: string) => call<{ request: ChangeRequest; revision: number }>('POST', `${crPath(id)}/apply`, {}),
  verify: (id: string, note?: string) => call<ChangeRequest>('POST', `${crPath(id)}/verify`, note ? { note } : {}),
  close: (id: string, note?: string) => call<ChangeRequest>('POST', `${crPath(id)}/close`, note ? { note } : {}),
  comment: (id: string, text: string) => call<ChangeRequest>('POST', `${crPath(id)}/comments`, { text }),
};
