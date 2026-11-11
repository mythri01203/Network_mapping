import type { AccountSummary, AuthStatus, OrganisationStatus, OrganisationSummary, PlatformEvent } from '@fibergis/shared';

import { type ApiClient, type ApiClientOptions, createApiClient, type RawRequest } from '../../api/client';

/**
 * Phase 23b: the organisations on this server, for the platform administrator (an administrator of
 * the first organisation). The server checks every call; this only shapes them.
 */
export interface OrganisationsClient {
  status(): Promise<AuthStatus>;
  list(): Promise<{ organisations: OrganisationSummary[]; events: PlatformEvent[] }>;
  create(input: { name: string; admin: { username: string; displayName: string; password?: string } }): Promise<{
    organisation: OrganisationSummary;
    admin: AccountSummary;
    /** Shown once, when the server made the password. */
    temporaryPassword?: string;
  }>;
  update(id: string, input: { name?: string; status?: OrganisationStatus }): Promise<{ organisation: OrganisationSummary }>;
}

export function createOrganisationsClient(options: ApiClientOptions = {}): OrganisationsClient {
  const call = (createApiClient(options) as ApiClient & { raw: RawRequest }).raw;
  return {
    status: () => call<AuthStatus>('GET', '/auth/status'),
    list: () => call('GET', '/platform/organisations'),
    create: (input) => call('POST', '/platform/organisations', input),
    update: (id, input) => call('PATCH', `/platform/organisations/${encodeURIComponent(id)}`, input),
  };
}

export const organisationsClient = createOrganisationsClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' });

/** Plain words for an organisation's state, for the list. */
export const organisationStateLabel = (o: Pick<OrganisationSummary, 'status' | 'host'>): string =>
  o.status === 'active' ? (o.host ? 'On (first organisation)' : 'On') : 'Switched off: nobody in it can log in';
