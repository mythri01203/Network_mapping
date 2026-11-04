import type { Cable, Equipment } from '../src/model/types';

export const equipment = (overrides: Partial<Equipment> & Pick<Equipment, 'id' | 'type'>): Equipment => ({
  name: overrides.id,
  category: 'Fiber Distribution',
  lat: 17.4,
  lng: 78.4,
  area: 'Test Area',
  street: 'Test Street',
  status: 'Active',
  images: [],
  installedDate: '2026-01-01',
  ...overrides,
});

export const cable = (overrides: Partial<Cable> & Pick<Cable, 'id'>): Cable => ({
  name: overrides.id,
  type: 'Distribution Fiber',
  fiberCount: 12,
  lengthMeters: 1000,
  installationType: 'Aerial',
  owner: 'Test',
  installationDate: '2026-01-01',
  status: 'Active',
  coordinates: [],
  cores: [],
  cableCategory: 'Fiber',
  ...overrides,
});
