import * as THREE from 'three';

import type { RackItem, SceneOdf, SceneOlt, SceneRack, SceneSwitch } from '../../scene/types';
import { type Kit, markPick } from '../kit';

/**
 * The central-office rack and what is in it, modelled in the reference prototype's units and then
 * scaled to metres (`RACK_SCALE`), so a 12.4-unit rack is a 2 m, 42U rack.
 */
export const RACK_SCALE = 0.16;

export interface RackAnchors {
  /** `${oltId}/${ponPortId}` → the front of the plug in that PON port. */
  ponPorts: Map<string, THREE.Object3D>;
  /** OLT id → its control card's SFP+ uplink cage. */
  oltUplinks: Map<string, THREE.Object3D>;
  /** Switch id → its first SFP+ cage. */
  switchUplinks: Map<string, THREE.Object3D>;
  /** Where cables leave the rack top. */
  top: THREE.Object3D;
  /** Equipment id → the object to look at. */
  items: Map<string, THREE.Object3D>;
}

type Plug = 'sc' | 'lc' | 'cap' | 'empty';

function mats(kit: Kit) {
  return {
    metal: kit.tex('brushed', 0xa4adb7, 0.95, 0.28),
    dark: kit.std(0x050607, 0, 0.95),
    chassis: kit.std(0x2c343c, 0.75, 0.38),
    face: kit.tex('brushed', 0x262d34, 0.6, 0.42),
    faceplate: kit.tex('brushed', 0x46515c, 0.75, 0.33),
    gold: kit.std(0xd4af37, 1, 0.25),
    green: kit.std(0x22a84a, 0.1, 0.45),
    boot: kit.std(0x1b1b1b, 0, 0.7),
    aqua: kit.std(0x10b5c4, 0.1, 0.4),
    cap: kit.std(0x2a5fd0, 0, 0.8),
    rack: kit.std(0x14181c, 0.8, 0.4),
  };
}

/** An SFP cage with what is plugged into it. Returns the z of the plug's front. */
function sfp(kit: Kit, p: THREE.Object3D, x: number, y: number, zf: number, plug: Plug, w = 0.44, h = 0.28): number {
  const m = mats(kit);
  const k = w / 0.44;
  kit.box(p, w, h, 0.3, m.metal, x, y, zf - 0.09);
  kit.box(p, w * 0.82, h * 0.71, 0.01, m.dark, x, y, zf + 0.062);
  if (plug === 'sc') {
    kit.box(p, w * 0.45, h * 0.64, 0.32, m.green, x, y, zf + 0.2);
    kit.cyl(p, 0.045 * k, 0.4, m.boot, x, y, zf + 0.52);
    return zf + 0.72;
  }
  if (plug === 'lc') {
    kit.box(p, w * 0.77, h * 0.64, 0.3, m.aqua, x, y, zf + 0.2);
    for (const o of [-0.08, 0.08]) kit.cyl(p, 0.035 * k, 0.35, m.aqua, x + o * k, y, zf + 0.5);
    return zf + 0.68;
  }
  if (plug === 'cap') kit.box(p, w * 0.68, h * 0.54, 0.07, m.cap, x, y, zf + 0.09);
  return zf + 0.1;
}

function anchor(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const a = new THREE.Object3D();
  a.position.set(x, y, z);
  parent.add(a);
  return a;
}

export const OLT_HEIGHT = 2.4;

