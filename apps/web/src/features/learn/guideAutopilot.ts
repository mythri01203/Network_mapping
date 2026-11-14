import type { Layer as LeafletLayer, Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';

import { connectSplitterOutput, linkSplitterInput, patchOdfPort, setOdfPortFeeder } from '@fibergis/shared';

import { deleteCable, deleteEquipment } from '../../stores/networkActions';
import { type Command, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import type { GuideCtx } from './guideTours';

/**
 * The guide maps by itself (learning assistant, Stage 3, "Map the network step by step"). For each
 * step it moves a hand to the real button and presses it, types in the real fields and taps the real
 * map, exactly as a person would, so what is shown is the real app working.
 *
 * What it makes is real until the end: then it deletes the cables and boxes it made (their splitters
 * go with the boxes). It never saves a customer, because the app has no way to remove one again; it
 * shows where Activate Subscriber is and closes the form instead. Nothing that was on the map before
 * is touched: only the ids the guide saw appear after it started.
 */

export class StopDemo extends Error {}

export interface Pilot {
  /** False once the guide is closed: every action stops there. */
  alive: () => boolean;
  /** True while the person has paused the guide: actions wait. */
  paused: () => boolean;
  ctx: () => GuideCtx;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- the hand */

let hand: HTMLDivElement | null = null;
function theHand(): HTMLDivElement {
  if (hand && document.body.contains(hand)) return hand;
  hand = document.createElement('div');
  hand.className = 'guide-cursor';
  hand.setAttribute('aria-hidden', 'true');
  hand.innerHTML =
    '<svg viewBox="0 0 24 24" width="44" height="44" fill="#fff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"><path d="M10 11V5a2 2 0 0 1 4 0v5"/><path d="M14 10V8a2 2 0 0 1 4 0v4"/><path d="M18 12a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-5.6-2.8L4.6 15a2 2 0 0 1 3.1-2.5L10 15V11"/></svg>';
  hand.style.left = `${window.innerWidth / 2}px`;
  hand.style.top = `${window.innerHeight / 2}px`;
  document.body.appendChild(hand);
  return hand;
}
export function hideHand() {
  hand?.remove();
  hand = null;
}

async function step(p: Pilot, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end || p.paused()) {
    if (!p.alive()) throw new StopDemo();
    await sleep(Math.min(120, Math.max(10, end - Date.now())));
  }
}

async function moveTo(p: Pilot, x: number, y: number) {
  const h = theHand();
  h.style.left = `${x}px`;
  h.style.top = `${y}px`;
  await step(p, 700);
}

async function press(p: Pilot) {
  const h = theHand();
  h.classList.add('is-pressing');
  await step(p, 180);
  h.classList.remove('is-pressing');
}

/* ------------------------------------------------------- finding things */

const outside = (el: Element) => !el.closest('[data-guide-layer]');

async function waitFor<T>(p: Pilot, find: () => T | null | undefined | false, what: string, ms = 9000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    if (!p.alive()) throw new StopDemo();
    const found = find();
    if (found) return found;
    if (Date.now() > end && !p.paused()) throw new Error(`I could not find ${what}.`);
    await sleep(150);
  }
}

/** A real button or label whose words start with `text` (outside the guide). */
function byText(text: string, tags = 'button, [role="tab"], [role="radio"], label'): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(tags)].filter(
    (el) => outside(el) && (el.textContent ?? '').trim().startsWith(text) && el.getBoundingClientRect().width > 0,
  );
  all.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
  return all[0] ?? null;
}
const byCss = (css: string) =>
  [...document.querySelectorAll<HTMLElement>(css)].find((el) => outside(el) && el.getBoundingClientRect().width > 0) ??
  null;
const pinOf = (id?: string) => (id ? byCss(`.gis-pin[data-eqid="${CSS.escape(id)}"]`) : null);
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** The real thing under a screen point, ignoring the guide's own layer. */
const hitAt = (x: number, y: number) => document.elementsFromPoint(x, y).find(outside) ?? null;

