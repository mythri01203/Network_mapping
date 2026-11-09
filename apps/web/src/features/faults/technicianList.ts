import { useEffect, useState } from 'react';

import { loginIsOn, useAuthStore } from '../../stores/authStore';

export interface TechnicianList {
  /** Login is on: a job goes only to a real technician account, chosen from the list. */
  loginOn: boolean;
  names: string[];
  state: 'loading' | 'ready' | 'failed';
}

/**
 * Technicians with an account (Phase 9), so a job goes to exactly the name they log in with: the
 * phone shows a technician only the jobs with their own name. In setup mode (no accounts) the name
 * is typed.
 */
export function useTechnicianList(): TechnicianList {
  const account = useAuthStore((s) => s.account);
  const loginOn = useAuthStore((s) => loginIsOn(s));
  const [result, setResult] = useState<{ names: string[]; state: TechnicianList['state'] }>({ names: [], state: 'loading' });
  useEffect(() => {
    if (!account) return;
    let live = true;
    const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
    fetch(`${base}/api/v1/auth/technicians`, { credentials: import.meta.env.VITE_API_URL ? 'include' : 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ displayName: string }[]>) : Promise.reject(new Error(String(r.status)))))
      .then((list) => live && setResult({ names: [...new Set(list.map((p) => p.displayName).filter(Boolean))], state: 'ready' }))
      .catch(() => live && setResult({ names: [], state: 'failed' }));
    return () => {
      live = false;
    };
  }, [account]);
  // Login on but nobody logged in here (no signal): the list cannot be read.
  return { loginOn, names: result.names, state: loginOn && !account ? 'failed' : result.state };
}
