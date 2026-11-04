import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from './cn';

/* ---------------------------------------------------------------- Card */

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white', className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, icon: Icon, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-slate-200 px-4 py-3', className)}>
      {Icon && <Icon size={16} strokeWidth={1.9} className="shrink-0 text-slate-500" />}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[13px] font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 truncate text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4', className)} {...rest}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------- Page header */

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon: Icon, actions, children, className }: PageHeaderProps) {
  return (
    <div className={cn('shrink-0 border-b border-slate-200 bg-white px-6', className)}>
      <div className="flex min-h-16 items-center gap-3 py-3">
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
            <Icon size={18} strokeWidth={1.8} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold leading-6 text-slate-900">{title}</h1>
          {description && <p className="truncate text-xs text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* --------------------------------------------------------- Section label */

export function SectionLabel({
  className,
  children,
  action,
}: {
  className?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</span>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------- Stat tile */

export interface StatTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent';
  className?: string;
  onClick?: () => void;
}

const STAT_TONE: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'text-slate-900',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
  accent: 'text-blue-700',
};

export function StatTile({ label, value, icon: Icon, hint, tone = 'default', className, onClick }: StatTileProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left',
        onClick && 'transition-colors hover:border-slate-300 hover:bg-slate-50',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-500">{label}</span>
        {Icon && <Icon size={15} strokeWidth={1.8} className="shrink-0 text-slate-400" />}
      </div>
      <div className={cn('tabular text-[22px] font-semibold leading-7 tracking-tight', STAT_TONE[tone])}>{value}</div>
      {hint && <div className="truncate text-[11px] text-slate-500">{hint}</div>}
    </Comp>
  );
}

/* ---------------------------------------------------------- Empty state */

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12',
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-slate-100 text-slate-400',
            compact ? 'h-8 w-8' : 'h-10 w-10',
          )}
        >
          <Icon size={compact ? 16 : 20} strokeWidth={1.8} />
        </div>
      )}
      <p className="text-[13px] font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-sm text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------- Key/value list */

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
}

export function KeyValueList({
  items,
  className,
  columns = 1,
}: {
  items: KeyValueItem[];
  className?: string;
  columns?: 1 | 2;
}) {
  return (
    <dl
      className={cn(
        columns === 2 ? 'grid grid-cols-2 gap-x-4 gap-y-2.5' : 'flex flex-col divide-y divide-slate-100',
        className,
      )}
    >
      {items.map((item, i) =>
        columns === 2 ? (
          <div key={i} className="min-w-0">
            <dt className="text-[11px] text-slate-500">{item.label}</dt>
            <dd className={cn('truncate text-[13px] text-slate-900', item.mono && 'font-mono text-xs')}>
              {item.value ?? '—'}
            </dd>
          </div>
        ) : (
          <div key={i} className="flex items-center justify-between gap-4 py-1.5">
            <dt className="shrink-0 text-xs text-slate-500">{item.label}</dt>
            <dd
              className={cn('min-w-0 truncate text-right text-[13px] text-slate-900', item.mono && 'font-mono text-xs')}
            >
              {item.value ?? '—'}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

/* --------------------------------------------------------- Progress bar */

export function ProgressBar({
  value,
  max = 100,
  tone,
  className,
  size = 'md',
}: {
  value: number;
  max?: number;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'auto';
  className?: string;
  size?: 'sm' | 'md';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const resolved =
    tone === 'auto' || !tone ? (pct >= 90 ? 'red' : pct >= 75 ? 'amber' : tone === 'auto' ? 'green' : 'blue') : tone;
  const color = { blue: 'bg-blue-600', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }[resolved];
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-slate-200', size === 'sm' ? 'h-1' : 'h-1.5', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ Kbd */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-slate-300 bg-slate-50 px-1 font-sans text-[10px] font-medium text-slate-500',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* -------------------------------------------------------------- Divider */

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-slate-200', className)} />;
}
