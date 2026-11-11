import * as THREE from 'three';

import { portColorCode } from '../../scene/models';
import type { Kit } from '../kit';

/**
 * Open-box models of each splitter stage and a cutaway room inside one house. They stand in a
 * "model gallery" beside the network (not at a map position), drawn in the prototype's units and
 * scaled to metres.
 */

export const GALLERY_SCALE = 0.4;
const HOME_SCALE = 0.55;
const YELLOW = 0xf2c500;

function tube(kit: Kit, parent: THREE.Object3D, pts: [number, number, number][], color: number, r = 0.022) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(kit.own(new THREE.TubeGeometry(curve, 40, r, 6)), kit.std(color, 0, 0.35));
  m.castShadow = true;
  parent.add(m);
  return m;
}

export interface StageSpec {
  ratio: string;
  title: string;
}

/** One open splitter box: input pigtail, splice tray with a coil, PLC module, output adapters, drops. */
export function splitterBox(kit: Kit, parent: THREE.Object3D, n: number, x: number, z: number): number {
  const w = n > 4 ? Math.min(9, 0.55 * n + 0.2) : 2.8;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  const steel = kit.std(0x8b949c, 0.9, 0.35);
  const side = kit.std(0x7d8791, 0.6, 0.45);
  kit.box(g, 0.3, 1, 0.3, steel, 0, 0.5, -0.3);
  kit.box(g, w, 3, 0.1, kit.std(0x4f575f, 0.5, 0.55), 0, 2.5, -0.5);
  for (const s of [-1, 1]) kit.box(g, 0.1, 3, 1, side, (s * w) / 2, 2.5, 0);
  kit.box(g, w, 0.1, 1, side, 0, 4, 0);
  kit.box(g, w, 0.1, 1, side, 0, 1, 0);
  kit.box(g, w * 0.8, 0.8, 0.04, kit.std(0xdfe3e6, 0.2, 0.5), 0, 3.4, -0.42);
  const coil = new THREE.Mesh(kit.torusGeo(0.28, 0.02, 8, 24), kit.std(YELLOW, 0, 0.4));
  coil.position.set(-w * 0.2, 3.4, -0.39);
  g.add(coil);
  kit.plate(g, 'splice tray', 0.8, 0.12, w * 0.18, 3.4, -0.39, '#445');
  kit.box(g, 1.2, 0.5, 0.16, kit.std(0x2f6fa8, 0.2, 0.4), 0, 2.55, -0.3);
  kit.plate(g, `1:${n} PLC splitter`, 1.1, 0.2, 0, 2.55, -0.215, '#fff');
  const ix = -w / 2 + 0.4;
  kit.box(g, 0.14, 0.16, 0.22, kit.std(YELLOW, 0.1, 0.5), ix, 1.6, -0.2);
  kit.plate(g, 'IN', 0.2, 0.1, ix, 1.4, -0.08, '#fff');
  tube(
    kit,
    g,
    [
      [ix, 1.7, -0.3],
      [ix, 2.4, -0.38],
      [-w * 0.2 - 0.28, 3.4, -0.38],
    ],
    YELLOW,
  );
  tube(
    kit,
    g,
    [
      [-w * 0.2 + 0.28, 3.4, -0.38],
      [-0.4, 3, -0.34],
      [-0.35, 2.8, -0.3],
    ],
    YELLOW,
  );
  for (let i = 0; i < n; i += 1) {
    const ax = -w / 2 + 1 + (i * (w - 1.4)) / Math.max(1, n - 1);
    const px = -0.5 + i * (1 / Math.max(1, n - 1));
    const c = new THREE.Color(portColorCode(i + 1).hex).getHex();
    kit.box(g, 0.14, 0.16, 0.22, kit.std(0x22a84a, 0.1, 0.5), ax, 1.6, -0.2);
    kit.plate(g, `${i + 1}`, 0.14, 0.1, ax, 1.4, -0.08, '#fff');
    tube(
      kit,
      g,
      [
        [px, 2.3, -0.3],
        [px, 2, -0.28],
        [ax, 1.85, -0.22],
        [ax, 1.7, -0.2],
      ],
      c,
    );
    tube(
      kit,
      g,
      [
        [ax, 1.5, -0.15],
        [ax, 1.2, 0.2],
        [ax, 0.9, 0.5],
        [ax, 0.1, 0.9],
      ],
      c,
      0.03,
    );
  }
  return w;
}

/** The stage boxes side by side. Returns the world positions of each title. */
export function buildStages(kit: Kit, parent: THREE.Group, stages: readonly StageSpec[]) {
  const titles: { text: string; at: THREE.Vector3 }[] = [];
  let x = 0;
  stages.forEach((s) => {
    const n = Number(s.ratio.split(':')[1]) || 2;
    const w = n > 4 ? Math.min(9, 0.55 * n + 0.2) : 2.8;
    const cx = x + w / 2;
    splitterBox(kit, parent, n, cx, 0);
    titles.push({ text: s.title, at: new THREE.Vector3(cx, 4.8, 0) });
    x += w + 2.2;
  });
  return { titles, width: x };
}

export interface HomeSpec {
  dropColor: number;
  dropText: string;
  /** Label words in the person's language. */
  words: { home: string; atb: string; patch: string; ont: string; router: string; tv: string };
}

