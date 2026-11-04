import { describe, expect, it } from 'vitest';

import type { MainView } from './mainView';
import { VIEW_META, viewForPath } from './views';

describe('viewForPath', () => {
  it('maps the root to the network map', () => {
    expect(viewForPath('/')).toBe('map');
    expect(viewForPath('')).toBe('map');
  });

  it('round-trips every view path', () => {
    for (const [view, meta] of Object.entries(VIEW_META)) {
      expect(viewForPath(meta.path)).toBe(view as MainView);
    }
  });

  it('ignores trailing slashes and case', () => {
    expect(viewForPath('/customers/')).toBe('customers');
    expect(viewForPath('/OLT-Rack')).toBe('olt_rack');
  });

  it('matches nested paths to their view', () => {
    expect(viewForPath('/equipment/OLT-01')).toBe('inventory');
  });

  it('does not match partial segments or unknown paths', () => {
    expect(viewForPath('/cablesx')).toBeNull();
    expect(viewForPath('/nowhere')).toBeNull();
  });

  it('gives every view a unique path', () => {
    const paths = Object.values(VIEW_META).map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
