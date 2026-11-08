import { type ReactNode, useEffect, useState } from 'react';
import { Eye, ShieldAlert, X } from 'lucide-react';
import { Link } from 'react-router';

import { useAuthStore } from '../../stores/authStore';
import { LoginScreen, PasswordScreen } from './LoginScreen';

/** How often to ask the server whether login is on, while it could not be reached. */
const RETRY_MS = 30_000;

/**
 * Shows the login screen when the server needs a login (Phase 9), and the password screen when the
 * office gave a temporary password. Otherwise the app as before. Work saved on this device is
 * never touched here: the sync engine keeps it and sends it after login.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const phase = useAuthStore((s) => s.phase);
  const mode = useAuthStore((s) => s.mode);
  const account = useAuthStore((s) => s.account);
  const loginNeeded = useAuthStore((s) => s.loginNeeded);
  const mustChange = useAuthStore((s) => s.mustChangePassword);
  const changeOpen = useAuthStore((s) => s.passwordChangeOpen);

  useEffect(() => {
    void useAuthStore.getState().refresh();
  }, []);

  useEffect(() => {
    if (phase !== 'unreachable') return;
    const timer = setInterval(() => void useAuthStore.getState().refresh(), RETRY_MS);
    window.addEventListener('online', onOnline);
    function onOnline() {
      void useAuthStore.getState().refresh();
    }
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [phase]);

  if (!account && (loginNeeded || (phase === 'ready' && mode === 'enforced'))) return <LoginScreen />;
  return (
    <>
      {children}
      {account && (mustChange || changeOpen) && <PasswordScreen required={mustChange} />}
    </>
  );
}

/** While login is off: a plain warning in the office screens, with the way to switch it on. */
export function SetupBanner() {
  const mode = useAuthStore((s) => s.mode);
  const [hidden, setHidden] = useState(false);
  if (mode !== 'setup' || hidden) return null;
  return (
    <div role="status" data-testid="setup-banner" className="flex shrink-0 items-center gap-2 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-950 border-b border-amber-300">
      <ShieldAlert size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Login is off — create the first admin account; keep this server on a trusted network.
      </span>
      <Link to="/admin" className="shrink-0 rounded px-2 py-0.5 font-semibold underline">
        Create admin
      </Link>
      <button type="button" aria-label="Hide this notice" onClick={() => setHidden(true)} className="shrink-0 rounded p-0.5 hover:bg-amber-200">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

/** For a look-only account: says so once at the top, so a refused change is no surprise. */
export function ViewerBanner() {
  const role = useAuthStore((s) => s.account?.role);
  if (role !== 'viewer') return null;
  return (
    <div role="status" data-testid="viewer-banner" className="flex shrink-0 items-center gap-2 bg-sky-100 px-3 py-1 text-xs font-medium text-sky-950 border-b border-sky-300">
      <Eye size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Look only: your account can see the network but not change it.</span>
    </div>
  );
}
