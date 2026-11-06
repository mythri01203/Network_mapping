import type { CatalogComponent, Equipment } from '@fibergis/shared';

/**
 * What a picked catalog item contributes to the equipment placed from it. Poles leave out the name
 * so they keep their automatic sequential numbering.
 */
export function placementTemplate(
  item: Pick<CatalogComponent, 'type' | 'name' | 'description' | 'defaultPorts'>,
): Partial<Equipment> {
  return {
    ...(item.type.includes('Pole') ? {} : { name: item.name }),
    totalPorts: item.defaultPorts,
    notes: item.description,
  };
}
