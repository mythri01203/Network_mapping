import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Power } from 'lucide-react';

import type { AuthStatus, OrganisationSummary, PlatformEvent } from '@fibergis/shared';

import { describeApiError } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { requestConfirm } from '../../stores/confirmStore';
import { showToast } from '../../stores/toastStore';
import { organisationsClient, organisationStateLabel } from './organisationsApi';

const FIELD = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm';
const BUTTON = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-50';

/** The new organisation's first administrator's password, made by the server and shown once. */
function ShownOnce({ who, organisation, password, onDone }: { who: string; organisation: string; password: string; onDone: () => void }) {
  return (
    <div role="status" data-testid="org-temp-password" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
      <p className="font-semibold text-emerald-900">
        Temporary password for {who} ({organisation}):
      </p>
      <p className="my-2 select-all font-mono text-lg font-bold tracking-wider text-emerald-950">{password}</p>
      <p className="text-xs text-emerald-900">Give it to them in person. It is shown only now. They choose their own after logging in, then add their own people.</p>
      <button type="button" className={`${BUTTON} mt-2 bg-emerald-700 text-white`} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function NewOrganisationForm({ onCreated }: { onCreated: (organisation: OrganisationSummary, who: string, temporaryPassword?: string) => void }) {
  const [form, setForm] = useState({ name: '', displayName: '', username: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ready = form.name.trim().length >= 2 && form.displayName.trim() && form.username.trim();
  return (
    <form
      data-testid="new-organisation-form"
      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const made = await organisationsClient.create({ name: form.name.trim(), admin: { username: form.username.trim(), displayName: form.displayName.trim() } });
          setForm({ name: '', displayName: '', username: '' });
          onCreated(made.organisation, made.admin.displayName, made.temporaryPassword);
        } catch (err) {
          setError(describeApiError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-xs font-semibold text-slate-700">
        Organisation name
        <input className={FIELD} data-testid="new-organisation-name" value={form.name} onChange={set('name')} />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Their administrator&apos;s name
        <input className={FIELD} data-testid="new-organisation-admin-name" value={form.displayName} onChange={set('displayName')} />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Their login name
        <input className={FIELD} data-testid="new-organisation-admin-login" value={form.username} onChange={set('username')} autoCapitalize="none" />
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={busy || !ready} data-testid="new-organisation-create" className={`${BUTTON} w-full bg-blue-700 text-white`}>
          <Plus size={16} /> Add organisation
        </button>
      </div>
      <p className="text-xs text-slate-500 md:col-span-4">
        The new organisation gets its own empty network, photos and backups. Nobody in it can see yours, and you cannot see theirs. Login names are unique on the whole server.
      </p>
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700 md:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Phase 23b, Administration, Users and roles: which organisation this login works on, and, for the
 * platform administrator (an administrator of the first organisation), the organisations on this
 * server. Each organisation's own administrator manages its people in the panel below.
 */
export function OrganisationsPanel() {
  const mode = useAuthStore((s) => s.mode);
  const account = useAuthStore((s) => s.account);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [organisations, setOrganisations] = useState<OrganisationSummary[]>([]);
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [shown, setShown] = useState<{ who: string; organisation: string; password: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const platformAdmin = !!status?.platformAdmin;

  const load = useCallback(async () => {
    if (mode !== 'enforced' || !account) return;
    try {
      const next = await organisationsClient.status();
      setStatus(next);
      if (next.platformAdmin) {
        const list = await organisationsClient.list();
        setOrganisations(list.organisations);
        setEvents(list.events);
      }
    } catch {
      // No signal: the panel stays as it was; the server checks everything anyway.
    }
  }, [mode, account]);

  useEffect(() => {
    // Loading from the server when the panel opens; the state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const switchState = async (o: OrganisationSummary) => {
    const off = o.status === 'active';
    if (off) {
      const sure = await requestConfirm({
        title: `Switch off ${o.name}?`,
        message: 'Nobody in it can log in, and its monitoring tokens stop working, until you switch it on again. Its network, photos and backups are kept.',
        confirmLabel: 'Switch off',
        tone: 'danger',
      });
      if (!sure) return;
    }
    try {
      await organisationsClient.update(o.id, { status: off ? 'suspended' : 'active' });
      showToast('success', off ? 'Organisation switched off' : 'Organisation switched on', o.name);
    } catch (err) {
      showToast('error', 'Not changed', describeApiError(err));
    }
    await load();
  };

  const saveName = async () => {
    if (!renaming) return;
    try {
      await organisationsClient.update(renaming.id, { name: renaming.name.trim() });
      showToast('success', 'Name changed', renaming.name.trim());
      setRenaming(null);
    } catch (err) {
      showToast('error', 'Name not changed', describeApiError(err));
    }
    await load();
  };

  if (!status?.organisation) return null;

  return (
    <div className="space-y-4" data-testid="organisations-panel">
      <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" data-testid="current-organisation">
        <Building2 size={16} className="text-slate-500" /> Organisation: <span className="font-semibold text-slate-900">{status.organisation.name}</span>
      </p>
      {platformAdmin && (
        <div className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Organisations on this server</h3>
            <p className="text-xs text-slate-500">You are a platform administrator. You can add, switch off and switch on organisations. You never see their networks or people.</p>
          </div>
          {shown && <ShownOnce who={shown.who} organisation={shown.organisation} password={shown.password} onDone={() => setShown(null)} />}
          <NewOrganisationForm
            onCreated={(organisation, who, password) => {
              if (password) setShown({ who, organisation: organisation.name, password });
              showToast('success', 'Organisation added', organisation.name);
              void load();
            }}
          />
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs" data-testid="organisations-table">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Accounts</th>
                  <th className="px-3 py-2">Added</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {organisations.map((o) => (
                  <tr key={o.id} data-testid={`organisation-row-${o.id}`}>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {renaming?.id === o.id ? (
                        <span className="flex gap-2">
                          <input className={`${FIELD} h-8`} aria-label={`New name for ${o.name}`} value={renaming.name} onChange={(e) => setRenaming({ id: o.id, name: e.target.value })} />
                          <button type="button" disabled={renaming.name.trim().length < 2} className={`${BUTTON} h-8 bg-blue-700 text-white`} onClick={() => void saveName()}>
                            Save
                          </button>
                          <button type="button" className={`${BUTTON} h-8 border border-slate-300 bg-white text-slate-700`} onClick={() => setRenaming(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          {o.name}
                          <button type="button" className="text-xs font-normal text-blue-700 underline" onClick={() => setRenaming({ id: o.id, name: o.name })}>
                            Rename
                          </button>
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${o.status === 'active' ? 'text-emerald-700' : 'text-red-700'}`}>{organisationStateLabel(o)}</td>
                    <td className="px-3 py-2">{o.activeAccounts}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(o.createdAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      {!o.host && (
                        <button type="button" className={`${BUTTON} h-8 border border-slate-300 bg-white text-slate-700`} onClick={() => void switchState(o)}>
                          <Power size={14} /> {o.status === 'active' ? 'Switch off' : 'Switch on'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold">What was done ({events.length})</summary>
              <ul className="mt-2 space-y-1">
                {events.map((e) => (
                  <li key={e.seq}>
                    {new Date(e.at).toLocaleString()}: {e.actorName}: {e.details}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
