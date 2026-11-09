import type { ColumnMapping, IngestRow, MonitoringSource, MonitoringSourceKind } from '@fibergis/shared';

import { type ApiClient, createApiClient, type RawRequest } from './client';

/**
 * Live monitoring requests (Phase 7). Sources and tokens: administrator. File import: administrator
 * and engineers. The push endpoint is for a script on the owner's network, not this app.
 */

export interface IngestResult {
  revision?: number;
  stored: { readings: number; statuses: number };
  matched: number;
  duplicates: number;
  skipped: { row: number; reason: string }[];
  unmatched: { row: number; key: string; reason: string }[];
  alarmsRaised: number;
  isTest: boolean;
  dryRun: boolean;
}

export interface SourceWithToken extends MonitoringSource {
  token?: { createdAt: string; lastUsedAt?: string } | null;
}

const call = (createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' }) as ApiClient & { raw: RawRequest }).raw;
const path = (id: string) => `/monitoring/sources/${encodeURIComponent(id)}`;

export const monitoringClient = {
  sources: () => call<{ sources: SourceWithToken[] }>('GET', '/monitoring/sources'),
  createSource: (input: { name: string; kind: MonitoringSourceKind; description?: string }) =>
    call<{ source: MonitoringSource; token?: string; tokenNote?: string }>('POST', '/monitoring/sources', input),
  updateSource: (id: string, input: { name?: string; enabled?: boolean; description?: string; columnMapping?: ColumnMapping }) =>
    call<{ source: MonitoringSource }>('PATCH', path(id), input),
  newToken: (id: string) => call<{ token: string; tokenNote: string }>('POST', `${path(id)}/token`),
  revokeToken: (id: string) => call<{ revoked: boolean }>('DELETE', `${path(id)}/token`),
  importRows: (input: { sourceId: string; rows: IngestRow[]; columnMapping?: ColumnMapping; dryRun?: boolean }) =>
    call<IngestResult>('POST', '/monitoring/import', input, { timeoutMs: 60_000 }),
  simulate: (input: { sourceId: string; rows: IngestRow[] }) => call<IngestResult>('POST', '/monitoring/simulate', input),
};