export function buildOlt(kit: Kit, parent: THREE.Object3D, olt: SceneOlt, uplinked: boolean, anchors: RackAnchors) {
  const m = mats(kit);
  const g = new THREE.Group();
  g.name = `olt:${olt.equipmentId}`;
  parent.add(g);
  markPick(g, { kind: 'equipment', id: olt.equipmentId });
  anchors.items.set(olt.equipmentId, g);
  kit.box(g, 5.4, 2.4, 3.6, m.chassis);
  kit.box(g, 5.8, 2.4, 0.06, m.faceplate, 0, 0, 1.8);
  for (const x of [-2.75, 2.75]) {
    kit.box(g, 0.08, 0.7, 0.25, m.metal, x - 0.1 * Math.sign(x), 0, 1.95);
    for (const y of [0.85, -0.85]) kit.cyl(g, 0.06, 0.04, m.metal, x, y, 1.84);
  }
  const zf = 1.89;
  const zoneLeft = -2.6;
  const zoneWidth = 2.9;
  const cards = Math.max(1, olt.cards);
  const ppc = Math.max(1, olt.portsPerCard);
  const pitch = Math.min(0.7, zoneWidth / cards);
  const cw = pitch - 0.08;
  const cols = ppc > 8 ? 2 : 1;
  const rows = Math.ceil(ppc / cols);
  const cellH = 2.0 / rows;
  const cageH = Math.min(0.28, cellH * 0.72);
  const cageW = Math.min(0.44, (cw * 0.78) / cols);
  for (let c = 0; c < cards; c += 1) {
    const x = zoneLeft + pitch / 2 + c * pitch;
    kit.box(g, cw, 2.3, 0.06, m.face, x, 0, 1.86);
    for (let k = 0; k < ppc; k += 1) {
      const port = olt.ports[c * ppc + k];
      if (!port) continue;
      const col = cols > 1 ? k % 2 : 0;
      const row = cols > 1 ? Math.floor(k / 2) : k;
      const px = x + (cols > 1 ? (col - 0.5) * cageW * 1.18 : 0.04);
      const py = 1.0 - cellH / 2 - row * cellH + 0.02;
      const plug: Plug = port.state === 'in_use' || port.state === 'fault' ? 'sc' : 'cap';
      const front = sfp(kit, g, px, py, zf, plug, cageW, cageH);
      kit.led(g, px - cageW / 2 - 0.04, py + cageH * 0.35, zf + 0.07, port.led, 0.045);
      anchors.ponPorts.set(`${olt.equipmentId}/${port.id}`, anchor(g, px, py, front));
    }
    kit.plate(g, `${olt.technology} ${c + 1}`, Math.min(0.5, cw * 0.95), 0.1, x, -1.06, zf + 0.01);
    // Card ejector levers and captive screws top and bottom.
    for (const y of [1.08, -1.08]) {
      kit.box(g, cw * 0.5, 0.06, 0.05, m.dark, x, y, zf + 0.02);
      kit.cyl(g, 0.035, 0.05, m.metal, x + cw * 0.38, y, zf + 0.02);
    }
  }
  // Name strip along the top of the chassis.
  kit.plate(g, olt.name.slice(0, 18), 1.3, 0.13, -1.9, 1.13, 1.84, '#e6edf3');
  [0.65, 1.35].forEach((x, i) => {
    kit.box(g, 0.62, 2.3, 0.06, kit.std(0x232b33, 0.6, 0.45), x, 0, 1.86);
    const front = sfp(kit, g, x, 0.75, zf, i === 0 && uplinked ? 'lc' : 'empty');
    if (i === 0) anchors.oltUplinks.set(olt.equipmentId, anchor(g, x, 0.75, front));
    sfp(kit, g, x, 0.2, zf, 'empty');
    kit.box(g, 0.3, 0.22, 0.1, m.metal, x, -0.4, zf);
    kit.box(g, 0.24, 0.14, 0.01, m.dark, x, -0.4, zf + 0.055);
    kit.box(g, 0.16, 0.015, 0.008, m.gold, x, -0.44, zf + 0.06);
    kit.led(g, x - 0.2, -0.8, zf + 0.04, 'steady');
    kit.led(g, x, -0.8, zf + 0.04, olt.status === 'Faulty' ? 'red' : olt.status === 'Warning' ? 'amber' : 'blink');
    kit.led(g, x + 0.2, -0.8, zf + 0.04, 'blink');
    kit.plate(g, i ? 'CTRL B' : 'CTRL A', 0.5, 0.1, x, -1.05, zf + 0.01);
  });
  kit.box(g, 0.9, 2.3, 0.06, m.face, 2.2, 0, 1.86);
  [0.6, -0.6].forEach((y, i) => {
    kit.cyl(g, 0.4, 0.02, m.dark, 2.2, y, 1.89);
    const ring = new THREE.Mesh(kit.torusGeo(0.42, 0.03), m.metal);
    ring.position.set(2.2, y, 1.9);
    g.add(ring);
    for (const r of [0.28, 0.15]) {
      const q = new THREE.Mesh(kit.torusGeo(r, 0.012, 6, 32), m.metal);
      q.position.set(2.2, y, 1.9);
      g.add(q);
    }
    for (let k = 0; k < 4; k += 1)
      kit.box(g, 0.84, 0.014, 0.014, m.metal, 2.2, y, 1.9).rotation.set(0, 0, (k * Math.PI) / 4);
    const fan = new THREE.Group();
    fan.position.set(2.2, y, 1.84);
    for (let k = 0; k < 7; k += 1) {
      const a = (k / 7) * Math.PI * 2;
      const blade = kit.box(
        fan,
        0.26,
        0.07,
        0.012,
        kit.std(0x222222, 0.2, 0.5),
        Math.cos(a) * 0.2,
        Math.sin(a) * 0.2,
        0,
      );
      blade.rotation.set(0.5, 0, a);
    }
    kit.cyl(fan, 0.07, 0.05, m.metal, 0, 0, 0);
    g.add(fan);
    kit.spinners.push({ object: fan, speed: i ? -14 : 14 });
  });
  return g;
}

