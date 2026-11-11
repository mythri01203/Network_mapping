import { useEffect, useState } from 'react';
import { Layers, Loader2, MapPinned } from 'lucide-react';

import { readLoadPreference } from '../../api/areaLoading';
import { syncEngine } from '../../api/syncEngine';
import { cn, MenuItem, Popover } from '../../components/ui';
import { useAreaLoadStore } from '../../stores/areaLoadStore';
import { requestConfirm } from '../../stores/confirmStore';

/**
 * Phase 24b: tells a person, in plain words, that this device holds only part of a big network (the
 * map areas looked at), so a list or count that lacks something is never taken as "it does not
 * exist". Shown in the top bar, beside the sync status, for as long as it is true (also offline).
 */
export function AreaLoadNotice() {
  const { mode, areas, truncated, wide, loading, serverRecords, loadedRecords } = useAreaLoadStore();
  if (mode !== 'area') return null;
  const label = truncated || wide ? 'Zoom in to load all' : 'Part loaded';
  return (
    <Popover
      align="end"
      panelClassName="w-80"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Network on this device: ${label}`}
          title="Only part of the network is on this device. Tap to see what that means."
          data-testid="area-load-notice"
          className={cn(
            'flex h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-amber-300 transition-colors md:h-8 md:min-w-0',
            open ? 'bg-slate-800' : 'hover:bg-slate-800',
          )}
        >
          {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <MapPinned size={15} aria-hidden />}
          <span className="hidden lg:inline">{label}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-2 px-3 pb-3 pt-2 text-xs leading-relaxed text-slate-600" role="status">
          <p className="text-[13px] font-semibold text-slate-900">Only part of the network is on this device</p>
          <p>
            This network is big. So this device loads only the places you look at on the map
            {areas > 0 ? ` (${areas} place${areas === 1 ? '' : 's'} so far)` : ''}, and what they are linked to. Move the map to load more.
          </p>
          <p>
            Items here: <span className="font-semibold tabular-nums text-slate-800">{loadedRecords.toLocaleString()}</span>
            {serverRecords !== null ? (
              <>
                {' '}
                of <span className="font-semibold tabular-nums text-slate-800">{serverRecords.toLocaleString()}</span> on the office server
              </>
            ) : null}
            .
          </p>
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
            Lists, counts, checks, reports and traces use only what is loaded. If something is missing from a list, it may still be on the server.
            The search box also asks the server.
          </p>
          {truncated && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900" data-testid="area-load-truncated">
              This place has too many items to load at once. Zoom in to load all of them.
            </p>
          )}
          {wide && !truncated && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900" data-testid="area-load-wide">
              The map shows a wide area. Only its middle is loaded. Zoom in, or move the map, to load more.
            </p>
          )}
          {loading && <p>Loading this place…</p>}
          <button
            type="button"
            data-testid="area-load-whole"
            className="mt-1 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-slate-200 font-medium text-slate-800 hover:bg-slate-50 md:min-h-9"
            onClick={() => {
              close();
              void requestConfirm({
                title: 'Load the whole network',
                message: 'Load every item of the network on this device? On a big network this can take a long time and use a lot of the phone memory. Your unsent changes are kept.',
                confirmLabel: 'Load everything',
              }).then((confirmed) => {
                if (confirmed) void syncEngine.setLoadPreference('whole');
              });
            }}
          >
            <Layers size={14} aria-hidden /> Load the whole network on this device
          </button>
        </div>
      )}
    </Popover>
  );
}

/** In the sync menu: go back to loading by map area after "Load the whole network" was chosen. */
export function AreaLoadMenuItem({ close }: { close: () => void }) {
  const mode = useAreaLoadStore((s) => s.mode);
  if (mode === 'area' || readLoadPreference() !== 'whole') return null;
  return (
    <MenuItem
      icon={MapPinned}
      label="Load only the map area (faster on big networks)"
      onClick={() => {
        close();
        void syncEngine.setLoadPreference('auto');
      }}
    />
  );
}

type SearchState = { query: string; status: 'asking' } | { query: string; status: 'done'; total: number; loaded: number } | { query: string; status: 'failed' };

/**
 * In the search list, while part of the network is loaded: this device searched only what it holds,
 * so the office server is asked too and what it finds is loaded (the list then shows it).
 */
export function AreaSearchNote({ query }: { query: string }) {
  const mode = useAreaLoadStore((s) => s.mode);
  const [state, setState] = useState<SearchState | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (mode !== 'area' || q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setState({ query: q, status: 'asking' });
      void syncEngine.searchServer(q).then((result) => {
        if (!live) return;
        setState(result ? { query: q, status: 'done', total: result.total, loaded: result.loaded } : { query: q, status: 'failed' });
      });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mode, q]);
  if (mode !== 'area' || q.length < 2) return null;
  const current = state?.query === q ? state : null;
  const text = !current || current.status === 'asking'
    ? 'Only part of the network is on this device. Asking the office server too…'
    : current.status === 'failed'
      ? 'Could not ask the office server. Only the part of the network on this device was searched.'
      : current.loaded > 0
        ? `The office server found ${current.loaded} more. They are loaded and listed now.`
        : current.total > 0
          ? 'The office server found nothing more.'
          : 'The office server found nothing either.';
  return (
    <p className="border-b border-slate-100 px-3 py-2 text-[12px] leading-snug text-amber-800" role="status" data-testid="area-search-note">
      {text}
    </p>
  );
}

/**
 * Field capture, on a network loaded by map area: loads the place where the worker stands, so the
 * nearby items, the "already mapped here?" check and QR tags see what is there. Nothing while the
 * whole network is here.
 */
export function useLoadPlace(location: { lat: number; lng: number } | null | undefined): void {
  const mode = useAreaLoadStore((s) => s.mode);
  // About 100 m steps: a walk does not ask again for every metre.
  const lat = location ? Math.round(location.lat * 1000) / 1000 : null;
  const lng = location ? Math.round(location.lng * 1000) / 1000 : null;
  useEffect(() => {
    if (mode === 'area' && lat !== null && lng !== null) void syncEngine.loadPlace(lat, lng);
  }, [mode, lat, lng]);
}
