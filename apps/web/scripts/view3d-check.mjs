#!/usr/bin/env node
/**
 * End-to-end check of the 3D view in a real browser: loads /3d, opens the demo network, visits
 * every camera preset, looks up a house, takes screenshots, fails on any page or console error, and
 * measures the frame rate with 100 houses (demo) and 1000 houses (/3d?bench=10).
 *
 *   npm run dev:web                      # in another terminal (or set --url to a running app)
 *   npm run check:3d -w @fibergis/web    # GPU rendering
 *   npm run check:3d -w @fibergis/web -- --software   # no GPU (CI): SwiftShader, slow
 *
 * Options: --url http://localhost:5173  --out <folder>  --chrome <path to chrome or edge>
 *          --uncapped (no vsync: measures what the scene sustains, above the screen's refresh)
 * Uses the Chrome or Edge already installed (playwright-core downloads no browser).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const URL = arg('url', 'http://localhost:5173').replace(/\/$/, '');
const OUT = resolve(arg('out', 'view3d-check'));
const SOFTWARE = process.argv.includes('--software');
const CANDIDATES = [
  arg('chrome', process.env.FIBERGIS_CHROME),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Edge found. Pass --chrome <path> or set FIBERGIS_CHROME.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// --uncapped: no vsync or frame-rate limit, to measure what the scene can sustain (a laptop on
// battery caps the screen at 30 fps, which hides the real number).
const UNCAPPED = process.argv.includes('--uncapped');
const args0 = SOFTWARE
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'];
const args = UNCAPPED ? [...args0, '--disable-frame-rate-limit', '--disable-gpu-vsync'] : args0;
const browser = await chromium.launch({ executablePath, headless: !process.argv.includes('--headed'), args });
const problems = [];
const results = [];

/** A page with the welcome guide and the 3D tour already seen, so they do not cover the scene. */
async function open(path, viewport = { width: 1440, height: 900 }, deviceScaleFactor = 1) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor,
    isMobile: deviceScaleFactor > 1,
    hasTouch: deviceScaleFactor > 1,
  });
  page.on('pageerror', (e) => {
    const where = (e.stack ?? '')
      .split('\n')
      .slice(1, 4)
      .map((l) => l.trim())
      .join(' | ');
    problems.push(`${path}: ${e.message}${where ? `  [${where}]` : ''}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${path}: console: ${m.text()}`);
    // three.js reports deprecated or wrong API use as warnings starting with "THREE.". Direct3D's
    // shader compiler notes about float rounding (X4122) come through the same way and are not ours.
    else if (m.type() === 'warning' && /THREE\./.test(m.text())) {
      const lines = m
        .text()
        .split('\n')
        .filter((l) => /warning X\d+/.test(l));
      const onlyPrecision = lines.length > 0 && lines.every((l) => /warning X4122/.test(l)) && !/error/i.test(m.text());
      if (!onlyPrecision) problems.push(`${path}: three.js warning: ${m.text()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'fiber_gis_learning_prefs',
      JSON.stringify({ state: { welcomeSeen: true, welcomeStep: 0 }, version: 0 }),
    );
    localStorage.setItem(
      'fiber_gis_view3d_prefs',
      JSON.stringify({
        state: { labels: true, pulses: true, lang: 'en', theme: 'auto', tourDone: true, origin: 'olt' },
        version: 0,
      }),
    );
  });
  await page.goto(`${URL}${path}`);
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  return page;
}

/** Frames per second over `ms`, counted with requestAnimationFrame (the engine renders in it). */
const sample = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - start < ms) requestAnimationFrame(tick);
          else done(Math.round((frames * 1000) / (performance.now() - start)));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
/** Best of three 3-second samples: other work on the machine only ever lowers a sample. */
const fps = async (page) => {
  const runs = [];
  for (let i = 0; i < 3; i += 1) runs.push(await sample(page, 3000));
  return `${Math.max(...runs)} (samples ${runs.join(', ')})`;
};

const settle = SOFTWARE ? 3500 : 1500;
const shot = async (page, name) => {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
};

try {
  // 1. Demo network, every preset, a house lookup.
  const page = await open('/3d');
  await page.getByRole('button', { name: 'Load demo network' }).first().click();
  await shot(page, '01-overview');
  results.push(['Demo network (100 houses)', `${await fps(page)} fps`]);
  const presets = [
    ['Main Office Box', '02-olt'],
    ['Network Switch', '03-switch'],
    ['Inside splitter boxes', '04-splitter-boxes'],
    ['Poles and main cable', '05-poles'],
    ['Home Connection Box', '06-fat'],
    ['All houses', '07-houses'],
    ['Inside a house', '08-inside-house'],
  ];
  for (const [label, name] of presets) {
    await page
      .getByRole('button', { name: new RegExp(`^${label}`) })
      .first()
      .click();
    await shot(page, name);
  }
  await page.getByPlaceholder(/House number/).fill('37');
  await page.getByRole('button', { name: 'Show fiber' }).click();
  await shot(page, '09-house-37');
  const path = await page.getByRole('region', { name: 'Fiber path' }).innerText();
  if (!/PON 1\/1\/1 → FDT-1 out \d → FDT-2\.\d out \d → FAT-\d+ port \d/.test(path))
    problems.push(`House 37 path not shown: ${path}`);
  results.push(['House 37 path', path.split('\n').find((l) => l.startsWith('PON')) ?? '?']);
  await page.close();

  // 2. 1000 houses on 10 OLTs.
  const big = await open('/3d?bench=10');
  await big.waitForTimeout(settle);
  await shot(big, '10-bench-1000-houses');
  results.push(['Benchmark (1000 houses)', `${await fps(big)} fps`]);
  const info = await big.evaluate(() => window.__view3dInfo);
  if (info)
    results.push([
      'Benchmark draw calls / triangles (one frame, incl. shadow pass)',
      `${info.calls} / ${info.triangles}`,
    ]);
  await big
    .getByRole('button', { name: /^All houses/ })
    .first()
    .click();
  await big.waitForTimeout(settle);
  results.push(['Benchmark, houses view', `${await fps(big)} fps`]);
  await big.close();

  // 3. Phone size: 390x844 at pixel ratio 2, touch, CPU slowed 4x. An emulation, not a real
  // phone: the GPU is this computer's.
  const phone = await open('/3d?bench=1', { width: 390, height: 844 }, 2);
  await shot(phone, '11-phone');
  const cdp = await phone.context().newCDPSession(phone);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  results.push(['Phone emulation, CPU 4x slower (100 houses)', `${await fps(phone)} fps`]);
  await phone.close();
  const phoneBig = await open('/3d?bench=10', { width: 390, height: 844 }, 2);
  const cdp2 = await phoneBig.context().newCDPSession(phoneBig);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await phoneBig.waitForTimeout(settle);
  results.push(['Phone emulation, CPU 4x slower (1000 houses)', `${await fps(phoneBig)} fps`]);
  await phoneBig.close();
} catch (e) {
  problems.push(`check stopped: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
}

console.log(
  `\n3D view check (${SOFTWARE ? 'software rendering' : 'GPU'}${UNCAPPED ? ', uncapped' : ''}, ${executablePath})`,
);
for (const [k, v] of results) console.log(`  ${k}: ${v}`);
console.log(`  Screenshots: ${OUT}`);
if (problems.length) {
  console.log('\nProblems:');
  for (const p of [...new Set(problems)]) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('  No page errors, console errors or three.js warnings.');
