import { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react';

import { ACCOUNT_ROLE_DUTIES, ACCOUNT_ROLE_LABELS, ACCOUNT_ROLES, type AccountRole, type AccountSummary } from '@fibergis/shared';

import { authClient, describeApiError } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { showToast } from '../../stores/toastStore';

const FIELD = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm';
const BUTTON = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-50';

function RoleTable() {
  return (
    <table className="w-full text-left text-xs">
      <tbody className="divide-y divide-slate-100">
        {ACCOUNT_ROLES.map((role) => (
          <tr key={role}>
            <td className="py-2 pr-3 font-semibold text-slate-800">{ACCOUNT_ROLE_LABELS[role]}</td>
            <td className="py-2 text-slate-600">{ACCOUNT_ROLE_DUTIES[role]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The first administrator account. Creating it switches login on for everyone. */
function FirstAdminForm() {
  const setup = useAuthStore((s) => s.setup);
  const min = useAuthStore((s) => s.passwordMinLength);
  const [form, setForm] = useState({ displayName: '', username: '', password: '', repeat: '', setupToken: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ready = form.displayName.trim() && form.username.trim() && form.password.length >= min && form.password === form.repeat;

  return (
    <form
      data-testid="first-admin-form"
      className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const problem = await setup({ displayName: form.displayName.trim(), username: form.username.trim(), password: form.password, ...(form.setupToken ? { setupToken: form.setupToken } : {}) });
        setBusy(false);
        setError(problem);
        if (!problem) showToast('success', 'Login is now on', 'You are logged in as the administrator. Everyone else now needs an account.');
      }}
    >
      <h4 className="flex items-center gap-2 text-sm font-bold text-amber-950">
        <ShieldCheck size={16} /> Login is off. Create the first administrator account
      </h4>
      <p className="text-xs text-amber-900">
        Until this exists anyone who can reach this server can change everything. After it is created, every person needs an account and must log in. Work already saved on phones is kept and sent after they log in.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          Your name
          <input className={FIELD} data-testid="first-admin-name" value={form.displayName} onChange={set('displayName')} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Login name
          <input className={FIELD} data-testid="first-admin-login" value={form.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Password (at least {min})
          <input className={FIELD} data-testid="first-admin-password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Same password again
          <input className={FIELD} data-testid="first-admin-repeat" type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" />
        </label>
        <label className="text-xs font-semibold text-slate-700 md:col-span-2">
          Setup code (only if SETUP_TOKEN is set on the server)
          <input className={FIELD} value={form.setupToken} onChange={set('setupToken')} />
        </label>
      </div>
      {form.repeat && form.password !== form.repeat && <p className="text-xs font-semibold text-red-700">The two passwords are not the same.</p>}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={!ready || busy} data-testid="first-admin-create" className={`${BUTTON} bg-amber-700 text-white`}>
        <ShieldCheck size={16} /> Create administrator and switch login on
      </button>
    </form>
  );
}

/** Shows a password made by the server once. It is not kept anywhere after this. */
function TemporaryPassword({ who, password, onDone }: { who: string; password: string; onDone: () => void }) {
  return (
    <div role="status" data-testid="temp-password" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
      <p className="font-semibold text-emerald-900">Temporary password for {who}:</p>
      <p className="my-2 select-all font-mono text-lg font-bold tracking-wider text-emerald-950" data-testid="temp-password-value">
        {password}
      </p>
      <p className="text-xs text-emerald-900">Give it to them in person. It is shown only now. They choose their own after logging in.</p>
      <button type="button" className={`${BUTTON} mt-2 bg-emerald-700 text-white`} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function NewUserForm({ onCreated }: { onCreated: (user: AccountSummary, temporaryPassword?: string) => void }) {
  const [form, setForm] = useState<{ displayName: string; username: string; role: AccountRole }>({ displayName: '', username: '', role: 'technician' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      data-testid="new-user-form"
      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const created = await authClient.createUser({ displayName: form.displayName.trim(), username: form.username.trim(), role: form.role });
          setForm({ displayName: '', username: '', role: form.role });
          onCreated(created.user, created.temporaryPassword);
        } catch (err) {
          setError(describeApiError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-xs font-semibold text-slate-700">
        Person&apos;s name
        <input className={FIELD} data-testid="new-user-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Login name
        <input className={FIELD} data-testid="new-user-login" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Role
        <select className={FIELD} data-testid="new-user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AccountRole })}>
          {ACCOUNT_ROLES.map((r) => (
            <option key={r} value={r}>
              {ACCOUNT_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={busy || !form.displayName.trim() || !form.username.trim()} data-testid="new-user-create" className={`${BUTTON} w-full bg-blue-700 text-white`}>
          <UserPlus size={16} /> Add account
        </button>
      </div>
      <p className="text-xs text-slate-500 md:col-span-4">{ACCOUNT_ROLE_DUTIES[form.role]} A temporary password is made and shown once.</p>
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700 md:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}

/** Administration, Users and roles (Phase 9). Accounts live on the server, never in the network data or backups. */
export function UsersPanel() {
  const mode = useAuthStore((s) => s.mode);
  const account = useAuthStore((s) => s.account);
  const [users, setUsers] = useState<AccountSummary[]>([]);
  const [shown, setShown] = useState<{ who: string; password: string } | null>(null);
  const isAdmin = mode === 'enforced' && account?.role === 'admin';

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setUsers(await authClient.listUsers());
    } catch (err) {
      showToast('error', 'Accounts not loaded', describeApiError(err));
    }
  }, [isAdmin]);

  useEffect(() => {
    // Loading the list from the server when the panel opens; the state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const change = async (user: AccountSummary, input: { role?: AccountRole; active?: boolean }) => {
    try {
      await authClient.updateUser(user.id, input);
      showToast('success', 'Account changed', `${user.displayName}: ${input.role ? ACCOUNT_ROLE_LABELS[input.role] : input.active ? 'switched on' : 'switched off and logged out'}.`);
    } catch (err) {
      showToast('error', 'Not changed', describeApiError(err));
    }
    await load();
  };

  const newPassword = async (user: AccountSummary) => {
    try {
      const result = await authClient.setUserPassword(user.id);
      if (result.temporaryPassword) setShown({ who: user.displayName, password: result.temporaryPassword });
    } catch (err) {
      showToast('error', 'Password not set', describeApiError(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="users-panel">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Users and roles</h3>
        <p className="text-xs text-slate-500">
          {mode === 'setup'
            ? 'Login is off (setup mode). The role chosen in the user menu only labels the audit trail; it does not limit anything.'
            : 'Every request is checked on the server against these roles. The screens follow the same rules.'}
        </p>
      </div>
      {mode === 'setup' && <FirstAdminForm />}
      {mode === 'enforced' && !isAdmin && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Only the administrator manages accounts.</p>}
      {isAdmin && (
        <>
          {shown && <TemporaryPassword who={shown.who} password={shown.password} onDone={() => setShown(null)} />}
          <NewUserForm
            onCreated={(user, password) => {
              if (password) setShown({ who: user.displayName, password });
              void load();
            }}
          />
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs" data-testid="users-table">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Login</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Last login</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} data-testid={`user-row-${u.username}`}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{u.displayName}</td>
                    <td className="px-3 py-2 font-mono">{u.username}</td>
                    <td className="px-3 py-2">
                      <select className="h-8 rounded border border-slate-300 bg-white px-2" value={u.role} onChange={(e) => void change(u, { role: e.target.value as AccountRole })} aria-label={`Role of ${u.displayName}`}>
                        {ACCOUNT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ACCOUNT_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">{u.active ? (u.mustChangePassword ? 'Active · temporary password' : 'Active') : 'Switched off'}</td>
                    <td className="px-3 py-2 text-slate-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                    <td className="flex gap-2 px-3 py-2">
                      <button type="button" className={`${BUTTON} h-8 border border-slate-300 bg-white text-slate-700`} onClick={() => void newPassword(u)}>
                        <KeyRound size={14} /> New password
                      </button>
                      <button type="button" className={`${BUTTON} h-8 border border-slate-300 bg-white text-slate-700`} onClick={() => void change(u, { active: !u.active })}>
                        {u.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-2 text-xs font-bold uppercase text-slate-500">What each role may do</h4>
        <RoleTable />
      </div>
    </div>
  );
}
