import { NO_LIVE_CONNECTION, type ReportCell, type ReportColumn, type ReportFilters, type ReportTable } from './reports';

/**
 * Network mapping Phase 22: one report as a document, for the PDF and the Excel "About" sheet. Every
 * value is the report's own; nothing is added. It says where the figures came from, the settings
 * used and the filters (TEST data included or left out), so a printed copy explains itself.
 */

export interface ReportDocument {
  title: string;
  facts: [string, string][];
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  notes: string[];
  footer: string;
}

/** The filters in plain words, the same on screen, in print, PDF and Excel. */
export function reportFiltersText(filters: ReportFilters): string {
  return [
    filters.from ? `from ${filters.from}` : '',
    filters.to ? `to ${filters.to}` : '',
    filters.area?.trim() ? `area "${filters.area.trim()}"` : 'every area',
    filters.includeTest ? 'TEST data included' : 'TEST data left out',
  ]
    .filter(Boolean)
    .join(', ');
}

const stamp = (at: Date) => `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function buildReportDocument(table: ReportTable, ctx: { filters: ReportFilters; generatedAt: Date }): ReportDocument {
  const settings = table.settingsUsed === undefined ? 'As written in "How it is worked out"' : table.settingsUsed.length === 0 ? 'None: counted from the records only' : table.settingsUsed.join('; ');
  return {
    title: table.title,
    facts: [
      ['How it is worked out', table.definition],
      ['Made from', table.sources?.length ? table.sources.join(', ') : 'Not stated'],
      ['Settings used', settings],
      ['Filters', reportFiltersText(ctx.filters)],
      ...(table.noLiveConnection ? [['Live data', NO_LIVE_CONNECTION] as [string, string]] : []),
      ['Rows', String(table.rows.length)],
    ],
    columns: table.columns,
    rows: table.rows,
    notes: table.notes,
    footer: `Made from FiberGIS records on ${stamp(ctx.generatedAt)}. Customers are named by id only: no names, addresses or house positions. "Not recorded" means nobody recorded it; it is never counted as zero or as free.`,
  };
}

/** The document's facts and notes as rows for a spreadsheet "About" sheet. */
export function reportAboutRows(doc: ReportDocument): { what: string; value: string }[] {
  return [{ what: 'Report', value: doc.title }, ...doc.facts.map(([what, value]) => ({ what, value })), ...doc.notes.map((n, i) => ({ what: `Note ${i + 1}`, value: n })), { what: 'Made', value: doc.footer }];
}
