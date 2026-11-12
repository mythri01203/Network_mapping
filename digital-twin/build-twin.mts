#!/usr/bin/env -S npx tsx
/**
 * Builds digital-twin/index.html: one self-contained page (Three.js r128 from a CDN, no map
 * service) showing the mapped FTTH network as a detailed 3D digital twin. The network is read
 * from the FiberGIS database (read-only) and written into the page, so it runs by double-click.
 *
 *   npx tsx digital-twin/build-twin.mts                     # uses apps/server/data/fibergis.db
 *   npx tsx digital-twin/build-twin.mts --db <path to .db>
 *
 * The data is shaped by apps/web/src/features/twin/twinData.ts, the same code the app's Digital
 * Twin page uses. PON ports, splitter stages, free outputs and power levels come from the app's own
 * `buildPonOverview` (packages/shared), so the twin shows the same numbers as the app. Levels are
 * calculated from the recorded launch power and the optical settings; they are not measurements.
 * Only what the twin shows is copied: no phone numbers, addresses or other personal details.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import type { Cable, Customer, Equipment, JointClosure, Splitter } from '@fibergis/shared';

import { buildTwinData } from '../apps/web/src/features/twin/twinData';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const dbArg = process.argv.indexOf('--db');
const dbPath = dbArg > 0 ? process.argv[dbArg + 1] : here('../apps/server/data/fibergis.db');

const db = new DatabaseSync(dbPath, { readOnly: true });
const load = <T,>(collection: string): T[] =>
  (db.prepare('select data from records where collection = ?').all(collection) as { data: string }[]).map(
    (r) => JSON.parse(r.data) as T,
  );
const equipment = load<Equipment>('equipment');
const cables = load<Cable>('cables');
const customers = load<Customer>('customers');
const splitters = load<Splitter>('splitters');
const closures = load<JointClosure>('closures');
db.close();

const data = buildTwinData({ equipment, cables, customers, splitters, closures }, { demoCut: true });
if (!data) throw new Error('No OLT in the database: nothing to anchor the twin on.');

// The page is kept as small source files and stitched into one self-contained index.html.
const script = ['twin-1-model.js', 'twin-2-scene.js', 'twin-3-equipment.js', 'twin-4-ui.js']
  .map((f) => readFileSync(here(`./${f}`), 'utf8'))
  .join(String.fromCharCode(10));
const marker = '/*__DATA__*/ null';
if (!script.includes(marker)) throw new Error('twin-1-model.js has no data marker.');
// "</" inside the JSON could end the script tag early: escape it.
const html = readFileSync(here('./template.html'), 'utf8')
  .replace('/*__CSS__*/', () => readFileSync(here('./twin.css'), 'utf8'))
  .replace('/*__JS__*/', () =>
    script.replace(marker, () =>
      JSON.stringify(data)
        .split('</')
        .join('<' + String.fromCharCode(92) + '/'),
    ),
  );
writeFileSync(here('./index.html'), html);

console.log(`Wrote digital-twin/index.html (${Math.round(html.length / 1024)} kB)`);
console.log(
  `  ${data.customers.length} customers (${data.customers.filter((c) => c.st).length} active), ${data.pons.length} PON ports, ${data.cables.length} cables, ${data.nodes.length} boxes, ${splitters.length} splitters, ${data.poles.length} poles`,
);
if (data.skipped.length) console.log(`  Left out (no recorded start and end box): ${data.skipped.join(', ')}`);