export const SWITCH_HEIGHT = 0.8;

export function buildSwitch(
  kit: Kit,
  parent: THREE.Object3D,
  sw: SceneSwitch,
  managerDy: number | null,
  anchors: RackAnchors,
) {
  const m = mats(kit);
  const g = new THREE.Group();
  g.name = `switch:${sw.equipmentId}`;
  parent.add(g);
  markPick(g, { kind: 'equipment', id: sw.equipmentId });
  anchors.items.set(sw.equipmentId, g);
  kit.box(g, 5.4, 0.8, 3.2, m.chassis, 0, 0, 0.2);
  kit.box(g, 5.8, 0.8, 0.06, m.faceplate, 0, 0, 1.8);
  kit.box(g, 5.4, 0.76, 0.04, m.face, 0, 0, 1.82);
  for (const x of [-2.75, 2.75]) kit.cyl(g, 0.06, 0.04, m.metal, x, 0, 1.84);
  const sz = 1.84;
  const perRow = Math.max(1, Math.ceil(sw.ports.length / 2));
  const spacing = Math.min(0.3, 3.5 / perRow);
  const pw = spacing * 0.87;
  const cat6 = kit.std(0x1f5fff, 0, 0.5);
  sw.ports.forEach((port, idx) => {
    const r = idx < perRow ? 0 : 1;
    const i = idx % perRow;
    const x = -2.35 + i * spacing;
    const y = r ? -0.2 : 0.2;
    kit.box(g, pw, 0.18, 0.12, m.metal, x, y, sz - 0.03);
    kit.box(g, pw * 0.77, 0.12, 0.01, m.dark, x, y, sz + 0.031);
    kit.box(g, pw * 0.62, 0.015, 0.008, m.gold, x, y - 0.04, sz + 0.037);
    kit.led(g, x - pw * 0.3, y + 0.075, sz + 0.04, port.led, 0.04);
    kit.led(g, x + pw * 0.3, y + 0.075, sz + 0.04, port.inUse ? 'amber' : 'off', 0.04);
    if (port.inUse) {
      kit.box(g, pw * 0.77, 0.14, 0.22, kit.std(0xd8dde2, 0, 0.3), x, y, sz + 0.13);
      kit.box(g, pw * 0.85, 0.16, 0.18, cat6, x, y, sz + 0.3);
      const down = managerDy ?? -0.9;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, y, sz + 0.5),
        new THREE.Vector3(x, y, sz + 0.75),
        new THREE.Vector3(x - 0.08, y - 0.35, sz + 0.95),
        new THREE.Vector3(x - 0.08, down, sz + 0.95),
      ]);
      const tube = new THREE.Mesh(kit.own(new THREE.TubeGeometry(curve, 24, 0.035, 6)), cat6);
      tube.castShadow = true;
      g.add(tube);
    }
  });
  const sfpX = Math.min(2.25, -2.35 + perRow * spacing + 0.5);
  const cages: [number, number][] = [
    [sfpX, 0.2],
    [sfpX + 0.5, 0.2],
    [sfpX, -0.2],
    [sfpX + 0.5, -0.2],
  ];
  cages.slice(0, Math.min(4, sw.sfpUplinks)).forEach(([x, y], i) => {
    const front = sfp(kit, g, x, y, sz, i === 0 && sw.uplinkTo ? 'lc' : 'empty', 0.36, 0.22);
    if (i === 0) anchors.switchUplinks.set(sw.equipmentId, anchor(g, x, y, front));
  });
  kit.led(g, sfpX - 0.5, 0.2, sz + 0.03, 'steady');
  kit.led(g, sfpX - 0.5, 0, sz + 0.03, 'blink');
  kit.led(g, sfpX - 0.5, -0.2, sz + 0.03, sw.uplinkTo ? 'blink' : 'off');
  kit.plate(g, 'SFP+ 1-4', 0.8, 0.1, sfpX + 0.25, 0, sz + 0.01);
  return g;
}

