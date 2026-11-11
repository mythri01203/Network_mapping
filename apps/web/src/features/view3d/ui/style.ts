import type { PresetKey } from '../scene/presets';

/** Shared look of the 3D view's panels, light and dark. */
export interface Tone {
  dark: boolean;
}

export const panelClass = (tone: Tone) =>
  tone.dark
    ? 'rounded-xl border border-white/15 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur-md'
    : 'rounded-xl border border-black/10 bg-white/90 text-slate-900 shadow-xl backdrop-blur-md';

export const mutedClass = (tone: Tone) => (tone.dark ? 'text-slate-400' : 'text-slate-500');

export const PRESET_ORDER: PresetKey[] = ['ov', 'olt', 'sw', 'box', 'pole', 'fat', 'vil', 'home'];
