import { type ReactNode, useEffect, useState } from 'react';
import { Cloud, CloudAlert, CloudOff, CloudUpload, Loader2, RefreshCw, Trash2, type LucideIcon } from 'lucide-react';
import { syncEngine } from '../../api/syncEngine';
import { confirmAction } from '../../lib/browser';
import { type SyncPhase, useSyncStore } from '../../stores/syncStore';
import { MenuItem, MenuSeparator, Popover, cn } from '../ui';

interface PhaseMeta {
  label: string;
  icon: LucideIcon;
  spin?: boolean;
  /** Text and dot colours on the dark navbar. */
  tone: string;
  dot: string;
  description: string;
}

const PHASES: Record<SyncPhase, PhaseMeta> = {
  connecting: {
    label: 'Connecting',
    icon: Loader2,
    spin: true,
    tone: 'text-slate-300',
    dot: 'bg-slate-400',
    description: 'Loading the network from the server.',
  },
  synced: {
    label: 'Saved',
    icon: Cloud,
    tone: 'text-slate-300',
    dot: 'bg-emerald-400',
    description: 'All changes are saved to the server.',
  },
  pending: {
    label: 'Saving…',
    icon: CloudUpload,
    tone: 'text-slate-200',
    dot: 'bg-sky-400',
    description: 'Recent changes will be saved in a moment.',
  },
  saving: {
    label: 'Saving…',
    icon: Loader2,
    spin: true,
    tone: 'text-slate-200',
    dot: 'bg-sky-400',
    description: 'Sending changes to the server.',
  },
  offline: {
    label: 'Offline',
    icon: CloudOff,
    tone: 'text-amber-300',
    dot: 'bg-amber-400',
    description:
      'The server is unreachable. You can keep working; changes are kept in this browser and sent when it is back.',
  },
  error: {
    label: 'Sync error',
    icon: CloudAlert,
    tone: 'text-red-300',
    dot: 'bg-red-400',
    description: 'The server refused some changes. They are kept in this browser until you retry or discard them.',
  },
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium tabular-nums text-slate-800">{value}</span>
    </div>
  );
}

/** Navbar indicator for server sync, with details and recovery actions in a popover. */
export function SyncStatus() {
  const { phase, revision, pendingCount, lastSyncedAt, error } = useSyncStore();
  const meta = PHASES[phase];
  const Icon = meta.icon;

  return (
    <Popover
      align="end"
      panelClassName="w-72"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Sync status: ${meta.label}`}
          title={meta.description}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
            meta.tone,
            open ? 'bg-slate-800' : 'hover:bg-slate-800',
          )}
        >
          <Icon size={15} strokeWidth={2} className={cn(meta.spin && 'animate-spin')} aria-hidden />
          <span className="hidden lg:inline">{meta.label}</span>
        </button>
      )}
    >
      {(close) => (
        <SyncDetails
          phase={phase}
          meta={meta}
          revision={revision}
          pendingCount={pendingCount}
          lastSyncedAt={lastSyncedAt}
          error={error}
          close={close}
        />
      )}
    </Popover>
  );
}

interface SyncDetailsProps {
  phase: SyncPhase;
  meta: PhaseMeta;
  revision: number | null;
  pendingCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  close: () => void;
}

function SyncDetails({ phase, meta, revision, pendingCount, lastSyncedAt, error, close }: SyncDetailsProps) {
  const now = useNow(10_000);
  const canRetry = phase === 'offline' || phase === 'error';

  return (
    <>
      <div className="space-y-2 border-b border-slate-100 px-3 pb-3 pt-2">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} aria-hidden />
          <span className="text-[13px] font-semibold text-slate-900">{meta.label}</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">{meta.description}</p>
        {error && (
          <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs leading-relaxed text-red-700" role="status">
            {error}
          </p>
        )}
        <div className="space-y-1 pt-1">
          <Detail label="Unsaved changes" value={pendingCount === 0 ? 'None' : pendingCount} />
          <Detail label="Last synced" value={lastSyncedAt ? formatAgo(lastSyncedAt, now) : 'Not yet'} />
          <Detail label="Server revision" value={revision ?? '—'} />
        </div>
      </div>
      {canRetry && (
        <MenuItem
          icon={RefreshCw}
          label="Retry now"
          onClick={() => {
            close();
            void syncEngine.retry();
          }}
        />
      )}
      {pendingCount > 0 && phase !== 'connecting' && (
        <>
          {canRetry && <MenuSeparator />}
          <MenuItem
            icon={Trash2}
            label="Discard unsaved changes"
            danger
            onClick={() => {
              close();
              if (
                confirmAction(
                  `Discard ${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'} and reload the network from the server?`,
                )
              ) {
                void syncEngine.discardLocalChanges();
              }
            }}
          />
        </>
      )}
    </>
  );
}
