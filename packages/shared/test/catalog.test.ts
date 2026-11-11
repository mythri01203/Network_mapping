import { describe, expect, it } from 'vitest';

import { roleCan } from '../src/domain/access';
import {
  catalogModelUsers,
  catalogPlacementTemplate,
  checkChangeSetCatalog,
  effectiveSpecs,
  findCatalogProblems,
  isProductModel,
  validateCatalogEntry,
} from '../src/domain/catalog';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import type { CatalogComponent, Equipment } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';

const model = (over: Partial<CatalogComponent> = {}): CatalogComponent => ({
  id: 'CAT-1',
  type: 'FAT',
  category: 'Fiber Distribution',
  name: 'Acme FAT-16',
  description: '',
  iconBg: 'bg-blue-700',
  isCustom: true,
  manufacturer: 'Acme',
  model: 'FAT-16',
  defaultPorts: 16,
  specs: [
    { key: 'Ingress protection', value: 'IP65' },
    { key: 'Operating temperature', value: '-40 to 85', unit: '°C' },
  ],
  specSource: 'Datasheet rev 3',
  ...over,
});

const item = (over: Partial<Equipment> = {}): Equipment => ({
  id: 'FAT-A',
  name: 'Box A',
  type: 'FAT',
  category: 'Fiber Distribution',
  lat: 12.9,
  lng: 77.6,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ...over,
});

describe('product models', () => {
  it('is a product model only with both a manufacturer and a model', () => {
    expect(isProductModel(model())).toBe(true);
    expect(isProductModel(model({ model: ' ' }))).toBe(false);
    expect(validateCatalogEntry([], model({ model: undefined }))).toMatch(/both the manufacturer and the model/);
  });

  it('refuses a second entry for the same make and model, and a spec listed twice', () => {
    expect(validateCatalogEntry([model()], model({ id: 'CAT-2', manufacturer: 'acme ', model: 'fat-16' }))).toMatch(/already in the catalogue/);
    expect(validateCatalogEntry([model()], model())).toBeNull();
    expect(validateCatalogEntry([], model({ specs: [{ key: 'IP', value: '65' }, { key: 'ip', value: '67' }] }))).toMatch(/listed twice/);
    expect(validateCatalogEntry([], model({ defaultPorts: -1 }))).toMatch(/port count/);
  });

  it('places with its make, model, link and ports, never a name, serial, owner or install date', () => {
    const t = catalogPlacementTemplate(model());
    expect(t).toEqual({ category: 'Fiber Distribution', totalPorts: 16, availablePorts: 16, catalogModelId: 'CAT-1', manufacturer: 'Acme', model: 'FAT-16' });
    for (const key of ['name', 'serialNumber', 'ownerName', 'installedDate', 'lat', 'lng'] as const) expect(t).not.toHaveProperty(key);
    // A generic type (no make and model) gives no link.
    expect(catalogPlacementTemplate(model({ manufacturer: undefined, model: undefined }))).not.toHaveProperty('catalogModelId');
  });
});

describe('effective specs', () => {
  it('takes the model lines and marks what the item changed or added', () => {
    const specs = effectiveSpecs(model(), {
      specOverrides: [
        { key: 'operating temperature', value: '-20 to 60', unit: '°C' },
        { key: 'Mounted on', value: 'Pole 12' },
      ],
    });
    expect(specs).toEqual([
      { key: 'Ingress protection', value: 'IP65', origin: 'model' },
      { key: 'Operating temperature', value: '-20 to 60', unit: '°C', origin: 'changed', modelValue: '-40 to 85 °C' },
      { key: 'Mounted on', value: 'Pole 12', origin: 'item' },
    ]);
  });

  it('has only the item lines when there is no model', () => {
    expect(effectiveSpecs(undefined, { specOverrides: [{ key: 'Colour', value: 'Grey' }] })).toEqual([{ key: 'Colour', value: 'Grey', origin: 'item' }]);
    expect(effectiveSpecs(undefined, {})).toEqual([]);
  });
});

describe('server rules', () => {
  const data = { equipment: [item({ catalogModelId: 'CAT-1' })], catalog: [model()] };

  it('refuses an item naming a model that is not on record', () => {
    expect(checkChangeSetCatalog(data, { upserts: { equipment: [item({ id: 'FAT-B', catalogModelId: 'CAT-GONE' })] } }).map((p) => p.code)).toEqual(['equipment_model_missing']);
    expect(checkChangeSetCatalog(data, { upserts: { equipment: [item({ id: 'FAT-B', catalogModelId: 'CAT-1' })] } })).toEqual([]);
  });

  it('refuses deleting a model items still use, and allows it once none does', () => {
    expect(checkChangeSetCatalog(data, { deletes: { catalog: ['CAT-1'] } })).toHaveLength(1);
    expect(checkChangeSetCatalog(data, { deletes: { catalog: ['CAT-1'], equipment: ['FAT-A'] } })).toEqual([]);
    expect(catalogModelUsers(data.equipment, 'CAT-1').map((e) => e.id)).toEqual(['FAT-A']);
  });

  it('does not blame a stored broken link on an unrelated change', () => {
    const stored = { ...data, equipment: [item({ catalogModelId: 'CAT-OLD' })] };
    expect(findCatalogProblems(stored)).toHaveLength(1);
    expect(checkChangeSetCatalog(stored, { upserts: { equipment: [item({ catalogModelId: 'CAT-OLD', notes: 'edited' })] } })).toEqual([]);
  });

  it('reports catalogue links in a restore, and finds none in the sample network', () => {
    const sample = createSampleNetwork();
    expect(checkRestoredNetwork(sample).counts.catalog).toBe(0);
    const broken = { ...sample, equipment: [...sample.equipment, item({ id: 'FAT-X', catalogModelId: 'CAT-GONE' })] };
    expect(checkRestoredNetwork(broken).counts.catalog).toBe(1);
  });

  it('lets engineers and the administrator change the catalogue, not office staff', () => {
    expect(roleCan('engineer', 'create', 'catalog')).toBe(true);
    expect(roleCan('admin', 'delete', 'catalog')).toBe(true);
    expect(roleCan('office', 'create', 'catalog')).toBe(false);
    expect(roleCan('technician', 'update', 'catalog')).toBe(false);
  });
});
