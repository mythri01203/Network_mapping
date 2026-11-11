// Workflow B (with A, G and J): the office accepts a box sent from the field, an OLT with 12 PON ports,
// a stretch of the feeder pole to pole, and a second organisation that sees nothing of the first.
// Ported from the scratch walkthrough w3-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { BASE, finish, network, openApp, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const P = { olt: [LAT, LNG], p1: [LAT + 0.001, LNG], pm: [LAT + 0.0015, LNG + 0.0008], p2: [LAT + 0.002, LNG + 0.0016], cap: [LAT - 0.0008, LNG + 0.0006] };
const seed = {
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', ...P.olt, { technology: 'GPON' }),
      eq('POLE-1', 'Pole 1', 'Telecom Pole', 'Supporting Infrastructure', ...P.p1),
      eq('POLE-M', 'Pole M', 'Telecom Pole', 'Supporting Infrastructure', ...P.pm),
      eq('POLE-2', 'Pole 2', 'Telecom Pole', 'Supporting Infrastructure', ...P.p2),
      // A box sent from a phone: waiting for the office to look at it.
      eq('CAP-B1', 'Box from the field', 'FAT', 'Fiber Distribution', ...P.cap, { status: 'Planned', captureSource: 'field_capture', reviewStatus: 'awaiting_review', locationMethod: 'gps', locationAccuracyMeters: 6 }),
    ],
    cables: [
      { id: 'FDR-1', name: 'Feeder A', type: 'Main Feeder Fiber', fiberCount: 12, lengthMeters: 260, owner: '', installationDate: '', status: 'Active', coordinates: [P.p1, P.pm, P.p2], startEquipmentId: 'POLE-1', endEquipmentId: 'POLE-2', cores: cores(12), cableCategory: 'Fiber' },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: 'pro', printStub: true });
const { p, shot, hasRaw, visibleSel, has, tapEl, tapId, tapText, setField, chooseByText, closePanels, find, typeInto } = app;
await app.collapseToolbox();
let data;

console.log('--- Phase 19: the office accepts a box sent from the field');
const notActive = (await network()).equipment.find((e) => e.id === 'CAP-B1');
log('a field capture waits for review, not Active', notActive?.status !== 'Active' && notActive?.reviewStatus === 'awaiting_review');
await p.goto(BASE + '/operations');
await sleep(2500);
await tapText('Field captures');
await sleep(800);
log('review queue lists the box', /Box from the field/.test(await p.evaluate(() => document.querySelector('[data-testid="field-review"]')?.innerText ?? '')));
await shot('19-review');
await tapEl('[data-testid="review-accept"]', 'accept');
await sleep(500);
if (await visibleSel('[data-testid="review-confirm"]')) await tapId('review-confirm');
await sleep(1500);
data = await network();
const acc = data.equipment.find((e) => e.id === 'CAP-B1');
log('accepted: Active, with who and when', acc?.status === 'Active' && acc?.reviewStatus === 'accepted' && !!acc?.reviewedAt, JSON.stringify({ s: acc?.status, r: acc?.reviewStatus }));
await p.goto(BASE + '/');
await sleep(2500);

console.log('--- Phase 10: an OLT with 12 PON ports');
await find('OLT Main', 'OLT Main');
await tapText('Configure OLT');
await sleep(900);
await tapText('3. PON Ports');
await sleep(400);
log('the port count is asked, not assumed', await has('How many PON ports does this OLT have'));
await typeInto('olt-pon-count', '12');
await tapText('Save Configuration');
await sleep(1800);
for (const t of ['Save anyway', 'Confirm']) if (await hasRaw(`^${t}$`)) await tapText(t);
data = await network();
const olt = data.equipment.find((e) => e.id === 'OLT-1');
log('OLT saved with 12 PON ports', (olt?.ponPorts ?? []).length === 12, String((olt?.ponPorts ?? []).length));
log('no splitter records made on their own', (data.splitters ?? []).length === 0);
await shot('10-olt');
await p.keyboard.press('Escape');
await closePanels();

console.log('--- Phase 6: a stretch of the feeder, pole to pole');
await find('Feeder A', 'Feeder A');
if (!(await visibleSel('[data-testid="cable-segment-add"]'))) await tapEl('button', 'stretches heading', { text: 'STRETCHES' });
await sleep(400);
await tapId('cable-segment-add');
await sleep(400);
const opts = await p.evaluate(() => ({
  from: [...(document.querySelector('[data-testid="cable-segment-from"]')?.options ?? [])].map((o) => o.value + '=' + o.text),
  method: [...(document.querySelector('[data-testid="cable-segment-method"]')?.options ?? [])].map((o) => o.value),
}));
console.log('stretch options', JSON.stringify(opts).slice(0, 300));
await chooseByText('cable-segment-from', 'Pole 1');
await chooseByText('cable-segment-to', 'Pole M');
const aerial = opts.method.find((m) => /Aerial/i.test(m));
if (aerial) await setField('cable-segment-method', aerial);
await tapId('cable-segment-save');
await sleep(1500);
for (const t of ['Save anyway']) if (await hasRaw(`^${t}$`)) await tapText(t);
data = await network();
const seg = (data.cableSegments ?? [])[0];
log('stretch saved on the one cable (no new cable made)', !!seg && seg.cableId === 'FDR-1' && data.cables.length === 1, JSON.stringify(seg ?? null).slice(0, 200));
await shot('6-stretch');
await closePanels();

console.log('--- Phase 23b: a second organisation sees nothing of the first');
const raw = async (path, init = {}, cookie) => {
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0], body: await res.json().catch(() => null) };
};
const setup = await raw('/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'owner', displayName: 'Owner', password: 'owner-pass-123' }) });
log('first administrator made (server computer only)', setup.status === 200 || setup.status === 201, String(setup.status));
const owner = setup.cookie;
const made = await raw('/platform/organisations', { method: 'POST', body: JSON.stringify({ name: 'Second ISP', admin: { username: 'second-admin', displayName: 'Second admin' } }) }, owner);
log('second organisation created, temporary password shown once', (made.status === 200 || made.status === 201) && !!made.body?.temporaryPassword, String(made.status));
const login = await raw('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'second-admin', password: made.body?.temporaryPassword }) });
// A temporary password must be changed before anything else, as for any new account.
const changed = await raw('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: made.body?.temporaryPassword, newPassword: 'second-pass-123' }) }, login.cookie);
log('temporary password must be changed first', changed.status === 200, String(changed.status));
const secondCookie = changed.cookie || login.cookie;
const theirs = await raw('/network', {}, secondCookie);
const mine = await raw('/network', {}, owner);
const theirIds = JSON.stringify(theirs.body ?? '');
log('second organisation cannot see the first one\'s network', theirs.status === 200 && !theirIds.includes('OLT-1') && !theirIds.includes('FDR-1'), `status ${theirs.status}`);
log('the first organisation still has its own', mine.status === 200 && JSON.stringify(mine.body).includes('OLT-1'));

await finish({ app });
