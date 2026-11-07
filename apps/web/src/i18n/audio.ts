import { create } from 'zustand';

import type { Catalog, Language } from './format';

/**
 * Human-recorded audio clips, one per message key: `/audio/<lang>/<key>.mp3`, listed in
 * `/audio/manifest.json`. No clips exist yet, so no speaker button shows anywhere. `speechSynthesis`
 * is never used: Android may read Telugu with an English voice, which is worse than silence.
 */
export interface AudioManifest {
  clips: Partial<Record<Language, string[]>>;
}

export const AUDIO_MANIFEST_URL = '/audio/manifest.json';

export const clipUrl = (lang: Language, key: string): string => `/audio/${lang}/${encodeURIComponent(key)}.mp3`;

export const parseAudioManifest = (value: unknown): AudioManifest => {
  const clips = (value as { clips?: unknown } | null)?.clips;
  if (!clips || typeof clips !== 'object') return { clips: {} };
  const result: AudioManifest = { clips: {} };
  for (const lang of ['en', 'te', 'kn'] as const) {
    const list = (clips as Record<string, unknown>)[lang];
    if (Array.isArray(list)) result.clips[lang] = list.filter((k): k is string => typeof k === 'string');
  }
  return result;
};

/**
 * True only when a recording exists and its words are final. A clip of draft Telugu or Kannada is
 * never played, even if a file was put there by mistake.
 */
export function canPlayClip(manifest: AudioManifest, catalog: Catalog, lang: Language, key: string): boolean {
  if (!manifest.clips[lang]?.includes(key)) return false;
  if (lang === 'en') return key in catalog;
  return catalog[key]?.[lang]?.reviewed === true;
}

interface AudioState {
  manifest: AudioManifest;
  loaded: boolean;
  load: () => Promise<void>;
}

export const useAudioManifest = create<AudioState>()((set, get) => ({
  manifest: { clips: {} },
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    try {
      const response = await fetch(AUDIO_MANIFEST_URL, { cache: 'no-cache' });
      if (response.ok) set({ manifest: parseAudioManifest(await response.json()) });
    } catch {
      // No manifest (offline before first visit, or dev server): no speaker buttons.
    }
  },
}));

let playing: HTMLAudioElement | null = null;

/** Plays one clip, stopping any other. Browsers may block sound that no tap started; that is ignored. */
export function playClip(lang: Language, key: string): void {
  playing?.pause();
  playing = new Audio(clipUrl(lang, key));
  void playing.play().catch(() => undefined);
}
