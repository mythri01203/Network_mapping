import { describe, expect, it, vi } from 'vitest';

import { createSampleNetwork } from '@fibergis/shared/sample';

import { ApiError, ApiUnavailableError, createApiClient, describeApiError, isTransientError } from './client';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init = {}) => respond(String(input), init));
  return { fetch, client: createApiClient({ baseUrl: 'http://api.test/', fetch }) };
}

describe('createApiClient', () => {
  it('sends JSON bodies to versioned endpoints', async () => {
    const { fetch, client } = clientWith(() => jsonResponse({ revision: 3, upserted: 1, deleted: 0 }));
    const result = await client.applyChanges({ deletes: { cables: ['C1'] } });

    expect(result).toEqual({ revision: 3, upserted: 1, deleted: 0 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/changes');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ deletes: { cables: ['C1'] } }));
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('sends the plain confirmation with a reset (Phase 9)', async () => {
    const { fetch, client } = clientWith(() => jsonResponse({ revision: 1 }));
    await client.reset();
    const init = fetch.mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toEqual({ confirm: 'reset' });
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('sends backups in the restore request format', async () => {
    const { fetch, client } = clientWith(() => jsonResponse({ revision: 2, restored: ['zones'] }));
    await client.restore({ collections: { zones: [] }, projectStartPoint: [1, 2] });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      data: { zones: [] },
      projectStartPoint: [1, 2],
    });
  });

  it('validates the network payload', async () => {
    const data = createSampleNetwork();
    await expect(clientWith(() => jsonResponse({ revision: 1, data })).client.getNetwork()).resolves.toEqual({
      revision: 1,
      data,
    });
    await expect(
      clientWith(() => jsonResponse({ revision: 1, data: { equipment: [] } })).client.getNetwork(),
    ).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('turns error bodies into ApiErrors', async () => {
    const { client } = clientWith(() =>
      jsonResponse(
        {
          error: 'validation_failed',
          message: 'Invalid change set.',
          issues: [{ path: 'upserts.cables.0', message: 'Required' }],
        },
        400,
      ),
    );
    const error = await client.applyChanges({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation_failed', isRejection: true });
    expect(isTransientError(error)).toBe(false);
    expect(describeApiError(error)).toBe('Invalid change set. (upserts.cables.0: Required)');
  });

  it('treats server failures, network errors and non-API responses as transient', async () => {
    const serverError = await clientWith(() => new Response('', { status: 503 }))
      .client.health()
      .catch((e: unknown) => e);
    expect(serverError).toMatchObject({ status: 503, isRejection: false });
    expect(isTransientError(serverError)).toBe(true);

    const offline = await clientWith(() => Promise.reject(new TypeError('Failed to fetch')))
      .client.health()
      .catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(ApiUnavailableError);
    expect(isTransientError(offline)).toBe(true);

    const html = await clientWith(() => new Response('<!doctype html><html></html>', { status: 200 }))
      .client.health()
      .catch((e: unknown) => e);
    expect(html).toBeInstanceOf(ApiUnavailableError);
  });

  it('reports timeouts as an unavailable server', async () => {
    const { client } = clientWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const error = await client.health({ timeoutMs: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnavailableError);
    expect((error as Error).message).toMatch(/did not respond in time/);
  });

  it('lets callers cancel requests', async () => {
    const { client } = clientWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const controller = new AbortController();
    const pending = client.health({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(ApiUnavailableError);
  });
});
