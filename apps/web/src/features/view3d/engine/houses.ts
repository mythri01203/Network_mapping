import * as THREE from 'three';

import type { SceneHouse } from '../scene/types';
import type { Kit } from './kit';

/**
 * All houses as instanced meshes (walls, tile roof, door, window, ONT, LED): one draw call per
 * part however many customers there are. House number tags come from one texture atlas drawn by
 * one instanced billboard. Colours are deterministic from the customer id.
 */

export const HOUSE = { w: 4.1, h: 3.06, d: 3.74, roof: 1.7 } as const;
const MAX_TAGS = 2048;
/** Common house paints: cream, pale yellow, pink, pale green, sky blue, white, peach. */
const WALL_PAINTS = [0xf1e7d0, 0xf3e3a8, 0xeec9c0, 0xcfe3c4, 0xc6dcea, 0xf4f1ea, 0xf0cfa8];

function canvasTexture(
  kit: Kit,
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
  repeat?: [number, number],
): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return undefined;
  draw(g);
  const t = kit.own(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

/** Deterministic noise so textures are the same on every load. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class HouseLayer {
  readonly group = new THREE.Group();
  readonly walls: THREE.InstancedMesh;
  readonly index = new Map<string, number>();
  private tags: THREE.InstancedMesh | null = null;
  private faults: THREE.InstancedMesh | null = null;
  readonly beam: THREE.Mesh;
  readonly ledMaterial: THREE.MeshStandardMaterial;

  constructor(
    kit: Kit,
    readonly houses: readonly SceneHouse[],
  ) {
    this.group.name = 'houses';
    const n = Math.max(1, houses.length);
    const r = rng(42);
    const stucco = canvasTexture(
      kit,
      128,
      128,
      (g) => {
        g.fillStyle = '#ddd5c6';
        g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 2600; i += 1) {
          g.fillStyle = i % 2 ? 'rgba(255,255,255,.06)' : 'rgba(70,60,45,.06)';
          g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 2);
        }
        // Rain streaks down from the roof line and damp near the ground.
        for (let i = 0; i < 26; i += 1) {
          g.fillStyle = `rgba(60,55,45,${0.04 + r() * 0.07})`;
          g.fillRect(r() * 128, 0, 1 + r() * 3, 18 + r() * 50);
        }
        const damp = g.createLinearGradient(0, 96, 0, 128);
        damp.addColorStop(0, 'rgba(70,65,55,0)');
        damp.addColorStop(1, 'rgba(70,65,55,.28)');
        g.fillStyle = damp;
        g.fillRect(0, 96, 128, 32);
      },
      [2, 1],
    );
    const tiles = canvasTexture(
      kit,
      128,
      128,
      (g) => {
        for (let row = 0; row < 8; row += 1)
          for (let c = 0; c < 9; c += 1) {
            g.fillStyle = `hsl(12,${42 + r() * 12}%,${28 + r() * 9}%)`;
            g.fillRect(c * 16 + (row % 2) * 8 - 8, row * 16, 15, 14);
          }
      },
      [0.5, 0.5],
    );
    const shape = new THREE.Shape();
    const half = HOUSE.w / 2 + 0.25;
    shape.moveTo(-half, 0);
    shape.lineTo(half, 0);
    shape.lineTo(0, HOUSE.roof);
    shape.closePath();
    const roofGeo = kit.own(new THREE.ExtrudeGeometry(shape, { depth: HOUSE.d + 0.5, bevelEnabled: false }));
    roofGeo.translate(0, 0, -(HOUSE.d + 0.5) / 2);
    const wallGeo = kit.boxGeo(HOUSE.w, HOUSE.h, HOUSE.d);
    wallGeo.translate(0, 0, 0); // shared geometry, positioned per instance
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = houses.length;
      this.group.add(m);
      return m;
    };
    this.walls = inst(wallGeo, kit.std(0xffffff, 0, 0.95, stucco ? { map: stucco } : {}));
    const roof = inst(roofGeo, [
      kit.std(0xe8e0d0, 0, 0.95, stucco ? { map: stucco } : {}),
      kit.std(0xffffff, 0, 0.85, tiles ? { map: tiles } : {}),
    ]);
    // Stone base, doorstep, door and window frames, and a window on the side wall.
    const plinth = inst(kit.boxGeo(HOUSE.w + 0.14, 0.4, HOUSE.d + 0.14), kit.tex('concrete', 0x8f8a80, 0, 0.95));
    const step = inst(kit.boxGeo(1.2, 0.2, 0.5), kit.tex('concrete', 0xa5a097, 0, 0.95));
    const frameMat = kit.std(0xf3efe6, 0, 0.6);
    const doorFrame = inst(kit.boxGeo(0.95, 1.74, 0.07), kit.std(0x2e1c10, 0.1, 0.7));
    const winFrame = inst(kit.boxGeo(1.12, 1.03, 0.06), frameMat);
    const sill = inst(kit.boxGeo(1.24, 0.07, 0.16), frameMat);
    const sideFrame = inst(kit.boxGeo(0.06, 1.03, 1.12), frameMat);
    const door = inst(kit.boxGeo(0.77, 1.6, 0.1), kit.tex('wood', 0x6b4426, 0.05, 0.6));
    const glass = kit.std(0x9ccbe8, 0.9, 0.05, { opacity: 0.6, emissive: 0xffc46b, emissiveIntensity: 0.35 });
    const win = inst(kit.boxGeo(0.94, 0.85, 0.08), glass);
    const sideWin = inst(kit.boxGeo(0.08, 0.85, 0.94), glass);
    const ont = inst(kit.boxGeo(0.2, 0.3, 0.08), kit.std(0xf2f2f2, 0.1, 0.35));
    this.ledMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x2bff72, emissiveIntensity: 2 });
    kit.own(this.ledMaterial);
    kit.leds.push({ material: this.ledMaterial, mode: 'blink', phase: 0 });
    const led = inst(kit.boxGeo(0.08, 0.08, 0.03), this.ledMaterial);
    const dm = new THREE.Object3D();
    const color = new THREE.Color();
    const roofColors = [0xffffff, 0xd9c5bd, 0xbfc7cf, 0xe8d2b8];
    houses.forEach((h, i) => {
      this.index.set(h.id, i);
      const c = Math.cos(h.yaw);
      const s = Math.sin(h.yaw);
      const put = (mesh: THREE.InstancedMesh, lx: number, ly: number, lz: number, sy = 1) => {
        dm.position.set(h.position.x + lx * c + lz * s, ly, h.position.z - lx * s + lz * c);
        dm.rotation.set(0, h.yaw, 0);
        dm.scale.set(1, sy, 1);
        dm.updateMatrix();
        mesh.setMatrixAt(i, dm.matrix);
      };
      const tall = HOUSE.h * h.floors;
      put(this.walls, 0, tall / 2, 0, h.floors);
      put(roof, 0, tall, 0);
      put(plinth, 0, 0.2, 0);
      put(step, -0.94, 0.1, HOUSE.d / 2 + 0.3);
      put(doorFrame, -0.94, 0.87, HOUSE.d / 2 + 0.02);
      put(door, -0.94, 0.8, HOUSE.d / 2 + 0.03);
      put(winFrame, 0.77, 2.04, HOUSE.d / 2 + 0.015);
      put(sill, 0.77, 1.5, HOUSE.d / 2 + 0.06);
      put(win, 0.77, 2.04, HOUSE.d / 2 + 0.02);
      put(sideFrame, -HOUSE.w / 2 - 0.015, 2.04, 0);
      put(sideWin, -HOUSE.w / 2 - 0.02, 2.04, 0);
      put(ont, 1.6, 1.53, HOUSE.d / 2 + 0.05);
      put(led, 1.6, 1.64, HOUSE.d / 2 + 0.1);
      this.walls.setColorAt(i, color.setHex(WALL_PAINTS[Math.floor(h.seed * 977) % WALL_PAINTS.length]));
      roof.setColorAt(i, color.setHex(roofColors[Math.floor(h.seed * 4) % 4]));
    });
    for (const m of [
      this.walls,
      roof,
      door,
      win,
      ont,
      led,
      plinth,
      step,
      doorFrame,
      winFrame,
      sill,
      sideFrame,
      sideWin,
    ])
      m.instanceMatrix.needsUpdate = true;
    if (this.walls.instanceColor) this.walls.instanceColor.needsUpdate = true;
    if (roof.instanceColor) roof.instanceColor.needsUpdate = true;
    this.walls.userData.houses = true;

    // Fault markers: a red cone over every house with a fresh "no light" or offline status.
    const faulty = houses.filter((h) => h.fault);
    if (faulty.length) {
      this.faults = new THREE.InstancedMesh(kit.cylGeo(0.5, 0, 1.1, 14), kit.basic(0xff3b3b), faulty.length);
      faulty.forEach((h, i) => {
        dm.position.set(h.position.x, HOUSE.h * h.floors + HOUSE.roof + 1.4, h.position.z);
        dm.rotation.set(0, 0, 0);
        dm.scale.set(1, 1, 1);
        dm.updateMatrix();
        this.faults!.setMatrixAt(i, dm.matrix);
      });
      this.group.add(this.faults);
    }

    this.beam = new THREE.Mesh(kit.cylGeo(0.18, 0.18, 16, 10), kit.basic(0xffe066, { opacity: 0.75 }));
    this.beam.visible = false;
    this.group.add(this.beam);
  }

  /** House number tags, one atlas and one draw call. Added to `labels` so the toggle hides them. */
  buildTags(kit: Kit, labels: THREE.Group) {
    if (typeof document === 'undefined' || !this.houses.length) return;
    const count = Math.min(MAX_TAGS, this.houses.length);
    const cols = 32;
    const rows = Math.ceil(count / cols);
    const cw = 64;
    const ch = 32;
    const canvas = document.createElement('canvas');
    canvas.width = cols * cw;
    canvas.height = Math.max(ch, THREE.MathUtils.ceilPowerOfTwo(rows * ch));
    const g = canvas.getContext('2d');
    if (!g) return;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 20px system-ui, sans-serif';
    const cells = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      g.fillStyle = this.houses[i].fault ? 'rgba(160,20,20,.9)' : 'rgba(10,16,22,.82)';
      g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      g.fillStyle = '#fff';
      const extra = this.houses[i].customerIds.length > 1 ? `+${this.houses[i].customerIds.length - 1}` : '';
      g.fillText(`${this.houses[i].number}${extra}`, x + cw / 2, y + ch / 2 + 1);
      cells[i * 2] = x / canvas.width;
      cells[i * 2 + 1] = 1 - (y + ch) / canvas.height;
    }
    const tex = kit.own(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const geo = kit.own(new THREE.PlaneGeometry(1, 1));
    geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 2));
    const mat = kit.own(
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: tex },
          cellSize: { value: new THREE.Vector2(cw / canvas.width, ch / canvas.height) },
          size: { value: new THREE.Vector2(1.6, 0.8) },
        },
        vertexShader: `
          attribute vec2 cell;
          uniform vec2 cellSize;
          uniform vec2 size;
          varying vec2 vUv;
          void main() {
            vUv = cell + uv * cellSize;
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            mv.xy += position.xy * size;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map;
          varying vec2 vUv;
          void main() {
            vec4 c = texture2D(map, vUv);
            if (c.a < 0.05) discard;
            gl_FragColor = c;
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    const tags = new THREE.InstancedMesh(geo, mat, count);
    const dm = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const h = this.houses[i];
      dm.position.set(h.position.x, HOUSE.h * h.floors + HOUSE.roof + 0.6, h.position.z);
      dm.updateMatrix();
      tags.setMatrixAt(i, dm.matrix);
    }
    tags.instanceMatrix.needsUpdate = true;
    tags.frustumCulled = false;
    tags.renderOrder = 8;
    this.tags = tags;
    labels.add(tags);
  }

  /** Eave clamp and wall box of a house in world space, where its drop ends. */
  dropEnd(houseId: string): { eave: THREE.Vector3; wallBox: THREE.Vector3 } | undefined {
    const i = this.index.get(houseId);
    if (i === undefined) return undefined;
    const h = this.houses[i];
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    const at = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(h.position.x + lx * c + lz * s, ly, h.position.z - lx * s + lz * c);
    const lx = HOUSE.w / 2 - 0.3;
    return { eave: at(lx, HOUSE.h * h.floors - 0.05, HOUSE.d / 2 + 0.12), wallBox: at(lx, 1.35, HOUSE.d / 2 + 0.08) };
  }

  highlight(houseId: string | null) {
    const i = houseId ? this.index.get(houseId) : undefined;
    if (i === undefined) {
      this.beam.visible = false;
      return;
    }
    const h = this.houses[i];
    this.beam.position.set(h.position.x, HOUSE.h * h.floors + 8, h.position.z);
    this.beam.visible = true;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.tags?.dispose();
  }
}
