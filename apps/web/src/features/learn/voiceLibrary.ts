import { create } from 'zustand';

import { LESSON_SCRIPTS, type LessonScript, type VoiceClip, type VoiceLanguage } from '@fibergis/shared';

/**
 * Lesson words and the voice clips this person may hear (learning assistant, Stage 2). The words
 * come with the app, so captions always work, even offline. Clips come from the server: field users
 * get approved ones only; the administrator also gets drafts, to listen before approving.
 */

const base = () => (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const credentials = (): RequestCredentials => (import.meta.env.VITE_API_URL ? 'include' : 'same-origin');

export const clipAudioUrl = (id: string) => `${base()}/api/v1/voice/audio/${encodeURIComponent(id)}`;

/**
 * Automatic voice: the server plays the step's saved voice, or makes it with Sarvam the first time.
 * The player id is `speak:<language>:<lesson key>`; any other id is a saved clip's id.
 */
export const speakId = (key: string, lang: VoiceLanguage) => `speak:${lang}:${key}`;
export function audioUrlOf(id: string): string {
  const m = /^speak:([a-z]+):(.+)$/.exec(id);
  if (!m) return clipAudioUrl(id);
  return `${base()}/api/v1/voice/speak/${encodeURIComponent(m[2]!)}/${encodeURIComponent(m[1]!)}`;
}

interface VoiceLibraryState {
  clips: VoiceClip[];
  /** loading, ready, or offline (no list: captions only). */
  state: 'idle' | 'loading' | 'ready' | 'offline';
  load: (force?: boolean) => Promise<void>;
}

export const useVoiceLibrary = create<VoiceLibraryState>()((set, get) => ({
  clips: [],
  state: 'idle',
  load: async (force = false) => {
    if (!force && (get().state === 'loading' || get().state === 'ready')) return;
    set({ state: 'loading' });
    try {
      const response = await fetch(`${base()}/api/v1/voice/clips`, { credentials: credentials(), cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { clips?: VoiceClip[] };
      set({ clips: Array.isArray(body.clips) ? body.clips : [], state: 'ready' });
    } catch {
      set({ clips: [], state: 'offline' });
    }
  },
}));

export const scriptOf = (key: string): LessonScript | undefined => LESSON_SCRIPTS.find((s) => s.key === key);

/**
 * The clip to play for a step in a language: approved first; a draft only when the person may hear
 * drafts (the administrator); never an outdated one; never another language's clip.
 */
export function clipFor(
  clips: readonly VoiceClip[],
  key: string,
  lang: VoiceLanguage,
  allowDrafts: boolean,
): VoiceClip | undefined {
  const usable = clips.filter(
    (c) => c.lessonKey === key && c.language === lang && !c.outdated && c.status !== 'rejected',
  );
  return (
    usable.find((c) => c.status === 'approved') ?? (allowDrafts ? usable.find((c) => c.status === 'draft') : undefined)
  );
}