export function buildOdf(kit: Kit, parent: THREE.Object3D, odf: SceneOdf, height: number, anchors: RackAnchors) {
  const m = mats(kit);
  const g = new THREE.Group();
  g.name = `odf:${odf.equipmentId}`;
  parent.add(g);
  markPick(g, { kind: 'equipment', id: odf.equipmentId });
  anchors.items.set(odf.equipmentId, g);
  kit.box(g, 5.4, height, 2.4, kit.std(0x3a434c, 0.6, 0.45), 0, 0, 0.6);
  kit.box(g, 5.8, height, 0.06, m.faceplate, 0, 0, 1.8);
  const perRow = 24;
  const rows = Math.max(1, Math.ceil(odf.ports.length / perRow));
  const rowH = height / rows;
  odf.ports.forEach((p, idx) => {
    const r = Math.floor(idx / perRow);
    const i = idx % perRow;
    const x = -2.3 + i * 0.19;
    const y = height / 2 - rowH / 2 - r * rowH;
    kit.box(g, 0.14, Math.min(0.16, rowH * 0.6), 0.08, kit.std(0x22a84a, 0.1, 0.5), x, y, 1.86);
    if (p.inUse) kit.box(g, 0.1, Math.min(0.12, rowH * 0.45), 0.22, kit.std(0xf2c500, 0.1, 0.5), x, y, 1.98);
    else kit.box(g, 0.11, Math.min(0.12, rowH * 0.45), 0.04, m.cap, x, y, 1.92);
  });
  kit.plate(g, odf.name.slice(0, 24), 1.2, 0.14, 2.2, 0, 1.84);
  return g;
}

export function buildGeneric(
  kit: Kit,
  parent: THREE.Object3D,
  id: string,
  name: string,
  height: number,
  anchors: RackAnchors,
) {
  const m = mats(kit);
  const g = new THREE.Group();
  parent.add(g);
  markPick(g, { kind: 'equipment', id });
  anchors.items.set(id, g);
  kit.box(g, 5.4, height, 3.0, m.chassis, 0, 0, 0.3);
  kit.box(g, 5.8, height, 0.06, m.faceplate, 0, 0, 1.8);
  kit.plate(g, name.slice(0, 28), 2.6, 0.18, -0.9, 0, 1.84);
  kit.led(g, 2.1, 0.1, 1.86, 'steady');
  kit.led(g, 2.3, 0.1, 1.86, 'blink');
  return g;
}

const itemHeight = (item: RackItem) =>
  item.kind === 'olt'
    ? OLT_HEIGHT
    : item.kind === 'switch'
      ? SWITCH_HEIGHT
      : item.kind === 'odf'
        ? item.odf.ports.length > 24
          ? 1.6
          : 0.8
        : Math.max(0.8, Math.min(2.4, item.heightU * 0.4));

/**
 * One rack with its items stacked from the top, a cable manager under the OLTs when there is a
 * switch, the power shelf at the bottom and blank panels in the gaps. Returns the anchors the
 * engine needs to run patch cords and uplinks.
 */
