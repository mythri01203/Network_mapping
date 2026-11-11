import * as THREE from 'three';

import type { SceneBox, ScenePole, SceneSpan } from '../../scene/types';
import { type Kit, markPick } from '../kit';

/** Outside plant in metres: poles, crossarms, power lines, the messenger strand, and every box. */

export const STRAND_RATIO = 0.66;

export interface PlantAnchors {
  /** Box id → where its cables attach. */
  boxes: Map<string, THREE.Vector3>;
  /** `${boxId}#${port}` → the bottom of that port, where a drop leaves. */
  ports: Map<string, THREE.Vector3>;
  /** Box id → the object to look at. */
  objects: Map<string, THREE.Object3D>;
}

const wood = (kit: Kit) => kit.tex('wood', 0x7a5a3a, 0, 0.92);
const steel = (kit: Kit) => kit.tex('brushed', 0x9aa3ab, 0.9, 0.35);
const galv = (kit: Kit) => kit.std(0xb4bcc2, 0.85, 0.45);

/** A wire hanging between two points with a sag in the middle. */
export function wire(
  kit: Kit,
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  mat: THREE.Material,
  r = 0.02,
) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  const geo = kit.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 16, r, 5));
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const INSULATOR_OFFSETS = [-0.85, 0, 0.85];
const UP = new THREE.Vector3(0, 1, 0);