/**
 * Open map near a point: not on a pin, a line, a label or a panel, and not under the guide's card.
 * The search walks outwards in rings until it finds such a spot.
 */
function openMapNear(x: number, y: number): { x: number; y: number } | null {
  const map = byCss('.leaflet-container');
  if (!map) return null;
  const box = map.getBoundingClientRect();
  for (let r = 0; r <= 320; r += 28) {
    for (let a = 0; a < 12; a++) {
      const px = x + Math.cos((a / 12) * Math.PI * 2) * r;
      const py = y + Math.sin((a / 12) * Math.PI * 2) * r;
      if (px < box.left + 50 || px > box.right - 50 || py < box.top + 50 || py > box.bottom - 50) continue;
      const hits = document.elementsFromPoint(px, py);
      if (hits.some((h) => h.closest('[data-guide-card]'))) continue;
      const top = hits.find(outside);
      if (!top || !map.contains(top)) continue;
      if (top.closest('.leaflet-marker-icon, .leaflet-interactive, .leaflet-control, .leaflet-popup, .leaflet-tooltip'))
        continue;
      return { x: px, y: py };
    }
  }
  return null;
}

/* -------------------------------------------------------------- actions */

async function tap(p: Pilot, el: HTMLElement) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await step(p, 60);
  const c = centre(el);
  await moveTo(p, c.x, c.y);
  await press(p);
  if (!p.alive()) throw new StopDemo();
  el.click();
  await step(p, 450);
}

/** A tap on the map itself (or a pin on it), the way the browser sends one. */
async function tapAt(p: Pilot, x: number, y: number) {
  await moveTo(p, x, y);
  await press(p);
  const target = hitAt(x, y);
  if (!target) throw new Error('I could not tap the map there.');
  // On the map, the tap is handed to the map itself: some browsers ignore a pretend mouse click there.
  // Loaded only here: the map code needs a browser.
  const map: LeafletMap | null = (await import('../map/leaflet/useLeafletMap')).activeLeafletMap();
  if (map && map.getContainer().contains(target)) {
    const originalEvent = new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0, view: window });
    const containerPoint = map.mouseEventToContainerPoint(originalEvent);
    const icon = target.closest('.leaflet-marker-icon');
    // A pin: its own click. Leaflet keeps each pin under its element's id.
    const id = icon ? (icon as unknown as { _leaflet_id?: number })._leaflet_id : undefined;
    const layer =
      id !== undefined ? (map as unknown as { _targets: Record<number, LeafletLayer> })._targets[id] : undefined;
    const event = {
      originalEvent,
      containerPoint,
      layerPoint: map.containerPointToLayerPoint(containerPoint),
      latlng:
        layer && 'getLatLng' in layer
          ? (layer as LeafletMarker).getLatLng()
          : map.containerPointToLatLng(containerPoint),
    };
    (layer ?? map).fire('click', event);
    await step(p, 600);
    return;
  }
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
  target.dispatchEvent(
    new PointerEvent('pointerdown', { ...init, pointerId: 1, isPrimary: true, pointerType: 'mouse' }),
  );
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  target.dispatchEvent(new MouseEvent('click', init));
  await step(p, 600);
}

async function tapPin(p: Pilot, id: string | undefined, what: string) {
  const pin = await waitFor(p, () => pinOf(id), what);
  const c = centre(pin);
  await tapAt(p, c.x, c.y);
}

const setNative = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

async function typeInto(p: Pilot, input: HTMLInputElement, text: string) {
  await tap(p, input);
  input.focus();
  for (let i = 1; i <= text.length; i++) {
    setNative(input, text.slice(0, i));
    await step(p, 45);
  }
}

async function choose(p: Pilot, select: HTMLSelectElement, value: string) {
  await tap(p, select);
  setNative(select, value);
  await step(p, 400);
}

/** The control under a form label (a select or an input). */
function fieldOf<T extends HTMLElement>(label: string, css = 'select, input'): T | null {
  const l = byText(label, 'label');
  return (l?.parentElement?.querySelector<T>(css) as T | null) ?? null;
}

