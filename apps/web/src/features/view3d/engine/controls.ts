import * as THREE from 'three';

/**
 * Orbit, pan and zoom without extra libraries, the same feel as the prototype: drag to orbit,
 * right-drag or Shift-drag to pan, wheel or pinch to zoom, and arrow keys / + / - when the canvas
 * has focus. The camera eases towards its target, so presets fly smoothly.
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
  private downAt: [number, number] | null = null;
  minDistance = 0.4;
  maxDistance = 2000;
  /** Set when the person moved the camera themselves, so callers can clear a preset highlight. */
  onUserMove: (() => void) | null = null;
  onTap: ((clientX: number, clientY: number) => void) | null = null;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(
    private camera: THREE.PerspectiveCamera,
    el: HTMLElement,
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
      if (this.pointers.size === 2) this.pinch = this.pinchDistance();
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
        this.zoom(this.pinch / d);
        this.pinch = d;
        return;
      }
      if (p.button === 2 || p.shift) this.pan(dx, dy);
      else this.rotate(dx, dy);
    });
    const up = (e: PointerEvent) => {
      if (
        this.downAt &&
        this.pointers.size === 1 &&
        Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) < 6
      )
        this.onTap?.(e.clientX, e.clientY);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.downAt = null;
    };
    on('pointerup', up);
    on('pointercancel', (e) => this.pointers.delete(e.pointerId));
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.001));
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

  private offset() {
    return this.eye.clone().sub(this.target);
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
