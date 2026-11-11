import type { Scene3D } from './types';

/** Camera presets of the 3D view, and whether the data has something for each to look at. */
export type PresetKey = 'ov' | 'olt' | 'sw' | 'box' | 'pole' | 'fat' | 'vil' | 'home';
export const PRESET_KEYS: readonly PresetKey[] = ['ov', 'olt', 'sw', 'box', 'pole', 'fat', 'vil', 'home'];

export function presetAvailable(scene: Scene3D, key: PresetKey): boolean {
  const items = scene.racks.flatMap((r) => r.items);
  switch (key) {
    case 'ov':
    case 'box':
    case 'home':
      return true;
    case 'olt':
      return items.some((i) => i.kind === 'olt');
    case 'sw':
      return items.some((i) => i.kind === 'switch');
    case 'pole':
      return scene.poles.length > 0 || scene.cables.some((c) => c.role === 'feeder');
    case 'fat':
      return scene.boxes.some((b) => b.model === 'fat');
    case 'vil':
      return scene.houses.length > 0;
  }
}