/** "Is this the same one?" when something is close by: the demo always adds a new one. */
async function answerSameOne(p: Pilot) {
  await step(p, 700);
  const b = byText('No, add a new one', 'button');
  if (b) await tap(p, b);
}

async function pick(p: Pilot, itemName: string) {
  await tap(p, await waitFor(p, () => byText(itemName, 'button'), `${itemName} in the list`));
}

async function placeNear(p: Pilot, near: () => { x: number; y: number }) {
  const at = await waitFor(
    p,
    () => {
      const n = near();
      return openMapNear(n.x, n.y);
    },
    'an empty place on the map',
  );
  await tapAt(p, at.x, at.y);
  await answerSameOne(p);
}

const mapCentre = () => {
  const map = byCss('.leaflet-container');
  return map ? centre(map) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
};
const pinOr = (id: string | undefined, dx: number, dy: number) => () => {
  const pin = pinOf(id);
  const c = pin ? centre(pin) : mapCentre();
  return { x: c.x + dx, y: c.y + dy };
};

interface ScreenPoint {
  x: number;
  y: number;
}

/** Distance from a point to the line a–b, in pixels. */
function offLine(pt: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
  return Math.abs(dy * pt.x - dx * pt.y + b.x * a.y - b.y * a.x) / len;
}

/** The corners of a road path: drops points that lie on a straight stretch (Douglas–Peucker). */
function corners(points: ScreenPoint[], tolerance: number): ScreenPoint[] {
  if (points.length <= 2) return points;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = offLine(points[i]!, points[0]!, points[points.length - 1]!);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [points[0]!, points[points.length - 1]!];
  const left = corners(points.slice(0, at + 1), tolerance);
  return [...left.slice(0, -1), ...corners(points.slice(at), tolerance)];
}

const MAX_ROAD_TAPS = 8;

/**
 * Where to tap so the cable follows the street between two boxes, from the app's own road routing
 * (the same one field crews use). Only corners are tapped, only on open map in view. Null when
 * there is no road route (offline, or the routing service did not answer): the caller draws simply.
 */
async function roadTaps(fromId: string | undefined, toId: string | undefined): Promise<ScreenPoint[] | null> {
  const { equipment } = useNetworkStore.getState();
  const a = equipment.find((e) => e.id === fromId);
  const b = equipment.find((e) => e.id === toId);
  if (!a || !b) return null;
  const { fetchRoadRoute } = await import('../../lib/routing');
  const route = await fetchRoadRoute([
    { id: a.id, name: a.name, lat: a.lat, lng: a.lng },
    { id: b.id, name: b.name, lat: b.lat, lng: b.lng },
  ]);
  if (!route || route.source !== 'road' || route.coordinates.length < 2) return null;
  const map = (await import('../map/leaflet/useLeafletMap')).activeLeafletMap();
  if (!map) return null;
  const rect = map.getContainer().getBoundingClientRect();
  const onScreen = route.coordinates.map(([lat, lng]) => {
    const pt = map.latLngToContainerPoint([lat, lng]);
    return { x: rect.left + pt.x, y: rect.top + pt.y };
  });
  // Fewer taps on a long, winding road: loosen until the corners fit.
  let tolerance = 10;
  let pts = corners(onScreen, tolerance);
  while (pts.length > MAX_ROAD_TAPS && tolerance < 200) pts = corners(onScreen, (tolerance *= 1.6));
  const start = pinOf(fromId);
  const end = pinOf(toId);
  const near = (el: Element | null, pt: ScreenPoint) => {
    if (!el) return false;
    const c = centre(el);
    return Math.hypot(c.x - pt.x, c.y - pt.y) < 26;
  };
  return pts.filter((pt) => {
    if (near(start, pt) || near(end, pt)) return false;
    if (pt.x < rect.left + 8 || pt.x > rect.right - 8 || pt.y < rect.top + 8 || pt.y > rect.bottom - 8) return false;
    const hits = document.elementsFromPoint(pt.x, pt.y);
    if (hits.some((h) => h.closest('[data-guide-card]'))) return false;
    const top = hits.find(outside);
    return !!top && map.getContainer().contains(top) && !top.closest('.leaflet-marker-icon, .leaflet-control');
  });
}

