import jsPDF from 'jspdf';

import { type Cable, type ColorScheme, coreIdentity, hasRecordedLocation, type JointClosure, trayUsage } from '@fibergis/shared';

import { historyWords, lossWords, NOT_RECORDED, SPLICE_STATUS_WORDS } from './spliceWords';

/**
 * Phase 8: the printable splice report of one closure. Every value comes from the records;
 * anything missing is written "Not recorded". `buildSpliceReport` is pure (tested); the PDF is
 * drawn with jsPDF, already a dependency.
 */

export interface SpliceReportTable {
  title: string;
  columns: string[];
  rows: string[][];
  /** Shown when there are no rows. */
  empty: string;
}

export interface SpliceReport {
  title: string;
  facts: [string, string][];
  tables: SpliceReportTable[];
  footer: string;
}

const orNot = (value: string | undefined | null) => (value && value.trim() ? value : NOT_RECORDED);

export function buildSpliceReport(closure: JointClosure, cables: readonly Cable[], schemes: readonly ColorScheme[], generatedAt: Date): SpliceReport {
  const cableById = new Map(cables.map((c) => [c.id, c]));
  const trayLabel = (id?: string) => (id ? (closure.trays ?? []).find((t) => t.id === id)?.label ?? `${id} (not on this closure)` : NOT_RECORDED);
  const fiber = (cableId: string, cableName: string, core: number) => {
    const cable = cableById.get(cableId);
    const identity = cable ? coreIdentity(cable, core, schemes) : undefined;
    return `${cable?.name ?? cableName ?? cableId} ${identity?.shortLabel ?? `F${core}`}${identity?.fiberColor ? ` ${identity.fiberColor.name}` : ' (colour not known)'}`;
  };
  const active = closure.splices.filter((s) => !s.retiredAt);
  const history = closure.splices.filter((s) => s.retiredAt);
  const pigtails = closure.terminations ?? [];
  const usage = trayUsage(closure);
  const roleWord = { in: 'In (from the OLT side)', out: 'Out (towards customers)', through: 'Passes through' } as const;

  return {
    title: `Splice report: ${closure.name}`,
    facts: [
      ['Closure', `${closure.name} (${closure.id})`],
      ['Type', closure.closureType],
      ['Position', hasRecordedLocation(closure) ? `${closure.lat.toFixed(6)}, ${closure.lng.toFixed(6)} (as recorded)` : NOT_RECORDED],
      ['Area', orNot(closure.area)],
      ['Installed', orNot(closure.installationDate)],
      ['Installed by', orNot(closure.technician)],
      ['Seal', closure.sealStatus && closure.sealStatus !== 'unknown' ? closure.sealStatus : NOT_RECORDED],
      ['Condition', closure.condition && closure.condition !== 'unknown' ? closure.condition.replace('_', ' ') : NOT_RECORDED],
      ['Cables', (closure.cableEntries ?? []).length ? (closure.cableEntries ?? []).map((e) => `${cableById.get(e.cableId)?.name ?? e.cableId}: ${roleWord[e.role]}`).join('; ') : NOT_RECORDED],
      ['Splices in service', String(active.length)],
      ['Pigtails in service', String(pigtails.filter((t) => !t.retiredAt).length)],
    ],
    tables: [
      {
        title: 'Trays',
        columns: ['Tray', 'Positions', 'Used', 'Note'],
        rows: usage.map((u) => [
          u.tray.label,
          u.tray.capacity !== undefined ? String(u.tray.capacity) : NOT_RECORDED,
          String(u.used),
          [u.tray.capacity !== undefined && u.used > u.tray.capacity ? 'More than its positions' : '', u.positionsTaken.length ? 'A position is recorded twice' : ''].filter(Boolean).join('. '),
        ]),
        empty: 'No trays recorded.',
      },
      {
        title: 'Splices in service',
        columns: ['Place', 'From (OLT side)', 'To (customer side)', 'Type', 'State', 'Loss', 'Meter or device', 'OTDR / test', 'Report', 'By, date', 'Notes'],
        rows: active.map((s) => [
          [trayLabel(s.trayId), s.cassette ? `cass. ${s.cassette}` : '', s.position !== undefined ? `pos. ${s.position}` : ''].filter(Boolean).join(', '),
          fiber(s.inputCableId, s.inputCableName, s.inputCore),
          fiber(s.outputCableId, s.outputCableName, s.outputCore),
          s.spliceType ?? NOT_RECORDED,
          SPLICE_STATUS_WORDS[s.status],
          lossWords(s),
          orNot(s.lossMeter),
          orNot(s.otdrRef),
          orNot(s.reportRef),
          `${orNot(s.technician)}, ${orNot(s.date)}`,
          [s.notes, s.photoIds?.length ? `${s.photoIds.length} photo(s)` : ''].filter(Boolean).join(' · '),
        ]),
        empty: 'No splices in service.',
      },
      {
        title: 'Fibers ending on a pigtail (connector)',
        columns: ['Place', 'Fiber', 'Connector', 'Pigtail label', 'Plugs into', 'By, date', 'State'],
        rows: pigtails.map((t) => [
          [trayLabel(t.trayId), t.cassette ? `cass. ${t.cassette}` : '', t.position !== undefined ? `pos. ${t.position}` : ''].filter(Boolean).join(', '),
          fiber(t.cableId, t.cableName, t.core),
          orNot(t.connectorType),
          orNot(t.pigtailLabel),
          orNot(t.connectsTo),
          `${orNot(t.technician)}, ${orNot(t.date)}`,
          t.retiredAt ? historyWords(t) : 'In service',
        ]),
        empty: 'No pigtails recorded.',
      },
      {
        title: 'Splice history (out of service or entered by mistake)',
        columns: ['From', 'To', 'Spliced', 'What happened'],
        rows: history.map((s) => [
          fiber(s.inputCableId, s.inputCableName, s.inputCore),
          fiber(s.outputCableId, s.outputCableName, s.outputCore),
          `${orNot(s.technician)}, ${orNot(s.date)}`,
          `${historyWords(s)}${s.replacedBySpliceId ? '. Replaced by a new splice' : ''}`,
        ]),
        empty: 'No splice history.',
      },
    ],
    footer: `Made from FiberGIS records on ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. "Not recorded" means nobody has entered it. Positions are as recorded, not a survey.`,
  };
}