export function buildPoles(kit: Kit, parent: THREE.Object3D, poles: readonly ScenePole[], spans: readonly SceneSpan[]) {
  const armDir = new Map<string, THREE.Vector3>();
  for (const s of spans) {
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    const along = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const across = new THREE.Vector3(-along.z, 0, along.x);
    if (!armDir.has(s.fromId)) armDir.set(s.fromId, across.clone());
    if (!armDir.has(s.toId)) armDir.set(s.toId, across.clone());
  }
  const insulatorTops = new Map<string, THREE.Vector3[]>();
  const strandAt = new Map<string, THREE.Vector3>();
  const insMat = kit.std(0x8a5a3c, 0.1, 0.18);
  for (const p of poles) {
    const g = new THREE.Group();
    g.position.set(p.position.x, 0, p.position.z);
    parent.add(g);
    markPick(g, { kind: 'equipment', id: p.id });
    // Tapered wooden pole set in a concrete collar, with a weather cap.
    const shaft = new THREE.Mesh(kit.cylGeo(0.11, 0.17, p.height, 12), wood(kit));
    shaft.position.y = p.height / 2;
    shaft.castShadow = true;
    g.add(shaft);
    const collar = new THREE.Mesh(kit.cylGeo(0.27, 0.32, 0.16, 10), kit.tex('concrete', 0xa3a19b, 0, 0.95));
    collar.position.y = 0.06;
    collar.receiveShadow = true;
    g.add(collar);
    const cap = new THREE.Mesh(kit.cylGeo(0.02, 0.125, 0.08, 8), galv(kit));
    cap.position.y = p.height + 0.04;
    g.add(cap);
    // Ground-line band (darker, where the pole is treated).
    const band = new THREE.Mesh(kit.cylGeo(0.172, 0.176, 0.5, 10), kit.std(0x2e241b, 0, 0.95));
    band.position.y = 0.4;
    g.add(band);
    const dir = armDir.get(p.id) ?? new THREE.Vector3(1, 0, 0);
    const yaw = Math.atan2(dir.x, dir.z);
    // Pole number plate, on the side across the line of the spans.
    const plate = kit.box(g, 0.14, 0.2, 0.01, kit.std(0xdfe4e8, 0.7, 0.35), dir.x * 0.16, 2.2, dir.z * 0.16);
    plate.rotation.y = yaw;
    // Step bolts for climbing, alternating sides.
    const along = new THREE.Vector3(dir.z, 0, -dir.x);
    const strandY = p.height * STRAND_RATIO;
    for (let k = 0; k < 6; k += 1) {
      const y = 2.6 + k * 0.45;
      if (y > strandY - 0.4) break;
      const sgn = k % 2 ? 1 : -1;
      const r = 0.17 - (y / p.height) * 0.06;
      const step = new THREE.Mesh(kit.cylGeo(0.012, 0.012, 0.22, 6), galv(kit));
      step.quaternion.setFromUnitVectors(UP, along);
      step.position.set(along.x * sgn * (r + 0.09), y, along.z * sgn * (r + 0.09));
      g.add(step);
    }
    strandAt.set(p.id, new THREE.Vector3(p.position.x, strandY, p.position.z));
    // Suspension clamp on every pole: bracket, through-bolt with nuts.
    const rS = 0.17 - STRAND_RATIO * 0.06;
    const bracket = kit.box(g, 0.06, 0.16, rS * 2 + 0.12, steel(kit), 0, strandY, 0);
    bracket.rotation.y = yaw;
    const bolt = kit.box(g, 0.024, 0.024, rS * 2 + 0.24, galv(kit), 0, strandY + 0.05, 0);
    bolt.rotation.y = yaw;
    for (const sgn of [-1, 1]) {
      const nut = kit.box(
        g,
        0.045,
        0.045,
        0.03,
        galv(kit),
        dir.x * sgn * (rS + 0.12),
        strandY + 0.05,
        dir.z * sgn * (rS + 0.12),
      );
      nut.rotation.y = yaw;
    }
    if (p.kind === 'electric') {
      const armY = p.height - 0.3;
      const arm = kit.box(g, 0.1, 0.12, 2.2, wood(kit), 0, armY, 0);
      arm.rotation.y = yaw;
      // Two diagonal braces from the pole up to the crossarm.
      for (const sgn of [-1, 1]) {
        // From the pole 0.7 m below the arm out to 0.6 m along it.
        const axis = new THREE.Vector3(dir.x * sgn * 0.6, 0.68, dir.z * sgn * 0.6);
        const brace = kit.box(
          g,
          0.03,
          axis.length(),
          0.04,
          galv(kit),
          dir.x * sgn * 0.3,
          armY - 0.36,
          dir.z * sgn * 0.3,
        );
        brace.quaternion.setFromUnitVectors(UP, axis.normalize());
      }
      const tops: THREE.Vector3[] = [];
      for (const o of INSULATOR_OFFSETS) {
        const pin = new THREE.Mesh(kit.cylGeo(0.015, 0.015, 0.12, 6), galv(kit));
        pin.position.set(dir.x * o, armY + 0.1, dir.z * o);
        g.add(pin);
        // Porcelain pin insulator with its sheds.
        const ins = new THREE.Mesh(kit.cylGeo(0.035, 0.06, 0.22, 12), insMat);
        ins.position.set(dir.x * o, armY + 0.25, dir.z * o);
        g.add(ins);
        for (const [dy, r] of [
          [0.17, 0.085],
          [0.27, 0.07],
        ] as const) {
          const shed = new THREE.Mesh(kit.cylGeo(r * 0.7, r, 0.025, 10), insMat);
          shed.position.set(dir.x * o, armY + dy, dir.z * o);
          g.add(shed);
        }
        tops.push(new THREE.Vector3(p.position.x + dir.x * o, armY + 0.37, p.position.z + dir.z * o));
      }
      insulatorTops.set(p.id, tops);
    }
  }
  const wireMat = kit.std(0x101010, 0.2, 0.6);
  const strandMat = kit.std(0x8b949c, 0.9, 0.35);
  for (const s of spans) {
    const a = strandAt.get(s.fromId);
    const b = strandAt.get(s.toId);
    if (a && b) wire(kit, parent, a, b, Math.min(0.6, a.distanceTo(b) * 0.008), strandMat, 0.012);
    if (!s.power) continue;
    const ta = insulatorTops.get(s.fromId);
    const tb = insulatorTops.get(s.toId);
    if (ta && tb)
      for (let i = 0; i < 3; i += 1)
        wire(kit, parent, ta[i], tb[i], Math.min(0.9, ta[i].distanceTo(tb[i]) * 0.012), wireMat, 0.014);
  }
  return { strandAt };
}

/** Height a box hangs or sits at, for the mount it has. */
export function boxHeight(box: SceneBox, aerialY: number): number {
  switch (box.mount) {
    case 'strand':
      return aerialY - 0.55;
    case 'pole':
      return aerialY - 1.15;
    case 'wall':
      return 1.6;
    case 'ground':
      return 0;
    case 'underground':
      return 0;
  }
}

const PORT_STATE_MAT: Record<string, number> = { used: 0x22a84a, free: 0x2a5fd0, fault: 0xffb000, reserved: 0x8b5cf6 };