async function drawTo(p: Pilot, fromId: string | undefined, toId: string | undefined) {
  const from = await waitFor(p, () => pinOf(fromId), 'the start of the cable');
  const to = await waitFor(p, () => pinOf(toId), 'the end of the cable');
  // Along the street, corner by corner, when the road route is known.
  const road = await roadTaps(fromId, toId).catch(() => null);
  if (!p.alive()) throw new StopDemo();
  if (road && road.length > 0) {
    for (const pt of road) await tapAt(p, pt.x, pt.y);
  } else {
    // No road route: one corner on the way, then right on the box.
    const a = centre(from);
    const b = centre(to);
    const bend = openMapNear((a.x + b.x) / 2, (a.y + b.y) / 2 + 40) ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    await tapAt(p, bend.x, bend.y);
  }
  const end = centre(await waitFor(p, () => pinOf(toId), 'the end of the cable'));
  await tapAt(p, end.x, end.y);
  await tap(p, await waitFor(p, () => byText('Finish', 'button'), 'the Finish button'));
}

const NEXT = '[data-testid="cable-step-next"]';

async function cableKind(p: Pilot, name: string, type?: string) {
  if (type) {
    const select = await waitFor(p, () => byCss('#cable-type') as HTMLSelectElement | null, 'the cable type');
    await choose(p, select, type);
  }
  const input = await waitFor(p, () => byCss('#cable-name') as HTMLInputElement | null, 'the cable name');
  await typeInto(p, input, name);
  await tap(p, await waitFor(p, () => byCss(NEXT), 'Next'));
  await tap(p, await waitFor(p, () => byCss(NEXT), 'Next'));
}

async function cableEnds(p: Pilot) {
  const yes = byText('Yes, connect', 'button');
  if (yes) await tap(p, yes);
  const pon = byCss('#cable-pon') as HTMLSelectElement | null;
  if (pon) {
    const free = [...pon.options].find(
      (o) => o.value && !o.disabled && !/^none/i.test(o.textContent ?? '') && o.index > 1,
    );
    if (free) await choose(p, pon, free.value);
  }
  await tap(p, await waitFor(p, () => byCss(NEXT), 'Next'));
}

async function cableSave(p: Pilot) {
  for (let i = 0; i < 6 && !byText('Save Cable', 'button'); i++) {
    const next = byCss(NEXT);
    if (!next) break;
    await tap(p, next);
  }
  await tap(p, await waitFor(p, () => byText('Save Cable', 'button'), 'the Save Cable button'));
  await step(p, 800);
  const blank = byText('Save without connecting', 'button');
  if (blank) await tap(p, blank);
}


