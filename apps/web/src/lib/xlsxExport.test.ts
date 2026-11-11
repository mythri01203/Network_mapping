import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import writeXlsxFile, { type Sheet } from 'write-excel-file/universal';
import { prepareXlsxSheets, safeSheetText, sheetNames, xlsxFileName } from './xlsxExport';

describe('xlsx export', () => {
  it('keeps text that starts like a formula as text, as the CSV writer does', () => {
    expect(safeSheetText('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(safeSheetText('+91 98')).toBe("'+91 98");
    expect(safeSheetText('-5')).toBe("'-5");
    expect(safeSheetText('@cmd')).toBe("'@cmd");
    expect(safeSheetText('\tx')).toBe("'\tx");
    expect(safeSheetText('FAT-01')).toBe('FAT-01');
  });

  it('writes a header row, keeps numbers as numbers and leaves unknown cells blank', () => {
    const [sheet] = prepareXlsxSheets([
      {
        name: 'Cables',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'length', label: 'Length (m)' },
        ],
        rows: [
          { name: 'F-1', length: 120 },
          { name: '=HYPERLINK("x")', length: null },
          { name: '', length: Number.NaN },
        ],
      },
    ]);
    expect(sheet!.sheet).toBe('Cables');
    expect(sheet!.data[0]).toEqual([
      { type: String, value: 'Name' },
      { type: String, value: 'Length (m)' },
    ]);
    expect(sheet!.data[1]).toEqual([
      { type: String, value: 'F-1' },
      { type: Number, value: 120 },
    ]);
    expect(sheet!.data[2]).toEqual([{ type: String, value: `'=HYPERLINK("x")` }, null]);
    expect(sheet!.data[3]).toEqual([null, null]);
  });

  it('makes sheet names Excel accepts', () => {
    expect(sheetNames(['A/B', 'a/b', '', 'x'.repeat(40)])).toEqual(['A B', 'a b (2)', 'Sheet 3', 'x'.repeat(31)]);
    expect(xlsxFileName('report.xlsx')).toBe('report.xlsx');
    expect(xlsxFileName('report')).toBe('report.xlsx');
  });

  it('produces a real workbook in which a formula-like text is a plain string', async () => {
    const prepared = prepareXlsxSheets([
      { name: 'One', columns: [{ key: 'a', label: 'A' }], rows: [{ a: '=1+1' }, { a: 7 }] },
      { name: 'Two', columns: [{ key: 'b', label: 'B' }], rows: [{ b: 'ok' }] },
    ]);
    const blob = await writeXlsxFile(prepared as Sheet<Blob>[]).toBlob();
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    const allXml = Object.values(files).map((f) => strFromU8(f)).join('\n');
    expect(allXml).toContain("'=1+1");
    expect(allXml).not.toMatch(/<f>/);
  });
});
