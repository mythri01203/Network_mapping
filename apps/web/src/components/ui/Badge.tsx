import React from 'react';

import { cn } from './cn';

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan';

const TONES: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: { badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  blue: { badge: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  green: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  amber: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  red: { badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
  violet: { badge: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  cyan: { badge: 'bg-cyan-50 text-cyan-700 ring-cyan-200', dot: 'bg-cyan-500' },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', dot = false, size = 'sm', className, children, ...rest }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded font-medium ring-1 ring-inset',
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
        t.badge,
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  // healthy
  active: 'green',
  online: 'green',
  operational: 'green',
  completed: 'green',
  resolved: 'green',
  available: 'green',
  ok: 'green',
  pass: 'green',
  good: 'green',
  connected: 'green',
  // in-flight
  assigned: 'blue',
  'in progress': 'blue',
  'in use': 'blue',
  used: 'blue',
  dispatched: 'blue',
  investigating: 'blue',
  expansion: 'blue',
  'under construction': 'blue',
  // attention
  warning: 'amber',
  maintenance: 'amber',
  'under maintenance': 'amber',
  pending: 'amber',
  'pending installation': 'amber',
  reported: 'amber',
  reserved: 'amber',
  degraded: 'amber',
  medium: 'amber',
  marginal: 'amber',
  suspended: 'amber',
  high: 'amber',
  // failure
  faulty: 'red',
  fault: 'red',
  damaged: 'red',
  critical: 'red',
  down: 'red',
  offline: 'red',
  failed: 'red',
  fail: 'red',
  'out of budget': 'red',
  disconnected: 'red',
  // planning / inactive
  planned: 'violet',
  proposed: 'violet',
  unverified: 'neutral',
  low: 'neutral',
  cancelled: 'neutral',
  inactive: 'neutral',
};

export function statusTone(status: string | undefined | null): BadgeTone {
  if (!status) return 'neutral';
  return STATUS_TONES[status.toLowerCase()] ?? 'neutral';
}

export interface StatusBadgeProps extends Omit<BadgeProps, 'tone' | 'children'> {
  status: string;
  tone?: BadgeTone;
  label?: React.ReactNode;
}

export function StatusBadge({ status, tone, label, dot = true, ...rest }: StatusBadgeProps) {
  return (
    <Badge tone={tone ?? statusTone(status)} dot={dot} {...rest}>
      {label ?? status}
    </Badge>
  );
}
