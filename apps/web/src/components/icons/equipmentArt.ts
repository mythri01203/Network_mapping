import type { EquipmentType } from '@fibergis/shared';

/**
 * Generic product-style SVG illustrations for every equipment type, drawn on a 64×64 grid.
 * They are served as data URLs, so each image has its own gradient ids and can be used in React
 * and in Leaflet marker HTML alike. Large, simple shapes keep them readable at map-pin size.
 */

const DEFS = `<defs>
<linearGradient id="dk" x2="0" y2="1"><stop stop-color="#4a5b72"/><stop offset="1" stop-color="#1b2533"/></linearGradient>
<linearGradient id="st" x2="0" y2="1"><stop stop-color="#f3f6f9"/><stop offset="1" stop-color="#a5b1bf"/></linearGradient>
<linearGradient id="wh" x2="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#d3dae3"/></linearGradient>
<linearGradient id="gn" x2="1" y2="0"><stop stop-color="#55705f"/><stop offset=".5" stop-color="#7f9c8b"/><stop offset="1" stop-color="#4a6355"/></linearGradient>
<linearGradient id="gy" x2="1" y2="0"><stop stop-color="#79869a"/><stop offset=".5" stop-color="#b4bfcc"/><stop offset="1" stop-color="#6a778a"/></linearGradient>
<linearGradient id="bl" x2="0" y2="1"><stop stop-color="#4f91f7"/><stop offset="1" stop-color="#1b4fc4"/></linearGradient>
<linearGradient id="ir" x2="0" y2="1"><stop stop-color="#69737f"/><stop offset="1" stop-color="#2a3038"/></linearGradient>
<linearGradient id="cn" x2="1" y2="0"><stop stop-color="#8e8b82"/><stop offset=".45" stop-color="#d3d0c7"/><stop offset="1" stop-color="#85827a"/></linearGradient>
<linearGradient id="wd" x2="1" y2="0"><stop stop-color="#6d4528"/><stop offset=".45" stop-color="#b07c50"/><stop offset="1" stop-color="#633e23"/></linearGradient>
<linearGradient id="pv" x2="0" y2="1"><stop stop-color="#fb923c"/><stop offset="1" stop-color="#c2500f"/></linearGradient>
</defs>`;

const LED = '#22c55e';
const AMBER = '#f59e0b';
const SC_BLUE = '#2563eb';
const INK = '#0f172a';
/** First fibers of the TIA-598 color sequence. */
const FIBERS = ['#2563eb', '#f97316', '#16a34a', '#92400e', '#64748b', '#e2e8f0', '#dc2626', '#111827'];

