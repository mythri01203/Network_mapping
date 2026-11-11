import * as THREE from 'three';

import type { LedState } from '../scene/types';
import { makeSurface, type SurfaceKind } from './textures';

/**
 * Shared building blocks for every 3D model: cached materials and geometries (one per distinct
 * colour/size), LEDs that blink by state, text textures, and floating labels. Everything made here
 * is tracked so `dispose()` frees it on unmount.
 */

export interface LedEntry {
  material: THREE.MeshStandardMaterial;
  mode: LedState;
  phase: number;
}

export interface MatOptions {
  opacity?: number;
  emissive?: number;
  emissiveIntensity?: number;
  map?: THREE.Texture;
  flatShading?: boolean;
  side?: THREE.Side;
  vertexColors?: boolean;
}

const LED_COLORS: Record<LedState, number> = {
  off: 0x2a2a2a,
  steady: 0x2bff72,
  blink: 0x2bff72,
  amber: 0xffb000,
  red: 0xff3030,
};

/** Whether this browser can draw canvas text (false in tests and workers). */
const canDrawText = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

export class Kit {
  private mats = new Map<string, THREE.Material>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private owned = new Set<THREE.Material | THREE.BufferGeometry | THREE.Texture>();
  readonly leds: LedEntry[] = [];
  readonly spinners: { object: THREE.Object3D; speed: number }[] = [];
  /** Floating labels; one group so the "Labels" toggle hides them all. */
  readonly labels = new THREE.Group();
  /** Number of labels made, to keep big networks within texture memory. */
  labelCount = 0;
  private phaseSeed = 1;

  constructor() {
    this.labels.name = 'labels';
  }

  /** Tracks something made outside the kit so it is freed with everything else. */
  own<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(thing: T): T {
    this.owned.add(thing);
    return thing;
  }

  std(color: number | string, metalness = 0.4, roughness = 0.5, o: MatOptions = {}): THREE.MeshStandardMaterial {
    const key = o.map ? undefined : `std|${color}|${metalness}|${roughness}|${JSON.stringify(o)}`;
    if (key && this.mats.has(key)) return this.mats.get(key) as THREE.MeshStandardMaterial;
    const params: THREE.MeshStandardMaterialParameters = {
      color: new THREE.Color(color),
      metalness,
      roughness,
      transparent: o.opacity !== undefined && o.opacity < 1,
      opacity: o.opacity ?? 1,
      emissiveIntensity: o.emissiveIntensity ?? 1,
    };
    // Only defined options: three.js warns about parameters set to undefined.
    if (o.emissive !== undefined) params.emissive = new THREE.Color(o.emissive);
    if (o.map) params.map = o.map;
    if (o.flatShading !== undefined) params.flatShading = o.flatShading;
    if (o.side !== undefined) params.side = o.side;
    if (o.vertexColors !== undefined) params.vertexColors = o.vertexColors;
    const m = new THREE.MeshStandardMaterial(params);
    if (key) this.mats.set(key, m);
    else this.owned.add(m);
    return m;
  }

  private surfaces = new Map<SurfaceKind, THREE.Texture | null>();

  /** A shared surface texture (wood, brushed metal...), or null where canvas cannot draw (tests). */
  surface(kind: SurfaceKind): THREE.Texture | null {
    if (!this.surfaces.has(kind)) {
      const t = makeSurface(kind);
      if (t) this.owned.add(t);
      this.surfaces.set(kind, t);
    }
    return this.surfaces.get(kind) ?? null;
  }

