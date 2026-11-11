/**
 * Phase 16: conditions for the filter builder and "select by attribute" (field, operator, value).
 * A blank value, an empty list or a missing field is "not recorded": it never equals a value, and
 * only "is not recorded" finds it. Nothing is filled in to make a record match.
 */

export const FILTER_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'gt', 'lt', 'is_empty', 'not_empty'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  gt: 'more than',
  lt: 'less than',
  is_empty: 'is not recorded',
  not_empty: 'is recorded',
};

/** Operators that need no value. */
export const VALUELESS_OPERATORS: ReadonlySet<FilterOperator> = new Set(['is_empty', 'not_empty']);

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value?: string;
}

export const isFilterOperator = (v: unknown): v is FilterOperator => typeof v === 'string' && (FILTER_OPERATORS as readonly string[]).includes(v);

export const isFilterCondition = (v: unknown): v is FilterCondition => {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as FilterCondition;
  return typeof c.field === 'string' && c.field.length > 0 && isFilterOperator(c.operator) && (c.value === undefined || typeof c.value === 'string');
};

/** A value read from a record: absent, text, a number, yes/no, or a list. */
export type CellValue = string | number | boolean | undefined;

/** Reads `a.b.c` from a record. Missing steps give undefined. */
export function readPath(record: unknown, path: string): unknown {
  let at: unknown = record;
  for (const step of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[step];
  }
  return at;
}

/** True when nothing is recorded: undefined, null, blank text, NaN or an empty list. */
export function isNotRecorded(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return undefined;
};

const asText = (v: unknown): string => {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(asText).join(', ');
  return String(v).trim().toLowerCase();
};

const BOOLEAN_WORDS: Record<string, boolean> = { yes: true, true: true, no: false, false: false };

/** Does one value meet one condition? */
export function meetsCondition(value: unknown, condition: Pick<FilterCondition, 'operator' | 'value'>): boolean {
  const { operator } = condition;
  if (operator === 'is_empty') return isNotRecorded(value);
  if (operator === 'not_empty') return !isNotRecorded(value);
  const wanted = (condition.value ?? '').trim();
  // A condition with no value written yet does not filter anything out.
  if (wanted === '') return true;
  const negative = operator === 'not_equals' || operator === 'not_contains';
  // Not recorded is never equal to, more or less than, or containing a value.
  if (isNotRecorded(value)) return negative;
  if (operator === 'gt' || operator === 'lt') {
    const a = asNumber(value);
    const b = asNumber(wanted);
    if (a !== undefined && b !== undefined) return operator === 'gt' ? a > b : a < b;
    // Dates as written (2026-11-10) and other text compare in order.
    const cmp = asText(value).localeCompare(wanted.toLowerCase(), undefined, { numeric: true });
    return operator === 'gt' ? cmp > 0 : cmp < 0;
  }
  if (typeof value === 'boolean' && wanted.toLowerCase() in BOOLEAN_WORDS) {
    const same = value === BOOLEAN_WORDS[wanted.toLowerCase()];
    return operator === 'equals' || operator === 'contains' || operator === 'starts_with' ? same : !same;
  }
  const have = asText(value);
  const w = wanted.toLowerCase();
  switch (operator) {
    case 'equals': {
      const a = asNumber(value);
      const b = asNumber(wanted);
      return a !== undefined && b !== undefined ? a === b : have === w;
    }
    case 'not_equals': {
      const a = asNumber(value);
      const b = asNumber(wanted);
      return a !== undefined && b !== undefined ? a !== b : have !== w;
    }
    case 'contains':
      return have.includes(w);
    case 'not_contains':
      return !have.includes(w);
    case 'starts_with':
      return have.startsWith(w);
  }
  return false;
}

/** Records meeting every condition (all must hold). `read` gives a field's value; by default the path. */
export function filterRecords<R>(records: readonly R[], conditions: readonly FilterCondition[], read: (record: R, field: string) => unknown = readPath): R[] {
  const active = conditions.filter((c) => c.field && (VALUELESS_OPERATORS.has(c.operator) || (c.value ?? '').trim() !== ''));
  if (active.length === 0) return [...records];
  return records.filter((r) => active.every((c) => meetsCondition(read(r, c.field), c)));
}

/** "Status is Active and Area contains North", for lists of saved filters. */
export function describeConditions(conditions: readonly FilterCondition[], fieldLabel: (field: string) => string = (f) => f): string {
  if (conditions.length === 0) return 'No conditions';
  return conditions
    .map((c) => `${fieldLabel(c.field)} ${FILTER_OPERATOR_LABELS[c.operator]}${VALUELESS_OPERATORS.has(c.operator) ? '' : ` "${c.value ?? ''}"`}`)
    .join(' and ');
}
