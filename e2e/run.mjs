#!/usr/bin/env node
// Runs the FiberGIS browser walkthroughs (Workflows A to L), each against its own fresh temporary
// server on 127.0.0.1:5056 with a temporary database, and kills that server afterwards.
//
//   node e2e/run.mjs --build                 every walk, desktop, after building the web app into a temp folder
//   node e2e/run.mjs --build A G             only Workflows A and G
//   node e2e/run.mjs D-fiber --phone         one walk by name, phone size (needs E2E_STATIC_DIR or --build)
//   node e2e/run.mjs --list                  what there is
//
// Needs E2E_PUPPETEER_DIR (a folder whose node_modules has puppeteer-core) and E2E_CHROME (the
// Chrome program). Nothing is installed, and the real database (apps/server/data) is never used.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SERVER_DIR = join(ROOT, 'apps', 'server');
const WEB_DIR = join(ROOT, 'apps', 'web');
const PORT = 5056;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

/**
 * Every walk. `covers` is every workflow it checks; the first letter is the one it is filed under.
 * `sample`: start the server with the demo network (only the login walk, as before).
 * `phone`: the walk was also used at phone size (360 x 740).
 */
export const WALKS = [
  { name: 'A-field-walk', covers: 'A B G', sample: false, timeout: 400, phone: true, about: 'Field-helper walk: place an OLT and a box, draw a cable that snaps to both, add a customer, see the service path' },
  { name: 'A-equipment-records', covers: 'A C D J', sample: false, timeout: 400, phone: true, about: 'Inspector tabs and history, a work record, placing by typed position, a pole inspection, a fibre marked faulty, the server audit trail' },
  { name: 'B-cable-route', covers: 'B E F', sample: false, timeout: 400, phone: true, about: 'Turn a cable round and open the route editor, a splice entered by mistake kept in history, an ODF port marked faulty, sites and racks, map-area query and catch-up' },
  { name: 'B-stretches-review', covers: 'B A G J', sample: false, timeout: 400, phone: true, about: 'Office accepts a box sent from the field, an OLT with 12 PON ports, a cable stretch pole to pole, a second organisation sees nothing of the first' },
  { name: 'C-osp-routes', covers: 'C K', sample: false, timeout: 500, phone: true, about: 'Spans and attachments, lengths kept apart, pole details and permission, duplicate warning, duct occupancy, KML and KMZ import' },
  { name: 'D-fiber', covers: 'D E F H', sample: false, timeout: 500, phone: true, about: 'OLT port, cable layouts, ODF patch, closure splice, splitter, customer fibres, trace core by core, a broken splice named, conflicting splice and double allocation refused, 96F non-TIA cable, unknown scheme' },
  { name: 'G-customers', covers: 'G H I', sample: false, timeout: 600, phone: true, about: 'Two customers on a splitter, ONT record, two services, an MDU, disconnect, move, ONT swap, the logical view with a gap named, reading reconciliation, map check' },
  { name: 'G-monitoring', covers: 'G I', sample: false, timeout: 600, phone: true, about: 'No live connection before a source, push source and token, readings with device time, CSV import with an unmatched row, stale readings, LOS alarm, TEST simulator kept apart' },
  { name: 'H-connections-search', covers: 'H F G J', sample: false, timeout: 400, phone: true, about: 'Splitter output marked faulty, connections of a box with a recorded check, a customer path fixed from the links, search by serial and the attribute table, a read-only account sees no customer names' },
  { name: 'H-faults', covers: 'H G', sample: false, timeout: 600, phone: false, about: 'TEST LOS on a splitter: suspected splitter, fault with affected customers from recorded paths, close refused without a check, work order on a phone with photo and reading, two devices edit one job (conflict kept)' },
  { name: 'I-trace-validation', covers: 'I H', sample: false, timeout: 400, phone: true, about: 'Network trace shows the missing link and never fills it, map check stores findings, capacity from records, live status says not connected, topology from recorded links' },
  { name: 'J-login-roles', covers: 'J K', sample: true, timeout: 300, phone: true, about: 'Setup mode, first admin, roles refused in plain words, login limits, restore refused by the link check, backup download, the login screen' },
  { name: 'L-performance', covers: 'L', sample: false, bench: true, timeout: 1500, phone: false, about: 'Phase 24b: the server benchmark network (100,000 records, E2E_L_RECORDS for another size); first paint by map area and whole, pan, search outside the area, an edit, zooming out to groups. Prints MEASURE lines. Run only when named (L)' },
  { name: 'K-backup-roundtrip', covers: 'K', sample: false, timeout: 200, phone: false, about: 'API level: backup download (JSON and zip), restore of that backup gives the same network, a broken backup is refused with nothing changed, a safety copy is made' },
];

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const picks = args.filter((a) => !a.startsWith('--'));
if (flags.has('--list') || flags.has('--help')) {
  for (const w of WALKS) console.log(`${w.name.padEnd(22)} covers ${w.covers.padEnd(8)} ${w.about}`);
  console.log('\nOptions: workflow letters (A to L) or walk names; --build; --phone; --both; --keep; --list');
  process.exit(0);
}
// Workflow L (minutes, 100,000 records) runs only when named.
const chosen = picks.length === 0 ? WALKS.filter((w) => !w.bench) : WALKS.filter((w) => picks.some((pick) => (pick.length === 1 ? w.covers.split(' ').includes(pick.toUpperCase()) : w.name.toLowerCase().includes(pick.toLowerCase()))));
if (chosen.length === 0) {
  console.error(`No walk matches ${picks.join(' ')}. Use --list.`);
  process.exit(2);
}
const modes = flags.has('--both') ? ['desktop', 'phone'] : flags.has('--phone') ? ['phone'] : ['desktop'];
const keep = flags.has('--keep');