function portRow(
  kit: Kit,
  g: THREE.Group,
  box: SceneBox,
  width: number,
  y: number,
  z: number,
  anchors: PlantAnchors,
  world: THREE.Vector3,
) {
  const n = box.ports.length;
  if (!n) return;
  const spacing = Math.min(0.11, (width - 0.1) / n);
  box.ports.forEach((p, i) => {
    const x = -((n - 1) * spacing) / 2 + i * spacing;
    // SC/APC adapter: a square housing with a coloured dust shutter, and on a used port a
    // plugged connector with its boot where the drop cable starts.
    const a = Math.min(0.07, spacing * 0.8);
    kit.box(g, a, 0.05, a, kit.std(0x2b2f33, 0.2, 0.6), x, y + 0.01, z);
    kit.box(g, a * 0.7, 0.012, a * 0.7, kit.std(PORT_STATE_MAT[p.state] ?? 0x2a5fd0, 0.1, 0.45), x, y - 0.018, z);
    if (p.state === 'used') {
      const conn = new THREE.Mesh(kit.cylGeo(a * 0.32, a * 0.32, 0.05, 8), kit.std(0x22a84a, 0.1, 0.45));
      conn.position.set(x, y - 0.04, z);
      g.add(conn);
      const boot = new THREE.Mesh(kit.cylGeo(a * 0.18, a * 0.26, 0.05, 8), kit.std(0x1b1b1b, 0, 0.7));
      boot.position.set(x, y - 0.085, z);
      g.add(boot);
    }
    // Port number printed above the adapter, facing out of the box.
    const label = kit.numberLabel(p.number, Math.min(0.08, spacing * 0.9));
    if (label) {
      label.position.set(x, y + 0.085, z + 0.14);
      g.add(label);
    }
    anchors.ports.set(`${box.id}#${p.number}`, new THREE.Vector3(world.x + x, world.y + y - 0.06, world.z + z));
  });
}

function closureModel(kit: Kit, g: THREE.Group, box: SceneBox) {
  const m = kit.tex('plastic', box.status === 'Faulty' ? 0x5a2424 : 0x2a3036, 0.2, 0.5);
  const body = new THREE.Mesh(kit.cylGeo(0.22, 0.22, 0.75, 20), m);
  body.castShadow = true;
  g.add(body);
  for (const s of [1, -1]) {
    const d = new THREE.Mesh(kit.sphereGeo(0.22, 20, 10, Math.PI * 2, Math.PI / 2), m);
    d.position.y = 0.375 * s;
    if (s < 0) d.rotation.x = Math.PI;
    g.add(d);
  }
  const ring = new THREE.Mesh(kit.torusGeo(0.225, 0.02, 6, 24), steel(kit));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  g.add(ring);
  // Hanger to the strand.
  kit.box(g, 0.04, 0.3, 0.04, steel(kit), 0, 0.62, 0);
  kit.box(g, 0.16, 0.03, 0.06, steel(kit), 0, 0.76, 0);
  // Base clamp and the cable ports at the bottom (big for the trunk, small for branches).
  const clamp = new THREE.Mesh(kit.torusGeo(0.225, 0.028, 6, 24), steel(kit));
  clamp.rotation.x = Math.PI / 2;
  clamp.position.y = -0.3;
  g.add(clamp);
  const portMat = kit.std(0x111315, 0, 0.75);
  for (const [x, z, r] of [
    [0, 0, 0.05],
    [0.12, 0.05, 0.03],
    [-0.12, 0.05, 0.03],
    [0.05, -0.12, 0.025],
    [-0.05, -0.12, 0.025],
  ]) {
    const port = new THREE.Mesh(kit.cylGeo(r, r, 0.12, 10), portMat);
    port.position.set(x, -0.6, z);
    g.add(port);
  }
  const ratio = box.splitters[0]?.ratio;
  kit.plate(g, ratio ? `${ratio}` : box.type.slice(0, 10), 0.34, 0.13, 0, 0, 0.23, '#9fd4ff');
}

