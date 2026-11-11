import jsPDF from 'jspdf';

import { buildTraceReport, type NetworkTraceResult, type TraceReport, traceReportCsv } from '@fibergis/shared';

import { downloadFile } from '../../lib/browser';

/**
 * Network mapping Phase 15: the trace report as a PDF (jsPDF, already a dependency) or a CSV (the
 * shared safe writer). Both come from `buildTraceReport`, so they say the same thing as the screen.
 */

const fileBase = (result: NetworkTraceResult, at: Date) => `trace-${result.type}-${result.fromLabel.replace(/[^\w-]+/g, '_').slice(0, 40)}-${at.toISOString().slice(0, 10)}`;

export function downloadTraceCsv(result: NetworkTraceResult, at: Date = new Date()): void {
  downloadFile(traceReportCsv(buildTraceReport(result, at)), 'text/csv;charset=utf-8', `${fileBase(result, at)}.csv`);
}

/** The PDF's built-in font covers Latin-1 only: arrows and marks are written in plain characters. */
export const pdfText = (text: string): string =>
  text
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u00b7/g, '-')
    .replace(/[^ -~\u00a0-\u00ff\u2013\u2014\u2026]/g, '');

/** Draws the report as an A4 landscape PDF. */
export function drawTracePdf(report: TraceReport): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  let y = margin;
  const need = (h: number) => {
    if (y + h > pageH - margin - 6) {
      doc.addPage();
      y = margin;
    }
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const title = doc.splitTextToSize(pdfText(report.title), pageW - margin * 2) as string[];
  doc.text(title, margin, y + 5);
  y += title.length * 5.5 + 4;
  doc.setFontSize(8.5);
  for (const [label, value] of report.facts) {
    const lines = doc.splitTextToSize(pdfText(value), pageW - margin * 2 - 32) as string[];
    need(lines.length * 3.8);
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, margin + 32, y + 3);
    y += lines.length * 3.8 + 0.6;
  }
  y += 3;
  // Wide text columns get more room; the record ids and position less.
  const weights: Record<string, number> = { part: 1.2, order: 0.5, level: 0.5, kind: 0.9, title: 2, detail: 2.6, state: 1, why: 2.2, links: 2.6, ids: 1.4, position: 1.2 };
  const total = report.columns.reduce((n, c) => n + (weights[c.key] ?? 1), 0);
  const widths = report.columns.map((c) => ((pageW - margin * 2) * (weights[c.key] ?? 1)) / total);
  doc.setFontSize(6.8);
  const drawRow = (cells: string[], bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfText(c || ''), widths[i] - 1.2) as string[]);
    const h = Math.max(...wrapped.map((w) => w.length)) * 2.8 + 1.4;
    need(h);
    let x = margin;
    wrapped.forEach((w, i) => {
      doc.text(w, x + 0.4, y + 2.6);
      x += widths[i];
    });
    doc.setDrawColor(200);
    doc.line(margin, y + h, pageW - margin, y + h);
    y += h + 0.4;
  };
  drawRow(report.columns.map((c) => c.label), true);
  for (const row of report.rows) drawRow(report.columns.map((c) => String(row[c.key] ?? '')), false);
  if (report.rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('No step is on record.', margin, y + 3);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    const footer = doc.splitTextToSize(pdfText(`${report.footer}  Page ${p} of ${pages}`), pageW - margin * 2) as string[];
    doc.text(footer, margin, pageH - margin + 1);
  }
  return doc;
}

export function downloadTracePdf(result: NetworkTraceResult, at: Date = new Date()): void {
  drawTracePdf(buildTraceReport(result, at)).save(`${fileBase(result, at)}.pdf`);
}
