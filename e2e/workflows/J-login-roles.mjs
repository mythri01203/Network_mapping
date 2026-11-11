// Workflow J (with K): Phase 9 login and roles. Setup mode, the first administrator, roles refused in plain words,
// login limits, a restore refused by the link check, the backup download, and the login screen.
// Ported from the scratch walkthrough auth-walk.mjs. Temp server on 127.0.0.1:5056 with the demo network (see e2e/run.mjs).
import { assertTempServer, BASE, finish, log, openApp } from '../lib/harness.mjs';

// ---- API with a tiny cookie jar per person ----
async function call(method, path, body, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  assertTempServer(`${BASE}/api/v1${path}`);
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: payload });
  const set = r.headers.get('set-cookie');
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, cookie: set ? set.split(';')[0] : cookie };
}
const PW = 'Field-test-2026!';

const st0 = await call('GET', '/auth/status');
log('fresh server starts in setup mode (login off)', st0.json?.mode === 'setup');

const setup = await call('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: PW });
const admin = setup.cookie;
log('first admin account created, login now on', setup.status === 200 && setup.json?.mode === 'enforced' && !!admin);
log('second setup is refused', (await call('POST', '/auth/setup', { username: 'x', displayName: 'X', password: PW })).status === 409);
log('no session: network is refused (401)', (await call('GET', '/network')).status === 401);

const mk = async (username, displayName, role) => (await call('POST', '/users', { username, displayName, role, password: PW }, admin)).status === 201;
log('admin adds a technician and a viewer', (await mk('ravi', 'Ravi', 'technician')) && (await mk('look', 'Looker', 'viewer')));

const login = async (username, password = PW) => call('POST', '/auth/login', { username, password });
const changePw = async (cookie) => (await call('POST', '/auth/password', { currentPassword: PW, newPassword: PW + 'x' }, cookie)).status === 200;
const tech = await login('ravi');
log('technician logs in and must set a new password', tech.status === 200 && tech.json?.mustChangePassword === true);
log('technician sets a new password', await changePw(tech.cookie));
const viewer = await login('look');
await changePw(viewer.cookie);

const net = (await call('GET', '/network', undefined, admin)).json?.data;
const cable = net?.cables?.[0];
const del = await call('POST', '/changes', { deletes: { cables: [cable?.id] } }, tech.cookie);
log('technician deleting a cable is refused (403, plain words)', del.status === 403 && typeof del.json?.message === 'string' && del.json.message.length > 10, String(del.json?.message ?? '').slice(0, 90));
log('the cable is still there', (await call('GET', '/network', undefined, admin)).json?.data?.cables?.some((c) => c.id === cable?.id));
const vw = await call('POST', '/changes', { upserts: { zones: [{ ...net.zones[0], name: 'Changed by viewer' }] } }, viewer.cookie);
log('viewer cannot change anything (403)', vw.status === 403);
log('viewer can still read the network', (await call('GET', '/network', undefined, viewer.cookie)).status === 200);

let last;
for (let i = 0; i < 8; i += 1) last = await login('ravi', 'wrong-password');
log('repeated wrong passwords are slowed down (429 with a wait)', last.status === 429, String(last.json?.message ?? '').slice(0, 80));

const broken = { ...net, spans: [{ id: 'SPAN-BROKEN', name: 'Broken span', fromStructureId: 'NO-SUCH-POLE', toStructureId: 'NO-SUCH-POLE-2', status: 'proposed', basis: 'field_sequence', createdAt: new Date().toISOString() }] };
const restore = await call('POST', '/restore', { data: broken }, admin);
const after = (await call('GET', '/network', undefined, admin)).json?.data;
log('restore of a backup with a broken link is refused by the link check, nothing changed',
  restore.status === 409 && /^Nothing was restored/.test(restore.json?.message ?? '') && !after?.spans?.some((s) => s.id === 'SPAN-BROKEN'),
  `${restore.status} ${String(restore.json?.message ?? '').slice(0, 90)}`);
log('technician cannot restore', (await call('POST', '/restore', { collections: net }, tech.cookie)).status === 403);
const report = await call('GET', '/reports/data-quality', undefined, admin);
log('data-quality report exports for the office', report.status === 200 && typeof report.json === 'object');
const backup = await call('GET', '/backup', undefined, admin);
log('admin can download a backup', backup.status === 200);
log('logout ends the session', (await call('POST', '/auth/logout', undefined, viewer.cookie)).status === 200 && (await call('GET', '/network', undefined, viewer.cookie)).status === 401);

// ---- Browser: the login screen ----
const app = await openApp({ uiMode: null, geolocation: null, permissions: [], consoleErrors: true, goto: false });
const { p } = app;
const seen = (id, timeout = 15000) => p.waitForSelector(`[data-testid="${id}"]`, { visible: true, timeout }).then(() => true, () => false);
const size = (id) => p.evaluate((i) => { const r = document.querySelector(`[data-testid="${i}"]`)?.getBoundingClientRect(); return r ? Math.round(Math.min(r.width, r.height)) : 0; }, id);

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
log('the app opens on the login screen', await seen('login-screen'));
log('login buttons are big enough (48 px or more)', (await size('login-next')) >= 48, `${await size('login-next')} px`);
await p.type('[data-testid="login-name"]', 'look');
await p.click('[data-testid="login-next"]');
log('password step appears after the name', await seen('login-password'));
await p.type('[data-testid="login-password"]', 'wrong-one');
await p.click('[data-testid="login-go"]');
log('a wrong password shows a plain message', await seen('login-error'));
await p.click('[data-testid="login-password"]', { clickCount: 3 });
await p.type('[data-testid="login-password"]', PW + 'x');
await p.click('[data-testid="login-go"]');
log('right password opens the app as a viewer, with the view-only notice', await seen('viewer-banner', 20000));
log('no setup banner once login is on', !(await p.$('[data-testid="setup-banner"]')));
await app.shot('viewer');
await finish({ errorsAreFailures: true });
