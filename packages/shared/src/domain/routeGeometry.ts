import type { LatLng } from '../model/types';
import { isLatLngPair, isValidCoordinate } from './defaults';
import { distanceMeters } from './fieldCapture';
import { pointToLine } from './outsidePlant';

/**
 * Phase 5: pure edits of a drawn line (a cable or a duct route). They only change points on the
 * map; they never connect, disconnect or measure anything. Each edit is one step, so the commands
 * built on them are one undo step each.
 */

export type RouteEnd = 'start' | 'end';

export type RouteEdit =
  /** Put point `index` somewhere else. */
  | { kind: 'move'; index: number; to: LatLng }
  /** Add a point. With `afterIndex` it goes after that point; without, into the nearest part of the line. */
  | { kind: 'insert'; point: LatLng; afterIndex?: number }
  /** Take point `index` out. The line stays joined through its neighbours. */
  | { kind: 'remove'; index: number }
  /** Add points beyond one end, in the order tapped (outwards from that end). */
  | { kind: 'extend'; end: RouteEnd; points: LatLng[] }
  /** Cut the line at point `index`, removing everything on the `remove` side of it. */
  | { kind: 'trim'; index: number; remove: RouteEnd };

export type RouteEditResult = { ok: true; points: LatLng[]; summary: string } | { ok: false; reason: string };

const validPoint = (p: unknown): p is LatLng => isLatLngPair(p) && isValidCoordinate(p[0], p[1]);
const validIndex = (points: readonly LatLng[], index: number) => Number.isInteger(index) && index >= 0 && index < points.length;

/** The part of the line a new point fits best: the point goes after the returned index. */
export function nearestSegmentIndex(points: readonly LatLng[], point: LatLng): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = pointToLine(point, [points[i], points[i + 1]])?.distanceMeters ?? Infinity;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** The point of the line closest to `point` within `toleranceMeters`, or -1. */
export function vertexNear(points: readonly LatLng[], point: LatLng, toleranceMeters: number): number {
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((p, i) => {
    const d = distanceMeters(p, point);
    if (d <= toleranceMeters && d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** Indexes of every point of the line within `toleranceMeters` of `point`. */
export function verticesNear(points: readonly LatLng[], point: LatLng, toleranceMeters: number): number[] {
  return points.flatMap((p, i) => (distanceMeters(p, point) <= toleranceMeters ? [i] : []));
}

const numberOf = (index: number) => `point ${index + 1}`;

/** Applies one edit to a line. Refuses an edit that leaves fewer than two points or names a point that is not there. */
export function applyRouteEdit(points: readonly LatLng[], edit: RouteEdit): RouteEditResult {
  if (points.length < 2) return { ok: false, reason: 'This line is not drawn yet. Draw it first.' };
  switch (edit.kind) {
    case 'move': {
      if (!validIndex(points, edit.index)) return { ok: false, reason: 'That point is not on this line.' };
      if (!validPoint(edit.to)) return { ok: false, reason: 'The new place is not a valid map position.' };
      const next = points.map((p, i) => (i === edit.index ? ([edit.to[0], edit.to[1]] as LatLng) : p));
      return { ok: true, points: next, summary: `moved ${numberOf(edit.index)}` };
    }
    case 'insert': {
      if (!validPoint(edit.point)) return { ok: false, reason: 'The new point is not a valid map position.' };
      const after = edit.afterIndex ?? nearestSegmentIndex(points, edit.point);
      if (!Number.isInteger(after) || after < 0 || after >= points.length - 1) {
        return { ok: false, reason: 'A new point goes between two points of the line. To add beyond an end, use Extend.' };
      }
      const next = [...points.slice(0, after + 1), [edit.point[0], edit.point[1]] as LatLng, ...points.slice(after + 1)];
      return { ok: true, points: next, summary: `added a point after ${numberOf(after)}` };
    }
    case 'remove': {
      if (!validIndex(points, edit.index)) return { ok: false, reason: 'That point is not on this line.' };
      if (points.length <= 2) return { ok: false, reason: 'A line needs at least two points, so this one cannot be removed.' };
      return { ok: true, points: points.filter((_, i) => i !== edit.index), summary: `removed ${numberOf(edit.index)}` };
    }
    case 'extend': {
      if (edit.points.length === 0) return { ok: false, reason: 'Tap at least one new point beyond the end.' };
      if (!edit.points.every(validPoint)) return { ok: false, reason: 'A new point is not a valid map position.' };
      const added = edit.points.map((p) => [p[0], p[1]] as LatLng);
      const next = edit.end === 'end' ? [...points, ...added] : [...[...added].reverse(), ...points];
      return { ok: true, points: next, summary: `extended the ${edit.end === 'end' ? 'To' : 'From'} end by ${added.length} point(s)` };
    }
    case 'trim': {
      if (!validIndex(points, edit.index)) return { ok: false, reason: 'That point is not on this line.' };
      const next = edit.remove === 'start' ? points.slice(edit.index) : points.slice(0, edit.index + 1);
      if (next.length === points.length) return { ok: false, reason: 'Nothing would be cut off there. Tap a point nearer the middle.' };
      if (next.length < 2) return { ok: false, reason: 'That would leave less than two points. Tap a point nearer the other end.' };
      return { ok: true, points: next, summary: `cut off the ${edit.remove === 'start' ? 'From' : 'To'} end at ${numberOf(edit.index)}` };
    }
  }
}

/** Which ends of the line are drawn somewhere else after an edit. */
export function endsMoved(before: readonly LatLng[], after: readonly LatLng[]): { start: boolean; end: boolean } {
  const same = (a: LatLng | undefined, b: LatLng | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  return { start: !same(before[0], after[0]), end: !same(before[before.length - 1], after[after.length - 1]) };
}

/**
 * Share (0 to 1) of line `a` lying within `corridorMeters` of line `b`, sampled along `a` about
 * every corridor width (at most 400 samples). Both lines need two points or more; otherwise 0.
 */
export function routeOverlapRatio(a: readonly LatLng[], b: readonly LatLng[], corridorMeters: number): number {
  if (a.length < 2 || b.length < 2 || !(corridorMeters > 0)) return 0;
  const samples: LatLng[] = [];
  let total = 0;
  for (let i = 0; i < a.length - 1; i += 1) total += distanceMeters(a[i], a[i + 1]);
  const step = Math.max(corridorMeters / 2, total / 400);
  for (let i = 0; i < a.length - 1; i += 1) {
    const [p, q] = [a[i], a[i + 1]];
    const length = distanceMeters(p, q);
    const parts = Math.max(1, Math.ceil(length / step));
    for (let j = 0; j < parts; j += 1) {
      const t = j / parts;
      samples.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  samples.push(a[a.length - 1]);
  const inside = samples.filter((s) => (pointToLine(s, b)?.distanceMeters ?? Infinity) <= corridorMeters).length;
  return inside / samples.length;
}
