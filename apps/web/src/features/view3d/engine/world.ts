import * as THREE from 'three';

import { type Msg3DKey, t3d } from '../i18n';
import { distance } from '../scene/geoLocal';
import type { CustomerPath, Scene3D } from '../scene/types';
import { batchStatic } from './batch';
import { buildStages, GALLERY_SCALE, HOME_SCALE, insideHouse } from './builders/cutaways';
import { buildBoxes, buildPoles, type PlantAnchors, STRAND_RATIO } from './builders/plant';
import { buildRack, type RackAnchors } from './builders/rack';
import { type FiberInput, FiberLayer } from './fibers';
import { HouseLayer } from './houses';
import { Kit } from './kit';

/**
 * Builds the whole 3D world from a `Scene3D`, with no renderer, so it can be tested without WebGL.
 * The engine adds lights, the camera and the render loop around it.
 */

export { PRESET_KEYS, type PresetKey } from '../scene/presets';
import type { PresetKey } from '../scene/presets';

export interface View {
  target: THREE.Vector3;
  eye: THREE.Vector3;
}

export interface World {
  root: THREE.Group;
  kit: Kit;
  fibers: FiberLayer;
  /** Thin lines and dots that stand in for cables, houses and boxes when the camera is far. */
  far: THREE.Group;
  houses: HouseLayer | null;
  gallery: THREE.Group;
  galleryKit: Kit;
  galleryAt: THREE.Vector3;
  focus: Map<string, { at: THREE.Vector3; size: number }>;
  /** What a click can hit: the pick boxes and the house walls. */
  pickTargets: THREE.Object3D[];
  presets: Record<PresetKey, View | null>;
  aerialY: number;
  counts: {
    racks: number;
    poles: number;
    boxes: number;
    fibers: number;
    houses: number;
    meshes: number;
    staticMeshesMerged: number;
  };
  /** Rebuilds the model gallery for one PON and one customer. */
  rebuildGallery: (ponKey: string | null, customer: CustomerPath | null, labels: boolean) => void;
  dispose: () => void;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Words for labels drawn in the scene, by locale key (see `../i18n.ts`). English by default. */
export type LabelText = (key: Msg3DKey, values?: Record<string, string | number>) => string;
const english: LabelText = (key, values) => t3d('en', key, values);

export function buildWorld(scene: Scene3D, options: { labels: boolean; dark: boolean; text?: LabelText }): World {
  const L = options.text ?? english;
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'world';
  root.add(kit.labels);
  const { center, extent } = scene;
  const focus = new Map<string, { at: THREE.Vector3; size: number }>();

  // Ground
  const groundSize = extent * 2 + 260;
  const ground = new THREE.Mesh(
    kit.planeGeo(groundSize, groundSize),
    kit.std(options.dark ? 0x2a3b25 : 0x7c9a68, 0, 0.95),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, 0, center.z);
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);
  const cells = Math.min(400, Math.round(groundSize / 5));
  const grid = new THREE.GridHelper(
    groundSize,
    cells,
    options.dark ? 0x34462e : 0x8eab79,
    options.dark ? 0x2e3f29 : 0x87a473,
  );
  grid.position.set(center.x, 0.01, center.z);
  grid.name = 'grid';
  kit.own(grid.geometry);
  kit.own(grid.material as THREE.Material);
  root.add(grid);