/** What the guide does by itself for each step, after saying it. */
export const AUTO: Record<string, (p: Pilot) => Promise<void>> = {
  'map.oltList': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Equipment"]'), 'the Equipment button')),
  'map.oltPick': (p) => pick(p, 'Optical Line Terminal (OLT)'),
  'map.oltPlace': (p) => placeNear(p, () => ({ x: mapCentre().x - 160, y: mapCentre().y - 40 })),
  'map.oltSetup': async (p) => {
    const name = await waitFor(p, () => fieldOf<HTMLInputElement>('OLT Name', 'input'), 'the OLT name');
    setNative(name, '');
    await typeInto(p, name, 'DEMO OLT');
    await tap(p, await waitFor(p, () => byText('Save Configuration', 'button'), 'Save Configuration'));
  },
  'map.fdtList': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Equipment"]'), 'the Equipment button')),
  'map.fdtPick': (p) => pick(p, 'Fiber Distribution Terminal (FDT)'),
  'map.fdtPlace': (p) => placeNear(p, pinOr(p.ctx().olt, 190, -30)),
  'map.feederSelect': (p) => tapPin(p, p.ctx().olt, 'the OLT on the map'),
  'map.feederStart': async (p) =>
    tap(p, await waitFor(p, () => byText('Draw feeder cable', 'button'), 'Draw feeder cable')),
  'map.feederRoute': (p) => drawTo(p, p.ctx().olt, p.ctx().fdt),
  'map.feederKind': (p) => cableKind(p, 'DEMO feeder cable'),
  'map.feederEnds': (p) => cableEnds(p),
  'map.feederSave': (p) => cableSave(p),
  'map.feederStop': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Select"]'), 'the Select button')),
  'map.fdtSplitterOpen': (p) => tapPin(p, p.ctx().fdt, 'the FDT on the map'),
  'map.fdtSplitterAdd': async (p) => {
    await tap(p, await waitFor(p, () => byText('Connectivity', 'button, [role="tab"]'), 'the Connectivity tab'));
    const ratio = await waitFor(
      p,
      () => byCss('[data-testid="splitter-add-ratio"]') as HTMLSelectElement | null,
      'the splitter size',
    );
    await choose(p, ratio, '1:8');
    await tap(p, await waitFor(p, () => byCss('[data-testid="splitter-add"]'), 'Add splitter'));
  },
  'map.fatList': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Equipment"]'), 'the Equipment button')),
  'map.fatPick': (p) => pick(p, 'FAT Terminal Box'),
  'map.fatPlace': (p) => placeNear(p, pinOr(p.ctx().fdt, 170, 60)),
  'map.distSelect': (p) => tapPin(p, p.ctx().fdt, 'the FDT on the map'),
  'map.distStart': async (p) => {
    await tap(p, await waitFor(p, () => byText('Details', 'button, [role="tab"]'), 'the Details tab'));
    await tap(p, await waitFor(p, () => byText('Start cable here', 'button'), 'Start cable here'));
  },
  'map.distRoute': (p) => drawTo(p, p.ctx().fdt, p.ctx().fat),
  'map.distKind': (p) => cableKind(p, 'DEMO distribution cable', 'Distribution Fiber'),
  'map.distEnds': (p) => cableEnds(p),
  'map.distSave': (p) => cableSave(p),
  'map.distStop': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Select"]'), 'the Select button')),
  'map.custOpen': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Add customer"]'), 'Add customer')),
  'map.custBox': async (p) => {
    const name = await waitFor(p, () => fieldOf<HTMLInputElement>('Subscriber Full Name', 'input'), 'the name field');
    await typeInto(p, name, 'DEMO customer');
    const box = await waitFor(p, () => fieldOf<HTMLSelectElement>('Access Terminal (FAT)', 'select'), 'the box list');
    await choose(p, box, p.ctx().fat ?? '');
  },
  'map.custSplitter': async (p) => {
    const ratio = byText('1:8', '[role="radio"]');
    if (ratio) {
      await tap(p, ratio);
      await tap(p, await waitFor(p, () => byText('Add splitter', 'button'), 'Add splitter'));
      return;
    }
    const select = await waitFor(p, () => fieldOf<HTMLSelectElement>('Splitter Module', 'select'), 'the splitter list');
    const first = [...select.options].find((o) => o.value);
    if (first) await choose(p, select, first.value);
  },
  'map.custPort': async (p) => {
    const label = await waitFor(p, () => byText('Select Available Output Port', 'label'), 'the output ports');
    const port = await waitFor(
      p,
      () => label.parentElement?.querySelector<HTMLElement>('button:not([disabled])'),
      'a free output port',
    );
    await tap(p, port);
    const fiber = await waitFor(p, () => byCss('[aria-label="Drop fiber"] button'), 'Fiber 1');
    await tap(p, fiber);
  },
  'map.custPlace': async (p) => {
    await tap(p, await waitFor(p, () => byText('Pick on map', 'button'), 'Pick on map'));
    const at = await waitFor(
      p,
      () => {
        const n = pinOr(p.ctx().fat, -70, 70)();
        return openMapNear(n.x, n.y);
      },
      'the house on the map',
    );
    await tapAt(p, at.x, at.y);
  },
  'demo.custSave': async (p) => {
    const activate = await waitFor(p, () => byText('Activate Subscriber', 'button'), 'Activate Subscriber');
    activate.scrollIntoView({ block: 'nearest' });
    const c = centre(activate);
    await moveTo(p, c.x, c.y);
    await step(p, 1800);
    // Not pressed: the form is closed instead, so no customer is saved.
    useUiStore.getState().setModalOpen('customerWizard', false);
    await step(p, 400);
  },
  ...flowAuto(),
  'demo.cleanup': async (p) => {
    await removeDemoItems(p.ctx());
  },
};

