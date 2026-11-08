import { type Equipment, equipmentIdPrefix, nextNumberedName } from '@fibergis/shared';

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

/**
 * The name shown for a new item nobody has named yet, such as "FAT-08" (Phase 9). The record's
 * permanent ID is random (`FAT-7K2M9XPQ4A`); this short number is only for people to read.
 */
export function newEquipmentName(type: string, equipment: readonly Pick<Equipment, 'id' | 'name'>[]): string {
  if (type.includes('Pole')) return nextPoleName(equipment);
  return nextNumberedName(equipmentIdPrefix(type), equipment);
}
