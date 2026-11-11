import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { type Cable, CORE_STATUS_LABELS, searchCores } from '@fibergis/shared';

import { Input } from '../../components/ui';
import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { FiberSwatch } from './FiberChip';
import { STATUS_MARK } from './fiberUi';

/**
 * "Find a fiber": by number (13, F13), tube (T2, tube 2, T2/3), state (faulty, reserved), colour
 * (only on cables whose scheme is known) or what it is used for. On this cable or on all cables.
 */
export function CoreFinder({ cable, onPick }: { cable: Cable; onPick: (cableId: string, core: number) => void }) {
  const cables = useNetworkStore((s) => s.cables);
  const schemes = useNetworkStore(selectColorSchemes);
  const [query, setQuery] = useState('');
  const [everywhere, setEverywhere] = useState(false);
  const result = useMemo(
    () => (query.trim() ? searchCores(cables, query, { schemes, limit: 30, ...(everywhere ? {} : { cableId: cable.id }) }) : undefined),
    [cables, query, schemes, everywhere, cable.id],
  );

  const scopeButton = (on: boolean, label: string, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={everywhere === on}
      onClick={() => setEverywhere(on)}
      className={`min-h-12 flex-1 rounded-md border px-2 text-xs font-medium md:min-h-8 ${everywhere === on ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'}`}
    >
      {everywhere === on ? '✓ ' : ''}
      {label}
    </button>
  );

  return (
    <div className="space-y-2" data-testid="core-finder">
      <label className="relative block">
        <span className="sr-only">Find a fiber</span>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          data-testid="core-search"
          className="min-h-12 pl-8 md:min-h-0"
          value={query}
          placeholder="Find a fiber: 13, T2/3, faulty, a use…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        {scopeButton(false, 'This cable', 'core-search-this')}
        {scopeButton(true, 'All cables', 'core-search-all')}
      </div>
      {result && (
        <div className="space-y-1" data-testid="core-search-results">
          <p className="text-[11px] text-slate-600">
            {result.total === 0 ? 'No fiber matches.' : result.total > result.hits.length ? `${result.total} fibers match. The first ${result.hits.length} are shown.` : `${result.total} fiber${result.total === 1 ? '' : 's'} match.`}
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {result.hits.map((hit) => (
              <li key={`${hit.cableId}#${hit.coreNumber}`}>
                <button
                  type="button"
                  data-testid={`core-hit-${hit.cableId}-${hit.coreNumber}`}
                  onClick={() => onPick(hit.cableId, hit.coreNumber)}
                  className="flex min-h-12 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs hover:border-blue-400 md:min-h-9"
                >
                  <FiberSwatch identity={hit.identity} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">
                      {hit.cableId !== cable.id ? `${hit.cableName}: ` : ''}
                      {hit.identity.label}
                    </span>
                    <span className="block truncate text-[11px] text-slate-600">
                      <span aria-hidden>{STATUS_MARK[hit.status] ?? '·'} </span>
                      {CORE_STATUS_LABELS[hit.status]}
                      {hit.use ? ` · for ${hit.use}` : ''}
                      {hit.matched.length ? ` · ${hit.matched.join(', ')}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