/* ------------------------------------------------- the full flow (flow.*) */

const byId = (id: string) => byCss(`[data-testid="${CSS.escape(id)}"]`);

/** Opens a tab of the selected item's panel, unless it is open already. */
async function openTab(p: Pilot, id: 'details' | 'connectivity') {
  const tab = await waitFor(p, () => byId(`inspector-tab-${id}`), `the ${id} tab`);
  if (tab.getAttribute('aria-selected') !== 'true') await tap(p, tab);
}

/** Chooses the first option of a select that `ok` accepts (waiting until the list has one). */
async function chooseWhere(p: Pilot, selectId: string, ok: (o: HTMLOptionElement) => boolean, what: string) {
  const select = await waitFor(p, () => byId(selectId) as HTMLSelectElement | null, what);
  const option = await waitFor(p, () => [...select.options].find((o) => o.value && !o.disabled && ok(o)), what);
  await choose(p, select, option.value);
}

/** Types into a field found by its test id. */
async function fill(p: Pilot, inputId: string, text: string, what: string) {
  const input = await waitFor(p, () => byId(inputId) as HTMLInputElement | null, what);
  setNative(input, '');
  await typeInto(p, input, text);
}

/** "Please check" after a save: the demo goes on, as a person who read it would. */
async function confirmIfAsked(p: Pilot) {
  await step(p, 700);
  const anyway = byText('Save anyway', 'button');
  if (anyway) await tap(p, anyway);
}

/** The Auto-pole switch in the drawing bar: on or off. */
async function autoPole(p: Pilot, on: boolean) {
  const label = [...document.querySelectorAll<HTMLElement>('label')].find(
    (l) => outside(l) && (l.textContent ?? '').includes('Auto-pole'),
  );
  const sw = label?.querySelector<HTMLElement>('[role="switch"]');
  if (sw && (sw.getAttribute('aria-checked') === 'true') !== on) await tap(p, sw);
}

/** A box's splitter: link its input to fiber 1 of a cable. */
async function addSplitterFedBy(p: Pilot, cableId: string | undefined) {
  await openTab(p, 'connectivity');
  await chooseWhere(p, 'splitter-add-ratio', (o) => o.value === '1:8', 'the splitter size');
  if (cableId) {
    await chooseWhere(p, 'splitter-add-input-cable', (o) => o.value === cableId, 'the cable that feeds it');
    await fill(p, 'splitter-add-input-core', '1', 'the fiber number');
  }
  await tap(p, await waitFor(p, () => byId('splitter-add'), 'Add splitter'));
  await confirmIfAsked(p);
}

/** ODF port 1 opened (its tile opens and closes the detail, so only when it is shut). */
async function openOdfPort1(p: Pilot) {
  await openTab(p, 'connectivity');
  if (!byId('odf-port-detail')) await tap(p, await waitFor(p, () => byId('odf-port-1'), 'ODF port 1'));
  await waitFor(p, () => byId('odf-port-detail'), 'the ODF port details');
}

