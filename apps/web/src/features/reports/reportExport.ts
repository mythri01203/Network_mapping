import jsPDF from 'jspdf';

import { buildReportDocument, type ReportDocument, type ReportFilters, reportAboutRows, reportFiltersText, type ReportTable } from '@fibergis/shared';

import { downloadXlsx, type XlsxSheet } from '../../lib/xlsxExport';
import { pdfText } from '../trace/traceExport';

/**
 * Network mapping Phase 22: a report as Excel (the shared safe writer), a generated PDF (jsPDF, the
 * same way as the trace report) or a picture (PNG). All come from the report table and
 * `buildReportDocument`, so they say what the screen says: the rows, where they came from, the
 * settings and the filters. Reports name customers by id only, and the data in the app is already
 * what this person's role may see (Phase 12), so nothing more is hidden or added here.
 */

const fileSafe = (text: string) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export const reportFileBase = (id: string, at: Date) => `fibergis-${fileSafe(id)}-${at.toISOString().slice(0, 10)}`;

const ABOUT_COLUMNS = [
  { key: 'what', label: 'What' },
  { key: 'value', label: 'Value' },
];

/** The sheets for one report: its rows, then what it is made from. */
export function reportSheets(table: ReportTable, filters: ReportFilters, at: Date): XlsxSheet[] {
  const doc = buildReportDocument(table, { filters, generatedAt: at });
  return [
    { name: table.title, columns: table.columns, rows: table.rows },
    { name: 'About this report', columns: ABOUT_COLUMNS, rows: reportAboutRows(doc) },
  ];
}

/** Every report in one workbook: a contents sheet, then one sheet per report. */
export function allReportSheets(tables: readonly ReportTable[], filters: ReportFilters, at: Date): XlsxSheet[] {
  const contents: XlsxSheet = {
    name: 'Contents',
    columns: [
      { key: 'report', label: 'Report' },
      { key: 'rows', label: 'Rows' },
      { key: 'from', label: 'Made from' },
      { key: 'settings', label: 'Settings used' },
      { key: 'notes', label: 'Notes' },
    ],
    rows: tables.map((t) => {
      const facts = Object.fromEntries(buildReportDocument(t, { filters, generatedAt: at }).facts);
      return { report: t.title, rows: t.rows.length, from: facts['Made from'] ?? '', settings: facts['Settings used'] ?? '', notes: t.notes.join(' ') };
    }),
  };
  contents.rows.push({ report: `Filters: ${reportFiltersText(filters)}`, rows: null, from: null, settings: null, notes: null });
  contents.rows.push({ report: `Made ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`, rows: null, from: null, settings: null, notes: 'Customers are named by id only. "Not recorded" means nobody recorded it; it is never counted as zero or as free.' });
  return [contents, ...tables.map((t) => ({ name: t.title, columns: t.columns, rows: t.rows }))];
}

export function downloadReportXlsx(table: ReportTable, filters: ReportFilters, at: Date = new Date()): Promise<void> {
  return downloadXlsx(reportSheets(table, filters, at), `${reportFileBase(table.id, at)}.xlsx`);
}

export function downloadAllReportsXlsx(tables: readonly ReportTable[], filters: ReportFilters, at: Date = new Date()): Promise<void> {
  return downloadXlsx(allReportSheets(tables, filters, at), `${reportFileBase('all-reports', at)}.xlsx`);
}

/** Draws the report as an A4 landscape PDF: title, the facts, the table, the notes, a footer on every page. */
export function drawReportPdf(report: ReportDocument): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const inner = pageW - margin * 2;
  let y = margin;
  const need = (h: number) => {
    if (y + h > pageH - margin - 6) {
      doc.addPage();
      y = margin;
    }
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const title = doc.splitTextToSize(pdfText(report.title), inner) as string[];
  doc.text(title, margin, y + 5);
  y += title.length * 5.5 + 4;
  doc.setFontSize(8.5);
  for (const [label, value] of report.facts) {
    const lines = doc.splitTextToSize(pdfText(value), inner - 36) as string[];
    need(lines.length * 3.8);
    doc.setFont('helvetica', 'bold');
    doc.text(pdfText(label), margin, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, margin + 36, y + 3);
    y += lines.length * 3.8 + 0.6;
  }
  y += 3;
  // Columns get room by how long their text is, within limits, so short number columns stay narrow.
  const weights = report.columns.map((c) => {
    let longest = c.label.length;
    for (const row of report.rows.slice(0, 300)) longest = Math.max(longest, String(row[c.key] ?? '').length);
    return Math.min(40, Math.max(4, longest));
  });
  const total = weights.reduce((n, w) => n + w, 0) || 1;
  const widths = weights.map((w) => (inner * w) / total);
  doc.setFontSize(report.columns.length > 12 ? 6 : 6.8);
  const lineH = report.columns.length > 12 ? 2.5 : 2.8;
  const drawRow = (cells: string[], bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfText(c || ''), Math.max(2, widths[i] - 1.2)) as string[]);
    const h = Math.max(1, ...wrapped.map((w) => w.length)) * lineH + 1.4;
    need(h);
    let x = margin;
    wrapped.forEach((w, i) => {
      doc.text(w, x + 0.4, y + lineH - 0.2);
      x += widths[i];
    });
    doc.setDrawColor(200);
    doc.line(margin, y + h, pageW - margin, y + h);
    y += h + 0.4;
  };
  drawRow(
    report.columns.map((c) => c.label),
    true,
  );
  for (const row of report.rows) drawRow(report.columns.map((c) => String(row[c.key] ?? '')), false);
  if (report.rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    need(5);
    doc.text('Nothing recorded.', margin, y + 3);
    y += 5;
  }
  if (report.notes.length > 0) {
    y += 3;
    doc.setFontSize(8);
    for (const note of report.notes) {
      const lines = doc.splitTextToSize(pdfText(note), inner) as string[];
      need(lines.length * 3.6);
      doc.setFont('helvetica', 'normal');
      doc.text(lines, margin, y + 3);
      y += lines.length * 3.6 + 0.6;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    const footer = doc.splitTextToSize(pdfText(`${report.footer}  Page ${p} of ${pages}`), inner) as string[];
    doc.text(footer, margin, pageH - margin + 1);
  }
  return doc;
}

export function downloadReportPdf(table: ReportTable, filters: ReportFilters, at: Date = new Date()): void {
  drawReportPdf(buildReportDocument(table, { filters, generatedAt: at })).save(`${reportFileBase(table.id, at)}.pdf`);
}

/** A picture of what is on screen (the report summary and the rows shown). `html-to-image` loads only when asked. */
export async function downloadReportPng(node: HTMLElement, table: Pick<ReportTable, 'id'>, at: Date = new Date()): Promise<void> {
  const { toPng } = await import('html-to-image');
  const url = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true });
  const link = document.createElement('a');
  link.href = url;
  link.download = `${reportFileBase(table.id, at)}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