/**
 * The inside of one house: aerial drop → eave clamp → wall box (ATB) with SC/APC → yellow patch
 * cord → ONT (PON port, 4 LAN, LEDs) → LAN cables → Wi-Fi router → TV. In prototype units.
 */
export function insideHouse(kit: Kit, parent: THREE.Group, spec: HomeSpec) {
  const g = new THREE.Group();
  parent.add(g);
  const wall = kit.std(0xf1ebe0, 0, 0.95);
  const wood = kit.std(0x6b4a2f, 0, 0.6);
  const steel = kit.std(0x8b949c, 0.9, 0.35);
  const dark = kit.std(0x050607, 0, 0.95);
  kit.box(g, 7.6, 0.2, 4.6, kit.std(0x8a6d4b, 0, 0.7), 0, 0.1, 0);
  kit.box(g, 7.2, 3.4, 0.15, wall, 0, 1.9, -2);
  kit.box(g, 0.15, 3.4, 4, wall, -3.6, 1.9, 0);
  kit.box(g, 0.15, 3.4, 4, wall, 3.6, 1.9, 0);
  kit.box(g, 7.6, 0.1, 4.6, kit.std(0xe8e0d0, 0, 0.9, { opacity: 0.15 }), 0, 3.65, 0, false);
  tube(
    kit,
    g,
    [
      [-9, 5.4, 0.3],
      [-6, 4.3, 0.3],
      [-3.9, 3.4, 0.3],
      [-3.85, 2.6, 0.3],
      [-3.6, 2.2, 0.3],
      [-3.4, 2, 0.3],
      [-3.42, 1.6, 0.3],
    ],
    spec.dropColor,
    0.035,
  );
  kit.box(g, 0.2, 0.14, 0.2, steel, -3.85, 3.4, 0.3);
  kit.box(g, 0.12, 0.3, 0.4, kit.std(0xffffff, 0, 0.4), -3.45, 1.4, 0.3);
  kit.box(g, 0.1, 0.08, 0.1, kit.std(0x22a84a, 0.1, 0.5), -3.38, 1.3, 0.3);
  kit.box(g, 2.8, 0.08, 1.1, wood, -0.8, 1, 0.3);
  for (const [a, c] of [
    [-2, -0.15],
    [0.4, -0.15],
    [-2, 0.75],
    [0.4, 0.75],
  ])
    kit.box(g, 0.08, 0.96, 0.08, wood, a, 0.5, c);
  kit.box(g, 0.95, 0.22, 0.6, kit.std(0xf4f4f4, 0.1, 0.3), -1.7, 1.15, 0.3);
  kit.box(g, 0.1, 0.1, 0.02, kit.std(0x22a84a, 0.1, 0.5), -2.05, 1.12, 0.61);
  for (let i = 0; i < 4; i += 1) {
    kit.box(g, 0.09, 0.08, 0.02, dark, -1.8 + i * 0.12, 1.12, 0.61);
    kit.led(g, -2 + i * 0.14, 1.23, 0.61, i < 2 ? 'steady' : 'blink');
  }
  tube(
    kit,
    g,
    [
      [-3.38, 1.3, 0.3],
      [-3.1, 1.1, 0.5],
      [-2.6, 1.08, 0.85],
      [-2.05, 1.12, 0.68],
    ],
    YELLOW,
    0.025,
  );
  kit.box(g, 0.8, 0.12, 0.5, kit.std(0x1a1d21, 0.3, 0.4), 0.7, 1.1, 0.3);
  for (const o of [-0.3, 0.3]) kit.box(g, 0.03, 0.55, 0.03, dark, 0.7 + o, 1.4, 0.1);
  kit.led(g, 0.45, 1.12, 0.56, 'blink');
  tube(
    kit,
    g,
    [
      [-1.8, 1.12, 0.65],
      [-1.4, 0.95, 1],
      [-0.1, 0.98, 0.9],
      [0.3, 1.08, 0.58],
    ],
    0x1f5fff,
    0.02,
  );
  kit.box(g, 2.4, 1.3, 0.08, dark, 1.9, 2.2, -1.9);
  kit.box(
    g,
    2.3,
    1.2,
    0.02,
    kit.std(0x103a6a, 0, 0.2, { emissive: 0x2a6fd0, emissiveIntensity: 0.8 }),
    1.9,
    2.2,
    -1.84,
  );
  tube(
    kit,
    g,
    [
      [0.9, 1.1, 0.3],
      [1.4, 1, -0.9],
      [1.6, 1.6, -1.8],
    ],
    0x1f5fff,
    0.02,
  );
  return {
    labels: [
      { text: spec.words.home, at: new THREE.Vector3(0, 4.7, 0), s: 0.8 },
      { text: spec.dropText, at: new THREE.Vector3(-6.2, 5.2, 0.3), s: 0.65 },
      { text: spec.words.atb, at: new THREE.Vector3(-3, 2.7, 0.3), s: 0.55 },
      { text: spec.words.patch, at: new THREE.Vector3(-2.7, 0.45, 1.3), s: 0.5 },
      { text: spec.words.ont, at: new THREE.Vector3(-1.7, 1.8, 0.3), s: 0.55 },
      { text: spec.words.router, at: new THREE.Vector3(0.7, 1.95, 0.3), s: 0.5 },
      { text: spec.words.tv, at: new THREE.Vector3(1.9, 3.4, -1.9), s: 0.5 },
    ],
  };
}

export { HOME_SCALE };
