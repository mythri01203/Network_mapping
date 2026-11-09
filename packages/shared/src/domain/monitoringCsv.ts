import { type ColumnMapping, ONU_STATES, type OnuState } from '../model/monitoringSchemas';
import type { IngestRow, SkippedRow } from './monitoringIngest';

/**
 * File import (Phase 7): a CSV or TSV that the owner exports from their OLT or NMS. The person
 * chooses which column is which; the choice is saved on the source so the next export maps the
 * same way. Nothing is guessed from column names. Vendor status words are mapped by the person too,
 * and a word nobody mapped is skipped with that reason.
 */

export interface DelimitedTable {
  delimiter: ',' | '\t' | ';';
  headers: string[];
  rows: string[][];
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

/** Reads a CSV, TSV or semicolon file. The first non-empty line is the header. */
export function parseDelimited(text: string): DelimitedTable | { error: string } {
  if (text.length > MAX_IMPORT_BYTES) return { error: 'The file is larger than 2 MB. Export fewer rows at a time.' };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { error: 'The file needs a header line and at least one row.' };
  const head = lines[0];
  const delimiter = head.includes('\t') ? '\t' : head.split(';').length > head.split(',').length ? ';' : ',';
  const headers = splitLine(head, delimiter);
  if (headers.length < 2) return { error: 'Only one column was found. Save the export as CSV or TSV.' };
  return { delimiter, headers, rows: lines.slice(1).map((l) => splitLine(l, delimiter)) };
}

/** The distinct status words in the chosen column, as written, for the person to map. */
export function statusWordsIn(table: DelimitedTable, column: string | undefined): string[] {
  const at = column ? table.headers.indexOf(column) : -1;
  if (at < 0) return [];
  return [...new Set(table.rows.map((r) => (r[at] ?? '').trim()).filter(Boolean))].slice(0, 50);
}

const isOurState = (word: string): word is OnuState => (ONU_STATES as readonly string[]).includes(word);

/** Applies a saved mapping. Returns rows ready for `planIngest`, and rows skipped here with why. */
export function rowsFromTable(table: DelimitedTable, mapping: ColumnMapping): { rows: IngestRow[]; rowNumbers: number[]; skipped: SkippedRow[] } {
  const col = (name: string | undefined) => (name ? table.headers.indexOf(name) : -1);
  const at = {
    onuAddress: col(mapping.onuAddress),
    serial: col(mapping.serial),
    deviceTime: col(mapping.deviceTime),
    ontRx: col(mapping.ontRx),
    oltRx: col(mapping.oltRx),
    unit: col(mapping.unit),
    status: col(mapping.status),
  };
  const rows: IngestRow[] = [];
  const rowNumbers: number[] = [];
  const skipped: SkippedRow[] = [];
  table.rows.forEach((cells, i) => {
    const n = i + 1;
    const get = (index: number) => (index >= 0 ? (cells[index] ?? '').trim() : '');
    const word = get(at.status);
    let state: OnuState | undefined;
    if (word) {
      state = mapping.statusWords?.[word] ?? (isOurState(word) ? word : undefined);
      if (!state) return void skipped.push({ row: n, reason: `Status "${word.slice(0, 30)}" is not mapped to online, offline, LOS, dying gasp or unknown` });
    }
    const row: IngestRow = {
      deviceTime: get(at.deviceTime),
      ...(get(at.onuAddress) ? { onuAddress: get(at.onuAddress) } : {}),
      ...(get(at.serial) ? { serial: get(at.serial) } : {}),
      ...(get(at.ontRx) ? { ontRxDbm: get(at.ontRx) } : {}),
      ...(get(at.oltRx) ? { oltRxDbm: get(at.oltRx) } : {}),
      ...(get(at.unit) || mapping.defaultUnit ? { unit: get(at.unit) || mapping.defaultUnit } : {}),
      ...(state ? { state, rawState: word } : {}),
    };
    if (!row.deviceTime) return void skipped.push({ row: n, reason: 'No device time in this row' });
    rows.push(row);
    rowNumbers.push(n);
  });
  return { rows, rowNumbers, skipped };
}

/** What a mapping still needs before a file can be read. */
export function mappingProblem(mapping: ColumnMapping): string | null {
  if (!mapping.onuAddress && !mapping.serial) return 'Choose the column with the ONU address or the serial.';
  if (!mapping.deviceTime) return 'Choose the column with the time the device read the value.';
  if (!mapping.ontRx && !mapping.oltRx && !mapping.status) return 'Choose at least one column with a reading or a status.';
  if ((mapping.ontRx || mapping.oltRx) && !mapping.unit && !mapping.defaultUnit) return 'Choose the unit column, or say the readings are in dBm.';
  return null;
}