function fatModel(kit: Kit, g: THREE.Group, box: SceneBox, anchors: PlantAnchors, world: THREE.Vector3) {
  const w = Math.max(0.6, Math.min(1.4, 0.12 * box.ports.length + 0.12));
  const faulty = box.status === 'Faulty';
  const body = kit.tex('plastic', faulty ? 0xb46a6a : 0xdfe2e4, 0.05, 0.55);
  const trim = kit.tex('plastic', faulty ? 0x8a4a4a : 0xc4c9cc, 0.05, 0.5);
  // Base and hinged front cover (a little bigger, with a seam), and a rain lip on top.
  kit.box(g, w, 0.42, 0.17, body, 0, 0, -0.05);
  kit.box(g, w + 0.02, 0.44, 0.1, trim, 0, 0, 0.085);
  kit.box(g, w + 0.06, 0.03, 0.3, trim, 0, 0.235, 0.01);
  kit.box(g, w + 0.03, 0.006, 0.006, kit.std(0x55595d, 0, 0.8), 0, 0.2, 0.136);
  // Hinges on the left, two latches on the right.
  const dark = kit.std(0x3d4246, 0.3, 0.6);
  for (const y of [0.13, -0.13]) {
    const hinge = new THREE.Mesh(kit.cylGeo(0.014, 0.014, 0.07, 8), dark);
    hinge.position.set(-w / 2 - 0.012, y, 0.12);
    g.add(hinge);
    kit.box(g, 0.03, 0.06, 0.04, dark, w / 2 + 0.012, y, 0.115);
  }
  // Cable glands for the cable coming in and the one going on.
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    const gland = new THREE.Mesh(kit.cylGeo(0.028, 0.032, 0.06, 10), kit.std(0x1a1c1e, 0, 0.7));
    gland.position.set(x, -0.24, -0.06);
    g.add(gland);
  }
  // Mounting plate, two stainless bands round the pole behind.
  kit.box(g, w * 0.7, 0.3, 0.02, steel(kit), 0, 0, -0.145);
  for (const y of [0.11, -0.11]) kit.box(g, 0.34, 0.025, 0.36, steel(kit), 0, y, -0.32);
  portRow(kit, g, box, w, -0.25, 0.03, anchors, world);
  const ratio = box.splitters.map((s) => s.ratio)[0];
  kit.plate(g, ratio ? `FAT ${ratio}` : 'FAT', 0.45, 0.11, 0, 0.1, 0.137, '#1f3a55');
}

function cabinetModel(kit: Kit, g: THREE.Group, box: SceneBox, anchors: PlantAnchors, world: THREE.Vector3) {
  const body = kit.tex('brushed', 0x6f8a74, 0.35, 0.55);
  kit.box(g, 1.0, 1.4, 0.45, body, 0, 0.8, 0);
  kit.box(g, 1.1, 0.1, 0.55, kit.std(0x5b6f5f, 0.3, 0.6), 0, 1.55, 0);
  // Concrete plinth it stands on.
  kit.box(g, 1.25, 0.14, 0.65, kit.tex('concrete', 0x9d9b95, 0, 0.95), 0, 0.06, 0);
  for (const x of [-0.25, 0.25]) kit.box(g, 0.46, 1.25, 0.02, kit.tex('brushed', 0x7f9a84, 0.35, 0.5), x, 0.8, 0.235);
  // Lock handle, hinges and a warning sticker.
  kit.box(g, 0.03, 0.18, 0.04, kit.std(0x1b1d1f, 0.3, 0.5), -0.03, 0.85, 0.26);
  for (const y of [0.4, 1.2]) for (const x of [-0.49, 0.49]) kit.box(g, 0.025, 0.08, 0.03, steel(kit), x, y, 0.24);
  kit.box(g, 0.12, 0.12, 0.004, kit.std(0xf2c200, 0, 0.5), 0.25, 1.05, 0.247);
  for (let i = 0; i < 5; i += 1) kit.box(g, 0.3, 0.02, 0.01, kit.std(0x2a3a2e, 0, 0.9), 0.25, 1.3 - i * 0.05, 0.25);
  kit.box(g, 0.04, 0.14, 0.04, steel(kit), 0.02, 0.85, 0.26);
  kit.plate(g, box.type === 'FDMS' ? 'FDMS' : 'FDH', 0.4, 0.12, -0.25, 1.3, 0.25);
  portRow(kit, g, box, 0.9, 0.45, 0.25, anchors, world);
}

