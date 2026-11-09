import { afterEach, describe, expect, it, vi } from 'vitest';

import { monitoringClient } from './monitoringClient';

const calls: { url: string; method: string; body?: string }[] = [];

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const fakeFetch = (status: number, payload: unknown) =>
  vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body as string | undefined });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  });

describe('monitoring client (Phase 7)', () => {
  it('sends a dry-run import and revokes a token with DELETE', async () => {
    vi.stubGlobal('fetch', fakeFetch(200, { dryRun: true, matched: 1, stored: { readings: 1, statuses: 0 }, duplicates: 0, skipped: [], unmatched: [], alarmsRaised: 0, isTest: false }));
    const result = await monitoringClient.importRows({ sourceId: 'MON-1', rows: [{ serial: 'S1', deviceTime: '2026-11-09T10:00:00Z', ontRxDbm: -20, unit: 'dBm' }], dryRun: true });
    expect(result.matched).toBe(1);
    expect(calls[0]).toMatchObject({ url: '/api/v1/monitoring/import', method: 'POST' });
    expect(JSON.parse(calls[0].body ?? '{}')).toMatchObject({ dryRun: true, sourceId: 'MON-1' });
    await monitoringClient.revokeToken('MON 1');
    expect(calls[1]).toMatchObject({ url: '/api/v1/monitoring/sources/MON%201/token', method: 'DELETE' });
  });

  it('passes the server refusal through in plain words', async () => {
    vi.stubGlobal('fetch', fakeFetch(403, { error: 'forbidden', message: 'Engineer accounts cannot manage monitoring sources and tokens. Ask the administrator.' }));
    await expect(monitoringClient.createSource({ name: 'x', kind: 'push' })).rejects.toThrow(/cannot manage monitoring sources/);
  });
});
