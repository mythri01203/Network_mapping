import type { CoreCrossSection, CoreStatus, CrossSectionFiber, CrossSectionTube } from '@fibergis/shared';

/**
 * Where to draw each tube and fiber of a cable cross-section, in a 300 x 300 box. Only geometry:
 * colours and states come from `coreCrossSection` (shared), so nothing is decided here.
 */

export const VIEW_SIZE = 300;
const CENTER = VIEW_SIZE / 2;
/** Room inside the outer sheath circle. */
const INNER = CENTER - 10;

export interface PlacedFiber {
  fiber: CrossSectionFiber;
  x: number;
  y: number;
  r: number;
  /** Big enough to print the fiber number inside. */
  showNumber: boolean;
}

export interface PlacedTube {
  tube: CrossSectionTube;
  x: number;
  y: number;
  r: number;
  /** Fibers sit on a ring, leaving the centre free for the tube number. */
  labelInside: boolean;
  fibers: PlacedFiber[];
}

/** Largest radius for n equal circles on a ring inside a circle of radius `room`. */
function ringFit(n: number, room: number): { r: number; ring: number } {
  if (n <= 1) return { r: room, ring: 0 };
  const s = Math.sin(Math.PI / n);
  const r = (room * s) / (1 + s);
  return { r, ring: room - r };
}

function placeFibers(fibers: readonly CrossSectionFiber[], cx: number, cy: number, tubeR: number): { placed: PlacedFiber[]; ring: boolean } {
  const k = fibers.length;
  if (k === 0) return { placed: [], ring: true };
  const room = tubeR * 0.86;
  if (k === 1) return { placed: [{ fiber: fibers[0], x: cx, y: cy, r: room * 0.5, showNumber: room * 0.5 >= 6 }], ring: false };
  if (k <= 12) {
    const { r, ring } = ringFit(k, room);
    const fr = r * 0.9;
    return {
      ring: true,
      placed: fibers.map((fiber, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / k;
        return { fiber, x: cx + ring * Math.cos(a), y: cy + ring * Math.sin(a), r: fr, showNumber: fr >= 6 };
      }),
    };
  }
  // Many fibers in one tube (or no tubes recorded): a sunflower spiral packs them evenly.
  const c = (room * 0.92) / Math.sqrt(k);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const fr = c * 0.44;
  return {
    ring: false,
    placed: fibers.map((fiber, i) => {
      const rr = c * Math.sqrt(i + 0.5);
      const a = -Math.PI / 2 + i * golden;
      return { fiber, x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r: fr, showNumber: fr >= 6 };
    }),
  };
}

export function layoutCrossSection(section: CoreCrossSection): PlacedTube[] {
  const n = section.tubes.length;
  if (n === 0) return [];
  const { r, ring } = ringFit(n, INNER);
  const tubeR = n === 1 ? INNER * 0.92 : r * 0.94;
  return section.tubes.map((tube, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = n === 1 ? CENTER : CENTER + ring * Math.cos(a);
    const y = n === 1 ? CENTER : CENTER + ring * Math.sin(a);
    const { placed, ring: onRing } = placeFibers(tube.fibers, x, y, tubeR);
    return { tube, x, y, r: tubeR, labelInside: onRing && tube.fibers.length >= 3 && tubeR >= 14, fibers: placed };
  });
}

/** The marker drawn on a fiber for its state, so the state is never told by colour alone. */
export type StatusMarker = 'dot' | 'ring' | 'cross' | 'slash' | 'none';

export function markerFor(status: CoreStatus): StatusMarker {
  switch (status) {
    case 'In Use':
    case 'Spliced':
      return 'dot';
    case 'Reserved':
      return 'ring';
    case 'Damaged':
    case 'Faulty':
      return 'cross';
    case 'Retired':
      return 'slash';
    default:
      return 'none';
  }
}

export const MARKER_LEGEND: { marker: StatusMarker; text: string }[] = [
  { marker: 'dot', text: 'in use or spliced' },
  { marker: 'ring', text: 'reserved' },
  { marker: 'cross', text: 'damaged or faulty' },
  { marker: 'slash', text: 'retired' },
];
