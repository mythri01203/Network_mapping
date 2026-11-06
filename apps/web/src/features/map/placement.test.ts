import { describe, expect, it } from 'vitest';

import { placementTemplate } from './placement';

describe('placementTemplate', () => {
  it('keeps the picked item name and port count', () => {
    const template = placementTemplate({
      type: 'Fiber Splitter',
      name: 'PLC Fiber Splitter (1:8 / 1:16)',
      description: 'Passive divider',
      defaultPorts: 8,
    });
    expect(template).toEqual({ name: 'PLC Fiber Splitter (1:8 / 1:16)', totalPorts: 8, notes: 'Passive divider' });
  });

  it('leaves pole names to automatic numbering', () => {
    const template = placementTemplate({ type: 'Telecom Pole', name: 'Telecom Pole', description: '', defaultPorts: 0 });
    expect(template).not.toHaveProperty('name');
  });
});
