import { create } from 'zustand';

import { type Account, type AccountRole, AUDIT_ROLE_FOR, type AuthMode, type AuthStatus, normalizeAccountRole, type PermissionAction, roleHasAction } from '@fibergis/shared';

import { ApiError, type AuthClient, authClient, describeApiError } from '../api/client';
import { readJson, writeJson } from '../lib/storage';
import { useUiStore } from './uiStore';

/**
 * Who is logged in on this device (Phase 9). The server decides: while no account exists it runs
 * in setup mode and the app behaves as before login existed. Only the person's name and role are
 * remembered on the device (never a password or the session token, which is an httpOnly cookie),
 * so a phone with no signal can keep working as the person who last logged in.
 */

/** People who logged in on this device, newest first, for big name tiles on the login screen. */
export interface RememberedPerson {
  username: string;
  displayName: string;
  role: AccountRole;
}

const PEOPLE_KEY = 'auth_people';
const LAST_KEY = 'auth_last';
const MAX_PEOPLE = 6;

/** Phase 23: a role remembered under an older or other spelling is read as the stored name. */
const isPerson = (v: unknown): v is RememberedPerson => {
  if (typeof v !== 'object' || v === null) return false;
  const person = v as RememberedPerson;
  const role = normalizeAccountRole(person.role);
  if (typeof person.username !== 'string' || typeof person.displayName !== 'string' || !role) return false;
  person.role = role;
  return true;
};

const isAccount = (v: unknown): v is Account => isPerson(v) && typeof (v as Account).id === 'string';

export type AuthPhase = 'unknown' | 'ready' | 'unreachable';

export interface AuthState {
  phase: AuthPhase;
  /** As the server last said; null before it answered. */
  mode: AuthMode | null;
  account: Account | null;
  /** The person last logged in here, used while the server cannot be reached. */
  lastAccount: Account | null;
  mustChangePassword: boolean;
  passwordMinLength: number;
  /** The server said "log in" (HTTP 401) while sending or loading. Unsent work is kept. */
  loginNeeded: boolean;
  people: RememberedPerson[];
  /** The "change my password" screen is open. */
  passwordChangeOpen: boolean;
  /** No account exists yet and this device is not the server computer: it waits for the first admin. */
  setupPending: boolean;
  /** The first admin may be made here with the server's setup code. */
  setupCodeAccepted: boolean;

  setPasswordChangeOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<string | null>;
  setup: (input: { username: string; displayName: string; password: string; setupToken?: string }) => Promise<string | null>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  markLoginNeeded: () => void;
  forgetPerson: (username: string) => void;
}

let client: AuthClient = authClient;
/** Tests swap the client. */
export const setAuthClient = (next: AuthClient) => {
  client = next;
};

const people = (): RememberedPerson[] => readJson<RememberedPerson[]>(PEOPLE_KEY, [], (v) => Array.isArray(v) && v.every(isPerson));

export const useAuthStore = create<AuthState>()((set, get) => {
  /** Takes the server's answer, and keeps the old audit role choice in step with the account. */
  const apply = (status: AuthStatus) => {
    const { account } = status;
    if (account) {
      writeJson(LAST_KEY, account);
      const next = [{ username: account.username, displayName: account.displayName, role: account.role }, ...get().people.filter((p) => p.username !== account.username)].slice(0, MAX_PEOPLE);
      writeJson(PEOPLE_KEY, next);
      set({ people: next, lastAccount: account });
      useUiStore.getState().setUserRole(AUDIT_ROLE_FOR[account.role]);
    }
    set({
      phase: 'ready',
      mode: status.mode,
      account,
      mustChangePassword: !!status.mustChangePassword,
      passwordMinLength: status.passwordMinLength,
      loginNeeded: status.mode === 'enforced' && !account,
      setupPending: !!status.setupPending,
      setupCodeAccepted: !!status.setupCodeAccepted,
    });
  };

  const failure = (error: unknown) => (error instanceof ApiError ? error.message : describeApiError(error));

  return {
    phase: 'unknown',
    mode: null,
    account: null,
    lastAccount: readJson<Account | null>(LAST_KEY, null, (v) => v === null || isAccount(v)),
    mustChangePassword: false,
    passwordMinLength: 8,
    loginNeeded: false,
    people: people(),
    passwordChangeOpen: false,
    setupPending: false,
    setupCodeAccepted: false,

    setPasswordChangeOpen: (passwordChangeOpen) => set({ passwordChangeOpen }),

    refresh: async () => {
      try {
        apply(await client.status({ timeoutMs: 8000 }));
      } catch {
        // No signal or no server: keep working as before; the login check runs again later.
        set({ phase: 'unreachable' });
      }
    },

    login: async (username, password) => {
      try {
        apply(await client.login({ username: username.trim().toLowerCase(), password }));
        return null;
      } catch (error) {
        return failure(error);
      }
    },

    setup: async (input) => {
      try {
        apply(await client.setup(input));
        return null;
      } catch (error) {
        return failure(error);
      }
    },

    logout: async () => {
      try {
        apply(await client.logout());
      } catch {
        set({ account: null });
      }
      writeJson(LAST_KEY, null);
      set({ lastAccount: null, loginNeeded: get().mode === 'enforced' });
    },

    changePassword: async (currentPassword, newPassword) => {
      try {
        apply(await client.changePassword({ currentPassword, newPassword }));
        return null;
      } catch (error) {
        return failure(error);
      }
    },

    markLoginNeeded: () => {
      set({ loginNeeded: true, account: null, mode: 'enforced', phase: 'ready' });
    },

    forgetPerson: (username) => {
      const next = get().people.filter((p) => p.username !== username);
      writeJson(PEOPLE_KEY, next);
      set({ people: next });
    },
  };
});

/**
 * The person whose work this device is doing: the logged-in account, or (no signal) the one last
 * logged in here. Null in setup mode, where the older role choice is used.
 */
export function currentAccount(state: Pick<AuthState, 'account' | 'lastAccount' | 'phase' | 'mode'> = useAuthStore.getState()): Account | null {
  if (state.account) return state.account;
  if (state.phase === 'unreachable' || state.phase === 'unknown') return state.mode === 'setup' ? null : state.lastAccount;
  return null;
}

/**
 * Phase 23: whether the person here may take an action (export, approve, configure...), by the
 * same table the server applies. Login off (setup mode): yes, as on the server. Only for showing or
 * hiding buttons; the server always checks again.
 */
export function mayDo(action: PermissionAction, state: Pick<AuthState, 'account' | 'lastAccount' | 'phase' | 'mode'> = useAuthStore.getState()): boolean {
  if (!loginIsOn(state)) return true;
  const account = currentAccount(state);
  return !!account && roleHasAction(account.role, action);
}

/** The same as `mayDo`, as a hook that follows login and logout. */
export const useMayDo = (action: PermissionAction): boolean => useAuthStore((s) => mayDo(action, s));

/** True once login is on (the server said so, or this device has logged in before and has no signal). */
export const loginIsOn = (state: Pick<AuthState, 'mode' | 'lastAccount' | 'phase'> = useAuthStore.getState()): boolean =>
  state.mode === 'enforced' || (state.mode === null && state.lastAccount !== null);