const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${rx ? ` rx="${rx}"` : ''}/>`;
const dot = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const shape = (d: string, fill: string) => `<path d="${d}" fill="${fill}"/>`;
const line = (d: string, stroke: string, width = 2) =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const times = (n: number, draw: (i: number) => string) => Array.from({ length: n }, (_, i) => draw(i)).join('');
const url = (id: string) => `url(#${id})`;

/** A rack-mounted unit with mounting ears and screws. */
const rackUnit = (y: number, h: number, fill: string) =>
  rect(2, y, 60, h, fill, 2.5) +
  rect(2, y, 60, 1.5, '#ffffff33', 1) +
  dot(5, y + 3.5, 1.1, '#cbd5e1') +
  dot(59, y + 3.5, 1.1, '#cbd5e1') +
  dot(5, y + h - 3.5, 1.1, '#cbd5e1') +
  dot(59, y + h - 3.5, 1.1, '#cbd5e1');

const scPorts = (x: number, y: number, n: number, pitch: number, fill = SC_BLUE) =>
  times(n, (i) => rect(x + i * pitch, y, pitch - 1.6, 6.5, fill, 0.8) + rect(x + i * pitch + 1.2, y + 2, pitch - 4, 2.5, INK));
const rjPorts = (x: number, y: number, n: number, pitch: number) =>
  times(n, (i) => rect(x + i * pitch, y, pitch - 1.4, 6, '#e2e8f0', 0.6) + rect(x + i * pitch + 1, y + 1.2, pitch - 3.4, 3.6, INK));
const leds = (x: number, y: number, n: number, pitch: number, fill = LED) =>
  times(n, (i) => dot(x + i * pitch, y, 1.2, fill));

const olt =
  rackUnit(10, 44, url('dk')) +
  times(3, (i) => {
    const y = 15 + i * 12.5;
    return rect(8, y, 48, 10.5, url('st'), 1.5) + rjPorts(11, y + 2.2, 6, 5.6) + leds(47, y + 5.2, 2, 4, i === 2 ? AMBER : LED);
  });

const patchPanel =
  rackUnit(17, 30, url('st')) + scPorts(9, 21, 8, 5.9) + scPorts(9, 33, 8, 5.9, '#16a34a') + rect(9, 29, 46, 1.2, '#64748b');

const coreSwitch =
  rackUnit(18, 28, url('dk')) +
  rjPorts(9, 22, 7, 5.2) +
  rjPorts(9, 34, 7, 5.2) +
  leds(9 + 2, 30.5, 7, 5.2) +
  scPorts(47, 22, 1, 8) +
  scPorts(47, 34, 1, 8);

const router =
  line('M14 26 10 7', '#334155', 3) +
  line('M50 26 54 7', '#334155', 3) +
  rect(4, 25, 56, 25, url('dk'), 4) +
  rect(4, 25, 56, 2, '#ffffff33', 1) +
  rjPorts(10, 37, 6, 5.8) +
  leds(11, 31, 6, 5.8) +
  rect(47, 30, 8, 13, '#94a3b8', 1) +
  rect(49, 33, 4, 7, INK);

const firewall =
  rackUnit(14, 36, url('dk')) +
  rect(9, 19, 34, 26, url('pv'), 1.5) +
  line('M9 27.7H43M9 36.3H43M20 19V27.7M32 19V27.7M14 27.7V36.3M26 27.7V36.3M38 27.7V36.3M20 36.3V45M32 36.3V45', '#7c2d12', 1.3) +
  leds(50, 23, 1, 0) +
  leds(50, 30, 1, 0, AMBER) +
  rect(47, 36, 8, 8, INK, 1);

const transmitter =
  rackUnit(16, 32, url('dk')) +
  rect(9, 21, 26, 14, '#052e16', 1.5) +
  line('M12 31 16 26l4 3 4-5 4 4 4-3', '#4ade80', 1.6) +
  leds(11, 41, 4, 5) +
  scPorts(39, 21, 2, 8.5, '#16a34a') +
  scPorts(39, 33, 2, 8.5, '#16a34a');

const headendRack =
  rect(10, 3, 44, 58, url('ir'), 3) +
  times(4, (i) => {
    const y = 8 + i * 13;
    return rect(14, y, 36, 10.5, i % 2 ? url('st') : url('dk'), 1.5) + rect(17, y + 3, 14, 4.5, '#052e16') + leds(36, y + 5.2, 3, 4.5);
  });

const cabinet = (body: string, doubleDoor: boolean, rails: boolean) =>
  rect(9, 55, 46, 6, '#57534e', 1) +
  rect(11, 8, 42, 48, body, 2.5) +
  rect(8, 4, 48, 6, '#475569', 2) +
  rect(8, 4, 48, 1.6, '#ffffff44', 1) +
  (doubleDoor ? rect(31.4, 10, 1.2, 46, '#1e293b') : '') +
  times(4, (i) => rect(15, 13 + i * 3, 12, 1.4, '#1e293b99') + (doubleDoor ? rect(37, 13 + i * 3, 12, 1.4, '#1e293b99') : '')) +
  (doubleDoor
    ? rect(26, 30, 3, 9, '#e2e8f0', 1) + rect(35, 30, 3, 9, '#e2e8f0', 1)
    : rect(46, 28, 3.4, 11, '#e2e8f0', 1)) +
  (rails ? rect(15, 42, 26, 9, '#ffffffd0', 1) + rect(18, 45, 20, 1.4, '#334155') + rect(18, 48, 13, 1.4, '#334155') : '');

const terminalShell = (body: string) =>
  rect(15, 6, 34, 52, body, 5) +
  rect(15, 6, 34, 2.2, '#ffffff66', 2) +
  rect(19, 12, 26, 22, '#ffffff70', 2) +
  shape('M33 15 26 25h5l-1.5 7 8-11h-5.5z', '#1d4ed8') +
  rect(15, 37, 34, 1.3, '#47556999') +
  rect(29, 35, 6, 5, '#475569', 1) +
  scPorts(19, 43, 4, 6.8) +
  times(4, (i) => rect(20.2 + i * 6.8, 50, 3.4, 8, FIBERS[i], 1));

const terminalBox = terminalShell(url('wh'));
const fiberTerminal = terminalShell(url('st'));

const poleBox =
  rect(8, 0, 11, 64, url('cn')) +
  rect(5, 16, 17, 3, '#334155', 1) +
  rect(5, 44, 17, 3, '#334155', 1) +
  rect(21, 9, 35, 45, url('wh'), 4) +
  rect(21, 9, 35, 2, '#ffffff', 2) +
  shape('M40 14 33 25h5l-2 8 9-12h-6z', '#1d4ed8') +
  scPorts(25, 38, 4, 7) +
  times(4, (i) => rect(26.2 + i * 7, 45, 3.6, 14, FIBERS[i], 1));

const wallBox =
  rect(0, 0, 64, 64, '#b9674a') +
  line('M0 13H64M0 26H64M0 39H64M0 52H64M16 0V13M48 0V13M32 13V26M0 13M16 26V39M48 26V39M32 39V52M16 52V64M48 52V64', '#e7d3c5', 1.4) +
  rect(13, 8, 38, 48, url('wh'), 4) +
  rect(13, 8, 38, 2, '#ffffff', 2) +
  shape('M33 14 26 25h5l-2 8 9-12h-6z', '#1d4ed8') +
  scPorts(18, 40, 4, 7.2) +
  rect(19, 49, 26, 3, '#94a3b8', 1);

const undergroundBox =
  rect(0, 22, 64, 42, '#8a6a4a') +
  dot(9, 35, 1.6, '#6d5238') +
  dot(55, 42, 2, '#6d5238') +
  dot(12, 56, 2, '#6d5238') +
  dot(53, 58, 1.5, '#6d5238') +
  rect(0, 19, 64, 5, '#5f7f4b') +
  rect(14, 13, 36, 44, url('dk'), 3) +
  rect(10, 10, 44, 7, url('st'), 2) +
  scPorts(19, 24, 4, 6.8) +
  times(4, (i) => rect(20.2 + i * 6.8, 31, 3.4, 22, FIBERS[i], 1));

const distributionPoint =
  line('M32 38 12 58M32 38 24 60M32 38 40 60M32 38 52 58', '#1f2937', 2.2) +
  rect(12, 8, 40, 32, url('wh'), 6) +
  rect(12, 8, 40, 2.2, '#ffffff', 2) +
  rect(12, 24, 40, 1.3, '#64748b') +
  dot(32, 16.5, 4, url('bl')) +
  leds(20, 32, 4, 8);

const plcSplitter =
  line('M2 32H17', AMBER, 3) +
  times(8, (i) => line(`M44 ${15 + i * 4.9}C50 ${15 + i * 4.9} 54 ${6 + i * 7.4} 62 ${6 + i * 7.4}`, FIBERS[i], 2.2)) +
  rect(15, 11, 31, 42, url('dk'), 3) +
  rect(15, 11, 31, 2, '#ffffff33', 1) +
  rect(19, 22, 23, 20, url('st'), 1.5) +
  line('M22 32H27C31 32 31 26 37 26M27 32C31 32 31 38 37 38M27 32H37', '#1d4ed8', 1.6);

const outdoorSplitter =
  line('M2 18H13', AMBER, 3.5) +
  times(4, (i) => line(`M51 ${17 + i * 10}H62`, FIBERS[i], 3)) +
  rect(10, 8, 42, 48, url('gy'), 5) +
  rect(10, 8, 42, 2.4, '#ffffff66', 2) +
  times(4, (i) => dot(14.5, 13 + i * 12.8, 1.4, '#334155') + dot(47.5, 13 + i * 12.8, 1.4, '#334155')) +
  rect(19, 15, 24, 34, url('dk'), 2) +
  line('M23 32H29C33 32 33 22 39 22M29 32C33 32 33 42 39 42M29 32H39', '#7dd3fc', 2);

const coupler =
  line('M2 32H20', AMBER, 3.5) +
  line('M44 27C50 27 53 16 62 16', '#2563eb', 3.5) +
  line('M44 37C50 37 53 48 62 48', '#dc2626', 2) +
  rect(16, 22, 32, 20, url('st'), 10) +
  rect(16, 24, 32, 4, '#ffffff99', 2) +
  rect(23, 22, 2, 20, '#64748b') +
  rect(39, 22, 2, 20, '#64748b');

const connector =
  line('M2 32H18', AMBER, 5) +
  rect(14, 26, 12, 12, '#1f2937', 2) +
  rect(24, 19, 21, 26, url('bl'), 2) +
  rect(24, 19, 21, 3, '#ffffff55', 1) +
  rect(28, 26, 13, 12, '#1e3a8a', 1) +
  rect(45, 27, 8, 10, '#e2e8f0', 1) +
  rect(53, 29.5, 9, 5, '#f8fafc', 1.5) +
  rect(53, 30, 9, 1.2, '#94a3b8');

const spliceJoint =
  line('M2 32H22', '#2563eb', 3) +
  line('M42 32H62', '#16a34a', 3) +
  rect(16, 22, 32, 20, url('st'), 4) +
  rect(16, 24.5, 32, 3, '#ffffffaa', 1) +
  rect(14, 21, 7, 22, '#334155', 1.5) +
  rect(43, 21, 7, 22, '#334155', 1.5) +
  rect(26, 31, 12, 2.4, '#f97316', 1);

const attenuator =
  line('M2 32H14', AMBER, 4) +
  line('M50 32H62', AMBER, 4) +
  rect(10, 26, 8, 12, '#1f2937', 1.5) +
  rect(46, 26, 8, 12, '#1f2937', 1.5) +
  rect(16, 19, 32, 26, url('st'), 3) +
  rect(16, 21, 32, 3, '#ffffffaa', 1) +
  rect(23, 28, 18, 10, INK, 1) +
  line('M26 35.5H30L32 30.5 34 35.5H38', '#fbbf24', 1.5);

const domeClosure =
  shape('M14 25C14 9 22 3 32 3s18 6 18 22v20H14z', url('dk')) +
  shape('M19 25C19 13 23 7 28 5c-3 4-5 10-5 20v20h-4z', '#ffffff24') +
  rect(10, 44, 44, 7, url('gy'), 2) +
  times(5, (i) => dot(15 + i * 8.5, 47.5, 1.3, '#1e293b')) +
  rect(15, 51, 34, 5, '#334155', 1) +
  rect(20, 56, 5, 8, '#111827', 1) +
  rect(30, 56, 5, 8, '#111827', 1) +
  rect(40, 56, 5, 8, '#111827', 1);

const inlineClosure =
  rect(0, 28, 11, 8, '#111827', 2) +
  rect(53, 28, 11, 8, '#111827', 2) +
  rect(8, 15, 48, 34, url('dk'), 11) +
  rect(14, 18, 36, 3, '#ffffff30', 1.5) +
  rect(8, 30.5, 48, 3, url('gy')) +
  times(5, (i) => dot(16 + i * 8, 32, 1.2, '#1e293b')) +
  rect(4, 26, 7, 12, '#475569', 1.5) +
  rect(53, 26, 7, 12, '#475569', 1.5);

const telecomPole =
  line('M0 19C18 25 46 25 64 19', '#1f2937', 1.6) +
  line('M0 26C18 31 46 31 64 26', '#2563eb', 1.6) +
  rect(27.5, 3, 9, 61, url('wd')) +
  line('M30 12V60M34 8V48', '#4a2d17', 0.6) +
  rect(23, 22, 18, 5, '#475569', 1) +
  rect(23, 29, 18, 3, '#475569', 1) +
  rect(23, 43, 18, 12, url('st'), 1.5) +
  rect(25.5, 46, 13, 2, '#64748b') +
  rect(25.5, 50, 13, 2, '#64748b');

const electricPole =
  line('M8 11C22 15 42 15 56 11', '#334155', 1.2) +
  line('M8 11 2 13M56 11 62 13', '#334155', 1.2) +
  rect(28, 3, 8, 61, url('cn')) +
  rect(8, 16, 48, 4.5, '#475569', 1) +
  times(3, (i) => rect(9.5 + i * 20.5, 8, 4, 8, '#7c3a1d', 1) + rect(8.2 + i * 20.5, 10, 6.6, 1.6, '#a8552c') + rect(8.2 + i * 20.5, 13, 6.6, 1.6, '#a8552c')) +
  rect(19, 30, 26, 22, url('gy'), 3) +
  rect(19, 30, 26, 2, '#ffffff77', 1) +
  times(3, (i) => rect(22 + i * 7.5, 26, 3.5, 4, '#7c3a1d', 1)) +
  shape('M33 35 27 43h4l-1 6 7-9h-4z', '#facc15');

const manhole =
  dot(32, 32, 30, url('cn')) +
  dot(32, 32, 25, url('ir')) +
  dot(32, 32, 25, 'none') +
  times(5, (i) => rect(13, 18.5 + i * 6, 38, 3, '#8b95a2', 1.5)) +
  dot(14, 32, 2.2, '#111827') +
  dot(50, 32, 2.2, '#111827');

const handhole =
  rect(4, 8, 56, 48, url('cn'), 3) +
  rect(10, 14, 44, 36, url('ir'), 2) +
  times(5, (i) => rect(14, 18.5 + i * 6, 36, 3, '#8b95a2', 1.5)) +
  rect(27, 11, 10, 4, '#111827', 1);

const chamber =
  rect(0, 12, 64, 52, '#8a6a4a') +
  rect(0, 8, 64, 6, '#5f7f4b') +
  rect(7, 16, 50, 45, url('cn'), 2) +
  rect(13, 21, 38, 34, '#1f2937', 1) +
  rect(4, 10, 56, 6, url('ir'), 1.5) +
  line('M13 33C24 33 26 44 51 44', '#f97316', 3) +
  line('M13 39C24 39 32 50 51 50', '#2563eb', 3) +
  times(4, (i) => rect(18 + i * 8, 24, 3, 25, '#ffffff14'));

const duct =
  rect(0, 12, 64, 40, url('st'), 3) +
  dot(32, 32, 18, '#f97316') +
  dot(32, 32, 14, '#1f2937') +
  dot(12, 32, 7, '#f97316') +
  dot(12, 32, 4.5, '#1f2937') +
  dot(52, 32, 7, '#f97316') +
  dot(52, 32, 4.5, '#1f2937') +
  dot(27, 28, 3.5, '#2563eb') +
  dot(37, 28, 3.5, '#16a34a') +
  dot(32, 37, 3.5, '#f97316');

const microduct =
  dot(32, 32, 29, '#1f2937') +
  dot(32, 32, 25.5, '#e2e8f0') +
  [
    [32, 32, 2],
    [32, 17, 0],
    [45, 24.5, 1],
    [45, 39.5, 3],
    [32, 47, 6],
    [19, 39.5, 4],
    [19, 24.5, 7],
  ]
    .map(([x, y, i]) => dot(x, y, 7, FIBERS[i]) + dot(x, y, 3.6, INK))
    .join('');

const cableTray =
  shape('M4 22 18 14H60L46 22z', '#cbd5e1') +
  line('M10 20 53 16M8 19 51 19', FIBERS[0], 1.6) +
  line('M10 21 52 18', FIBERS[1], 1.6) +
  rect(4, 22, 42, 26, url('st'), 1) +
  shape('M46 22 60 14V40L46 48z', '#8996a6') +
  times(5, (i) => rect(9 + i * 7.3, 27, 4.5, 16, '#475569', 0.8)) +
  times(2, (i) => shape(`M${50 + i * 5} ${24 - i * 3}l2.5-1.4v16l-2.5 1.4z`, '#334155'));

const buildingEntry =
  rect(11, 8, 42, 53, '#b8c2cf', 2) +
  rect(11, 8, 42, 53, url('gy'), 2) +
  rect(8, 4, 48, 6, '#475569', 1) +
  times(3, (r) => times(4, (c) => rect(15.5 + c * 8.7, 15 + r * 11, 6, 7, '#bfdbfe', 0.8))) +
  rect(26, 48, 12, 13, '#334155', 1) +
  line('M0 55H24', '#f97316', 3.5) +
  dot(24, 55, 4.5, '#1d4ed8') +
  dot(24, 55, 2, '#e2e8f0');

const junctionPoint =
  line('M32 32 7 11M32 32 57 11M32 32 7 53M32 32 57 53', '#475569', 4) +
  line('M32 32 7 11', FIBERS[0], 2) +
  line('M32 32 57 11', FIBERS[1], 2) +
  line('M32 32 7 53', FIBERS[2], 2) +
  line('M32 32 57 53', FIBERS[6], 2) +
  dot(32, 32, 16, url('dk')) +
  dot(32, 32, 11.5, url('st')) +
  dot(32, 32, 4.5, '#1d4ed8');

const slackLoop =
  `<ellipse cx="32" cy="33" rx="24" ry="18" fill="none" stroke="#111827" stroke-width="6"/>` +
  `<ellipse cx="32" cy="29" rx="24" ry="18" fill="none" stroke="#334155" stroke-width="6"/>` +
  `<ellipse cx="32" cy="25" rx="24" ry="18" fill="none" stroke="#475569" stroke-width="6"/>` +
  rect(5, 21, 5, 16, '#f59e0b', 1) +
  rect(54, 21, 5, 16, '#f59e0b', 1) +
  line('M32 43V62', '#1f2937', 4);

const homeDevice = (fiber: boolean) =>
  (fiber ? line('M50 45C58 45 56 57 62 60', AMBER, 3) : '') +
  rect(6, 16, 52, 32, url('wh'), 5) +
  rect(6, 16, 52, 2.4, '#ffffff', 2) +
  rect(6, 40, 52, 8, '#cbd5e1', 3) +
  leds(14, 27, 4, 6.5) +
  dot(40, 27, 1.4, AMBER) +
  rect(44, 22, 9, 10, url('bl'), 2) +
  dot(48.5, 27, 2, '#e2e8f0') +
  (fiber ? rect(46, 41, 7, 5, SC_BLUE, 1) : rect(12, 42, 28, 2, '#94a3b8', 1));

const wifiRouter =
  rect(9, 7, 3.6, 26, '#1f2937', 1.8) +
  rect(51.4, 7, 3.6, 26, '#1f2937', 1.8) +
  line('M23 16C28 11 36 11 41 16', '#2563eb', 2.6) +
  line('M27.5 21C30 18.5 34 18.5 36.5 21', '#2563eb', 2.6) +
  dot(32, 25, 2, '#2563eb') +
  rect(4, 31, 56, 21, url('wh'), 5) +
  rect(4, 31, 56, 2, '#ffffff', 2) +
  rect(4, 46, 56, 6, '#cbd5e1', 3) +
  leds(14, 39, 6, 7.2);

const modem =
  rect(16, 5, 32, 54, url('wh'), 5) +
  rect(16, 5, 32, 2.2, '#ffffff', 2) +
  rect(19, 53, 26, 6, '#cbd5e1', 2) +
  times(5, (i) => dot(32, 14 + i * 6.2, 1.5, i === 4 ? AMBER : LED)) +
  rect(24, 44, 16, 5, url('bl'), 1);

const customerTerminal =
  shape('M32 5 3 30h8v29h42V30h8z', url('wh')) +
  shape('M32 5 3 30h8L32 12l21 18h8z', '#b45309') +
  rect(26, 40, 12, 19, '#475569', 1) +
  rect(15, 34, 9, 9, '#93c5fd', 1) +
  rect(40, 34, 9, 9, '#93c5fd', 1) +
  line('M61 38H52', '#f97316', 3) +
  dot(50, 38, 3.5, SC_BLUE);

const setTopBox =
  rect(9, 8, 46, 28, INK, 2.5) +
  rect(12, 11, 40, 22, '#1d4ed8', 1) +
  shape('M12 33V24L24 16 36 25 44 19 52 26V33z', '#60a5fa') +
  rect(28, 36, 8, 4, '#334155') +
  rect(4, 42, 56, 15, url('dk'), 3) +
  rect(4, 42, 56, 1.8, '#ffffff33', 1) +
  rect(10, 47, 15, 5, '#052e16', 1) +
  leds(44, 49.5, 3, 4.5);

const opticalInstrument =
  rect(11, 3, 42, 58, url('pv'), 6) +
  rect(16, 9, 32, 25, '#052e16', 2) +
  line('M19 28 25 18 31 22 37 15 45 27', '#4ade80', 2) +
  times(6, (i) => rect(18 + (i % 3) * 10.3, 39 + Math.floor(i / 3) * 7, 7.5, 5, '#1e293b', 1)) +
  rect(26, 0, 12, 5, SC_BLUE, 1);

const dish =
  line('M36 37 44 61H24L32 37', '#475569', 3.5) +
  shape('M6 12C6 34 26 48 52 40z', url('st')) +
  shape('M6 12C8 25 18 36 33 40l19 0z', '#94a3b8') +
  line('M6 12 52 40', '#64748b', 1.6) +
  line('M27 27 46 13', '#334155', 2.5) +
  rect(43, 8, 8, 8, url('dk'), 1.5) +
  rect(17, 59, 34, 4, '#334155', 1);

const opticalNode =
  rect(20, 0, 3, 14, '#111827') +
  rect(41, 0, 3, 14, '#111827') +
  rect(7, 10, 50, 44, url('gy'), 5) +
  rect(7, 10, 50, 2.4, '#ffffff77', 2) +
  rect(14, 18, 36, 20, url('dk'), 2) +
  leds(20, 24, 4, 8) +
  line('M18 33H46', AMBER, 2.4) +
  times(5, (i) => rect(14 + i * 8, 42, 4, 8, '#1e293b99', 1)) +
  rect(10, 54, 7, 9, url('st'), 1) +
  rect(47, 54, 7, 9, url('st'), 1);

const rfAmplifier =
  rect(0, 28, 8, 8, url('st'), 1) +
  rect(56, 28, 8, 8, url('st'), 1) +
  rect(7, 13, 50, 38, url('gy'), 4) +
  times(9, (i) => rect(11 + i * 5, 16, 2.4, 32, '#47556988', 1)) +
  rect(22, 24, 20, 16, url('dk'), 2) +
  shape('M27 27V37L37 32z', '#4ade80');

const tapOff =
  rect(11, 7, 42, 50, url('st'), 4) +
  rect(11, 7, 42, 2.4, '#ffffff', 2) +
  times(4, (i) => dot(15.5 + (i % 2) * 33, i < 2 ? 12 : 52, 1.5, '#475569')) +
  rect(26, 57, 12, 7, '#e2e8f0') +
  rect(26, 0, 12, 7, '#e2e8f0') +
  times(4, (i) => {
    const x = 23 + (i % 2) * 18;
    const y = 24 + Math.floor(i / 2) * 15;
    return dot(x, y, 6, '#d97706') + dot(x, y, 3.4, '#fde68a') + dot(x, y, 1.2, INK);
  });

const ART: Record<EquipmentType, string> = {
  OLT: olt,
  ODF: patchPanel,
  'Fiber Patch Panel': patchPanel,
  'Core Switch': coreSwitch,
  Router: router,
  'MikroTik Router': router,
  Firewall: firewall,
  'Optical Transmitter': transmitter,
  'Headend Equipment': headendRack,
  FDMS: cabinet(url('gn'), true, true),
  FDT: cabinet(url('gn'), false, true),
  FAT: terminalBox,
  'Fiber Distribution Cabinet': cabinet(url('gy'), true, false),
  'Fiber Terminal Box': fiberTerminal,
  'Pole-Mounted Terminal Box': poleBox,
  'Wall-Mounted Terminal Box': wallBox,
  'Underground Terminal Box': undergroundBox,
  'Fiber Splitter': plcSplitter,
  'Ratio Coupler': coupler,
  'Outdoor Splitter': outdoorSplitter,
  'Fiber Connector': connector,
  'Fiber Splice Joint': spliceJoint,
  'Optical Attenuator': attenuator,
  'Fiber Joint Closure': domeClosure,
  'Splice Closure': inlineClosure,
  'Distribution Point': distributionPoint,
  'Telecom Pole': telecomPole,
  'Electric Pole': electricPole,
  Manhole: manhole,
  Handhole: handhole,
  'Underground Chamber': chamber,
  Duct: duct,
  Microduct: microduct,
  'Cable Tray': cableTray,
  'Building Entry Point': buildingEntry,
  'Junction Point': junctionPoint,
  'Fiber Slack Loop': slackLoop,
  ONT: homeDevice(true),
  ONU: homeDevice(false),
  'Wi-Fi Router': wifiRouter,
  'Optical Modem': modem,
  'Customer Terminal': customerTerminal,
  'Set-Top Box': setTopBox,
  'Optical Instrument': opticalInstrument,
  'Cable TV Headend': dish,
  'CATV Optical Node': opticalNode,
  'CATV RF Amplifier': rfAmplifier,
  'CATV Tap-Off Box': tapOff,
};

/** Complete SVG markup for an equipment type. Unknown custom types get a generic device. */
export function equipmentSvg(type: string | null | undefined): string {
  const art = (type && ART[type as EquipmentType]) || terminalBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${DEFS}${art}</svg>`;
}

const urlCache = new Map<string, string>();

/** The illustration as a data URL, usable as an image source anywhere. */
export function equipmentArtUrl(type: string | null | undefined): string {
  const key = type ?? '';
  let dataUrl = urlCache.get(key);
  if (!dataUrl) {
    dataUrl = `data:image/svg+xml,${encodeURIComponent(equipmentSvg(type))}`;
    urlCache.set(key, dataUrl);
  }
  return dataUrl;
}

/** The equipment types that have their own illustration. */
export const ILLUSTRATED_TYPES = Object.keys(ART) as EquipmentType[];
