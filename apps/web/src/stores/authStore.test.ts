import { afterEach, describe, expect, it } from 'vitest';

import { mayDo, useAuthStore } from './authStore';

/** Phase 23: buttons follow the same role table the server applies. */
describe('mayDo', () => {
  afterEach(() => useAuthStore.setState({ mode: null, account: null, lastAccount: null, phase: 'unknown' }));

  const as = (role: 'admin' | 'noc' | 'supervisor' | 'technician' | 'viewer') =>
    useAuthStore.setState({ mode: 'enforced', phase: 'ready', account: { id: 'U1', username: 'u', displayName: 'U', role } });

  it('allows everything with login off (setup mode), as the server does', () => {
    useAuthStore.setState({ mode: 'setup', phase: 'ready', account: null, lastAccount: null });
    expect(mayDo('export')).toBe(true);
    expect(mayDo('approve')).toBe(true);
  });

  it('hides export from Field Technicians and Read-only accounts, approve from all but approvers', () => {
    as('technician');
    expect(mayDo('export')).toBe(false);
    as('viewer');
    expect(mayDo('export')).toBe(false);
    expect(mayDo('view')).toBe(true);
    as('noc');
    expect(mayDo('export')).toBe(true);
    expect(mayDo('approve')).toBe(false);
    as('supervisor');
    expect(mayDo('approve')).toBe(true);
    expect(mayDo('configure')).toBe(false);
    as('admin');
    expect(mayDo('configure')).toBe(true);
  });
});
