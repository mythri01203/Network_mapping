import { isOdfPortFaulty, type OdfPort } from '@fibergis/shared';

/** The port's state in words, with a mark, so it never relies on colour alone. */
export function odfPortState(port: OdfPort): { mark: string; word: string; tile: string } {
  if (isOdfPortFaulty(port)) return { mark: '✕', word: 'Faulty', tile: 'border-red-400 bg-red-50 text-red-900' };
  if (port.status === 'reserved') return { mark: 'R', word: 'Reserved', tile: 'border-violet-400 bg-violet-50 text-violet-900' };
  if (port.patch && port.feederCableId) return { mark: '●', word: 'Patched, fiber behind', tile: 'border-blue-400 bg-blue-50 text-blue-900' };
  if (port.patch || port.feederCableId) return { mark: '◐', word: port.patch ? 'Patched, no fiber recorded behind' : 'Fiber behind, not patched', tile: 'border-amber-400 bg-amber-50 text-amber-900' };
  return { mark: '', word: 'Free', tile: 'border-slate-200 bg-white text-slate-800' };
}