/** A function, so the list above can use it before this point in the file. */
function flowAuto(): Record<string, (p: Pilot) => Promise<void>> {
  return {
  'flow.oltConnect': (p) => openTab(p, 'connectivity'),
  'flow.odfList': async (p) =>
    tap(p, await waitFor(p, () => byCss('button[aria-label="Equipment"]'), 'the Equipment button')),
  'flow.odfPick': (p) => pick(p, 'Optical Distribution Frame (ODF)'),
  'flow.odfPlace': (p) => placeNear(p, pinOr(p.ctx().olt, 50, 80)),
  'flow.odfPanel': async (p) => {
    await openTab(p, 'connectivity');
    await fill(p, 'odf-panel-label', 'Panel A', 'the panel name');
    await fill(p, 'odf-panel-ports', '12', 'the number of adapters');
    await tap(p, await waitFor(p, () => byId('odf-panel-add'), 'Add panel'));
  },
  'flow.odfPatch': async (p) => {
    await openOdfPort1(p);
    const olt = p.ctx().olt;
    await chooseWhere(p, 'odf-patch-olt', (o) => o.value === olt, 'the OLT');
    await chooseWhere(p, 'odf-patch-pon', () => true, 'the PON port');
    await fill(p, 'odf-patch-cord', 'DEMO patch cord', 'the cord label');
    await tap(p, await waitFor(p, () => byId('odf-patch-save'), 'Save patch'));
    await confirmIfAsked(p);
  },
  'flow.feederSelect': (p) => tapPin(p, p.ctx().odf, 'the ODF on the map'),
  'flow.feederStart': async (p) => {
    await openTab(p, 'details');
    await tap(p, await waitFor(p, () => byText('Start cable here', 'button'), 'Start cable here'));
  },
  'flow.feederRoute': async (p) => {
    await autoPole(p, true);
    await drawTo(p, p.ctx().odf, p.ctx().fdt);
  },
  'flow.feederKind': (p) => cableKind(p, 'DEMO feeder cable', 'Main Feeder Fiber'),
  'flow.feederEnds': (p) => cableEnds(p),
  'flow.feederPoles': async (p) => {
    // From the route page to the poles page.
    await tap(p, await waitFor(p, () => byCss(NEXT), 'Next'));
    const legend = await waitFor(
      p,
      () => byText('Poles near the line', 'legend') ?? byText('Draw the route first', 'p'),
      'the poles list',
    );
    for (const box of legend.closest('fieldset')?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []) {
      if (!box.checked) await tap(p, box);
    }
    const onThem = byText('Yes, it is on them', '[role="radio"]');
    if (onThem) await tap(p, onThem);
    await tap(p, await waitFor(p, () => byCss(NEXT), 'Next'));
  },
  'flow.feederSlack': async (p) => {
    const add = byText('Add a slack loop', 'button');
    if (add) {
      await tap(p, add);
      const poles = new Set(p.ctx().poles ?? []);
      const place = await waitFor(p, () => byCss('#slack-place-0') as HTMLSelectElement | null, 'where the loop is');
      const option =
        [...place.options].find((o) => poles.has(o.value)) ?? [...place.options].find((o) => o.value);
      if (option) await choose(p, place, option.value);
      const length = await waitFor(p, () => byCss('#slack-length-0') as HTMLInputElement | null, 'the loop length');
      await typeInto(p, length, '20');
    }
    await tap(p, await waitFor(p, () => byCss(NEXT), 'Next'));
  },
  'flow.feederSave': (p) => cableSave(p),
  'flow.feederStop': async (p) => {
    await autoPole(p, false);
    await tap(p, await waitFor(p, () => byCss('button[aria-label="Select"]'), 'the Select button'));
  },
  'flow.odfFeeder': async (p) => {
    await tapPin(p, p.ctx().odf, 'the ODF on the map');
    await openOdfPort1(p);
    const feeder = p.ctx().feeder;
    await chooseWhere(p, 'odf-feeder-cable', (o) => o.value === feeder, 'the feeder cable');
    await fill(p, 'odf-feeder-core', '1', 'the fiber number');
    await tap(p, await waitFor(p, () => byId('odf-feeder-save'), 'Save feeder fiber'));
    await confirmIfAsked(p);
  },
  'flow.fdtOpen': (p) => tapPin(p, p.ctx().fdt, 'the FDT on the map'),
  'flow.fdtSplitter': (p) => addSplitterFedBy(p, p.ctx().feeder),
  'flow.fdtOutput': async (p) => {
    await tapPin(p, p.ctx().fdt, 'the FDT on the map');
    await openTab(p, 'connectivity');
    const card = `[data-testid="splitter-${CSS.escape(p.ctx().fdtSplitter ?? '')}"]`;
    if (!byCss(`${card} [data-testid="splitter-out-detail"]`))
      await tap(p, await waitFor(p, () => byCss(`${card} [data-testid="splitter-out-1"]`), 'splitter output 1'));
    const dist = p.ctx().dist;
    await chooseWhere(p, 'splitter-out-cable', (o) => o.value === dist, 'the distribution cable');
    await fill(p, 'splitter-out-core', '1', 'the fiber number');
    await tap(p, await waitFor(p, () => byId('splitter-out-save'), 'Connect output'));
    await confirmIfAsked(p);
  },
  'flow.fatOpen': (p) => tapPin(p, p.ctx().fat, 'the FAT on the map'),
  'flow.fatSplitter': (p) => addSplitterFedBy(p, p.ctx().dist),
  };
}

