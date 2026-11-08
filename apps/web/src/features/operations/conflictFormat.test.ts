import { describe, expect, it } from 'vitest';

import { fieldsToCompare, showValue } from './conflictFormat';

describe('conflict screens', () => {
  it('put plain values first and bookkeeping last, so a person sees what really differs', () => {
    const theirs = { technicianPhone: '+91 90000 11111', fieldNotes: [], history: [{}], status: 'Assigned' };
    const mine = { technicianPhone: '', fieldNotes: [{ text: 'Box door broken' }], history: [{}, {}], status: 'In Progress' };
    expect(fieldsToCompare(['fieldNotes', 'history', 'status', 'technicianPhone'], theirs, mine)).toEqual(['status', 'technicianPhone', 'fieldNotes', 'history']);
  });

  it('shows values in a few words without changing them', () => {
    expect(showValue(undefined)).toBe('(empty)');
    expect(showValue('In Progress')).toBe('In Progress');
    expect(showValue([{ text: 'Box door broken' }])).toBe('1 · last: Box door broken');
    expect(showValue([1, 2])).toBe('2 item(s)');
    expect(showValue({ a: 'x'.repeat(300) }).length).toBeLessThanOrEqual(160);
  });
});
