import React, { useState } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

import { CORE_STATUSES, type CoreStatus, type FiberCore } from '@fibergis/shared';

import { cn, ProgressBar } from '../../components/ui';

/** Scrollable inspector body with a pinned action bar. */
export function InspectorLayout({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5">
          {actions}
        </div>
      )}
    </>
  );
}

interface InspectorSectionProps {
  title: string;
  icon?: LucideIcon;
  /** Short non-interactive summary shown next to the title (e.g. a count). */
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function InspectorSection({ title, icon: Icon, aside, defaultOpen = true, children }: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        {Icon && <Icon size={14} strokeWidth={2} className="shrink-0 text-slate-400" />}
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        {aside && <span className="text-xs tabular-nums text-slate-500">{aside}</span>}
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-slate-400 transition-transform duration-150', !open && '-rotate-90')}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

export function ActionList({ children }: { children: React.ReactNode }) {
  return <div className="-mx-2 flex flex-col">{children}</div>;
}

interface ActionRowProps {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onClick: () => void;
}

export function ActionRow({ icon: Icon, label, hint, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-slate-50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors group-hover:border-blue-200 group-hover:text-blue-600">
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-slate-800">{label}</span>
        {hint && <span className="block truncate text-[11px] text-slate-500">{hint}</span>}
      </span>
      <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
    </button>
  );
}

/** A record reference that selects the record when clicked. */
export function RecordLink({ name, id, onSelect }: { name: string; id: string; onSelect?: () => void }) {
  if (!onSelect) {
    return (
      <span className="truncate" title={id}>
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`Select ${id}`}
      className="max-w-full truncate text-blue-700 hover:text-blue-800 hover:underline"
    >
      {name}
    </button>
  );
}

export function Metric({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="truncate text-[11px] text-slate-500">{label}</div>
      <div className={cn('mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-900', className)}>
        {value ?? '—'}
      </div>
    </div>
  );
}

/** Port occupancy; `used` is optional because some records only carry a port count. */
export function PortUsage({ used, total, unit = 'ports' }: { used?: number; total: number; unit?: string }) {
  if (used === undefined) {
    return (
      <p className="text-[13px] text-slate-900">
        <span className="font-semibold tabular-nums">{total}</span>
        <span className="text-slate-500"> {unit}, occupancy not recorded</span>
      </p>
    );
  }
  const free = Math.max(0, total - used);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-slate-900">
          <span className="font-semibold tabular-nums">{used}</span>
          <span className="text-slate-500">
            {' '}
            of {total} {unit} in use
          </span>
        </span>
        <span className="text-xs tabular-nums text-slate-500">{free} free</span>
      </div>
      <ProgressBar value={used} max={total} tone="auto" />
    </div>
  );
}

const CORE_COLORS: Record<CoreStatus, string> = {
  'In Use': 'bg-blue-600',
  Available: 'bg-emerald-500',
  Reserved: 'bg-amber-500',
  Damaged: 'bg-red-500',
  'Under Maintenance': 'bg-orange-400',
  Unverified: 'bg-slate-400',
  Spliced: 'bg-indigo-500',
  Dark: 'bg-emerald-300',
  Disconnected: 'bg-slate-500',
  Unknown: 'bg-slate-300',
};

export function CoreBreakdown({ cores, fiberCount }: { cores: readonly FiberCore[]; fiberCount: number }) {
  const total = Math.max(fiberCount, cores.length);
  const counts = CORE_STATUSES.map((status) => ({
    status,
    count: cores.filter((core) => core.status === status).length,
  }));
  const unrecorded = Math.max(0, total - cores.length);
  const inUse = counts.find((c) => c.status === 'In Use')?.count ?? 0;

  if (total === 0) return <p className="text-xs text-slate-500">No fiber cores recorded for this cable.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-slate-900">
          <span className="font-semibold tabular-nums">{inUse}</span>
          <span className="text-slate-500"> of {total} cores in use</span>
        </span>
        <span className="text-xs tabular-nums text-slate-500">{Math.round((inUse / total) * 100)}%</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200">
        {counts.map(({ status, count }) =>
          count > 0 ? (
            <div
              key={status}
              className={CORE_COLORS[status]}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${status}: ${count}`}
            />
          ) : null,
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {counts
          .filter(({ count }) => count > 0)
          .map(({ status, count }) => (
            <div key={status} className="flex items-center gap-2 text-xs">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', CORE_COLORS[status])} />
              <dt className="flex-1 truncate text-slate-600">{status}</dt>
              <dd className="font-medium tabular-nums text-slate-900">{count}</dd>
            </div>
          ))}
        {unrecorded > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full bg-slate-200" />
            <dt className="flex-1 truncate text-slate-600">Not recorded</dt>
            <dd className="font-medium tabular-nums text-slate-900">{unrecorded}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