function smallModel(kit: Kit, g: THREE.Group, box: SceneBox) {
  switch (box.model) {
    case 'manhole': {
      const lid = new THREE.Mesh(kit.cylGeo(0.45, 0.45, 0.04, 24), kit.std(0x2a2d31, 0.8, 0.5));
      lid.position.y = 0.02;
      g.add(lid);
      const rim = new THREE.Mesh(kit.torusGeo(0.47, 0.035, 6, 32), kit.std(0x6b6f73, 0.2, 0.8));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.03;
      g.add(rim);
      kit.box(g, 0.3, 0.005, 0.05, kit.std(0x15171a, 0, 0.9), 0, 0.045, 0);
      return;
    }
    case 'slack': {
      for (let i = 0; i < 3; i += 1) {
        const coil = new THREE.Mesh(kit.torusGeo(0.4 - i * 0.03, 0.025, 6, 32), kit.std(0x101010, 0.1, 0.6));
        coil.position.set(0, 0, i * 0.03);
        g.add(coil);
      }
      return;
    }
    case 'ont': {
      kit.box(g, 0.05, 1.2, 0.05, steel(kit), 0, 0.6, 0);
      kit.box(g, 0.22, 0.28, 0.07, kit.std(0xf2f2f2, 0.1, 0.35), 0, 1.3, 0.04);
      kit.led(g, 0.06, 1.38, 0.08, box.status === 'Faulty' ? 'red' : 'blink');
      return;
    }
    case 'catv_node':
    case 'catv_amp':
    case 'catv_tap': {
      const s = box.model === 'catv_node' ? 1 : box.model === 'catv_amp' ? 0.7 : 0.45;
      const al = kit.std(0xb7bcc2, 0.85, 0.35);
      kit.box(g, 0.6 * s, 0.35 * s, 0.3 * s, al);
      for (let i = 0; i < 6; i += 1) kit.box(g, 0.6 * s, 0.02, 0.05 * s, al, 0, -0.15 * s + i * 0.06 * s, 0.17 * s);
      kit.box(g, 0.04, 0.3, 0.04, steel(kit), 0, 0.3 * s, 0);
      return;
    }
    case 'entry': {
      kit.box(g, 0.08, 1.6, 0.08, kit.std(0x9aa4ae, 0.2, 0.6), 0, 0.8 - 1.6, -0.06);
      kit.box(g, 0.3, 0.3, 0.1, kit.std(0xe6e6e6, 0.1, 0.4));
      return;
    }
    case 'marker': {
      kit.box(g, 0.1, 0.8, 0.1, kit.std(0xff7a1a, 0, 0.6), 0, 0.4, 0);
      kit.box(g, 0.14, 0.1, 0.14, kit.std(0xf5f5f5, 0, 0.6), 0, 0.7, 0);
      return;
    }
    default: {
      kit.box(g, 0.5, 0.5, 0.5, kit.std(0x8a929a, 0.3, 0.6), 0, 0.25, 0);
      kit.plate(g, box.type.slice(0, 14), 0.48, 0.1, 0, 0.3, 0.26);
    }
  }
}

export function buildBoxes(
  kit: Kit,
  parent: THREE.Object3D,
  boxes: readonly SceneBox[],
  poles: readonly ScenePole[],
  aerialY: number,
  labels: boolean,
) {
  const anchors: PlantAnchors = { boxes: new Map(), ports: new Map(), objects: new Map() };
  const labelBudget = 400;
  for (const box of boxes) {
    const y = boxHeight(box, aerialY);
    const g = new THREE.Group();
    g.position.set(box.position.x, y, box.position.z);
    parent.add(g);
    markPick(g, { kind: 'equipment', id: box.id });
    anchors.objects.set(box.id, g);
    const world = g.position.clone();
    if (box.model === 'closure') closureModel(kit, g, box);
    else if (box.model === 'fat') {
      fatModel(kit, g, box, anchors, world);
      const nearPole = poles.some((p) => Math.hypot(p.position.x - box.position.x, p.position.z - box.position.z) < 2);
      if (box.mount === 'pole' && !nearPole) {
        // The record says it is on a pole that is not on the map: a plain post holds it up.
        const post = new THREE.Mesh(kit.cylGeo(0.09, 0.12, y + 0.6, 10), wood(kit));
        post.position.set(0, -y / 2 + 0.3, -0.25);
        post.castShadow = true;
        g.add(post);
      }
      if (box.mount === 'underground') g.position.y = 0.25;
    } else if (box.model === 'cabinet') cabinetModel(kit, g, box, anchors, world);
    else {
      smallModel(kit, g, box);
      if ((box.model === 'catv_node' || box.model === 'catv_amp' || box.model === 'catv_tap') && box.mount !== 'strand')
        g.position.y = aerialY - 1.0;
      if (box.model === 'entry') g.position.y = 1.6;
    }
    const attach = g.position.clone();
    if (box.model === 'closure') attach.y -= 0.45;
    if (box.model === 'cabinet') attach.y = 1.0;
    if (box.model === 'manhole') attach.y = 0.05;
    anchors.boxes.set(box.id, attach);
    if (labels && kit.labelCount < labelBudget) {
      const ratio = box.splitters.length ? ` (${box.splitters.map((s) => s.ratio).join(', ')})` : '';
      const tag = kit.tag(
        `${box.name}${ratio}`,
        box.position.x,
        g.position.y + (box.model === 'cabinet' ? 2.2 : 1.3),
        box.position.z,
        0.55,
      );
      // Names stay readable from far away; the engine hides one that would cover another.
      kit.keepReadable(tag, 26);
      if (tag) tag.userData.priority = box.model === 'fat' ? 1 : 2;
    }
  }
  return anchors;
}
