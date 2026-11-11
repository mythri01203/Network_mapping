import { describe, expect, it } from 'vitest';

import { placementTemplate } from './placement';

describe('placementTemplate', () => {
  it('keeps the port count but never the catalogue name or description', () => {
    const template = placementTemplate({ id: 'spl', type: 'Fiber Splitter', category: 'Fiber Distribution', defaultPorts: 8 });
    expect(template).toEqual({ category: 'Fiber Distribution', totalPorts: 8, availablePorts: 8 });
    expect(template).not.toHaveProperty('name');
    expect(template).not.toHaveProperty('notes');
  });

  it('links a product model and takes its make and model, never a serial', () => {
    const template = placementTemplate({ id: 'CAT-1', type: 'FAT', category: 'Fiber Distribution', defaultPorts: 16, manufacturer: 'Acme', model: 'FAT-16' });
    expect(template).toEqual({ category: 'Fiber Distribution', totalPorts: 16, availablePorts: 16, catalogModelId: 'CAT-1', manufacturer: 'Acme', model: 'FAT-16' });
    expect(template).not.toHaveProperty('serialNumber');
  });
});
