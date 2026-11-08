import { describe, expect, it } from 'vitest';

import { buildReports, NO_LIVE_CONNECTION, parseRecordTime, reportToCsv } from '../src/domain/reports';
import { createSampleNetwork } from '../src/sample';
import { fault, workOrder } from './fixtures';

const table = (tables: ReturnType<typeof buildReports>, id: string) => tables.find((t) => t.id === id)!;

describe('buildReports', () => {
  it('counts the sample network without inventing figures', () => {
    const data = createSampleNetwork();
    const tables = buildReports(data, {}, '2026-11-08');
    const inventory = table(tables, 'inventory');
    const counted = inventory.rows.filter((r) => !String(r.type).match(/Span|Duct|closure/)).reduce((n, r) => n + Number(r.count), 0);
    expect(counted).toBe(data.equipment.length);
    const live = table(tables, 'live');
    expect(live.noLiveConnection).toBe(true);
    expect(live.rows.every((r) => typeof r.state === 'string')).toBe(true);
    expect(live.rows[0].state).toBe(NO_LIVE_CONNECTION);
  });

  it('leaves TEST faults out unless asked, and says so', () => {
    const base = createSampleNetwork();
    const data = { ...base, faults: [fault({ id: 'F-REAL', reportedAt: '2026-11-01 10:00' }), fault({ id: 'F-TEST', reportedAt: '2026-11-01 10:00', isTest: true })] };
    const without = table(buildReports(data), 'faults');
    expect(without.rows.reduce((n, r) => n + Number(r.count), 0)).toBe(1);
    expect(without.notes.join(' ')).toMatch(/TEST events left out \(1\)/);
    const withTest = table(buildReports(data, { includeTest: true }), 'faults');
    expect(withTest.rows.reduce((n, r) => n + Number(r.count), 0)).toBe(2);
  });

  it('works out repair times only from faults with both times', () => {
    const base = createSampleNetwork();
    const data = {
      ...base,
      faults: [
        fault({ id: 'F-1', reportedAt: '2026-11-01 10:00', repairedAt: '2026-11-01T14:00:00.000Z' }),
        fault({ id: 'F-2', reportedAt: '2026-11-02 08:00' }),
      ],
    };
    const repair = table(buildReports(data), 'repair-times');
    expect(repair.rows.find((r) => r.measure === 'With both raised and repaired times recorded')?.value).toBe(1);
    const noTimes = table(buildReports({ ...base, faults: [fault({ id: 'F-2', reportedAt: '2026-11-02 08:00' })] }), 'repair-times');
    expect(String(noTimes.rows.at(-1)?.value)).toMatch(/Not worked out/);
  });

  it('filters jobs by date and shows missing times as not recorded', () => {
    const base = createSampleNetwork();
    const data = {
      ...base,
      workOrders: [
        workOrder({ id: 'WO-A', technicianName: 'Ravi', scheduledDate: '2026-11-03', status: 'Assigned' }),
        workOrder({ id: 'WO-B', technicianName: 'Ravi', scheduledDate: '2026-10-01', status: 'Assigned' }),
      ],
    };
    const jobs = table(buildReports(data, { from: '2026-11-01', to: '2026-11-30' }), 'work-orders');
    expect(jobs.rows).toEqual([expect.objectContaining({ technician: 'Ravi', jobs: 1, medianHours: 'Not recorded' })]);
  });
});

describe('reportToCsv', () => {
  it('quotes commas and keeps formula-like text as text', () => {
    const csv = reportToCsv({
      columns: [
        { key: 'a', label: 'Name' },
        { key: 'b', label: 'Value' },
      ],
      rows: [
        { a: 'Box, north', b: -19.5 },
        { a: '=HYPERLINK("x")', b: 3 },
      ],
    });
    expect(csv).toBe('Name,Value\r\n"Box, north",-19.5\r\n"\'=HYPERLINK(""x"")",3\r\n');
  });
});

describe('parseRecordTime', () => {
  it('reads both record time formats and rejects nonsense', () => {
    expect(parseRecordTime('2026-11-04 09:30')).toBe(Date.parse('2026-11-04T09:30'));
    expect(parseRecordTime('2026-11-04T09:30:00.000Z')).toBe(Date.parse('2026-11-04T09:30:00.000Z'));
    expect(parseRecordTime('soon')).toBeUndefined();
    expect(parseRecordTime(undefined)).toBeUndefined();
  });
});
