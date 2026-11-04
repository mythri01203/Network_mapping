import type { Equipment } from '@fibergis/shared';

const POLE_NAME = /^Pole-(\d+)$/;

/**
 * Next free "Pole-NN" name. Numbering continues after the highest existing number,
 * so deleting a pole never produces a duplicate name.
 */
export function nextPoleName(equipment: readonly Pick<Equipment, 'name'>[]): string {
  let highest = 0;
  for (const { name } of equipment) {
    const match = POLE_NAME.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Pole-${String(highest + 1).padStart(2, '0')}`;
}