  // Central office: racks inside a cutaway room.
  const rackAnchors: RackAnchors[] = [];
  const rooms: { x: number; z: number; n: number }[] = [];
  for (const rack of scene.racks) {
    const { group, anchors } = buildRack(kit, rack);
    root.add(group);
    rackAnchors.push(anchors);
    const room = rooms.find((r) => distance(r, rack.position) < 3);
    if (room) room.n += 1;
    else rooms.push({ x: rack.position.x, z: rack.position.z, n: 1 });
  }
  root.updateMatrixWorld(true);
  // The equipment room: a cutaway with the front and right side open so the racks can be seen.
  // Building only (walls, floor, door, light, cable ladder), like the walls of a house.
  const plaster = kit.tex('plaster', 0xd9d4cb, 0, 0.92);
  const outside = kit.tex('plaster', 0xc9b79a, 0, 0.95);
  const steelMat = kit.tex('brushed', 0x9aa3ab, 0.85, 0.4);
  for (const room of rooms) {
    const w = room.n * 0.9 + 2.6;
    const x0 = room.x + ((room.n - 1) * 0.9) / 2;
    const zc = room.z - 0.3;
    const left = x0 - w / 2;
    kit.box(root, w + 0.3, 0.14, 3.9, kit.tex('concrete', 0x9a9a96, 0, 0.95), x0, -0.05, zc);
    kit.box(root, w, 0.02, 3.6, kit.tex('tiles', 0xbfc4c6, 0, 0.6), x0, 0.03, zc).receiveShadow = true;
    // Back wall and left wall: plaster inside, painted render outside.
    kit.box(root, w, 3.0, 0.06, plaster, x0, 1.5, room.z - 2.0);
    kit.box(root, w + 0.15, 3.0, 0.1, outside, x0, 1.5, room.z - 2.1);
    kit.box(root, 0.06, 3.0, 3.6, plaster, left + 0.05, 1.5, zc);
    kit.box(root, 0.1, 3.0, 3.6, outside, left - 0.03, 1.5, zc);
    // Skirting and a parapet on top of the walls.
    kit.box(root, w, 0.1, 0.02, kit.std(0x5a5f63, 0, 0.7), x0, 0.08, room.z - 1.96);
    kit.box(root, w + 0.2, 0.12, 0.2, kit.std(0x8c8a84, 0, 0.9), x0, 3.06, room.z - 2.08);
    kit.box(root, 0.2, 0.12, 3.8, kit.std(0x8c8a84, 0, 0.9), left - 0.02, 3.06, zc);
    // Door in the left wall: frame, steel door, handle.
    kit.box(root, 0.14, 2.2, 1.05, kit.std(0x3b3f44, 0.3, 0.6), left, 1.1, room.z + 0.6);
    kit.box(root, 0.16, 2.06, 0.92, kit.tex('brushed', 0x6d7a86, 0.6, 0.45), left, 1.05, room.z + 0.6);
    kit.box(root, 0.22, 0.03, 0.14, steelMat, left, 1.05, room.z + 0.25);
    // See-through roof, a ceiling light and the overhead cable ladder.
    kit.box(root, w, 0.08, 3.6, kit.std(0xe8e0d0, 0, 0.9, { opacity: 0.12 }), x0, 3.04, zc, false);
    kit.box(
      root,
      1.2,
      0.04,
      0.16,
      kit.std(0xffffff, 0, 0.3, { emissive: 0xfff6e0, emissiveIntensity: 1.2 }),
      x0,
      2.95,
      zc + 0.6,
      false,
    );
    const ladder = kit.std(0x8c949c, 0.8, 0.4);
    for (const dz of [-0.2, 0.2]) kit.box(root, w - 0.2, 0.08, 0.025, ladder, x0, 2.55, room.z - 0.25 + dz);
    for (let x = left + 0.2; x < left + w - 0.1; x += 0.3)
      kit.box(root, 0.025, 0.02, 0.4, ladder, x, 2.52, room.z - 0.25);
    for (const x of [left + 0.3, left + w - 0.3]) kit.box(root, 0.02, 0.45, 0.02, ladder, x, 2.8, room.z - 0.25);
    // Earth bar on the back wall.
    kit.box(root, 0.5, 0.05, 0.02, kit.std(0xb87333, 1, 0.3), left + 0.6, 0.45, room.z - 1.95);
  }
  for (const a of rackAnchors) {
    for (const [id, obj] of a.items) {
      const at = obj.getWorldPosition(new THREE.Vector3());
      focus.set(id, { at, size: 1.2 });
    }
  }
  scene.racks.forEach((r) => {
    if (!options.labels) return;
    for (const item of r.items) {
      const id =
        item.kind === 'olt'
          ? item.olt.equipmentId
          : item.kind === 'switch'
            ? item.sw.equipmentId
            : item.kind === 'odf'
              ? item.odf.equipmentId
              : item.equipmentId;
      const at = focus.get(id)?.at;
      if (!at) continue;
      const name =
        item.kind === 'olt'
          ? L('label.olt', { name: item.olt.name, ports: item.olt.ports.length, tech: item.olt.technology })
          : item.kind === 'switch'
            ? `${item.sw.name}`
            : item.kind === 'odf'
              ? item.odf.name
              : item.name;
      const tag = kit.tag(name, at.x + 1.0, at.y, at.z + 0.4, 0.1);
      // The OLT names stay readable from the overview, so the central offices can be found.
      if (item.kind === 'olt') {
        kit.keepReadable(tag, 46);
        if (tag) tag.userData.priority = 3;
      }
    }
    kit.tag(L('label.ups'), r.position.x + 1.0, 0.25, r.position.z + 0.4, 0.08);
  });