export function buildRack(kit: Kit, rack: SceneRack): { group: THREE.Group; anchors: RackAnchors; height: number } {
  const m = mats(kit);
  const anchors: RackAnchors = {
    ponPorts: new Map(),
    oltUplinks: new Map(),
    switchUplinks: new Map(),
    items: new Map(),
    top: new THREE.Object3D(),
  };
  const group = new THREE.Group();
  group.name = `rack:${rack.id}`;
  const hasSwitch = rack.items.some((i) => i.kind === 'switch');
  const needed = rack.items.reduce((s, i) => s + itemHeight(i) + 0.12, 0) + (hasSwitch ? 0.9 : 0) + 3.4;
  const H = Math.max(12.4, needed + 0.4);
  for (const [x, z] of [
    [-3, -2.1],
    [3, -2.1],
    [-3, 2.1],
    [3, 2.1],
  ])
    kit.box(group, 0.2, H, 0.2, m.rack, x, H / 2, z);
  kit.box(group, 6.4, 0.15, 4.6, m.rack, 0, H, 0);
  kit.box(group, 6.4, 0.15, 4.6, m.rack, 0, 0.1, 0);
  for (const x of [-3.1, 3.1])
    kit.box(group, 0.04, H - 0.4, 4.2, kit.std(0x9fb4c8, 0.2, 0.1, { opacity: 0.1 }), x, H / 2, 0, false);
  // 19-inch mounting rails with their square cage-nut holes, front and back.
  const rail = kit.tex('rail', 0xb8bfc6, 0.85, 0.35);
  for (const z of [1.72, -1.6]) for (const x of [-2.9, 2.9]) kit.box(group, 0.22, H - 0.3, 0.06, rail, x, H / 2, z);
  // Levelling feet and the top cable entry brush.
  for (const [x, z] of [
    [-2.8, -1.9],
    [2.8, -1.9],
    [-2.8, 1.9],
    [2.8, 1.9],
  ])
    kit.cyl(group, 0.14, 0.12, m.dark, x, -0.02, z).rotation.x = 0;
  kit.box(group, 1.6, 0.06, 0.5, kit.std(0x0c0c0c, 0, 0.95), -2.0, H + 0.1, 1.2);

  const uplinked = new Set(rack.items.flatMap((i) => (i.kind === 'switch' && i.sw.uplinkTo ? [i.sw.uplinkTo] : [])));
  let cursor = H - 0.35;
  let managerY: number | null = null;
  const placed: { item: RackItem; y: number }[] = [];
  rack.items.forEach((item, idx) => {
    const h = itemHeight(item);
    const y = cursor - h / 2;
    placed.push({ item, y });
    cursor -= h + 0.12;
    const next = rack.items[idx + 1];
    if (hasSwitch && managerY === null && item.kind !== 'switch' && next?.kind === 'switch') {
      managerY = cursor - 0.39;
      cursor -= 0.9;
    }
  });
  if (hasSwitch && managerY === null) {
    managerY = cursor - 0.39;
    cursor -= 0.9;
  }
  for (const { item, y } of placed) {
    const holder = new THREE.Group();
    holder.position.y = y;
    group.add(holder);
    if (item.kind === 'olt') buildOlt(kit, holder, item.olt, uplinked.has(item.olt.equipmentId), anchors);
    else if (item.kind === 'switch')
      buildSwitch(kit, holder, item.sw, managerY !== null ? managerY - y : null, anchors);
    else if (item.kind === 'odf') buildOdf(kit, holder, item.odf, itemHeight(item), anchors);
    else buildGeneric(kit, holder, item.equipmentId, item.name, itemHeight(item), anchors);
  }
  if (managerY !== null) {
    kit.box(group, 5.8, 0.78, 0.5, kit.std(0x1a1f24, 0.5, 0.6), 0, managerY, 1.6);
    for (let i = 0; i < 14; i += 1) kit.box(group, 0.18, 0.5, 0.1, m.dark, -2.5 + i * 0.4, managerY, 1.86);
  }
  // Power shelf and blank panels: rack furniture, drawn as typical and not on record.
  kit.box(group, 5.6, 2.4, 3.4, kit.std(0x23292f, 0.6, 0.5), 0, 1.4, 0);
  kit.box(group, 5.8, 2.4, 0.06, m.face, 0, 1.4, 1.75);
  kit.plate(group, 'UPS / RECTIFIER 48V', 3, 0.3, -0.8, 1.9, 1.79);
  kit.box(
    group,
    1.2,
    0.4,
    0.02,
    kit.std(0x0a2a1f, 0, 0.2, { emissive: 0x1fbf7a, emissiveIntensity: 0.6 }),
    1.8,
    1.4,
    1.79,
  );
  const blank = kit.tex('vent', 0x2a2f34, 0.4, 0.7);
  for (let y = 3.4; y + 0.39 < cursor; y += 0.8) {
    kit.box(group, 5.8, 0.78, 0.04, blank, 0, y, 1.82);
    for (const x of [-2.75, 2.75]) kit.cyl(group, 0.05, 0.02, m.metal, x, y, 1.85);
  }
  anchors.top.position.set(-2.4, H + 0.2, 1.4);
  group.add(anchors.top);
  group.scale.setScalar(RACK_SCALE);
  group.position.set(rack.position.x, 0.02, rack.position.z);
  return { group, anchors, height: H * RACK_SCALE };
}
