import * as THREE from 'three';

import { type GeoOrigin, makeProjection } from '../scene/geoLocal';
import type { LocalPoint } from '../scene/types';

/**
 * The real street map (or satellite picture) under the 3D network: the same web map tiles the 2D
 * map shows, stitched into one texture and laid on the ground at the right place. A picture of the
 * area only; nothing on it is network data.
 */

export interface TileSource {
  /** Leaflet-style template with {s}, {x}, {y}, {z}. */
  url: string;
  subdomains?: string[];
  maxZoom: number;
  attribution: string;
  /**
   * Most detailed zoom to use in 3D. Street maps print their names for a screen, so at the
   * closest zoom a street name is metres tall on the ground; one level less keeps them in scale.
   */
  maxZoom3d?: number;
}

export type GroundState = 'off' | 'loading' | 'ready' | 'partial' | 'failed';

export interface TilePlan {
  z: number;
  x0: number;
  y0: number;
  /** Tiles across and down. */
  nx: number;
  ny: number;
  /** Local metres of the north-west and south-east corners of the tile block. */
  nw: LocalPoint;
  se: LocalPoint;
}

const RAD = Math.PI / 180;
const lngToX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = lat * RAD;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const xToLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const yToLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return Math.atan(Math.sinh(n)) / RAD;
};

/**
 * Which tiles cover a square of `half` metres around `center` (local metres from `origin`): the
 * most detailed zoom that needs at most `maxSide` tiles across. Pure, so it is tested.
 */
export function tilePlan(
  origin: GeoOrigin,
  center: LocalPoint,
  half: number,
  maxZoom: number,
  maxSide = 12,
): TilePlan | null {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng) || Math.abs(origin.lat) > 85) return null;
  if (origin.lat === 0 && origin.lng === 0) return null;
  const proj = makeProjection(origin);
  const nwGeo = proj.toGeo({ x: center.x - half, z: center.z - half });
  const seGeo = proj.toGeo({ x: center.x + half, z: center.z + half });
  for (let z = Math.min(19, maxZoom); z >= 3; z -= 1) {
    const x0 = Math.floor(lngToX(nwGeo.lng, z));
    const y0 = Math.floor(latToY(nwGeo.lat, z));
    const x1 = Math.floor(lngToX(seGeo.lng, z));
    const y1 = Math.floor(latToY(seGeo.lat, z));
    const nx = x1 - x0 + 1;
    const ny = y1 - y0 + 1;
    if (nx > maxSide || ny > maxSide) continue;
    return {
      z,
      x0,
      y0,
      nx,
      ny,
      nw: proj.toLocal(yToLat(y0, z), xToLng(x0, z)),
      se: proj.toLocal(yToLat(y0 + ny, z), xToLng(x0 + nx, z)),
    };
  }
  return null;
}

export function tileUrl(source: TileSource, x: number, y: number, z: number): string {
  const subs = source.subdomains?.length ? source.subdomains : ['a', 'b', 'c'];
  const s = subs[Math.abs(x + y) % subs.length];
  return source.url.replace('{s}', s).replace('{x}', String(x)).replace('{y}', String(y)).replace('{z}', String(z));
}

const TILE = 256;