/** Draws the report as an A4 landscape PDF and starts the download. */
export function downloadSpliceReport(report: SpliceReport, fileName: string): void {
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
  doc.setFontSize(14);
  doc.text(report.title, margin, y + 5);
  y += 10;
  doc.setFontSize(9);
  for (const [label, value] of report.facts) {
    const lines = doc.splitTextToSize(value, pageW - margin * 2 - 40) as string[];
    need(lines.length * 4);
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, margin + 40, y + 3);
    y += lines.length * 4 + 0.5;
  }
  for (const table of report.tables) {
    y += 4;
    need(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(table.title, margin, y + 4);
    y += 7;
    doc.setFontSize(7.5);
    if (table.rows.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.text(table.empty, margin, y + 3);
      y += 5;
      continue;
    }
    const width = (pageW - margin * 2) / table.columns.length;
    const drawRow = (cells: string[], bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const wrapped = cells.map((c) => doc.splitTextToSize(c || '', width - 1.5) as string[]);
      const h = Math.max(...wrapped.map((w) => w.length)) * 3.2 + 1.5;
      need(h);
      wrapped.forEach((w, i) => doc.text(w, margin + i * width + 0.5, y + 3));
      doc.setDrawColor(200);
      doc.line(margin, y + h, pageW - margin, y + h);
      y += h + 0.5;
    };
    drawRow(table.columns, true);
    for (const row of table.rows) drawRow(row, false);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${report.footer}  Page ${p} of ${pages}`, margin, pageH - margin + 2);
  }
  doc.save(fileName);
}
