import { useCallback, useEffect, useState } from 'react';

import { MONITORING_SOURCE_KIND_LABELS, MONITORING_SOURCE_KINDS, type MonitoringSourceKind } from '@fibergis/shared';

import { describeApiError } from '../../api/client';
import { monitoringClient, type SourceWithToken } from '../../api/monitoringClient';
import { Button } from '../../components/ui';
import { showToast } from '../../stores/toastStore';
import { formatDateTime } from '../inspector/format';
import { refreshFromServer } from './useMonitoring';

/** Administrator only (the server checks again): make sources, switch them on and off, push tokens. */
export function SourcesPanel() {
  const [sources, setSources] = useState<SourceWithToken[] | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MonitoringSourceKind>('push');
  const [shownToken, setShownToken] = useState<{ source: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [reload, setReload] = useState(0);
  const load = useCallback(async () => setReload((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    monitoringClient.sources().then(
      (r) => alive && setSources(r.sources),
      (error: unknown) => showToast('error', 'Could not load sources', describeApiError(error)),
    );
    return () => {
      alive = false;
    };
  }, [reload]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await load();
      await refreshFromServer();
    } catch (error) {
      showToast('error', 'Not saved', describeApiError(error));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const made = await monitoringClient.createSource({ name: name.trim(), kind });
      setName('');
      if (made.token) setShownToken({ source: made.source.name, token: made.token });
      showToast('success', 'Source added', `${made.source.name}${made.source.isTest ? ' (TEST, switched off until you switch it on)' : ''}.`);
    });

  return (
    <div className="space-y-4 text-xs text-slate-700" data-testid="mon-sources">
      <p>
        A source is where readings come from: a file you export from the OLT or NMS, a script on your own network that pushes to this server, or the TEST simulator. There is no
        direct OLT connection: that needs your OLT make and model (see docs/MONITORING_ADAPTERS.md).
      </p>
      {shownToken && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-amber-900" data-testid="mon-token-box">
          <div className="font-semibold">Push token for {shownToken.source}. Copy it now: it is shown once and the server keeps only a hash.</div>
          <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-[11px]" data-testid="mon-token">
            {shownToken.token}
          </code>
          <Button size="sm" className="mt-2" onClick={() => setShownToken(null)}>
            I have copied it
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="mon-source-name" className="min-h-[40px] w-56 rounded-lg border border-slate-300 px-2" placeholder="Such as NMS push, OLT-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as MonitoringSourceKind)} data-testid="mon-source-kind" className="min-h-[40px] rounded-lg border border-slate-300 px-2">
            {MONITORING_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {MONITORING_SOURCE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()} data-testid="mon-source-add">
          Add source
        </Button>
      </div>
      {sources === null ? (
        <p>Loading…</p>
      ) : sources.length === 0 ? (
        <p data-testid="mon-sources-none">No source yet. Until one sends data, every screen says &quot;No live connection&quot;.</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className={`rounded-lg border p-3 ${s.isTest ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`} data-testid={`mon-source-${s.id}`}>
              <div className="font-semibold">
                {s.isTest ? 'TEST · ' : ''}
                {s.name} · {MONITORING_SOURCE_KIND_LABELS[s.kind]} · {s.enabled ? 'On' : 'Off'}
              </div>
              <div className="text-[11px] text-slate-500">
                {s.id} · last data {s.lastReceivedAt ? formatDateTime(s.lastReceivedAt) : 'never'}
                {s.kind === 'push' ? ` · token ${s.token ? `made ${formatDateTime(s.token.createdAt)}, last used ${s.token.lastUsedAt ? formatDateTime(s.token.lastUsedAt) : 'never'}` : 'none'}` : ''}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} data-testid={`mon-source-toggle-${s.id}`} onClick={() => void run(async () => void (await monitoringClient.updateSource(s.id, { enabled: !s.enabled })))}>
                  {s.enabled ? 'Switch off' : 'Switch on'}
                </Button>
                {s.kind === 'push' && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void run(async () => setShownToken({ source: s.name, token: (await monitoringClient.newToken(s.id)).token }))}>
                      New token
                    </Button>
                    {s.token && (
                      <Button size="sm" disabled={busy} onClick={() => void run(async () => void (await monitoringClient.revokeToken(s.id)))}>
                        Revoke token
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
