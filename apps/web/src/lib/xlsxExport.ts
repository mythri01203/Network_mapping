/**
 * Excel (.xlsx) export (network mapping Phase 21). One shared writer for every Excel download, so
 * every sheet gets the same protection as the CSV writer (`reportToCsv`): text that starts like a
 * formula (= + - @, tab, carriage return) is kept as text with a leading apostrophe, and a blank
 * cell means "not recorded" (never 0). `write-excel-file` is loaded only when a download starts, so
 * it stays out of the main bundle.
 */
import type { Sheet } from 'write-excel-file/browser';

export type XlsxCell = string | number | null;

export interface XlsxSheet {
  name: string;
  columns: { key: string; label: string }[];
  rows: Record<string, XlsxCell>[];
}

/** One prepared cell: a string or number with its type, or an empty cell. */
export type PreparedCell = { type: StringConstructor; value: string } | { type: NumberConstructor; value: number } | null;

export interface PreparedSheet {
  sheet: string;
  data: PreparedCell[][];
  columns: { width: number }[];
}

/** Text that a spreadsheet could run as a formula is kept as text, as in the CSV writer. */
export function safeSheetText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ], not blank, and unique. */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = (raw.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim() || `Sheet ${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function prepareCell(value: XlsxCell | undefined): PreparedCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? { type: Number, value } : null;
  if (value === '') return null;
  return { type: String, value: safeSheetText(value) };
}

/** The sheets as `write-excel-file` input: a header row, then the rows in column order. */
export function prepareXlsxSheets(sheets: readonly XlsxSheet[]): PreparedSheet[] {
  const names = sheetNames(sheets.map((s) => s.name));
  return sheets.map((s, i) => {
    const header = s.columns.map((c) => prepareCell(c.label));
    const body = s.rows.map((row) => s.columns.map((c) => prepareCell(row[c.key])));
    const columns = s.columns.map((c) => {
      let longest = c.label.length;
      for (const row of s.rows) {
        const v = row[c.key];
        if (v !== null && v !== undefined) longest = Math.max(longest, String(v).length);
      }
      return { width: Math.min(60, Math.max(8, longest + 2)) };
    });
    return { sheet: names[i]!, data: [header, ...body], columns };
  });
}

/** The .xlsx file name, ending in .xlsx once. */
export function xlsxFileName(fileName: string): string {
  const base = fileName.trim().replace(/\.xlsx$/i, '') || 'export';
  return `${base}.xlsx`;
}

/** Builds the workbook and downloads it. Rejects when there is nothing to write. */
export async function downloadXlsx(
  sheets: { name: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[] }[],
  fileName: string,
): Promise<void> {
  if (sheets.length === 0) throw new Error('There is nothing to export.');
  const prepared = prepareXlsxSheets(sheets);
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const blob = await writeXlsxFile(prepared as Sheet<Blob>[]).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = xlsxFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
