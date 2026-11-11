import { type CatalogComponent, catalogPlacementTemplate, type Equipment } from '@fibergis/shared';

/**
 * What a picked catalog item contributes to the equipment placed from it (Phase 2). Never its name:
 * each item gets its own (poles the next number), so a street of boxes is not ten "PLC Splitter"s.
 * Never its description as notes: that describes the product, not this item.
 */
export function placementTemplate(
  item: Pick<CatalogComponent, 'id' | 'type' | 'category' | 'defaultPorts' | 'manufacturer' | 'model'>,
): Partial<Equipment> {
  return catalogPlacementTemplate({ name: '', description: '', iconBg: '', ...item } as CatalogComponent);
}