  /**
   * A cached material with a surface texture tinted by `color`. Shared like `std`, so meshes that
   * use it still batch into one draw call. Plain `std` where textures cannot be drawn.
   */
  tex(kind: SurfaceKind, color: number | string, metalness = 0.4, roughness = 0.5): THREE.MeshStandardMaterial {
    const key = `tex|${kind}|${color}|${metalness}|${roughness}`;
    const hit = this.mats.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const map = this.surface(kind);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness, roughness });
    if (map) m.map = map;
    this.mats.set(key, m);
    return m;
  }

  /** A material that is changed later (dimmed, highlighted), so never shared. */
  own_std(color: number | string, metalness = 0.4, roughness = 0.5, o: MatOptions = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness,
      roughness,
      transparent: true,
      opacity: o.opacity ?? 1,
      emissive: new THREE.Color(o.emissive ?? 0),
    });
    this.owned.add(m);
    return m;
  }

  basic(color: number | string, o: { opacity?: number; depthTest?: boolean } = {}): THREE.MeshBasicMaterial {
    const key = `basic|${color}|${o.opacity ?? 1}|${o.depthTest ?? true}`;
    const hit = this.mats.get(key);
    if (hit) return hit as THREE.MeshBasicMaterial;
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      depthTest: o.depthTest ?? true,
    });
    this.mats.set(key, m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    const hit = this.geos.get(key);
    if (hit) return hit as T;
    const g = make();
    this.geos.set(key, g);
    return g;
  }

  boxGeo(w: number, h: number, d: number) {
    return this.geo(`box|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`, () => new THREE.BoxGeometry(w, h, d));
  }

  cylGeo(rt: number, rb: number, len: number, seg = 18) {
    return this.geo(
      `cyl|${rt.toFixed(4)}|${rb.toFixed(4)}|${len.toFixed(4)}|${seg}`,
      () => new THREE.CylinderGeometry(rt, rb, len, seg),
    );
  }

  torusGeo(r: number, tube: number, rs = 8, ts = 32) {
    return this.geo(`tor|${r}|${tube}|${rs}|${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts));
  }

  sphereGeo(r: number, ws = 12, hs = 10, phiLen = Math.PI * 2, thetaLen = Math.PI) {
    return this.geo(
      `sph|${r}|${ws}|${hs}|${phiLen}|${thetaLen}`,
      () => new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen),
    );
  }

  planeGeo(w: number, h: number) {
    return this.geo(`pl|${w.toFixed(4)}|${h.toFixed(4)}`, () => new THREE.PlaneGeometry(w, h));
  }

  /** A box mesh added to `parent` (the prototype's `B`). */
  box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    shadow = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    parent.add(m);
    return m;
  }

  /** A cylinder lying along z (the prototype's `Cy`): screws, plugs, fan hubs. */
  cyl(
    parent: THREE.Object3D,
    r: number,
    len: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.cylGeo(r, r, len, 12), mat);
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  led(parent: THREE.Object3D, x: number, y: number, z: number, mode: LedState, size = 0.05): THREE.Mesh {
    // One material per state and blink phase (4 phases), shared by every LED in that group, so LEDs
    // can be batched and still blink out of step.
    this.phaseSeed = (this.phaseSeed * 9301 + 49297) % 233280;
    const bucket = Math.floor((this.phaseSeed / 233280) * 4);
    const key = `${mode}|${bucket}`;
    let material = this.ledMats.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: 0x111111,
        emissive: LED_COLORS[mode],
        emissiveIntensity: mode === 'off' ? 0.25 : 2,
      });
      this.owned.add(material);
      this.ledMats.set(key, material);
      this.leds.push({ material, mode, phase: bucket * 2.3 });
    }
    const m = new THREE.Mesh(this.boxGeo(size, size, size * 0.4), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** LED brightness for the time `t` (seconds), the same rules as the prototype. */
  tickLeds(t: number) {
    for (const l of this.leds) {
      const m = l.material;
      switch (l.mode) {
        case 'off':
          m.emissiveIntensity = 0.25;
          break;
        case 'steady':
          m.emissiveIntensity = 2;
          break;
        case 'blink':
          m.emissiveIntensity = Math.sin(t * 9 + l.phase) > 0 ? 2.4 : 0.25;
          break;
        case 'amber':
          m.emissiveIntensity = Math.sin(t * 2 + l.phase) > 0 ? 2 : 0.6;
          break;
        case 'red':
          m.emissiveIntensity = Math.sin(t * 5 + l.phase) > 0 ? 2.6 : 0.4;
          break;
      }
    }
  }

  textTexture(text: string, w: number, h: number, fontPx: number, fg: string, bg: string | null): THREE.Texture | null {
    if (!canDrawText()) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    if (bg) {
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect?.(2, 2, w - 4, h - 4, Math.min(18, h / 3));
      if (!g.roundRect) g.rect(2, 2, w - 4, h - 4);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 3;
      g.stroke();
    }
    g.fillStyle = fg;
    let size = fontPx;
    g.font = `600 ${size}px system-ui, "Noto Sans Kannada", "Noto Sans Telugu", sans-serif`;
    while (size > 10 && g.measureText(text).width > w - 16) {
      size -= 2;
      g.font = `600 ${size}px system-ui, "Noto Sans Kannada", "Noto Sans Telugu", sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.owned.add(t);
    return t;
  }

  private numberMats = new Map<number, THREE.MeshBasicMaterial | null>();
  private ledMats = new Map<string, THREE.MeshStandardMaterial>();

  /**
   * A small printed port number. One texture per distinct number, shared by every box, so a
   * thousand FATs still use only a few dozen textures.
   */
  numberLabel(n: number, size: number): THREE.Mesh | null {
    let mat = this.numberMats.get(n);
    if (mat === undefined) {
      const map = this.textTexture(String(n), 64, 48, 34, '#ffffff', 'rgba(10,16,22,.9)');
      mat = map ? new THREE.MeshBasicMaterial({ map, transparent: true }) : null;
      if (mat) this.owned.add(mat);
      this.numberMats.set(n, mat);
    }
    if (!mat) return null;
    return new THREE.Mesh(this.planeGeo(size, size * 0.75), mat);
  }

  /** Flat printed text on a face (the prototype's `plate`). */
  plate(
    parent: THREE.Object3D,
    text: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    fg = '#cfd8e0',
  ): THREE.Mesh | null {
    const ch = Math.max(16, Math.round((256 * h) / w));
    const map = this.textTexture(text, 256, ch, Math.round(ch * 0.7), fg, null);
    if (!map) return null;
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true });
    this.owned.add(mat);
    const m = new THREE.Mesh(this.planeGeo(w, h), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** A floating label that always faces the camera, at a world position. */
  tag(text: string, x: number, y: number, z: number, scale = 0.8, sub?: string): THREE.Sprite | null {
    const label = sub ? `${text} · ${sub}` : text;
    const map = this.textTexture(label, 512, 112, 44, '#ffffff', 'rgba(10,16,22,.85)');
    if (!map) return null;
    const mat = new THREE.SpriteMaterial({ map, depthTest: false, transparent: true });
    this.owned.add(mat);
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z);
    sp.scale.set(4.6 * scale, scale, 1);
    sp.renderOrder = 9;
    sp.userData.baseScale = new THREE.Vector2(sp.scale.x, sp.scale.y);
    this.labels.add(sp);
    this.labelCount += 1;
    return sp;
  }

  /** Keeps a label at least `px` pixels tall however far the camera is (for a few key names). */
  keepReadable(sprite: THREE.Sprite | null, px = 18) {
    if (sprite) sprite.userData.minPx = px;
  }

  dispose() {
    this.surfaces.clear();
    for (const m of this.mats.values()) m.dispose();
    for (const g of this.geos.values()) g.dispose();
    for (const o of this.owned) o.dispose();
    this.mats.clear();
    this.geos.clear();
    this.owned.clear();
    this.numberMats.clear();
    this.ledMats.clear();
    this.leds.length = 0;
    this.spinners.length = 0;
  }
}

/** Marks an object as something a click selects. */
export function markPick(object: THREE.Object3D, pick: PickInfo) {
  object.userData.pick = pick;
}

export type PickInfo =
  { kind: 'equipment'; id: string } | { kind: 'house'; houseId: string } | { kind: 'cable'; id: string };

/** The nearest pick info walking up from a hit object. */
export function pickOf(object: THREE.Object3D | null): PickInfo | undefined {
  let o: THREE.Object3D | null = object;
  while (o) {
    if (o.userData.pick) return o.userData.pick as PickInfo;
    o = o.parent;
  }
  return undefined;
}