/** One stitched block of tiles on one plane. */
class TileLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private texture: THREE.CanvasTexture | null = null;
  private token = 0;
  key = '';

  constructor(
    private anisotropy: number,
    offset: number,
    private y: number,
  ) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      // The sky reflection would wash the map out; the sun and sky lights are enough.
      envMapIntensity: 0.15,
      // Drawn just above the plain ground without fighting it for depth.
      polygonOffset: true,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }

  hide() {
    this.key = '';
    this.token += 1;
    this.mesh.visible = false;
  }

  /** Loads the plan's tiles; `done(ok, total)` is called when they are in (or after 12 s). */
  load(source: TileSource, plan: TilePlan, key: string, done: (ok: number, total: number) => void) {
    this.key = key;
    const token = ++this.token;
    const canvas = document.createElement('canvas');
    canvas.width = plan.nx * TILE;
    canvas.height = plan.ny * TILE;
    const g = canvas.getContext('2d');
    if (!g) {
      done(0, 1);
      return;
    }
    g.fillStyle = '#e8e6e1';
    g.fillRect(0, 0, canvas.width, canvas.height);
    let settled = 0;
    let ok = 0;
    const total = plan.nx * plan.ny;
    const finish = () => {
      if (token !== this.token) return;
      if (ok > 0) {
        this.texture?.dispose();
        const t = new THREE.CanvasTexture(canvas);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.anisotropy;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        this.texture = t;
        this.material.map = t;
        this.material.needsUpdate = true;
        const w = plan.se.x - plan.nw.x;
        const d = plan.se.z - plan.nw.z;
        this.mesh.scale.set(w, d, 1);
        this.mesh.position.set(plan.nw.x + w / 2, this.y, plan.nw.z + d / 2);
        this.mesh.visible = true;
      }
      done(ok, total);
    };
    // Whatever has arrived after 12 s is shown, so a slow connection still gets a map.
    const timer = setTimeout(() => {
      if (settled < total) finish();
    }, 12_000);
    for (let j = 0; j < plan.ny; j += 1)
      for (let i = 0; i < plan.nx; i += 1) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        const settle = (loaded: boolean) => {
          if (token !== this.token) return;
          if (loaded) {
            g.drawImage(img, i * TILE, j * TILE, TILE, TILE);
            ok += 1;
          }
          settled += 1;
          if (settled === total) {
            clearTimeout(timer);
            finish();
          }
        };
        img.onload = () => settle(true);
        img.onerror = () => settle(false);
        img.src = tileUrl(source, plan.x0 + i, plan.y0 + j, plan.z);
      }
  }

  dispose() {
    this.token += 1;
    this.texture?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

/** Width of one tile on the ground, metres, at this latitude and zoom. */
export const tileMeters = (lat: number, z: number) => (40_075_016.7 * Math.cos(lat * RAD)) / 2 ** z;

/**
 * The detail zoom for a camera this far from what it looks at: closer means sharper tiles.
 * 0 when the base map is enough.
 */
export function detailZoom(distance: number, maxZoom: number, baseZoom: number): number {
  const want = distance < 140 ? 19 : distance < 900 ? 18 : distance < 2600 ? 17 : 0;
  const z = Math.min(want, maxZoom);
  return z > baseZoom ? z : 0;
}

/**
 * The map under the scene. A base layer covers the whole network; on a big network that is coarse,
 * so a second, sharper patch follows what the camera looks at. Kept outside the world so redrawing
 * the network keeps it.
 */
export class MapGround {
  readonly group = new THREE.Group();
  private base: TileLayer;
  private detail: TileLayer;
  private source: TileSource | null = null;
  private origin: GeoOrigin = { lat: 0, lng: 0 };
  private baseZoom = 0;
  private detailAt: LocalPoint | null = null;
  private detailZ = 0;

  constructor(
    anisotropy: number,
    private onState: (state: GroundState) => void,
  ) {
    this.group.name = 'street-map';
    this.base = new TileLayer(anisotropy, -2, 0.004);
    this.detail = new TileLayer(anisotropy, -4, 0.008);
    this.group.add(this.base.mesh, this.detail.mesh);
  }

  get visible() {
    return this.base.mesh.visible;
  }

  /** Dims the picture at night so it does not glare. */
  setDark(dark: boolean) {
    for (const l of [this.base, this.detail]) l.material.color.setScalar(dark ? 0.42 : 0.8);
  }

  /** Loads the tiles for this area (or hides the map when `source` is null). */
  show(source: TileSource | null, origin: GeoOrigin, center: LocalPoint, half: number) {
    const cap = source ? Math.min(source.maxZoom, source.maxZoom3d ?? 19) : 0;
    const plan = source ? tilePlan(origin, center, half, cap) : null;
    const key =
      source && plan
        ? `${source.url}|${plan.z}|${plan.x0}|${plan.y0}|${plan.nx}|${plan.ny}|${origin.lat},${origin.lng}`
        : '';
    if (key === this.base.key && (key || !this.source)) return;
    this.detail.hide();
    this.detailAt = null;
    this.source = source;
    this.origin = origin;
    if (!source || !plan) {
      this.base.hide();
      this.source = null;
      this.onState('off');
      return;
    }
    this.baseZoom = plan.z;
    this.onState('loading');
    this.base.load(source, plan, key, (ok, total) => {
      if (ok === 0) this.base.mesh.visible = false;
      this.onState(ok === 0 ? 'failed' : ok === total ? 'ready' : 'partial');
    });
  }

  /**
   * Called as the camera moves: loads a sharper patch around `target` when the camera is close
   * enough to need one, and drops it when the camera pulls back.
   */
  focus(target: LocalPoint, distance: number) {
    const source = this.source;
    if (!source || !this.base.mesh.visible) return;
    const cap = Math.min(source.maxZoom, source.maxZoom3d ?? 19);
    const z = detailZoom(distance, cap, this.baseZoom);
    if (!z) {
      if (this.detail.key) this.detail.hide();
      this.detailAt = null;
      return;
    }
    const size = tileMeters(this.origin.lat, z);
    const moved = this.detailAt ? Math.hypot(target.x - this.detailAt.x, target.z - this.detailAt.z) : Infinity;
    if (z === this.detailZ && moved < size * 1.5) return;
    const plan = tilePlan(this.origin, target, size * 3.4, z, 9);
    if (!plan || plan.z !== z) return;
    this.detailAt = { ...target };
    this.detailZ = z;
    const key = `${source.url}|${plan.z}|${plan.x0}|${plan.y0}`;
    if (key === this.detail.key) return;
    // The old patch stays on screen until the new one has loaded.
    this.detail.load(source, plan, key, () => {});
  }

  dispose() {
    this.base.dispose();
    this.detail.dispose();
  }
}
