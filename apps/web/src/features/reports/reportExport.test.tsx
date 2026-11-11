import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildReportDocument, buildReports, type ReportTable } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { prepareXlsxSheets } from '../../lib/xlsxExport';
import { allReportSheets, drawReportPdf, reportSheets } from './reportExport';
import { groupReports, ReportPicker } from './ReportsModal';

/** Network mapping Phase 22: reports as Excel and PDF, and the report list at phone width. */

const table: ReportTable = {
  id: 'cable-inventory',
  title: 'Cable inventory: every cable as recorded',
  definition: 'One row per cable.',
  sources: ['Cables'],
  settingsUsed: [],
  columns: [
    { key: 'id', label: 'Cable id' },
    { key: 'owner', label: 'Owner' },
    { key: 'drawn', label: 'Drawn (m)' },
  ],
  rows: [
    { id: 'C-1', owner: '=HYPERLINK("x")', drawn: 120 },
    { id: 'C-2', owner: 'Not recorded', drawn: 'No line drawn' },
  ],
  notes: ['1 cable(s) have no owner recorded.'],
};
const at = new Date('2026-11-11T10:00:00Z');

describe('report Excel sheets', () => {
  it('writes the rows and an About sheet with sources, settings and filters, formulas kept as text', () => {
    const sheets = reportSheets(table, { includeTest: false }, at);
    expect(sheets.map((s) => s.name)).toEqual([table.title, 'About this report']);
    const about = Object.fromEntries(sheets[1].rows.map((r) => [r.what, r.value]));
    expect(about['Made from']).toBe('Cables');
    expect(about['Settings used']).toBe('None: counted from the records only');
    expect(about.Filters).toBe('every area, TEST data left out');
    const prepared = prepareXlsxSheets(sheets);
    expect(prepared[0].data[1][1]).toEqual({ type: String, value: '\'=HYPERLINK("x")' });
    // "Not recorded" stays words, never an empty or zero cell.
    expect(prepared[0].data[2][1]).toEqual({ type: String, value: 'Not recorded' });
  });

  it('puts every report in one workbook after a contents sheet', () => {
    const tables = buildReports(createSampleNetwork(), {}, '2026-11-11');
    const sheets = allReportSheets(tables, {}, at);
    expect(sheets[0].name).toBe('Contents');
    expect(sheets).toHaveLength(tables.length + 1);
    // Excel sheet names stay unique and short.
    const names = prepareXlsxSheets(sheets).map((s) => s.sheet);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });
});

describe('report PDF', () => {
  it('draws a wide report on landscape pages without failing', () => {
    const wide = buildReports(createSampleNetwork(), {}, '2026-11-11').find((t) => t.id === 'cable-inventory')!;
    const doc = drawReportPdf(buildReportDocument(wide, { filters: {}, generatedAt: at }));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const empty = drawReportPdf(buildReportDocument({ ...table, rows: [] }, { filters: {}, generatedAt: at }));
    expect(empty.getNumberOfPages()).toBe(1);
  });
});

describe('report list', () => {
  it('groups the reports, keeps unknown ones, and offers a drop-down for phones', () => {
    const tables = [...buildReports(createSampleNetwork(), {}, '2026-11-11'), { ...table, id: 'someone-elses-report', title: 'A new report' }];
    const groups = groupReports(tables);
    expect(groups.flatMap((g) => g.tables)).toHaveLength(tables.length);
    expect(groups.at(-1)!.title).toBe('Other reports');
    const html = renderToStaticMarkup(<ReportPicker tables={tables} selectedId="orphans" onSelect={() => {}} />);
    expect(html).toContain('data-testid="report-select"');
    expect(html).toContain('<optgroup label="Poles, ducts and permissions">');
    for (const id of ['cable-inventory', 'duct-occupancy', 'splicing', 'odf-ports', 'orphans', 'disconnected-cables', 'customer-paths', 'pole-attachments', 'osp-summary', 'validation-findings']) {
      expect(html).toContain(`data-testid="report-${id}"`);
    }
  });
});
