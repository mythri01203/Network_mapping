import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { CableRole } from '../scene/types';
import type { Kit } from './kit';

/**
 * Every fiber drawn as a tube along its route, with light pulses (cyan downstream 1490 nm, amber
 * upstream 1310 nm). Drops are merged into one mesh with per-vertex colour, so a thousand drops are
 * one draw call; dimming and highlighting rewrite that colour.
 */

export interface FiberInput {
  id: string;
  role: CableRole;
  level?: number;
  ponKeys: string[];
  customerId?: string;
  points: THREE.Vector3[];
  color: number;
  radius: number;
  pulse: boolean;
  opacity?: number;
}

interface Line extends FiberInput {
  curve: THREE.CatmullRomCurve3;
  length: number;
  on: boolean;
}

export type FiberFilter =
  | { kind: 'all' }
  | { kind: 'feeder' }
  | { kind: 'level'; level: number }
  | { kind: 'drop' }
  | { kind: 'pon'; ponKey: string };

interface MergedSet {
  mesh: THREE.Mesh;
  colors: THREE.BufferAttribute;
  base: Float32Array;
  /** Line id → its first vertex and vertex count in the merged buffer. */
  ranges: Map<string, [number, number]>;
}

const DIM = 0.08;
const PULSE_SPEED = 14;

export class FiberLayer {
  readonly group = new THREE.Group();
  private lines: Line[] = [];
  /** Drops, and every other fiber, each merged into one mesh with per-vertex colour. */
  private sets: MergedSet[] = [];
  private pulseDown: THREE.InstancedMesh | null = null;
  private pulseUp: THREE.InstancedMesh | null = null;
  private pulsing: Line[] = [];
  private dummy = new THREE.Object3D();
  private dropsOn = true;