for (const name of ['E2E_PUPPETEER_DIR', 'E2E_CHROME']) {
  if (!process.env[name]) {
    console.error(`Set ${name} first (see e2e/README.md).`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- helpers
const isWindows = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portInUse = () =>
  new Promise((done) => {
    const socket = connect({ host: HOST, port: PORT });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

const nodeBin = process.execPath;
const tsxCli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const runRoot = mkdtempSync(join(tmpdir(), 'fibergis-e2e-'));
let staticDir = process.env.E2E_STATIC_DIR;
let current = null;
const cleanUp = () => {
  killTree(current);
  if (!keep) rmSync(runRoot, { recursive: true, force: true });
};
process.on('SIGINT', () => {
  cleanUp();
  process.exit(130);
});

if (await portInUse()) {
  console.error(`Port ${PORT} is already in use. The walks only run against their own temporary server there; stop whatever is on ${PORT} first.`);
  process.exit(2);
}

if (flags.has('--build')) {
  staticDir = join(runRoot, 'web');
  console.log(`Building the web app into ${staticDir} (apps/web/dist is not touched) ...`);
  const built = spawnSync(nodeBin, [viteCli, 'build', '--outDir', staticDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: WEB_DIR, stdio: 'inherit' });
  if (built.status !== 0) {
    console.error('The web build failed; nothing was run.');
    cleanUp();
    process.exit(2);
  }
}
if (!staticDir || !existsSync(join(staticDir, 'index.html'))) {
  console.error('No web build: pass --build, or set E2E_STATIC_DIR to a folder with a built index.html.');
  cleanUp();
  process.exit(2);
}

async function startServer(dir, sample, bench = false) {
  if (bench) {
    // Workflow L: the same synthetic network as `npm run benchmark`, written into this temp database only.
    const records = String(Number(process.env.E2E_L_RECORDS) || 100_000);
    console.log(`writing ${records} benchmark records into the temp database ...`);
    const made = spawnSync(nodeBin, [tsxCli, 'scripts/benchmark.ts', `--write-db=${join(dir, 'x.db')}`, records], { cwd: SERVER_DIR, stdio: 'inherit' });
    if (made.status !== 0) throw new Error('Could not write the benchmark network into the temp database.');
  }
  const log = createWriteStream(join(dir, 'server.log'));
  const child = spawn(nodeBin, [tsxCli, 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST,
      LOG_LEVEL: 'silent',
      SEED_SAMPLE_DATA: sample ? 'true' : 'false',
      DATABASE_PATH: join(dir, 'x.db'),
      STATIC_DIR: staticDir,
    },
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  current = child;
  for (let i = 0; i < 240; i += 1) {
    if (child.exitCode !== null) throw new Error(`The temp server stopped (exit ${child.exitCode}); see ${join(dir, 'server.log')}.`);
    try {
      const res = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch {}
    await sleep(500);
  }
  killTree(child);
  throw new Error('The temp server did not answer within 120 seconds.');
}

function runWalk(walk, mode, dir) {
  return new Promise((done) => {
    const out = join(dir, 'out');
    mkdirSync(out, { recursive: true });
    const logFile = join(dir, 'walk.log');
    const log = createWriteStream(logFile);
    const child = spawn(nodeBin, [join(HERE, 'workflows', `${walk.name}.mjs`)], {
      cwd: HERE,
      env: { ...process.env, E2E_MODE: mode, E2E_OUT: out, E2E_WALK: walk.name },
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    const take = (chunk) => {
      text += chunk;
      log.write(chunk);
      if (process.env.E2E_VERBOSE) process.stdout.write(chunk);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      take(`\nTIMEOUT after ${walk.timeout} s\n`);
      killTree(child);
    }, walk.timeout * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      log.end();
      const passes = (text.match(/^PASS \|/gm) ?? []).length;
      const fails = (text.match(/^FAIL \|/gm) ?? []).length;
      const finished = /^SUMMARY /m.test(text);
      const errorsLine = text.match(/^BROWSER ERRORS (\d+)/m);
      done({ passes, fails, finished, code, browserErrors: errorsLine ? Number(errorsLine[1]) : null, failLines: text.split('\n').filter((l) => l.startsWith('FAIL |') || /Error|TIMEOUT/.test(l)).slice(0, 8), logFile });
    });
  });
}

// ---------------------------------------------------------------- run
const rows = [];
for (const walk of chosen) {
  for (const mode of modes) {
    if (mode === 'phone' && !walk.phone && modes.length > 1) continue;
    const dir = mkdtempSync(join(runRoot, `${walk.name}-${mode}-`));
    const started = Date.now();
    process.stdout.write(`${walk.name} (${mode}) ... `);
    let row;
    try {
      await startServer(dir, walk.sample, walk.bench);
      const result = await runWalk(walk, mode, dir);
      const ok = result.finished && result.fails === 0 && result.code === 0;
      row = { walk: walk.name, mode, ok, ...result };
    } catch (error) {
      row = { walk: walk.name, mode, ok: false, passes: 0, fails: 0, finished: false, failLines: [String(error.message)] };
    } finally {
      killTree(current);
      current = null;
      for (let i = 0; i < 20 && (await portInUse()); i += 1) await sleep(250);
    }
    row.seconds = Math.round((Date.now() - started) / 1000);
    console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.passes} pass, ${row.fails} fail${row.finished ? '' : ', did not finish'} (${row.seconds} s)`);
    if (!row.ok) for (const line of row.failLines ?? []) console.log(`    ${line.slice(0, 220)}`);
    if (keep && row.logFile) console.log(`    log: ${row.logFile}`);
    rows.push(row);
  }
}

console.log('\nWalk                   Mode     Result  Pass  Fail  Browser errors');
for (const r of rows) console.log(`${r.walk.padEnd(22)} ${r.mode.padEnd(8)} ${(r.ok ? 'PASS' : 'FAIL').padEnd(7)} ${String(r.passes).padStart(4)}  ${String(r.fails).padStart(4)}  ${r.browserErrors ?? '-'}`);
if (await portInUse()) console.error(`Warning: something is still listening on ${PORT}.`);
if (keep) console.log(`\nKept: ${runRoot}`);
cleanUp();
process.exit(rows.every((r) => r.ok) ? 0 : 1);
