import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { canPlayClip, parseAudioManifest } from './audio';
import { type Catalog, formatMessage, missingKeys, translate, unreviewedKeys } from './format';
import { MESSAGES } from './messages';

const catalog: Catalog = {
  hello: { en: 'Hello {name}', te: { text: 'నమస్కారం {name}', reviewed: false } },
  onlyEnglish: { en: 'Only in English' },
  count: { en: '{n, plural, =0 {Nothing} one {# item} other {# items}}' },
  kind: { en: '{k, select, pole {Pole} other {Thing}}' },
};

describe('message format', () => {
  it('fills values, plurals and selects', () => {
    expect(formatMessage('Hello {name}', { name: 'Ravi' })).toBe('Hello Ravi');
    expect(translate(catalog, 'en', 'count', { n: 0 }).text).toBe('Nothing');
    expect(translate(catalog, 'en', 'count', { n: 1 }).text).toBe('1 item');
    expect(translate(catalog, 'en', 'count', { n: 1250 }).text).toBe('1,250 items');
    expect(translate(catalog, 'en', 'kind', { k: 'pole' }).text).toBe('Pole');
    expect(translate(catalog, 'en', 'kind', { k: 'box' }).text).toBe('Thing');
  });

  it('uses Western digits in Telugu and Kannada', () => {
    expect(formatMessage('{n}', { n: 1234 }, 'te')).toBe('1,234');
    expect(formatMessage('{n}', { n: 7 }, 'kn')).toBe('7');
  });

  it('falls back to English for a key missing in the chosen language, and to the key when unknown', () => {
    expect(translate(catalog, 'te', 'hello', { name: 'Ravi' })).toEqual({ text: 'నమస్కారం Ravi', lang: 'te' });
    expect(translate(catalog, 'te', 'onlyEnglish')).toEqual({ text: 'Only in English', lang: 'en' });
    expect(translate(catalog, 'kn', 'hello', { name: 'Ravi' })).toEqual({ text: 'Hello Ravi', lang: 'en' });
    expect(translate(catalog, 'te', 'no.such.key')).toEqual({ text: 'no.such.key', lang: 'en' });
  });

  it('leaves an unfilled placeholder visible rather than inventing a value', () => {
    expect(formatMessage('Tag: {tag}')).toBe('Tag: {tag}');
  });
});

describe('field catalog', () => {
  const keys = Object.keys(MESSAGES);

  it('marks every Telugu and Kannada text as an unreviewed draft', () => {
    expect(unreviewedKeys(MESSAGES, 'te')).toEqual(keys);
    expect(unreviewedKeys(MESSAGES, 'kn')).toEqual(keys);
    expect(missingKeys(MESSAGES, 'te')).toEqual([]);
    expect(missingKeys(MESSAGES, 'kn')).toEqual([]);
  });

  it('keeps the same placeholders in every language', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const [key, entry] of Object.entries(MESSAGES) as [string, Catalog[string]][]) {
      for (const lang of ['te', 'kn'] as const) {
        expect(names(entry[lang]?.text ?? entry.en), `${lang} ${key}`).toEqual(names(entry.en));
      }
    }
  });

  it('lists every draft key in docs/LANGUAGE_REVIEW.md', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../../../docs/LANGUAGE_REVIEW.md', import.meta.url)), 'utf8');
    const missing = keys.filter((key) => !doc.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });
});

describe('audio clips', () => {
  const manifest = parseAudioManifest({ clips: { en: ['hello'], te: ['hello'], kn: 'nope' } });

  it('shows a speaker only for a recorded clip whose words are final', () => {
    expect(canPlayClip(manifest, catalog, 'en', 'hello')).toBe(true);
    // The Telugu text is a draft, so its recording must not play.
    expect(canPlayClip(manifest, catalog, 'te', 'hello')).toBe(false);
    expect(canPlayClip(manifest, { hello: { en: 'x', te: { text: 'y', reviewed: true } } }, 'te', 'hello')).toBe(true);
    expect(canPlayClip(manifest, catalog, 'en', 'count')).toBe(false);
    expect(manifest.clips.kn).toBeUndefined();
  });

  it('treats a missing or broken manifest as no clips', () => {
    expect(parseAudioManifest(null)).toEqual({ clips: {} });
    expect(parseAudioManifest({ clips: 3 })).toEqual({ clips: {} });
  });
});
