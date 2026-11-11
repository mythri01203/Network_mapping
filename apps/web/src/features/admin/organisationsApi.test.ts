import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/client';
import { createOrganisationsClient, organisationStateLabel } from './organisationsApi';

describe('organisations client (Phase 23b)', () => {
  it('sends the platform calls to the server routes', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ organisation: { id: 'ORG-1', name: 'Second ISP', status: 'suspended', host: false, createdAt: '', updatedAt: '', activeAccounts: 1 } });
    }) as unknown as typeof globalThis.fetch;
    const client = createOrganisationsClient({ baseUrl: 'http://server', fetch });
    const result = await client.update('ORG-1', { status: 'suspended' });
    expect(result.organisation.status).toBe('suspended');
    await client.create({ name: 'Third ISP', admin: { username: 'carol', displayName: 'Carol' } });
    await client.list();
    expect(calls).toEqual([
      { url: 'http://server/api/v1/platform/organisations/ORG-1', method: 'PATCH', body: { status: 'suspended' } },
      { url: 'http://server/api/v1/platform/organisations', method: 'POST', body: { name: 'Third ISP', admin: { username: 'carol', displayName: 'Carol' } } },
      { url: 'http://server/api/v1/platform/organisations', method: 'GET', body: undefined },
    ]);
  });

  it('passes the server refusal on as a plain message', async () => {
    const fetch = (async () => Response.json({ error: 'forbidden', message: 'Only an administrator of the first organisation on this server can manage organisations.' }, { status: 403 })) as unknown as typeof globalThis.fetch;
    const client = createOrganisationsClient({ baseUrl: 'http://server', fetch });
    await expect(client.list()).rejects.toBeInstanceOf(ApiError);
    await expect(client.list()).rejects.toThrow(/first organisation/);
  });

  it('says the state in plain words', () => {
    expect(organisationStateLabel({ status: 'active', host: true })).toBe('On (first organisation)');
    expect(organisationStateLabel({ status: 'suspended', host: false })).toMatch(/nobody in it can log in/);
  });
});