  // Poles, spans, boxes.
  const aerialY = scene.poles.length
    ? (scene.poles.reduce((s, p) => s + p.height, 0) / scene.poles.length) * STRAND_RATIO - 0.12
    : 5.8;
  buildPoles(kit, root, scene.poles, scene.spans);
  // Pole names on a small network (a big one would be a forest of labels).
  if (options.labels && scene.poles.length <= 40)
    for (const p of scene.poles) kit.tag(p.name, p.position.x, p.height + 0.7, p.position.z, 0.4);
  for (const p of scene.poles) focus.set(p.id, { at: v(p.position.x, p.height * 0.6, p.position.z), size: p.height });
  const plant: PlantAnchors = buildBoxes(kit, root, scene.boxes, scene.poles, aerialY, options.labels);
  for (const [id, obj] of plant.objects) focus.set(id, { at: obj.position.clone(), size: 1.5 });

  // Houses
  const houses = scene.houses.length ? new HouseLayer(kit, scene.houses) : null;
  if (houses) {
    root.add(houses.group);
    houses.buildTags(kit, kit.labels);
  }

  // Fibers
  // Real thickness: a 24-fibre aerial cable is about 12 mm across, a drop about 5 mm (drawn a
  // little thicker so it can be seen). From far away thin lines stand in for them (`far` below).
  const k = 1;
  const radius = { feeder: 0.02, branch: 0.015, drop: 0.009, uplink: 0.012, other: 0.015 } as const;
  const ponAnchor = new Map<string, THREE.Vector3>();
  const rackTop = new Map<string, THREE.Vector3>();
  for (const a of rackAnchors) {
    const top = a.top.getWorldPosition(new THREE.Vector3());
    for (const [key, obj] of a.ponPorts) {
      ponAnchor.set(key, obj.getWorldPosition(new THREE.Vector3()));
      rackTop.set(key, top);
    }
  }
  const feederPort = new Map<string, string>();
  for (const r of scene.racks)
    for (const item of r.items)
      if (item.kind === 'olt')
        for (const p of item.olt.ports)
          if (p.feederCableId) feederPort.set(p.feederCableId, `${item.olt.equipmentId}/${p.id}`);
  for (const pon of scene.pons)
    for (const id of scene.cables.filter((c) => c.role === 'feeder' && c.ponKeys.includes(pon.key)).map((c) => c.id))
      if (!feederPort.has(id)) feederPort.set(id, pon.key);
  const houseOf = new Map(scene.customers.map((c) => [c.customerId, c]));