  constructor(kit: Kit, items: readonly FiberInput[]) {
    this.group.name = 'fibers';
    const parts: Record<
      'drops' | 'lines',
      { geos: THREE.BufferGeometry[]; ranges: Map<string, [number, number]>; cursor: number }
    > = {
      drops: { geos: [], ranges: new Map(), cursor: 0 },
      lines: { geos: [], ranges: new Map(), cursor: 0 },
    };
    const grey = new THREE.Color(0x9aa4ae);
    for (const item of items) {
      if (item.points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(item.points, false, 'centripetal');
      const length = curve.getLength();
      const line: Line = { ...item, curve, length, on: true };
      this.lines.push(line);
      const isDrop = item.role === 'drop';
      const segs = isDrop ? 16 : Math.min(160, Math.max(12, Math.round(length / 3), item.points.length * 4));
      const geo = new THREE.TubeGeometry(curve, segs, item.radius, isDrop ? 5 : 6);
      const n = geo.attributes.position.count;
      // A schematic line (route not drawn) is drawn paler instead of transparent.
      const c = new THREE.Color(item.color).lerp(grey, (item.opacity ?? 1) < 1 ? 0.5 : 0);
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) c.toArray(arr, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      const part = parts[isDrop ? 'drops' : 'lines'];
      part.geos.push(geo);
      part.ranges.set(item.id, [part.cursor, n]);
      part.cursor += n;
      if (!isDrop && item.pulse) this.pulsing.push(line);
    }
    for (const [name, part] of Object.entries(parts)) {
      if (!part.geos.length) continue;
      const merged = kit.own(mergeGeometries(part.geos, false) ?? new THREE.BufferGeometry());
      for (const g of part.geos) g.dispose();
      const colors = merged.getAttribute('color') as THREE.BufferAttribute;
      const mesh = new THREE.Mesh(merged, kit.std(0xffffff, 0, name === 'drops' ? 0.4 : 0.35, { vertexColors: true }));
      mesh.name = name;
      // Cables a few centimetres thick cast no visible shadow; drops are many and do.
      mesh.castShadow = name === 'drops';
      this.group.add(mesh);
      this.sets.push({ mesh, colors, base: new Float32Array(colors.array as Float32Array), ranges: part.ranges });
    }
    if (this.pulsing.length) {
      // One unit sphere; each pulse is scaled to its own fiber.
      const geo = kit.sphereGeo(1, 10, 10);
      this.pulseDown = new THREE.InstancedMesh(geo, kit.basic(0x7ee6ff), this.pulsing.length);
      this.pulseUp = new THREE.InstancedMesh(geo, kit.basic(0xffb347), this.pulsing.length);
      for (const m of [this.pulseDown, this.pulseUp]) {
        m.frustumCulled = false;
        this.group.add(m);
      }
    }
  }

  get count() {
    return this.lines.length;
  }

  /**
   * Shows only the fibers the filter keeps (the rest fade); with a customer, only that customer's
   * drop stays and is brightened. Works by rewriting the merged colour buffers: no draw calls added.
   */
  apply(filter: FiberFilter, customerId: string | null) {
    const keep = (l: Line): boolean => {
      if (customerId && l.role === 'drop') return l.customerId === customerId;
      switch (filter.kind) {
        case 'all':
          return true;
        case 'feeder':
          return l.role === 'feeder';
        case 'level':
          return l.role === 'branch' && l.level === filter.level;
        case 'drop':
          return l.role === 'drop';
        case 'pon':
          return l.ponKeys.includes(filter.ponKey);
      }
    };
    this.dropsOn = filter.kind === 'all' || filter.kind === 'drop' || filter.kind === 'pon';
    for (const l of this.lines) l.on = keep(l);
    const byId = new Map(this.lines.map((l) => [l.id, l]));
    for (const set of this.sets) {
      const arr = set.colors.array as Float32Array;
      for (const [id, [start, count]] of set.ranges) {
        const l = byId.get(id);
        if (!l) continue;
        const picked = !!customerId && l.customerId === customerId;
        const lift = l.on && filter.kind !== 'all' && l.role !== 'drop';
        for (let i = start * 3; i < (start + count) * 3; i += 1) {
          const b = set.base[i];
          arr[i] = !l.on ? b * DIM : picked ? Math.min(1, b * 1.35 + 0.08) : lift ? Math.min(1, b * 1.15 + 0.05) : b;
        }
      }
      set.colors.needsUpdate = true;
    }
  }

  /** The route of one fiber, for focusing the camera. */
  curveOf(id: string): THREE.CatmullRomCurve3 | undefined {
    return this.lines.find((l) => l.id === id)?.curve;
  }

  tick(t: number, showPulses: boolean) {
    if (!this.pulseDown || !this.pulseUp) return;
    const d = this.dummy;
    this.pulsing.forEach((l, i) => {
      const visible = showPulses && l.on;
      if (!visible) {
        d.scale.setScalar(0);
        d.updateMatrix();
        this.pulseDown!.setMatrixAt(i, d.matrix);
        this.pulseUp!.setMatrixAt(i, d.matrix);
        return;
      }
      const speed = l.length < 8 ? PULSE_SPEED / 10 : PULSE_SPEED;
      // Always in [0, 1): a negative time must never give a negative curve position.
      const raw = (t * speed) / Math.max(1, l.length);
      const u = ((raw % 1) + 1) % 1;
      d.scale.setScalar(Math.max(0.018, l.radius * 2.2));
      d.position.copy(l.curve.getPointAt(u));
      d.updateMatrix();
      this.pulseDown!.setMatrixAt(i, d.matrix);
      d.position.copy(l.curve.getPointAt(1 - ((u + 0.5) % 1)));
      d.updateMatrix();
      this.pulseUp!.setMatrixAt(i, d.matrix);
    });
    this.pulseDown.instanceMatrix.needsUpdate = true;
    this.pulseUp.instanceMatrix.needsUpdate = true;
  }

  get dropsVisible() {
    return this.dropsOn;
  }
}