/**
 * Deletes the cables, then the boxes and the OLT the demo made (their splitters go with them). Only
 * the ids the guide recorded; anything else is never touched. Returns the ids it could not remove.
 */
/**
 * Before the demo's cables and boxes can be deleted, the links it recorded between them are taken
 * off again (each would otherwise hold the cable): the splitter inputs and outputs in its FDT and
 * FAT, and its ODF's patch cords and feeder fibers. Only the demo's own items are touched.
 */
function unlinkDemoParts(ctx: GuideCtx) {
  const store = useNetworkStore.getState();
  const run = (command: Command<unknown>) => store.runCommand(command, { skipConfirm: true });
  const hosts = new Set([ctx.fdt, ctx.fat].filter(Boolean));
  for (const s of useNetworkStore.getState().splitters.filter((x) => hosts.has(x.terminalBoxId))) {
    for (const o of s.outputPorts)
      if (o.connectedDropCableId) run((d, c) => connectSplitterOutput(d, s.id, o.portNumber, null, c));
    if (s.inputPort.connectedCableId || s.inputPort.connectedSplitterId) run((d, c) => linkSplitterInput(d, s.id, null, c));
  }
  const odf = useNetworkStore.getState().equipment.find((e) => e.id === ctx.odf);
  for (const panel of odf?.odfPanels ?? []) {
    for (const port of panel.ports) {
      if (port.patch) run((d, c) => patchOdfPort(d, odf!.id, panel.id, port.number, null, c));
      if (port.feederCableId) run((d, c) => setOdfPortFeeder(d, odf!.id, panel.id, port.number, null, c));
    }
  }
}

export async function removeDemoItems(ctx: GuideCtx | null | undefined): Promise<string[]> {
  if (!ctx) return [];
  unlinkDemoParts(ctx);
  const { cables, equipment } = useNetworkStore.getState();
  const left: string[] = [];
  for (const id of [ctx.dist, ctx.feeder]) {
    if (id && cables.some((c) => c.id === id) && !(await deleteCable(id, { skipConfirm: true }))) left.push(id);
  }
  // House wires made by the customer form are never kept by the demo, but a stray one would block the box.
  for (const c of useNetworkStore.getState().cables) {
    if (
      c.type === 'Drop Fiber' &&
      !ctx.baseline.cables.includes(c.id) &&
      (c.startEquipmentId === ctx.fat || c.endEquipmentId === ctx.fat)
    ) {
      if (!(await deleteCable(c.id, { skipConfirm: true }))) left.push(c.id);
    }
  }
  // The ODF before the OLT (its patch named the OLT); the poles last, once no cable hangs on them.
  for (const id of [ctx.fat, ctx.fdt, ctx.odf, ctx.olt, ...(ctx.poles ?? [])]) {
    if (id && equipment.some((e) => e.id === id) && !(await deleteEquipment(id, { skipConfirm: true }))) left.push(id);
  }
  return left;
}
