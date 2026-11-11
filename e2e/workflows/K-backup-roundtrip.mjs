// Workflow K (export and import), API level through the running temp server: a backup downloaded as
// JSON and as a zip, put back after changes (the network comes back exactly), a broken backup refused
// with nothing changed, a safety copy made first, and a device told to reload after a restore.
// KML and KMZ import in the browser are in C-osp-routes.mjs. Temp server on 127.0.0.1:5056 only.
import { api, assertTempServer, BASE, cores, eq, finish, LAT, LNG, log, network, post, seed } from '../lib/harness.mjs';

const pick = (data) => ({
  equipment: [...data.equipment].sort((a, b) => a.id.localeCompare(b.id)),
  cables: [...data.cables].sort((a, b) => a.id.localeCompare(b.id)),
  customers: [...data.customers].sort((a, b) => a.id.localeCompare(b.id)),
});
const same = (a, b) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));

await seed({
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', LAT, LNG, { technology: 'GPON' }),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', LAT + 0.0015, LNG + 0.002, { totalPorts: 8 }),
    ],
    cables: [
      { id: 'FDR-1', name: 'Feeder A', type: 'Main Feeder Fiber', fiberCount: 12, lengthMeters: 250, owner: '', installationDate: '', status: 'Active', coordinates: [[LAT, LNG], [LAT + 0.0015, LNG + 0.002]], startEquipmentId: 'OLT-1', endEquipmentId: 'FAT-1', cores: cores(12), cableCategory: 'Fiber' },
    ],
  },
});
const original = await network();

console.log('--- 1 download a backup');
const backup = await api('/backup');
log('backup downloads as a FiberGIS backup file', backup.status === 200 && typeof backup.body?.format === 'string' && !!backup.body?.data, `${backup.status} ${backup.body?.format}`);
log('the backup holds every record as stored', !!backup.body?.data && same(backup.body.data, original));
const zipUrl = `${BASE}/api/v1/backup?photos=1`;
assertTempServer(zipUrl);
const zipRes = await fetch(zipUrl);
const zip = new Uint8Array(await zipRes.arrayBuffer());
log('backup with photos downloads as a zip', zipRes.status === 200 && zip[0] === 0x50 && zip[1] === 0x4b, `${zipRes.status} ${zipRes.headers.get('content-type')} ${zip.length} bytes`);

console.log('--- 2 change the network, then put the backup back');
const box = original.equipment.find((e) => e.id === 'FAT-1');
const changed = await post({ upserts: { equipment: [{ ...box, name: 'Box 1 renamed' }, eq('POLE-9', 'Pole 9', 'Telecom Pole', 'Supporting Infrastructure', LAT - 0.001, LNG)] } });
log('a change after the backup is stored', changed.status === 200);
const revisionBefore = (await api('/health')).body?.revision;
const restored = await api('/restore', { method: 'POST', body: JSON.stringify(backup.body) });
log('restore of the backup is accepted', restored.status === 200, `${restored.status} ${restored.text.slice(0, 160)}`);
log('a safety copy was made first, and the restore says so', typeof restored.body?.safetyCopy === 'string' && restored.body.safetyCopy.length > 0, String(restored.body?.safetyCopy));
const afterRestore = await network();
log('the network is exactly as in the backup again', same(afterRestore, backup.body.data), afterRestore.equipment.map((e) => e.name).join(', '));
const catchUp = await api(`/changes?since=${revisionBefore}`);
log('a device that was up to date is told to reload, not given a partial catch-up', catchUp.status === 200 && catchUp.body?.reload === true, JSON.stringify(catchUp.body).slice(0, 160));

console.log('--- 3 a broken backup is refused');
const broken = structuredClone(backup.body);
broken.data.cables = broken.data.cables.map((c) => ({ ...c, endEquipmentId: 'NO-SUCH-BOX' }));
const refused = await api('/restore', { method: 'POST', body: JSON.stringify(broken) });
log('restore of a backup with a cable to nowhere is refused in plain words', refused.status === 409 && refused.body?.error === 'restore_refused' && /^Nothing was restored/.test(refused.body?.message ?? ''), `${refused.status} ${String(refused.body?.message).slice(0, 140)}`);
log('the refused restore lists its problems', Array.isArray(refused.body?.problems) && refused.body.problems.length > 0);
log('nothing changed after the refusal', same(await network(), backup.body.data));

console.log('--- 4 the zip goes back too');
const zipUrl2 = `${BASE}/api/v1/restore`;
assertTempServer(zipUrl2);
const zipRestore = await fetch(zipUrl2, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip });
const zipBody = await zipRestore.json().catch(() => null);
log('restore from the zip is accepted', zipRestore.status === 200, `${zipRestore.status} ${JSON.stringify(zipBody).slice(0, 160)}`);
log('the network is still exactly as in the backup', same(await network(), original));

await finish();
