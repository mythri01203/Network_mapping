import { buildConnectionIndex, type ConnectionIndex, type LinkCheckState } from '@fibergis/shared';

import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';

/**
 * Network mapping Phase 13: the connection index for the screens, built once per change of the
 * records it reads (not per panel), so many panels share one build.
 */

type Inputs = Parameters<typeof buildConnectionIndex>[0] & { schemes: ReturnType<typeof selectColorSchemes> };

let cache: { inputs: Inputs; index: ConnectionIndex } | null = null;

const KEYS = ['equipment', 'cables', 'splitters', 'closures', 'customers', 'onts', 'rfElements', 'rfLinks', 'linkVerifications', 'schemes'] as const;

export function connectionIndexOf(inputs: Inputs): ConnectionIndex {
  if (cache && KEYS.every((k) => cache!.inputs[k] === inputs[k])) return cache.index;
  const index = buildConnectionIndex(inputs, inputs.schemes);
  cache = { inputs, index };
  return index;
}

/** The index for the network in the store, rebuilt only when one of its records changes. */
export function useConnectionIndex(): ConnectionIndex {
  const equipment = useNetworkStore((s) => s.equipment);
  const cables = useNetworkStore((s) => s.cables);
  const splitters = useNetworkStore((s) => s.splitters);
  const closures = useNetworkStore((s) => s.closures);
  const customers = useNetworkStore((s) => s.customers);
  const onts = useNetworkStore((s) => s.onts);
  const rfElements = useNetworkStore((s) => s.rfElements);
  const rfLinks = useNetworkStore((s) => s.rfLinks);
  const linkVerifications = useNetworkStore((s) => s.linkVerifications);
  const schemes = useNetworkStore(selectColorSchemes);
  return connectionIndexOf({ equipment, cables, splitters, closures, customers, onts, rfElements, rfLinks, linkVerifications, schemes });
}

/** A mark and words for each check state, never colour alone. */
export const CHECK_STYLE: Record<LinkCheckState, { mark: string; badge: string; words: string }> = {
  not_checked: { mark: '○', badge: 'border-slate-300 bg-white text-slate-700', words: 'Not checked' },
  passed: { mark: '✓', badge: 'border-emerald-300 bg-emerald-50 text-emerald-900', words: 'Checked: good' },
  failed: { mark: '✕', badge: 'border-red-300 bg-red-50 text-red-900', words: 'Checked: bad' },
  inconclusive: { mark: '?', badge: 'border-amber-300 bg-amber-50 text-amber-900', words: 'Checked: could not tell' },
  changed_since_check: { mark: '↻', badge: 'border-amber-300 bg-amber-50 text-amber-900', words: 'Changed since its check' },
};

/** "−19.4" → -19.4, with the sign the person chose. Undefined when nothing usable is typed. */
export function readingFrom(digits: string, sign: '-' | '+' | undefined): number | undefined {
  const text = digits.trim().replace(',', '.');
  if (!text || !sign || !/^\d{1,2}(\.\d{1,2})?$/.test(text)) return undefined;
  const value = Number(text);
  return sign === '-' ? -value : value;
}
