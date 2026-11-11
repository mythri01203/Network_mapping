import { describe, expect, it } from 'vitest';

import { LANGS_3D, MSG3D, type Msg3DKey, t3d, tx } from './i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('3D view words', () => {
  it('has every key in all five languages with the same placeholders', () => {
    for (const [key, entry] of Object.entries(MSG3D)) {
      for (const lang of LANGS_3D) {
        const text = (entry as Record<string, string>)[lang];
        expect(text, `${key} ${lang}`).toBeTruthy();
        expect(placeholders(text), `${key} ${lang}`).toEqual(placeholders(entry.en));
      }
    }
  });

  it('fills values and falls back to the key for unknown scene text', () => {
    expect(t3d('en', 'house', { n: 7 })).toBe('House 7');
    expect(t3d('hi', 'house', { n: 7 })).toBe('घर 7');
    expect(tx('ta', { key: 'note.undrawn', values: { n: 2 } })).toContain('2');
    expect(tx('en', { key: 'no.such.key', values: {} })).toBe('no.such.key');
  });

  it('names every preset and tour step', () => {
    for (const k of ['ov', 'olt', 'sw', 'box', 'pole', 'fat', 'vil', 'home']) {
      expect(MSG3D[`preset.${k}` as Msg3DKey]).toBeDefined();
      expect(MSG3D[`cap.${k}` as Msg3DKey]).toBeDefined();
    }
    for (let n = 1; n <= 5; n += 1) expect(MSG3D[`tour.${n}.t` as Msg3DKey]).toBeDefined();
  });
});
