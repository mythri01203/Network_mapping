// Shared helpers for the FiberGIS browser walkthroughs (Workflows A to K).
//
// Every walkthrough talks ONLY to the temporary server that e2e/run.mjs starts on 127.0.0.1:5056,
// with a temporary database. Nothing here can reach the real server (port 5000) or a dev server.
//
// puppeteer-core is NOT a dependency of this repo. It is loaded from the folder named in
// E2E_PUPPETEER_DIR (a folder whose node_modules holds puppeteer-core), and Chrome from E2E_CHROME.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 5056;
export const BASE = `http://127.0.0.1:${PORT}`;

/** Throws unless `url` is the temporary walkthrough server. */
export function assertTempServer(url) {
  const u = new URL(url);
  if (u.hostname !== '127.0.0.1' || u.port !== String(PORT)) {
    throw new Error(`The walkthroughs only talk to the temporary server on 127.0.0.1:${PORT}, not ${url}.`);
  }
}
assertTempServer(BASE);
if (process.env.E2E_BASE && process.env.E2E_BASE.replace(/\/$/, '') !== BASE) {
  throw new Error(`E2E_BASE must be ${BASE} (or unset); refusing ${process.env.E2E_BASE}.`);
}

export const MODE = process.env.E2E_MODE === 'phone' ? 'phone' : 'desktop';
export const phone = MODE === 'phone';
export const W = Number(process.env.E2E_WIDTH) || (phone ? 360 : 1500);
export const H = Number(process.env.E2E_HEIGHT) || (phone ? 740 : 950);
/** Screenshots and other files a walk writes. */
export const OUT = process.env.E2E_OUT || mkdtempSync(join(tmpdir(), 'fibergis-e2e-out-'));
mkdirSync(OUT, { recursive: true });
export const WALK = process.env.E2E_WALK || 'walk';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- results
const counts = { passes: 0, fails: 0 };
export const results = counts;
export function log(step, ok, note = '') {
  if (ok) counts.passes += 1;
  else counts.fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${step}${note ? ' | ' + note : ''}`);
  return !!ok;
}

// ---------------------------------------------------------------- API (temp server only)
export async function api(path, init = {}) {
  const url = `${BASE}/api/v1${path}`;
  assertTempServer(url);
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text, headers: res.headers, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}
export const network = async () => (await api('/network')).body.data;
export const post = (body) => api('/changes', { method: 'POST', body: JSON.stringify(body) });
export const health = async () => (await api('/health')).body;

/** Stores the walk's starting records through the normal checked write. */
export async function seed(changes, label = 'seed') {
  const res = await post(changes);
  log(`${label} stored on the temp server`, res.status === 200, res.status !== 200 ? `${res.status} ${JSON.stringify(res.body).slice(0, 300)}` : '');
  return res;
}

// ---------------------------------------------------------------- record builders used by many walks
export const LAT = 12.9352;
export const LNG = 77.6245;
export const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
export const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
export const tia = { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 };

// ---------------------------------------------------------------- browser
let puppeteerModule = null;
export function puppeteer() {
  if (puppeteerModule) return puppeteerModule;
  const dir = process.env.E2E_PUPPETEER_DIR;
  if (!dir) throw new Error('Set E2E_PUPPETEER_DIR to a folder whose node_modules has puppeteer-core (it is not a dependency of this repo).');
  const require = createRequire(join(dir, 'noop.js'));
  try {
    puppeteerModule = require('puppeteer-core');
  } catch (error) {
    throw new Error(`puppeteer-core was not found from ${dir}: ${error.message}`);
  }
  return puppeteerModule;
}
export function chromePath() {
  const chrome = process.env.E2E_CHROME;
  if (!chrome) throw new Error('Set E2E_CHROME to the Chrome or Chromium program to drive.');
  return chrome;
}

let browserPromise = null;
/** One headless Chrome per walk. */
export function browser({ args = [] } = {}) {
  browserPromise ??= puppeteer().launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', ...args] });
  return browserPromise;
}

const PRO_PREFS = JSON.stringify({ state: { uiMode: 'pro' }, version: 1 });
const WELCOME_SEEN = JSON.stringify({ state: { welcomeSeen: true, welcomeStep: 0 }, version: 0 });

export const allErrors = [];

/**
 * Opens the app in a new page and returns the page helpers.
 *  - `uiMode: 'pro'` stores the Pro mode preference first (null leaves the app's default).
 *  - `newContext: true` uses a separate browser profile (another person on another device).
 *  - `geolocation` is the GPS fix the page gets; `path` the first address; `waitMs` the first wait.
 *  - `viewport` overrides the walk's desktop/phone size for this page.
 */
export async function openApp({ uiMode = 'pro', newContext = false, geolocation = { latitude: LAT + 0.0018, longitude: LNG + 0.003, accuracy: 6 }, path = '/', waitMs = 3000, viewport, tag = 'page', printStub = false, launchArgs, permissions = ['geolocation'], consoleErrors = false, goto = true } = {}) {
  const b = await browser({ args: launchArgs });
  const ctx = newContext ? await b.createBrowserContext() : b.defaultBrowserContext();
  await ctx.overridePermissions(BASE, permissions);
  const p = await ctx.newPage();
  const vp = viewport ?? { width: W, height: H, isMobile: phone, hasTouch: phone };
  const isPhone = !!vp.isMobile;
  await p.setViewport({ deviceScaleFactor: 1, ...vp });
  await p.evaluateOnNewDocument(
    (pro, welcome, stub) => {
      try {
        if (pro) localStorage.setItem('fiber_gis_ui_prefs', pro);
        localStorage.setItem('fiber_gis_learning_prefs', welcome);
      } catch {}
      if (stub) {
        // The print dialog cannot open headless: record the call and whether the print styles were on.
        window.__printed = 0;
        window.print = () => {
          window.__printed += 1;
          window.__printClass = document.body.classList.contains('gis-printing');
        };
      }
    },
    uiMode === 'pro' ? PRO_PREFS : null,
    WELCOME_SEEN,
    printStub,
  );
  if (geolocation) await p.setGeolocation(geolocation);
  const errors = [];
  p.on('pageerror', (e) => {
    errors.push(e.message);
    allErrors.push(`${tag}: ${e.message}`);
  });
  if (consoleErrors) {
    p.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR|401|403/.test(m.text())) {
        errors.push(`console: ${m.text()}`);
        allErrors.push(`${tag} console: ${m.text()}`);
      }
    });
  }
  p.on('dialog', (d) => d.dismiss());
  if (goto) {
    await p.goto(BASE + path);
    await sleep(waitMs);
  }
  return pageHelpers(p, { phone: isPhone, errors, tag });
}

/** The helpers every walk uses, bound to one page. */
export function pageHelpers(p, { phone: isPhone = phone, errors = [], tag = 'page' } = {}) {
  let failShots = 0;
  const h = { p, phone: isPhone, errors };
  h.shot = (name) => p.screenshot({ path: join(OUT, `${WALK}-${MODE}-${tag === 'page' ? '' : tag + '-'}${name}.png`) }).catch(() => undefined);
  /** Page text test. Section titles are upper-cased by CSS and innerText follows CSS, so it ignores case by default. */
  h.hasRaw = (re, flags = 'i') => p.evaluate((s, f) => new RegExp(s, f).test(document.body.innerText), re, flags);
  /** Phase 3: the inspector has tabs. Opens each until the test passes and stays on that tab. */
  h.revealInTabs = async (test) => {
    const tabs = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="inspector-tab-"]')].map((t) => t.dataset.testid));
    for (const t of tabs) {
      await p.evaluate((t) => document.querySelector(`[data-testid="${t}"]`)?.click(), t);
      await sleep(300);
      if (await test()) return true;
    }
    return false;
  };
  h.visibleSel = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().width > 0), sel);
  h.has = async (re) => (await h.hasRaw(re)) || (await h.revealInTabs(() => h.hasRaw(re)));
  h.check = async (label, re) => log(label, await h.has(re));
  h.textOf = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.innerText).join('\n'), sel);
  /** Text of every element with this data-testid, visible or not. */
  h.testText = (testId) => p.evaluate((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => e.innerText).join(' | '), testId);

  /** Taps an element like a finger, after checking a finger could reach it (not covered, on screen). */
  h.tapEl = async (selector, label, { text, wait = 700 } = {}) => {
    if (!(await h.visibleSel(selector))) await h.revealInTabs(() => h.visibleSel(selector));
    const info = await p.evaluate(
      (selector, text) => {
        const all = [...document.querySelectorAll(selector)].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (!text || (e.innerText || e.getAttribute('aria-label') || '').trim().includes(text));
        });
        const e = all.at(-1);
        if (!e) return null;
        e.scrollIntoView({ block: 'center', inline: 'center' });
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, h: Math.round(r.height), disabled: !!e.disabled, reach: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && !!top && (e === top || e.contains(top) || top.contains(e)) };
      },
      selector,
      text,
    );
    if (!info) return log(`tap ${label}`, false, 'NOT FOUND') && false;
    if (info.disabled) return log(`tap ${label}`, false, 'disabled') && false;
    if (!info.reach) {
      log(`tap ${label}`, false, 'covered or off screen');
      if (failShots < 4) {
        failShots += 1;
        const cover = await p.evaluate(({ x, y }) => {
          const t = document.elementFromPoint(x, y);
          return t ? `${t.tagName}.${String(t.className).slice(0, 80)} "${(t.innerText || '').slice(0, 40)}"` : 'nothing';
        }, info);
        console.log('   covered by', cover, 'at', Math.round(info.x), Math.round(info.y));
        await h.shot(`fail-${failShots}`);
      }
      return false;
    }
    if (isPhone) await p.touchscreen.tap(info.x, info.y);
    else await p.mouse.click(info.x, info.y);
    await sleep(wait);
    return true;
  };
  h.tapId = (id) => h.tapEl(`[data-testid="${id}"]`, id);
  h.TAP_TEXT = 'button,a,[role=button],[role=tab],summary';
  h.tapText = (text, selector = h.TAP_TEXT) => h.tapEl(selector, `"${text}"`, { text });
  /** Taps the first visible element whose data-testid starts with `prefix`. */
  h.tapFirst = async (prefix, label) => {
    const id = await p.evaluate((prefix) => [...document.querySelectorAll(`[data-testid^="${prefix}"]`)].find((e) => e.getBoundingClientRect().width > 0)?.dataset.testid ?? null, prefix);
    if (!id) return log(`tap ${label}`, false, 'NOT FOUND');
    return h.tapId(id);
  };

  /**
   * The older field-helper tap: finds a control by its words, says how big it is and whether a finger
   * could reach it (that is the check), then taps it; when covered it clicks it anyway unless `noForce`.
   */
  h.tapLabel = async (text, opts = {}) => {
    const info = await p.evaluate(
      (text, exact) => {
        const all = [...document.querySelectorAll('button,a,[role=button],label,summary')].filter((e) => {
          const r = e.getBoundingClientRect();
          const t = (e.innerText || e.getAttribute('aria-label') || e.title || '').trim();
          return r.width > 0 && r.height > 0 && (exact ? t === text : t.includes(text));
        });
        const e = all.at(-1);
        if (!e) return null;
        e.scrollIntoView({ block: 'center', inline: 'center' });
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, w: Math.round(r.width), h: Math.round(r.height), inView: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, clear: !!top && (e === top || e.contains(top) || top.contains(e)) };
      },
      text,
      !!opts.exact,
    );
    if (!info) {
      log(`tap "${text}"`, false, 'NOT FOUND');
      return false;
    }
    const reachable = info.inView && info.clear;
    const note = `${info.w}x${info.h}px${info.h < 48 ? ' (under 48)' : ''}${reachable ? '' : info.inView ? ' COVERED' : ' OFF-SCREEN'}`;
    log(`tap "${text}"`, reachable, note);
    if (!reachable) {
      if (opts.noForce) return false;
      await p.evaluate(
        (text, exact) => {
          const e = [...document.querySelectorAll('button,a,[role=button],label,summary')]
            .filter((el) => {
              const t = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
              return el.getBoundingClientRect().width > 0 && (exact ? t === text : t.includes(text));
            })
            .at(-1);
          e?.click();
        },
        text,
        !!opts.exact,
      );
    } else if (isPhone) await p.touchscreen.tap(info.x, info.y);
    else await p.mouse.click(info.x, info.y);
    await sleep(500);
    return true;
  };
  /** Taps the map at a screen point, after checking no panel covers it there. */
  h.mapTap = async (x, y, label) => {
    const free = await p.evaluate((x, y) => !!document.elementFromPoint(x, y)?.closest('.leaflet-container'), x, y);
    log(`map tap ${label} at ${Math.round(x)},${Math.round(y)}`, free, free ? '' : 'map covered here');
    if (isPhone) await p.touchscreen.tap(x, y);
    else await p.mouse.click(x, y);
    await sleep(600);
  };

  /** Sets a React-controlled input or select (the last visible one with this test id), as typing or choosing would. */
  h.setField = async (testId, value) => {
    if (!(await h.visibleSel(`[data-testid="${testId}"]`))) await h.revealInTabs(() => h.visibleSel(`[data-testid="${testId}"]`));
    const ok = await p.evaluate(
      (testId, value) => {
        const el = [...document.querySelectorAll(`[data-testid="${testId}"]`)].at(-1);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        return true;
      },
      testId,
      value,
    );
    if (!ok) log(`field ${testId}`, false, 'NOT FOUND');
    await sleep(250);
  };
  /** Chooses a select option by its visible words. */
  h.chooseByText = async (testId, text) => {
    const value = await p.evaluate(
      (testId, text) => [...([...document.querySelectorAll(`[data-testid="${testId}"]`)].at(-1)?.options ?? [])].find((o) => o.text.includes(text))?.value,
      testId,
      text,
    );
    if (value === undefined) log(`option "${text}" in ${testId}`, false, 'NOT FOUND');
    else await h.setField(testId, value);
  };
  /** Types into a field with the keyboard, as a person would (clears it first). */
  h.typeInto = async (testId, value) => {
    if (!(await h.visibleSel(`[data-testid="${testId}"]`))) await h.revealInTabs(() => h.visibleSel(`[data-testid="${testId}"]`));
    const all = await p.$$(`[data-testid="${testId}"]`);
    let el = null;
    for (const candidate of all) if (await candidate.evaluate((e) => e.getBoundingClientRect().width > 0)) el = candidate;
    el ??= all.at(-1);
    if (!el) return log(`field ${testId}`, false, 'NOT FOUND');
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await el.click({ clickCount: 3 });
    await p.keyboard.type(value);
    await sleep(200);
  };
  /** Types into the input next to a label with these words. */
  h.typeBy = async (label, value) => {
    const ok = await p.evaluate((label) => {
      const l = [...document.querySelectorAll('label')].find((x) => x.innerText.includes(label));
      const i = l?.parentElement?.querySelector('input');
      if (!i) return false;
      i.focus();
      i.select?.();
      return true;
    }, label);
    if (!ok) log(`type into ${label}`, false, 'NOT FOUND');
    else await p.keyboard.type(value);
    return ok;
  };
  h.tab = async (id) => {
    await h.tapEl(`[data-testid="inspector-tab-${id}"]`, `tab ${id}`);
    await sleep(300);
  };
  /** On a phone a chosen item shows a small bar with Details; when the inspector is already open there is none. */
  h.openDetails = async () => {
    const open = await p.evaluate(() => !!document.querySelector('aside[aria-label="Inspector"]'));
    if (isPhone && !open) await h.tapText('Details');
    await sleep(500);
  };
  h.closePanels = async () => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate(() => document.querySelectorAll('[aria-label="Close"]').forEach((e) => e.click()));
    await sleep(400);
  };
  /** Finds a record with the top search box and opens it, as a person would. */
  h.find = async (query, label) => {
    await h.closePanels();
    let input = await p.$('input[aria-label="Search network"]');
    const visible = input && (await p.evaluate((e) => e.getBoundingClientRect().width > 0, input));
    if (!visible) {
      await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /search/i.test(x.getAttribute('aria-label') ?? ''))?.click());
      await sleep(400);
      input = await p.$('input[aria-label="Search network"]');
    }
    if (!input) return log(`search for ${label}`, false, 'no search box');
    await input.click({ clickCount: 3 });
    await p.keyboard.type(query);
    await sleep(500);
    // Phase 16: results are grouped by kind (equipment first); tap the first match, as a person would.
    const hit = await p.evaluate((label) => {
      const b = [...document.querySelectorAll('#global-search-results [role="option"]')].find((e) => e.getBoundingClientRect().width > 0 && e.innerText.includes(label));
      b?.click();
      return !!b;
    }, label);
    log(`search result ${label}`, hit);
    await sleep(700);
    if (!hit) await p.keyboard.press('Enter');
    await sleep(700);
    await h.openDetails();
  };
  h.toastText = () => p.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"]')].map((e) => e.innerText).join(' | '));
  /** Says yes to a "Save anyway" question when one is asked, and prints what it said. */
  h.confirmIfAsked = async () => {
    await sleep(300);
    if (await h.has('Save anyway')) {
      console.log('confirm asked:', (await p.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')).slice(0, 200).replace(/\s+/g, ' '));
      await h.tapText('Save anyway');
    }
  };
  /** Opens a sidebar tool, through the phone's menu first. */
  h.openTool = async (label) => {
    await h.closePanels();
    // Screens with their own close button (such as Close capacity), as a person would tap it.
    await p.evaluate(() => [...document.querySelectorAll('[aria-label^="Close "]')].filter((e) => e.getAttribute('aria-label') !== 'Close menu' && e.getBoundingClientRect().width > 0).forEach((e) => e.click()));
    await sleep(400);
    if (isPhone) await h.tapText('Open menu');
    return h.tapEl('[aria-label="Primary"] button, [aria-label="Primary"] a', `menu: ${label}`, { text: label });
  };
  /** Closes the equipment toolbox when it opened by itself, because it covers the map. */
  h.collapseToolbox = async () => {
    if (await p.evaluate(() => [...document.querySelectorAll('[aria-label="Collapse Toolbox"]')].some((e) => e.getBoundingClientRect().width > 0))) {
      await p.evaluate(() => document.querySelector('[aria-label="Collapse Toolbox"]').click());
      return true;
    }
    return false;
  };
  h.zoomIn = async (times, gap = 400) => {
    await p.evaluate(
      async (z, gap) => {
        const zin = document.querySelector('[aria-label="Zoom in"]');
        for (let i = 0; zin && i < z; i += 1) {
          zin.click();
          await new Promise((r) => setTimeout(r, gap));
        }
      },
      times,
      gap,
    );
  };
  h.hscroll = () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  /** Waits until the browser has sent its changes ("Saved on phone" / "Sending" gone). */
  h.settle = async () => {
    for (let i = 0; i < 10; i += 1) {
      const pending = await p.evaluate(() => document.body.innerText.match(/Saved on phone|Sending/) !== null);
      if (!pending) break;
      await sleep(500);
    }
    await sleep(1500);
  };
  return h;
}

/** Prints the end lines (page width, browser errors, summary), closes Chrome and sets the exit code. */
export async function finish({ app, errorsAreFailures = false } = {}) {
  if (app) console.log('hscroll at end', await app.hscroll().catch(() => 'page closed'));
  if (errorsAreFailures) log('no browser errors', allErrors.length === 0, allErrors.slice(0, 3).join(' || '));
  console.log('BROWSER ERRORS', allErrors.length, allErrors.slice(0, 3).join(' | '));
  console.log(`SUMMARY ${counts.passes} pass, ${counts.fails} fail`);
  if (browserPromise) await (await browserPromise).close().catch(() => undefined);
  process.exitCode = counts.fails > 0 ? 1 : 0;
}

/** For walks that must stop early: still prints the summary and closes Chrome. */
export async function abort(reason) {
  log(reason, false);
  await finish();
  process.exit(1);
}

// ---------------------------------------------------------------- customer form: choose the connection
// Since the audit fix the customer form preselects nothing: like a person, choose the box, the
// splitter (adding a 1:8 one if the box has none, choosing the ratio) and the first free output.
const pickWait = (ms) => new Promise((r) => setTimeout(r, ms));

async function markSelect(p, firstTexts, tag) {
  return p.evaluate(
    (firstTexts, tag) => {
      const s = [...document.querySelectorAll('select')].find((x) => firstTexts.includes(x.options[0]?.text) && x.getBoundingClientRect().width > 0);
      if (!s) return null;
      s.setAttribute('data-walk', tag);
      return s.value || [...s.options].find((o) => o.value)?.value || null;
    },
    firstTexts,
    tag,
  );
}

const clickButtonText = (p, text) =>
  p.evaluate((text) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === text && !x.disabled && x.getBoundingClientRect().width > 0);
    b?.click();
    return !!b;
  }, text);

const SPLITTER_FIRST = ['Choose the splitter', 'No splitter in this box yet', 'Choose the box first'];

/** Returns what it chose, or null fields where it could not. */
export async function pickConnection(p, { boxText } = {}) {
  const box = await p.evaluate((boxText) => {
    const s = [...document.querySelectorAll('select')].find((x) => ['Choose the box', 'Place a terminal box on the map first'].includes(x.options[0]?.text) && x.getBoundingClientRect().width > 0);
    if (!s) return null;
    s.setAttribute('data-walk', 'box');
    if (s.value) return s.value;
    const o = [...s.options].find((x) => x.value && (!boxText || x.text.includes(boxText))) ?? [...s.options].find((x) => x.value);
    return o?.value ?? null;
  }, boxText ?? null);
  if (box) await p.select('[data-walk="box"]', box);
  await pickWait(300);
  let splitter = await markSelect(p, SPLITTER_FIRST, 'spl');
  let added = false;
  if (!splitter) {
    added = (await clickButtonText(p, '1:8')) && (await clickButtonText(p, 'Add splitter'));
    await pickWait(500);
    splitter = await markSelect(p, SPLITTER_FIRST, 'spl');
  }
  if (splitter) await p.select('[data-walk="spl"]', splitter);
  await pickWait(300);
  const port = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button[title$=": Free"]')].find((x) => !x.disabled && x.getBoundingClientRect().width > 0);
    b?.click();
    return b ? Number(b.innerText.trim()) || b.title : null;
  });
  await pickWait(200);
  // Phase 0B: the drop fiber is chosen too, never assumed (the new drop has 2 fibers).
  const dropFiber = await p.evaluate(() => {
    const b = document.querySelector('[data-testid="drop-fiber-1"]');
    if (!b || b.getBoundingClientRect().width === 0) return null;
    b.click();
    return 1;
  });
  await pickWait(200);
  return { box, splitter, port, added, dropFiber };
}

/** A small picture file in the output folder, for walks that attach a photo (made by Chrome, no files kept in the repo). */
export async function makePhoto(name, { text = 'FiberGIS walk photo', type = name.endsWith('.jpg') ? 'jpeg' : 'png' } = {}) {
  const b = await browser();
  const page = await b.newPage();
  await page.setViewport({ width: 320, height: 240, deviceScaleFactor: 1 });
  await page.goto(`data:text/html,<body style="margin:0;background:%23446;color:%23fff;font:28px sans-serif;padding:20px">${encodeURIComponent(text)}</body>`);
  const path = join(OUT, name);
  await page.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 70 } : {}) });
  await page.close();
  return path;
}

/** The repository root (for tools such as the map-check script). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
