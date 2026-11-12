import * as THREE from 'three';

import type { CustomerPath, Scene3D } from '../scene/types';
import { OrbitRig } from './controls';
import type { FiberFilter } from './fibers';
import { type PickInfo, pickOf } from './kit';
import { type GroundState, MapGround, type TileSource } from './mapGround';
import { buildWorld, type LabelText, type PresetKey, type World } from './world';

/**
 * The 3D view's engine: renderer, lights, camera, render loop and picking around a `World`.
 * React owns the panels; this class owns everything WebGL and frees all of it in `dispose()`.
 */

export interface EngineEvents {
  onPick: (pick: PickInfo | null) => void;
  /** The person moved the camera, so no preset is active any more. */
  onUserMove?: () => void;
  onStats?: (s: { fps: number; pixelRatio: number }) => void;
  /** The street map under the scene: loading, shown, or could not load (offline). */
  onGround?: (state: GroundState) => void;
}

export interface EngineOptions {
  dark: boolean;
  /** Words for labels drawn in the scene. */
  text?: LabelText;
  labels: boolean;
  pulses: boolean;
  reducedMotion: boolean;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

const SKY = { dark: 0x0b0f14, light: 0xdfe9f1 } as const;
const MAX_DPR = 2;

export class View3DEngine {
  private renderer: THREE.WebGLRenderer;
  private scene3 = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 6000);
  private rig: OrbitRig;
  private world: World | null = null;
  private data: Scene3D | null = null;
  private env: THREE.Texture | null = null;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.PointLight;
  // THREE.Clock is deprecated since r183; Timer is its replacement (threejs-fundamentals skill).
  private timer = new THREE.Timer();
  private running = false;
  private resizeObserver: ResizeObserver | null = null;
  private filter: FiberFilter = { kind: 'all' };
  private customerId: string | null = null;
  private ponKey: string | null = null;
  private opts: EngineOptions;
  private frames = 0;
  private fpsAt = 0;
  private pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  private lowFpsSeconds = 0;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private ground: MapGround;
  private groundSource: TileSource | null = null;
  private onVisibility = () => {
    if (document.hidden) this.stop();
    else this.start();
  };

  constructor(
    private host: HTMLElement,
    private events: EngineEvents,
    options: EngineOptions,
  ) {
    this.opts = { ...options };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated since r182 and falls back to PCFShadowMap, which is soft.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The scene is static apart from LEDs, fans and pulses: shadows are drawn again only when it
    // changes (`refreshShadows`), not every frame. This is the biggest saving on integrated GPUs.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.style.outline = 'none';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      '3D network view. Drag to move, right-drag or Shift-drag to turn, scroll or pinch to zoom, double-click to go closer. Arrow keys turn, plus and minus zoom.',
    );
    host.appendChild(canvas);

