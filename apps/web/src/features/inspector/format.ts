import { type BudgetStatus, budgetStatusFor, type SignalLevel } from '@fibergis/shared';

import type { BadgeTone, KeyValueItem } from '../../components/ui';

/** Drops optional rows that have no value, so detail lists only show what is on record. */
export const presentItems = (items: KeyValueItem[]): KeyValueItem[] =>
  items.filter((item) => item.value !== undefined && item.value !== null && item.value !== '');

export function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function formatDbm(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dBm`;
}

const isValidDate = (date: Date) => !Number.isNaN(date.getTime());

export function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return isValidDate(date) ? date.toLocaleDateString(undefined, { dateStyle: 'medium' }) : iso;
}

export function formatDateTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return isValidDate(date) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : iso;
}

export function formatUptime(hours: number): string {
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days} d ${Math.round(hours % 24)} h` : `${Math.round(hours)} h`;
}

/** Joins the parts that are present, or returns undefined so lists can show a dash. */
export function joinPresent(parts: Array<string | number | undefined | null>, separator = ' '): string | undefined {
  const present = parts.filter((part) => part !== undefined && part !== null && part !== '');
  return present.length > 0 ? present.join(separator) : undefined;
}

const RX_BUDGET: Record<BudgetStatus, { label: string; tone: BadgeTone; text: string }> = {
  Pass: { label: 'Within budget', tone: 'green', text: 'text-emerald-700' },
  Warning: { label: 'Marginal', tone: 'amber', text: 'text-amber-700' },
  Fail: { label: 'Below sensitivity', tone: 'red', text: 'text-red-700' },
  Unknown: { label: 'No reading', tone: 'neutral', text: 'text-slate-500' },
};

/** Received-power assessment against the shared ONT/OLT power budget thresholds. */
export const rxBudget = (rx: number | undefined) => RX_BUDGET[budgetStatusFor(rx)];

export const SIGNAL_TONES: Record<SignalLevel, BadgeTone> = {
  Normal: 'green',
  Warning: 'amber',
  Critical: 'red',
  Unavailable: 'neutral',
};
