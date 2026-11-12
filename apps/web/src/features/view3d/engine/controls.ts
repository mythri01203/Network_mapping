import * as THREE from 'three';

/**
 * Map-style camera without extra libraries: drag moves over the ground (like the 2D map),
 * right-drag or Shift-drag turns and tilts, the wheel or a pinch zooms towards the point under the
 * pointer, a two-finger twist turns, and arrow keys / + / - work when the canvas has focus. The
 * camera eases towards its target, so presets fly smoothly.
 */
export class OrbitRig {
  /** Where the camera looks and stands (goals). */
  readonly target = new THREE.Vector3();
  readonly eye = new THREE.Vector3(30, 30, 30);
  /** Where it is now, easing towards the goals. */
  private lookAt = new THREE.Vector3();
  private pos = new THREE.Vector3(30, 30, 30);
  private pointers = new Map<number, { x: number; y: number; button: number; shift: boolean }>();
  private pinch = 0;
  private twist = 0;
  private downAt: [number, number] | null = null;
  private lastTap = 0;
  /** Double tap or double click on the ground. */
  onDoubleTap: ((clientX: number, clientY: number) => void) | null = null;
  minDistance = 0.4;
  maxDistance = 2000;
  /** Set when the person moved the camera themselves, so callers can clear a preset highlight. */
  onUserMove: (() => void) | null = null;
  onTap: ((clientX: number, clientY: number) => void) | null = null;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(
    private camera: THREE.PerspectiveCamera,
    private el: HTMLElement,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      name: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(name, fn as EventListener, opts);
      this.listeners.push([el, name, fn as EventListener, opts]);
    };
    on('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      if (this.pointers.size === 1) this.downAt = [e.clientX, e.clientY];
      if (this.pointers.size === 2) {
        this.pinch = this.pinchDistance();
        this.twist = this.pinchAngle();
      }
    });
    on('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        const [a, b] = [...this.pointers.values()];
        this.zoomAt(this.pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.pinch = d;
        // Twisting two fingers turns the view.
        const angle = this.pinchAngle();
        let turn = angle - this.twist;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        this.twist = angle;
        if (Math.abs(turn) > 0.002) this.rotate(turn / 0.006, 0);
        return;
      }
      if (p.button === 2 || p.shift) this.rotate(dx, dy);
      else this.move(dx, dy);
    });
    const up = (e: PointerEvent) => {
      if (
        this.downAt &&
        this.pointers.size === 1 &&
        Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) < 6
      ) {
        const now = performance.now();
        if (now - this.lastTap < 350) {
          this.lastTap = 0;
          this.onDoubleTap?.(e.clientX, e.clientY);
        } else {
          this.lastTap = now;
          this.onTap?.(e.clientX, e.clientY);
        }
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.downAt = null;
    };
    on('pointerup', up);
    on('pointercancel', (e) => this.pointers.delete(e.pointerId));
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        // A mouse wheel sends big steps, a touchpad many small ones; both feel the same this way.
        const step = Math.max(-240, Math.min(240, e.deltaY));
        this.zoomAt(Math.exp(step * 0.0022), e.clientX, e.clientY);
      },
      { passive: false },
    );
    on('contextmenu', (e) => e.preventDefault());
    on('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft') this.rotate(-30, 0);
      else if (k === 'ArrowRight') this.rotate(30, 0);
      else if (k === 'ArrowUp' && e.shiftKey) this.pan(0, 30);
      else if (k === 'ArrowDown' && e.shiftKey) this.pan(0, -30);
      else if (k === 'ArrowUp') this.rotate(0, -30);
      else if (k === 'ArrowDown') this.rotate(0, 30);
      else if (k === '+' || k === '=') this.zoom(0.85);
      else if (k === '-' || k === '_') this.zoom(1.18);
      else return;
      e.preventDefault();
    });
  }

  private pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  private pinchAngle() {
    const [a, b] = [...this.pointers.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private offset() {
    return this.eye.clone().sub(this.target);
  }

  /** The point on the ground under a screen position, or null when it looks at the sky. */
  groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const dir = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();
    if (dir.y > -1e-3) return null;
    const t = -this.camera.position.y / dir.y;
    if (!Number.isFinite(t) || t > this.maxDistance * 4) return null;
    return this.camera.position.clone().addScaledVector(dir, t);
  }

  /** Zooms towards the ground point under the pointer, as a map does. */
  zoomAt(f: number, clientX: number, clientY: number) {
    const g = this.groundAt(clientX, clientY);
    const before = this.offset().length();
    this.zoom(f);
    const k = this.offset().length() / (before || 1);
    if (!g || k === 1) return;
    const shift = new THREE.Vector3((g.x - this.target.x) * (1 - k), 0, (g.z - this.target.z) * (1 - k));
    this.target.add(shift);
    this.eye.add(shift);
    this.lookAt.copy(this.target);
    this.pos.copy(this.eye);
  }

  /** Moves over the ground: the map follows the finger. */
  move(dx: number, dy: number) {
    const o = this.offset();
    const len = o.length();
    const h = this.el.clientHeight || 1;
    const k = (2 * len * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const m = this.camera.matrix.elements;
    const right = new THREE.Vector3(m[0], 0, m[2]).normalize();
    const fwd = new THREE.Vector3(-o.x, 0, -o.z);
    if (fwd.lengthSq() < 1e-9) fwd.set(-m[8], 0, -m[10]);
    fwd.normalize();
    // Looking flat along the ground, a finger's width covers more of it.
    const tilt = Math.max(0.3, o.y / (len || 1));
    const v = right.multiplyScalar(-dx * k).add(fwd.multiplyScalar((dy * k) / tilt));
    this.target.add(v);
    this.eye.add(v);
    this.lookAt.copy(this.target);
    this.pos.copy(this.eye);
    this.onUserMove?.();
  }

  zoom(f: number) {
    const o = this.offset();
    o.setLength(Math.min(this.maxDistance, Math.max(this.minDistance, o.length() * f)));
    this.eye.copy(this.target).add(o);
    this.pos.copy(this.eye);
    this.onUserMove?.();
  }

  rotate(dx: number, dy: number) {
    const s = new THREE.Spherical().setFromVector3(this.offset());
    s.theta -= dx * 0.006;
    s.phi = Math.min(3, Math.max(0.1, s.phi - dy * 0.006));
    this.eye.copy(this.target).add(new THREE.Vector3().setFromSpherical(s));
    this.pos.copy(this.eye);
    this.onUserMove?.();
  }

  pan(dx: number, dy: number) {
    const k = this.offset().length() * 0.0016;
    const m = this.camera.matrix.elements;
    const v = new THREE.Vector3(m[0], m[1], m[2])
      .multiplyScalar(-dx * k)
      .add(new THREE.Vector3(m[4], m[5], m[6]).multiplyScalar(dy * k));
    this.target.add(v);
    this.eye.add(v);
    this.lookAt.copy(this.target);
    this.pos.copy(this.eye);
    this.onUserMove?.();
  }

  /** Flies to a new view. `instant` jumps (first frame, reduced motion). */
  flyTo(target: THREE.Vector3, eye: THREE.Vector3, instant = false) {
    this.target.copy(target);
    this.eye.copy(eye);
    if (instant) {
      this.lookAt.copy(target);
      this.pos.copy(eye);
    }
  }

  /** Eases one frame. Returns true while still moving. */
  update(ease = 0.06): boolean {
    this.lookAt.lerp(this.target, ease);
    this.pos.lerp(this.eye, ease);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrix();
    return this.pos.distanceToSquared(this.eye) > 1e-6 || this.lookAt.distanceToSquared(this.target) > 1e-6;
  }

  dispose() {
    for (const [t, n, f, o] of this.listeners) t.removeEventListener(n, f, o);
    this.listeners = [];
  }
}