  const inputs: FiberInput[] = [];
  for (const c of scene.cables) {
    const y = c.aerial ? aerialY : 0.06;
    let pts = c.points.map((p) => v(p.x, y, p.z));
    // Cable ends at boxes attach to the box.
    const startBox = c.startId ? plant.boxes.get(c.startId) : undefined;
    const endBox = c.endId ? plant.boxes.get(c.endId) : undefined;
    const path = c.customerId ? houseOf.get(c.customerId) : undefined;
    if (c.role === 'drop' && path?.fatBoxId) {
      const port = path.fatPort ? plant.ports.get(`${path.fatBoxId}#${path.fatPort}`) : undefined;
      const start = port ?? plant.boxes.get(path.fatBoxId);
      if (start) pts[0] = start.clone();
    } else if (startBox) pts[0] = startBox.clone();
    if (endBox) pts[pts.length - 1] = endBox.clone();
    if (c.role === 'drop' && path && houses) {
      const end = houses.dropEnd(path.houseId);
      if (end) {
        pts[pts.length - 1] = end.eave;
        pts.push(end.wallBox);
      }
    }
    // A feeder from a PON port runs up the rack, out of the room and up to the strand.
    const portKey = feederPort.get(c.id);
    const port = portKey ? ponAnchor.get(portKey) : undefined;
    const top = portKey ? rackTop.get(portKey) : undefined;
    if (port && top) {
      // A thin patch cord from the PON port up the rack and out of the room; the cable itself
      // starts at the wall and climbs to the strand.
      const out = top.clone().add(v(0, 0.9, 1.6));
      inputs.push({
        id: `patch:${c.id}`,
        role: c.role,
        level: c.level,
        ponKeys: c.ponKeys,
        points: [
          port.clone(),
          port.clone().add(v(0, 0, 0.12)),
          top.clone().add(v(0, 0, 0.3)),
          top.clone().add(v(0, 0.5, 0.8)),
          out,
        ],
        color: new THREE.Color(c.colorHex).getHex(),
        radius: 0.009,
        pulse: true,
      });
      const next = pts[1];
      const climb =
        c.aerial && next ? [v(out.x + (next.x - out.x) * 0.15, aerialY, out.z + (next.z - out.z) * 0.15)] : [];
      pts = [out.clone(), ...climb, ...pts.slice(1)];
    }
    // Aerial sag between points that are far apart.
    if (c.aerial && c.role !== 'drop') {
      const sagged: THREE.Vector3[] = [pts[0]];
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > 6 && Math.abs(a.y - aerialY) < 0.5 && Math.abs(b.y - aerialY) < 0.5) {
          const mid = a.clone().lerp(b, 0.5);
          mid.y -= Math.min(0.55, d * 0.01);
          sagged.push(mid);
        }
        sagged.push(b);
      }
      pts = sagged;
    }
    if (c.role === 'drop' && pts.length >= 2) {
      const a = pts[0];
      const b = pts[1];
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= Math.min(1.2, a.distanceTo(b) * 0.06);
      pts.splice(1, 0, mid);
    }
    inputs.push({
      id: c.id,
      role: c.role,
      level: c.level,
      ponKeys: c.ponKeys,
      customerId: c.customerId,
      points: pts,
      color: new THREE.Color(c.colorHex).getHex(),
      radius: radius[c.role] * (c.role === 'drop' ? Math.min(k, 2.5) : k),
      pulse: c.role !== 'drop',
      opacity: c.schematic ? 0.55 : 1,
    });
  }
  // OM3 aqua uplink from each switch to the OLT it is recorded as linked to.
  for (const r of scene.racks) {
    for (const item of r.items) {
      if (item.kind !== 'switch' || !item.sw.uplinkTo) continue;
      const a = rackAnchors
        .map((x) => x.switchUplinks.get(item.sw.equipmentId))
        .find(Boolean)
        ?.getWorldPosition(new THREE.Vector3());
      const b = rackAnchors
        .map((x) => x.oltUplinks.get(item.sw.uplinkTo!))
        .find(Boolean)
        ?.getWorldPosition(new THREE.Vector3());
      if (!a || !b) continue;
      const mid = a
        .clone()
        .lerp(b, 0.5)
        .add(v(0, 0, 0.14));
      inputs.push({
        id: `uplink:${item.sw.equipmentId}`,
        role: 'uplink',
        ponKeys: [],
        points: [a, a.clone().add(v(0, 0.03, 0.09)), mid, b.clone().add(v(0, 0, 0.06)), b],
        color: 0x10b5c4,
        radius: 0.008,
        pulse: true,
      });
    }
  }
  const fibers = new FiberLayer(kit, inputs);
  root.add(fibers.group);

  // Far layer: from hundreds of metres up a cable or a house is thinner than a pixel, so every
  // cable is also a thin line and every house, box and office a dot of a fixed size on screen.
  // The engine shows it only when the camera is high. Same records, same places, same colours.
  const far = new THREE.Group();
  far.name = 'far';
  far.visible = false;
  {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const f of inputs) {
      if (f.role === 'uplink' || f.id.startsWith('patch:')) continue;
      c.setHex(f.color);
      for (let i = 1; i < f.points.length; i += 1) {
        const a = f.points[i - 1];
        const b = f.points[i];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    if (pos.length) {
      const g = kit.own(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      far.add(new THREE.LineSegments(g, kit.own(new THREE.LineBasicMaterial({ vertexColors: true }))));
    }
    const dots = (points: { x: number; y: number; z: number }[], color: number, size: number) => {
      if (!points.length) return;
      const g = kit.own(new THREE.BufferGeometry());
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          points.flatMap((p) => [p.x, p.y, p.z]),
          3,
        ),
      );
      far.add(new THREE.Points(g, kit.own(new THREE.PointsMaterial({ color, size, sizeAttenuation: false }))));
    };
    dots(
      scene.houses.map((h) => ({ x: h.position.x, y: 3, z: h.position.z })),
      0xfff2c9,
      4,
    );
    dots(
      scene.poles.map((p) => ({ x: p.position.x, y: p.height, z: p.position.z })),
      0x6b4a2e,
      3,
    );
    dots(
      scene.boxes.filter((b) => b.model === 'fat').map((b) => ({ x: b.position.x, y: 6, z: b.position.z })),
      0x1d9bf0,
      7,
    );
    dots(
      scene.boxes.filter((b) => b.model !== 'fat').map((b) => ({ x: b.position.x, y: 6.5, z: b.position.z })),
      0xff8a1f,
      9,
    );
    dots(
      scene.racks.map((r) => ({ x: r.position.x, y: 4, z: r.position.z })),
      0xe11d48,
      13,
    );
  }
  root.add(far);

  // Model gallery: splitter stages and the inside of a house, beside the network.
  const galleryAt = v(center.x - extent - 30, 0, center.z + 12);
  const gallery = new THREE.Group();
  gallery.name = 'gallery';
  root.add(gallery);
  let galleryKit = new Kit();
  const platform = kit.box(root, 30, 0.1, 9, kit.std(0x3b434c, 0.2, 0.6), galleryAt.x + 4, -0.03, galleryAt.z);
  platform.receiveShadow = true;
  const rebuildGallery = (ponKey: string | null, customer: CustomerPath | null, labels: boolean) => {
    gallery.clear();
    galleryKit.dispose();
    galleryKit = new Kit();
    gallery.add(galleryKit.labels);
    world.galleryKit = galleryKit;
    const pon = scene.pons.find((p) => p.key === ponKey) ?? scene.pons.find((p) => p.levels.length) ?? null;
    const stages = (pon?.levels ?? []).map((l, i, all) => {
      const ratio = l.ratios.reduce((a, b) => (Number(b.split(':')[1]) > Number(a.split(':')[1]) ? b : a));
      return {
        ratio,
        title: L('label.stage', { n: l.level, ratio, fat: i === all.length - 1 ? ' (FAT)' : '', boxes: l.boxes }),
      };
    });
    const stageGroup = new THREE.Group();
    stageGroup.position.copy(galleryAt);
    stageGroup.scale.setScalar(GALLERY_SCALE);
    gallery.add(stageGroup);
    const { titles } = buildStages(galleryKit, stageGroup, stages);
    if (labels)
      for (const t of titles)
        galleryKit.tag(t.text, galleryAt.x + t.at.x * GALLERY_SCALE, t.at.y * GALLERY_SCALE + 0.2, galleryAt.z, 0.45);
    if (labels && !stages.length) galleryKit.tag(L('label.noSplitters'), galleryAt.x + 2, 2, galleryAt.z, 0.5);

    const home = new THREE.Group();
    const homeAt = v(galleryAt.x - 7, 0, galleryAt.z);
    home.position.copy(homeAt);
    home.scale.setScalar(HOME_SCALE);
    gallery.add(home);
    const color = customer
      ? new THREE.Color((customer.fiberColor ?? customer.portColor)?.hex ?? '#9aa4ae').getHex()
      : 0x9aa4ae;
    const colorWord = customer?.fiberColor
      ? L('label.fiberWord', { color: customer.fiberColor.name })
      : customer?.portColor
        ? L('label.portCode', { color: customer.portColor.name })
        : L('label.colorUnknown');
    const dropText = customer
      ? L('label.drop', { color: colorWord, port: customer.fatPort ? L('label.port', { n: customer.fatPort }) : '' })
      : L('label.dropNone');
    const { labels: homeLabels } = insideHouse(galleryKit, home, {
      dropColor: color,
      dropText,
      words: {
        home: L('label.home'),
        atb: L('label.atb'),
        patch: L('label.patch'),
        ont: L('label.ont'),
        router: L('label.router'),
        tv: L('label.tv'),
      },
    });
    if (labels)
      for (const l of homeLabels)
        galleryKit.tag(
          l.text,
          homeAt.x + l.at.x * HOME_SCALE,
          l.at.y * HOME_SCALE + 0.15,
          homeAt.z + l.at.z * HOME_SCALE,
          l.s * 0.38,
        );
  };

  // Camera presets, all worked out from the data.
  const ext = Math.max(20, extent);
  const target0 = v(center.x, 1, center.z);
  const presets: Record<PresetKey, View | null> = {
    // A big network is looked at from steeply above, like a map; a small one from the side.
    ov: {
      target: target0,
      eye: target0
        .clone()
        .add(ext > 300 ? v(0.02, 1.9, 0.95).multiplyScalar(ext) : v(0.03, 0.55, 0.83).multiplyScalar(ext * 2.5)),
    },
    olt: null,
    sw: null,
    box: null,
    pole: null,
    fat: null,
    vil: null,
    home: null,
  };
  const firstOlt = scene.racks.flatMap((r) => r.items).find((i) => i.kind === 'olt');
  if (firstOlt?.kind === 'olt') {
    const at = focus.get(firstOlt.olt.equipmentId)?.at;
    if (at) presets.olt = { target: at.clone(), eye: at.clone().add(v(0.45, 0.35, 2.2)) };
  }
  const firstSw = scene.racks.flatMap((r) => r.items).find((i) => i.kind === 'switch');
  if (firstSw?.kind === 'switch') {
    const at = focus.get(firstSw.sw.equipmentId)?.at;
    if (at) presets.sw = { target: at.clone(), eye: at.clone().add(v(0.3, 0.3, 1.9)) };
  }
  const feeder =
    scene.cables.find((c) => c.role === 'feeder' && c.aerial) ?? scene.cables.find((c) => c.role === 'feeder');
  if (feeder) {
    const mid = feeder.points[Math.floor(feeder.points.length / 2)];
    presets.pole = { target: v(mid.x, aerialY * 0.8, mid.z), eye: v(mid.x - 10, aerialY + 9, mid.z + 16) };
  } else if (scene.poles.length) {
    const p = scene.poles[0].position;
    presets.pole = { target: v(p.x, aerialY * 0.8, p.z), eye: v(p.x - 10, aerialY + 9, p.z + 16) };
  }
  const fatWithDrops =
    scene.boxes.find((b) => b.model === 'fat' && b.ports.some((p) => p.state === 'used')) ??
    scene.boxes.find((b) => b.model === 'fat');
  if (fatWithDrops) {
    const at = plant.boxes.get(fatWithDrops.id) ?? v(fatWithDrops.position.x, aerialY - 1, fatWithDrops.position.z);
    presets.fat = { target: v(at.x, at.y - 1.4, at.z), eye: v(at.x + 4, at.y + 4.5, at.z + 9) };
  }
  if (scene.houses.length) {
    const xs = scene.houses.map((h) => h.position.x);
    const zs = scene.houses.map((h) => h.position.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const he = Math.max(20, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...zs) - Math.min(...zs)) / 2);
    presets.vil = { target: v(cx, 1, cz), eye: v(cx, he * 1.4, cz + he * 1.3) };
  }
  presets.box = { target: v(galleryAt.x + 4, 1.0, galleryAt.z), eye: v(galleryAt.x + 4, 3.2, galleryAt.z + 13) };
  presets.home = { target: v(galleryAt.x - 7.6, 1.0, galleryAt.z), eye: v(galleryAt.x - 7.0, 3.2, galleryAt.z + 8.2) };

  // Merge every static part that shares a material, so big networks stay at a few hundred draw calls.
  const batched = batchStatic(kit, root, [kit.labels, fibers.group, far, gallery, ...(houses ? [houses.group] : [])]);
  let meshes = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== undefined && o.parent?.name !== 'pick-proxies')
      meshes += 1;
  });

  const world: World = {
    root,
    kit,
    fibers,
    far,
    houses,
    gallery,
    galleryKit,
    galleryAt,
    focus,
    pickTargets: [...batched.proxies.children, ...(houses ? [houses.walls] : [])],
    presets,
    aerialY,
    counts: {
      racks: scene.racks.length,
      poles: scene.poles.length,
      boxes: scene.boxes.length,
      fibers: fibers.count,
      houses: scene.houses.length,
      meshes,
      staticMeshesMerged: batched.before,
    },
    rebuildGallery,
    dispose: () => {
      houses?.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      galleryKit.dispose();
      kit.dispose();
      root.clear();
    },
  };
  return world;
}
