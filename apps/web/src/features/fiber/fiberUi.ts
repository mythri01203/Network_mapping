/** Small helpers shared by the fiber screens. */
import type { CoreStatus } from '@fibergis/shared';

/** A mark for each core state, so the state is never told by colour alone. */
export const STATUS_MARK: Partial<Record<CoreStatus, string>> = {
  'In Use': '●',
  Reserved: '◐',
  Damaged: '✕',
  Faulty: '!',
  Retired: '—',
  Spliced: '⋈',
  Available: '○',
  Dark: '○',
};

export interface FiberChoice {
  cableId: string;
  core: string;
}

export const emptyFiber: FiberChoice = { cableId: '', core: '' };

/** A parsed choice, or null when either part is missing. */
export const fiberOf = (choice: FiberChoice): { cableId: string; core: number } | null =>
  choice.cableId && choice.core && Number(choice.core) > 0 ? { cableId: choice.cableId, core: Number(choice.core) } : null;

/** Places where fibers are spliced or split can hold a closure record. */
export const hostsClosure = (type: string) =>
  /Closure|Splice Joint|FDT|FDMS|Distribution Cabinet|Terminal Box|^FAT$|Distribution Point/.test(type);
export const hostsSplitters = (type: string) =>
  /Splitter|Coupler|Closure|FDT|FDMS|Distribution Cabinet|Terminal Box|^FAT$|Distribution Point/.test(type);

/** "Shelf 0, Slot 5, Port 0" → ordered parts. The last word of each piece is the value. */
export function parsePartsText(text: string) {
  return text
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const i = piece.lastIndexOf(' ');
      return i > 0 ? { label: piece.slice(0, i).trim(), value: piece.slice(i + 1).trim() } : { label: 'Level', value: piece };
    })
    .slice(0, 8);
}
