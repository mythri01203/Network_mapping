import { create } from 'zustand';

import { audioUrlOf } from './voiceLibrary';

/**
 * One voice at a time (learning assistant, Stage 2). It only starts when the person taps Play: no
 * sound starts by itself. Browsers' speech synthesis is never used, so a language never comes out
 * in another language's voice.
 */

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/** The parts of an audio element the player uses (tests pass a fake). */
export interface AudioLike {
  src: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  play: () => Promise<void>;
  pause: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

let makeAudio: () => AudioLike = () => new Audio() as unknown as AudioLike;
/** Tests swap the audio element. */
export const setAudioFactory = (factory: () => AudioLike) => {
  makeAudio = factory;
  element = null;
};

let element: AudioLike | null = null;

interface PlayerState {
  clipId: string | null;
  phase: PlayerPhase;
  /** Seconds played and in all (0 until known). */
  current: number;
  duration: number;
  play: (clipId: string) => void;
  pause: () => void;
  resume: () => void;
  repeat: () => void;
  stop: () => void;
}

export const useVoicePlayer = create<PlayerState>()((set, get) => {
  const audio = (): AudioLike => {
    if (element) return element;
    const a = makeAudio();
    const sync = () => set({ current: a.currentTime || 0, duration: Number.isFinite(a.duration) ? a.duration : 0 });
    a.addEventListener('timeupdate', sync);
    a.addEventListener('loadedmetadata', sync);
    a.addEventListener('playing', () => set({ phase: 'playing' }));
    a.addEventListener('pause', () => {
      if (get().phase === 'playing') set({ phase: 'paused' });
    });
    a.addEventListener('ended', () => set({ phase: 'ended', current: a.duration || get().current }));
    a.addEventListener('error', () => set({ phase: 'error' }));
    element = a;
    return a;
  };

  const start = (a: AudioLike) => {
    set({ phase: 'loading' });
    a.play().catch(() => set({ phase: 'error' }));
  };

  return {
    clipId: null,
    phase: 'idle',
    current: 0,
    duration: 0,
    play: (clipId) => {
      const a = audio();
      if (get().clipId === clipId && get().phase === 'paused') {
        start(a);
        return;
      }
      a.pause();
      a.src = audioUrlOf(clipId);
      a.currentTime = 0;
      set({ clipId, current: 0, duration: 0 });
      start(a);
    },
    pause: () => {
      if (get().phase !== 'playing' && get().phase !== 'loading') return;
      audio().pause();
      set({ phase: 'paused' });
    },
    resume: () => {
      if (get().phase === 'paused') start(audio());
    },
    repeat: () => {
      if (!get().clipId) return;
      const a = audio();
      a.pause();
      a.currentTime = 0;
      set({ current: 0 });
      start(a);
    },
    stop: () => {
      if (element) {
        element.pause();
        element.currentTime = 0;
      }
      set({ phase: 'idle', current: 0 });
    },
  };
});