    // Environment for realistic metal reflections, as in the prototype.
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x1c232b);
    const envBoxes: THREE.Mesh[] = [];
    for (const [x, y, z, w, h, d, i] of [
      [0, 20, 0, 30, 1, 30, 3],
      [-20, 8, 10, 1, 12, 20, 1.6],
      [20, 8, -10, 1, 12, 20, 1.3],
      [0, 6, 25, 30, 10, 1, 1.1],
    ]) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i) }),
      );
      m.position.set(x, y, z);
      envScene.add(m);
      envBoxes.push(m);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    for (const m of envBoxes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.scene3.environment = this.env;

    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x1a1f24, 0.5);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.fill = new THREE.PointLight(0xdfeaff, 0.7, 30);
    this.scene3.add(this.hemi, this.sun, this.sun.target, this.fill);
    this.ground = new MapGround(this.renderer.capabilities.getMaxAnisotropy(), (state) => {
      this.showGrid();
      this.refreshShadows();
      this.events.onGround?.(state);
    });
    this.scene3.add(this.ground.group);
    this.applyTheme();

    this.rig = new OrbitRig(this.camera, canvas);
    this.rig.onUserMove = () => this.events.onUserMove?.();
    this.rig.onTap = (x, y) => this.pickAt(x, y);
    this.rig.onDoubleTap = (x, y) => this.flyToGround(x, y);

    // Development only: lets `npm run check:3d` look inside (draw calls, toggles).
    if (import.meta.env.DEV) (window as unknown as { __view3dEngine?: unknown }).__view3dEngine = this;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.start();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setScene(scene: Scene3D) {
    const prev = this.data;
    // A different network (demo on or off, another origin) starts from its own overview.
    const fresh =
      !prev ||
      prev.isDemo !== scene.isDemo ||
      prev.origin.lat !== scene.origin.lat ||
      prev.origin.lng !== scene.origin.lng;
    this.world?.dispose();
    if (this.world) this.scene3.remove(this.world.root);
    this.data = scene;
    this.world = buildWorld(scene, { labels: this.opts.labels, dark: this.opts.dark, text: this.opts.text });
    this.scene3.add(this.world.root);
    this.world.kit.labels.visible = this.opts.labels;
    const ext = Math.max(20, scene.extent);
    this.rig.maxDistance = ext * 8 + 200;
    this.scene3.fog = new THREE.Fog(this.opts.dark ? SKY.dark : SKY.light, ext * 2.6, ext * 9 + 220);
    // Shadows cover the area the camera looks at and follow it (`followShadows`).
    this.shadowAt = null;
    this.followShadows(true);
    const rack = scene.racks[0]?.position ?? scene.center;
    this.fill.position.set(rack.x, 2.5, rack.z + 2.5);
    this.world.rebuildGallery(this.ponKey, this.currentCustomer(), this.opts.labels);
    this.applyFiberState();
    if (fresh) this.preset('ov', true);
    this.updateGround();
    this.showGrid();
    this.refreshShadows();
  }

  /** The street map (or satellite picture) to lay under the scene; null for plain ground. */
  setGround(source: TileSource | null) {
    this.groundSource = source;
    this.updateGround();
  }

  private updateGround() {
    const d = this.data;
    if (!d) return;
    // The same area as the plain ground in `buildWorld`.
    this.ground.show(this.groundSource, d.origin, d.center, d.extent + 130);
  }

  /** The plain ground's grid is hidden while the street map lies on top of it. */
  private showGrid() {
    const grid = this.world?.root.getObjectByName('grid');
    if (grid) grid.visible = !this.ground.visible;
  }

  get stats() {
    return this.world?.counts;
  }

  private currentCustomer(): CustomerPath | null {
    if (!this.data) return null;
    return this.data.customers.find((c) => c.customerId === this.customerId) ?? this.data.customers[0] ?? null;
  }

  hasPreset(key: PresetKey): boolean {
    return !!this.world?.presets[key];
  }

  preset(key: PresetKey, instant = false) {
    const p = this.world?.presets[key];
    if (!p) return;
    this.rig.flyTo(p.target, p.eye, instant || this.opts.reducedMotion);
  }

  /** Flies to one piece of equipment (rack item, pole or box). False when it is not drawn. */
  focusEquipment(id: string): boolean {
    const f = this.world?.focus.get(id);
    if (!f) return false;
    const d = Math.max(1.4, f.size * 3);
    this.rig.flyTo(f.at, f.at.clone().add(new THREE.Vector3(d * 0.35, d * 0.45, d)), this.opts.reducedMotion);
    return true;
  }

  /** Selects a customer: flies to the house, shows the beam, highlights its drop, fades the rest. */
  selectCustomer(customerId: string | null) {
    this.customerId = customerId;
    const c = customerId ? this.data?.customers.find((x) => x.customerId === customerId) : undefined;
    this.world?.houses?.highlight(c?.houseId ?? null);
    if (c?.ponKey) this.ponKey = c.ponKey;
    this.applyFiberState();
    this.world?.rebuildGallery(this.ponKey, this.currentCustomer(), this.opts.labels);
    this.refreshShadows();
    const house = c ? this.data?.houses.find((h) => h.id === c.houseId) : undefined;
    if (house) {
      const t = new THREE.Vector3(house.position.x, 1.5, house.position.z);
      const front = new THREE.Vector3(Math.sin(house.yaw), 0, Math.cos(house.yaw));
      this.rig.flyTo(
        t,
        t
          .clone()
          .add(front.multiplyScalar(14))
          .add(new THREE.Vector3(4, 7, 0)),
        this.opts.reducedMotion,
      );
    }
  }

  setFilter(filter: FiberFilter) {
    this.filter = filter;
    if (filter.kind === 'pon') this.ponKey = filter.ponKey;
    if (filter.kind !== 'all') {
      this.customerId = null;
      this.world?.houses?.highlight(null);
    }
    this.applyFiberState();
    if (filter.kind === 'pon') {
      this.world?.rebuildGallery(this.ponKey, this.currentCustomer(), this.opts.labels);
      this.refreshShadows();
    }
  }

  private frameNo = 0;
  private tmp = new THREE.Vector3();

  /**
   * Hides floating labels smaller than 8 px on screen: unreadable, and each is a draw call.
   * They come back as the camera gets closer. House number tags are one draw call and stay.
   */
  private cullLabels(w: World) {
    const h = this.renderer.domElement.clientHeight || 1;
    const k = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const camPos = this.camera.position;
    const width = this.renderer.domElement.clientWidth || 1;
    // Names that stay readable from far away (OLT, FDT, FAT): the most important first, and one
    // that would cover another is hidden, so they never pile up.
    const kept: { o: THREE.Object3D; pr: number; d: number }[] = [];
    const placed: [number, number, number, number][] = [];
    for (const group of [w.kit.labels, w.galleryKit.labels]) {
      for (const o of group.children) {
        if (!(o as THREE.Sprite).isSprite) continue;
        const d = this.tmp.copy(o.position).distanceTo(camPos);
        const base = o.userData.baseScale as THREE.Vector2 | undefined;
        const minPx = o.userData.minPx as number | undefined;
        if (base && minPx) {
          const px = (base.y * k) / Math.max(0.01, d);
          const grow = THREE.MathUtils.clamp(minPx / px, 1, 3000);
          o.scale.set(base.x * grow, base.y * grow, 1);
          kept.push({ o, pr: (o.userData.priority as number | undefined) ?? 1, d });
          continue;
        }
        o.visible = (o.scale.y * k) / Math.max(0.01, d) >= 8;
      }
    }
    this.declutter(kept, placed, k, width, h);
  }

  /** Shows the kept labels that do not cover a more important (or nearer) one. */
  private declutter(
    kept: { o: THREE.Object3D; pr: number; d: number }[],
    placed: [number, number, number, number][],
    k: number,
    width: number,
    height: number,
  ) {
    kept.sort((a, b) => b.pr - a.pr || a.d - b.d);
    for (const { o, d } of kept) {
      const p = this.tmp.copy(o.position).project(this.camera);
      if (p.z > 1 || p.z < -1) {
        o.visible = false;
        continue;
      }
      const hw = (o.scale.x * k) / Math.max(0.01, d) / 2 + 3;
      const hh = (o.scale.y * k) / Math.max(0.01, d) / 2 + 2;
      const x = ((p.x + 1) / 2) * width;
      const y = ((1 - p.y) / 2) * height;
      const hit = placed.some((r) => x - hw < r[2] && x + hw > r[0] && y - hh < r[3] && y + hh > r[1]);
      o.visible = !hit;
      if (!hit) placed.push([x - hw, y - hh, x + hw, y + hh]);
    }
  }

  private shadowAt: THREE.Vector3 | null = null;
  private shadowSize = 0;

  /**
   * Keeps the sun's shadow box around what the camera looks at, sized to the camera distance, so
   * poles, boxes and houses cast shadows anywhere in a network kilometres wide. The shadow map is
   * drawn again only when the camera has moved a good part of the box.
   */
  private followShadows(force = false) {
    const t = this.rig.target;
    const dist = this.camera.position.distanceTo(t);
    const s = THREE.MathUtils.clamp(dist * 1.2, 30, 220);
    const moved = this.shadowAt ? Math.hypot(t.x - this.shadowAt.x, t.z - this.shadowAt.z) : Infinity;
    const resized = Math.abs(s - this.shadowSize) > this.shadowSize * 0.35;
    if (!force && moved < this.shadowSize * 0.3 && !resized) return;
    this.shadowAt = t.clone();
    this.shadowSize = s;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 6 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.position.set(t.x + s * 0.7, s * 1.9, t.z + s * 0.9);
    this.sun.target.position.set(t.x, 0, t.z);
    this.sun.target.updateMatrixWorld();
    this.refreshShadows();
  }

  /** A soft sky: deeper blue overhead, pale at the horizon (flat colour at night). */
  private skyTexture: THREE.Texture | null = null;
  private makeSky(dark: boolean): THREE.Texture | THREE.Color {
    this.skyTexture?.dispose();
    this.skyTexture = null;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d');
    if (!g) return new THREE.Color(dark ? SKY.dark : SKY.light);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    if (dark) {
      grad.addColorStop(0, '#05080d');
      grad.addColorStop(1, '#141c26');
    } else {
      grad.addColorStop(0, '#5b9bd8');
      grad.addColorStop(0.55, '#a9cdea');
      grad.addColorStop(1, '#dfe9f1');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.skyTexture = t;
    return t;
  }

  /** Draws the shadow map once on the next frame. */
  private refreshShadows() {
    this.renderer.shadowMap.needsUpdate = true;
  }

  private applyFiberState() {
    this.world?.fibers.apply(this.filter, this.customerId);
  }

  setLabels(on: boolean) {
    this.opts.labels = on;
    if (this.world) this.world.kit.labels.visible = on;
    if (this.world) this.world.galleryKit.labels.visible = on;
  }

  /** New label words (the language changed): the world is drawn again, the camera stays. */
  setText(text: LabelText) {
    if (this.opts.text === text) return;
    this.opts.text = text;
    if (this.data) this.setScene(this.data);
  }

  setPulses(on: boolean) {
    this.opts.pulses = on;
  }

  setTheme(dark: boolean) {
    if (this.opts.dark === dark) return;
    this.opts.dark = dark;
    this.applyTheme();
    if (this.data) this.setScene(this.data);
  }

  private applyTheme() {
    const sky = this.opts.dark ? SKY.dark : SKY.light;
    this.scene3.background = this.makeSky(this.opts.dark);
    if (this.scene3.fog) (this.scene3.fog as THREE.Fog).color.setHex(sky);
    this.hemi.intensity = this.opts.dark ? 0.5 : 0.9;
    this.ground?.setDark(this.opts.dark);
    this.sun.intensity = this.opts.dark ? 1.1 : 1.6;
    this.renderer.toneMappingExposure = this.opts.dark ? 1 : 1.05;
  }

  /** On-screen buttons: zoom in or out a step, turn left or right. */
  nav(action: 'in' | 'out' | 'left' | 'right') {
    if (action === 'in') this.rig.zoom(0.6);
    else if (action === 'out') this.rig.zoom(1.6);
    else this.rig.rotate(action === 'left' ? -70 : 70, 0);
  }

  /** Double click on the ground: go there, three times closer. */
  private flyToGround(clientX: number, clientY: number) {
    const g = this.rig.groundAt(clientX, clientY);
    if (!g) return;
    const o = this.camera.position.clone().sub(this.rig.target);
    o.setLength(Math.max(25, o.length() * 0.33));
    const t = new THREE.Vector3(g.x, 1, g.z);
    this.rig.flyTo(t, t.clone().add(o), this.opts.reducedMotion);
    this.events.onUserMove?.();
  }

  /**
   * What a tap hits on screen before any 3D test: a name label, or (from far away, when they
   * stand in for the models) the dot of a box, an office or a house. Null when nothing is near.
   */
  private pickOnScreen(clientX: number, clientY: number): PickInfo | null {
    const w = this.world;
    const d = this.data;
    if (!w || !d) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const k = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const at = (x: number, y: number, z: number): [number, number] | null => {
      const p = this.tmp.set(x, y, z).project(this.camera);
      if (p.z > 1 || p.z < -1) return null;
      return [((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height];
    };
    if (w.kit.labels.visible)
      for (const o of w.kit.labels.children) {
        const pick = o.userData.pick as PickInfo | undefined;
        if (!pick || !o.visible) continue;
        const dist = o.position.distanceTo(this.camera.position);
        const s = at(o.position.x, o.position.y, o.position.z);
        if (!s) continue;
        const hw = (o.scale.x * k) / Math.max(0.01, dist) / 2;
        const hh = (o.scale.y * k) / Math.max(0.01, dist) / 2;
        if (Math.abs(px - s[0]) <= hw + 2 && Math.abs(py - s[1]) <= hh + 2) return pick;
      }
    if (!w.far.visible) return null;
    let best: PickInfo | null = null;
    let bestD = 16;
    const near = (x: number, y: number, z: number, pick: PickInfo, bias = 0) => {
      const s = at(x, y, z);
      if (!s) return;
      const dd = Math.hypot(px - s[0], py - s[1]) - bias;
      if (dd < bestD) {
        bestD = dd;
        best = pick;
      }
    };
    for (const r of d.racks) {
      const olt = r.items.find((i) => i.kind === 'olt');
      if (olt?.kind === 'olt') near(r.position.x, 4, r.position.z, { kind: 'equipment', id: olt.olt.equipmentId }, 4);
    }
    for (const b of d.boxes)
      near(b.position.x, b.model === 'fat' ? 6 : 6.5, b.position.z, { kind: 'equipment', id: b.id }, 2);
    for (const h of d.houses) near(h.position.x, 3, h.position.z, { kind: 'house', houseId: h.id });
    return best;
  }

  private pickAt(clientX: number, clientY: number) {
    if (!this.world) return;
    const onScreen = this.pickOnScreen(clientX, clientY);
    if (onScreen) {
      // Picked by its name or dot from far away: go to it so it can be seen.
      if (onScreen.kind === 'equipment') this.focusEquipment(onScreen.id);
      this.events.onPick(onScreen);
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const houses = this.world.houses;
    // Only what can be picked: the pick boxes and the houses, not the whole scene (threejs-interaction skill).
    const hits = this.raycaster.intersectObjects(this.world.pickTargets, false);
    for (const h of hits) {
      if (houses && h.object === houses.walls && h.instanceId !== undefined) {
        const house = houses.houses[h.instanceId];
        if (house) {
          this.events.onPick({ kind: 'house', houseId: house.id });
          return;
        }
      }
      const info = pickOf(h.object);
      if (info) {
        this.events.onPick(info);
        return;
      }
    }
    this.events.onPick(null);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.timer.reset();
    this.fpsAt = this.timer.getElapsed();
    this.frames = 0;
    // setAnimationLoop rather than a hand-made requestAnimationFrame loop (threejs-fundamentals skill).
    // The timer reads performance.now() itself: the loop's timestamp can be a little earlier than
    // the reset above, which would make the first frame's time negative.
    this.renderer.setAnimationLoop(() => {
      this.timer.update();
      this.frame();
    });
  }

  private stop() {
    this.renderer.setAnimationLoop(null);
    this.running = false;
  }

  private frame() {
    const dt = Math.min(0.25, Math.max(0, this.timer.getDelta()));
    const t = this.timer.getElapsed();
    // Time-based easing: the camera settles in about a second at any frame rate.
    this.rig.update(this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.5));
    // Near and far planes follow the camera distance: sharp depth close to a rack, and the whole
    // of a 5 km network in view from high up.
    const dist = this.camera.position.distanceTo(this.rig.target);
    const near = THREE.MathUtils.clamp(dist * 0.002, 0.05, 20);
    const far = Math.max(6000, dist * 6);
    if (Math.abs(near - this.camera.near) > near * 0.2 || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    const w = this.world;
    if (w) {
      const animate = !this.opts.reducedMotion;
      w.kit.tickLeds(animate ? t : 0);
      w.galleryKit.tickLeds(animate ? t : 0);
      if (animate) for (const s of w.kit.spinners) s.object.rotation.z = t * s.speed;
      w.fibers.tick(t, this.opts.pulses && animate);
      if (this.frameNo++ % 8 === 0) {
        this.cullLabels(w);
        // From far away houses and cables are thinner than a pixel: dots and lines stand in.
        w.far.visible = this.camera.position.y > 90;
        if (this.frameNo % 32 === 1) {
          const at = this.rig.target;
          this.ground.focus({ x: at.x, z: at.z }, this.camera.position.distanceTo(at));
          this.followShadows();
        }
      }
    }
    this.renderer.render(this.scene3, this.camera);
    // Development only: draw calls and triangles for `npm run check:3d`.
    if (import.meta.env.DEV) {
      const r = this.renderer.info.render;
      (window as unknown as { __view3dInfo?: object }).__view3dInfo = {
        calls: r.calls,
        triangles: r.triangles,
        pixelRatio: this.pixelRatio,
        shadows: this.renderer.shadowMap.enabled,
      };
    }
    // Frame rate: lower the pixel ratio when a phone cannot keep up.
    this.frames += 1;
    if (t - this.fpsAt >= 1) {
      const fps = this.frames / (t - this.fpsAt);
      this.frames = 0;
      this.fpsAt = t;
      if (fps < 28 && this.pixelRatio > 1) {
        this.lowFpsSeconds += 1;
        if (this.lowFpsSeconds >= 2) {
          this.pixelRatio = Math.max(1, this.pixelRatio - 0.5);
          this.renderer.setPixelRatio(this.pixelRatio);
          this.resize();
          this.lowFpsSeconds = 0;
        }
      } else this.lowFpsSeconds = 0;
      this.events.onStats?.({ fps: Math.round(fps), pixelRatio: this.pixelRatio });
    }
  }

  focusCanvas() {
    this.renderer.domElement.focus();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.timer.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver?.disconnect();
    this.rig.dispose();
    this.world?.dispose();
    this.world = null;
    this.ground.dispose();
    this.skyTexture?.dispose();
    this.env?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
