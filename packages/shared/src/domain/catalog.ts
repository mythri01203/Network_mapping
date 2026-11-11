import type { ChangeSet } from '../model/api';
import type { CatalogComponent, Equipment, SpecLine } from '../model/types';

/**
 * Phase 2: the equipment catalogue and the items placed from it.
 *
 * A catalogue entry with a manufacturer and a model is a product model. Items placed from it keep a
 * link (`catalogModelId`) and take its specs; each item may change a line for itself, and that line
 * is shown as changed. A model fills in only what is the same for every unit of it (make, model,
 * port count, specs). Never a serial number, an owner, a place or an install date.
 */

export const isProductModel = (item: Pick<CatalogComponent, 'manufacturer' | 'model'>): boolean =>
  !!item.manufacturer?.trim() && !!item.model?.trim();

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** A plain reason the entry cannot be saved, or null. `existing` is the catalogue before the save. */
export function validateCatalogEntry(existing: readonly CatalogComponent[], item: CatalogComponent): string | null {
  if (!item.name.trim()) return 'Give the entry a name.';
  if (!String(item.type).trim()) return 'Say what kind of equipment it is.';
  if ((item.manufacturer?.trim() && !item.model?.trim()) || (!item.manufacturer?.trim() && item.model?.trim())) {
    return 'A product model needs both the manufacturer and the model, or neither.';
  }
  if (item.defaultPorts !== undefined && (!Number.isInteger(item.defaultPorts) || item.defaultPorts < 0 || item.defaultPorts > 4096)) {
    return 'The port count must be a whole number from 0 to 4096.';
  }
  const keys = (item.specs ?? []).map((s) => norm(s.key));
  const repeated = keys.find((k, i) => keys.indexOf(k) !== i);
  if (repeated) return `The spec "${repeated}" is listed twice. Keep one line per spec.`;
  if (isProductModel(item)) {
    const twin = existing.find(
      (c) => c.id !== item.id && norm(c.manufacturer) === norm(item.manufacturer) && norm(c.model) === norm(item.model),
    );
    if (twin) return `${item.manufacturer} ${item.model} is already in the catalogue ("${twin.name}"). Change that entry instead of adding a second one.`;
  }
  return null;
}

/** Items placed from this catalogue entry. */
export const catalogModelUsers = (equipment: readonly Equipment[], modelId: string): Equipment[] =>
  equipment.filter((e) => e.catalogModelId === modelId);

export type SpecOrigin = 'model' | 'changed' | 'item';

export interface EffectiveSpec extends SpecLine {
  /** `model`: from the catalogue model. `changed`: the model's line, changed for this item. `item`: only on this item. */
  origin: SpecOrigin;
  /** The model's value when the item changed it. */
  modelValue?: string;
}

/** The specs an item has: its model's lines, with the item's own changes and additions marked. */
export function effectiveSpecs(model: CatalogComponent | undefined, item: Pick<Equipment, 'specOverrides'>): EffectiveSpec[] {
  const overrides = new Map((item.specOverrides ?? []).map((s) => [norm(s.key), s]));
  const result: EffectiveSpec[] = [];
  for (const line of model?.specs ?? []) {
    const own = overrides.get(norm(line.key));
    if (own) {
      overrides.delete(norm(line.key));
      result.push({ ...own, key: line.key, origin: 'changed', modelValue: `${line.value}${line.unit ? ` ${line.unit}` : ''}` });
    } else {
      result.push({ ...line, origin: 'model' });
    }
  }
  for (const own of overrides.values()) result.push({ ...own, origin: 'item' });
  return result;
}

/**
 * What placing a catalogue entry fills in: the kind, and for a product model its make, model, link
 * and port count. No name (each item gets its own), no serial, owner, place or install date.
 */
export function catalogPlacementTemplate(item: CatalogComponent): Partial<Equipment> {
  return {
    category: item.category as Equipment['category'],
    ...(item.defaultPorts !== undefined ? { totalPorts: item.defaultPorts, availablePorts: item.defaultPorts } : {}),
    ...(isProductModel(item) ? { catalogModelId: item.id, manufacturer: item.manufacturer!.trim(), model: item.model!.trim() } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Server rules                                                        */
/* ------------------------------------------------------------------ */

export interface CatalogCheckData {
  equipment: readonly Equipment[];
  catalog: readonly CatalogComponent[];
}

export interface CatalogProblem {
  code: 'equipment_model_missing';
  key: string;
  message: string;
  refs: string[];
}

/** Broken links between items and the catalogue: an item naming a model that is not on record. */
export function findCatalogProblems(data: CatalogCheckData): CatalogProblem[] {
  const models = new Set(data.catalog.map((c) => c.id));
  const problems: CatalogProblem[] = [];
  for (const e of data.equipment) {
    if (e.catalogModelId && !models.has(e.catalogModelId)) {
      problems.push({
        code: 'equipment_model_missing',
        key: `equipment_model_missing:${e.id}`,
        message: `${e.name} names catalogue model ${e.catalogModelId}, which is not on record. Choose an existing model, or clear it.`,
        refs: [e.id],
      });
    }
  }
  return problems;
}

export function changeSetTouchesCatalog(changes: ChangeSet): boolean {
  return (['equipment', 'catalog'] as const).some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);
}

/**
 * Problems a change set adds. Deleting a model that items still use leaves them naming nothing, so it
 * is refused. Problems already stored are not blamed on the change.
 */
export function checkChangeSetCatalog(current: CatalogCheckData, changes: ChangeSet): CatalogProblem[] {
  const after = (name: 'equipment' | 'catalog') => {
    const byId = new Map((current[name] as readonly { id: string }[]).map((r) => [r.id, r]));
    for (const id of changes.deletes?.[name] ?? []) byId.delete(id);
    for (const r of (changes.upserts?.[name] ?? []) as { id: string }[]) byId.set(r.id, r);
    return [...byId.values()];
  };
  const old = new Set(findCatalogProblems(current).map((p) => p.key));
  return findCatalogProblems({ equipment: after('equipment') as Equipment[], catalog: after('catalog') as CatalogComponent[] }).filter((p) => !old.has(p.key));
}
