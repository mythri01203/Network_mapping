/** A field value in a few words. Long values are cut, never changed. */
export function showValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, 160);
  if (Array.isArray(value)) {
    // A list of notes or steps: the newest one's words say more than a count.
    const last = value.at(-1) as { text?: unknown; label?: unknown } | undefined;
    const words = typeof last?.text === 'string' ? last.text : typeof last?.label === 'string' ? last.label : null;
    return words ? `${value.length} · last: ${words.slice(0, 120)}` : `${value.length} item(s)`;
  }
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** Bookkeeping a person does not need to compare first. */
const LATER = new Set(['history', 'fieldEvents', 'photos', 'photoRefs', 'images', 'updatedAt', 'assignedAt', 'startedAt', 'createdAt']);

/**
 * Every field the phone version would change on the record as it is now. Worked out here from the
 * two copies, never taken from the conflict's own list, so no change can hide behind a short list.
 */
export function fieldsThatWouldChange(mine: Record<string, unknown> | null, current: Record<string, unknown> | undefined): string[] {
  if (!mine || !current) return [];
  return [...new Set([...Object.keys(mine), ...Object.keys(current)])].filter((key) => JSON.stringify(mine[key]) !== JSON.stringify(current[key]));
}

/** Changed fields in the order a person should read them: plain values first, bookkeeping last. */
export function fieldsToCompare(fields: readonly string[], a: Record<string, unknown> | null, b: Record<string, unknown> | null): string[] {
  const rank = (f: string) => {
    const value = a?.[f] ?? b?.[f];
    if (LATER.has(f)) return 2;
    return typeof value === 'object' && value !== null ? 1 : 0;
  };
  return [...fields].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
}
