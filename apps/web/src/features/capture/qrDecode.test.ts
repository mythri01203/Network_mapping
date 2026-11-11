import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as reader from 'zxing-wasm/reader';
import * as writer from 'zxing-wasm/writer';

import { equipmentSchema, findByTag, normalizeTag } from '@fibergis/shared';

import { TAG_BARCODE_FORMATS } from './qrScanner';

// The bundled decoder, run in Node with its WASM file read from disk (no CDN, as on the phone).
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('zxing-wasm/reader')).replace(/[\\/]dist[\\/].*$/, '');
reader.prepareZXingModule({ overrides: { wasmBinary: readFileSync(join(pkgDir, 'dist/reader/zxing_reader.wasm')).buffer as ArrayBuffer } });
writer.prepareZXingModule({ overrides: { wasmBinary: readFileSync(join(pkgDir, 'dist/writer/zxing_writer.wasm')).buffer as ArrayBuffer } });

describe('QR tags', () => {
  it('reads a printed tag code and finds the record it belongs to', async () => {
    const tag = await writer.writeBarcode('krm-0142', { format: 'QRCode', scale: 6 });
    expect(tag.error).toBe('');
    const [hit] = await reader.readBarcodes(tag.image!, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
    expect(hit?.isValid).toBe(true);
    const pole = equipmentSchema.parse({
      id: 'POLE-0000000001', name: 'Pole-01', type: 'Telecom Pole', category: 'Supporting Infrastructure', lat: 12.9, lng: 77.6,
      area: '', street: '', status: 'Active', images: [], installedDate: '', tagCode: 'KRM-0142',
    });
    expect(normalizeTag(hit.text)).toBe('KRM-0142');
    expect(findByTag([pole], hit.text)?.id).toBe('POLE-0000000001');
  });

  it('finds no QR code in a picture of some other barcode', async () => {
    const other = await writer.writeBarcode('5901234123457', { format: 'EAN13', scale: 3 });
    expect(await reader.readBarcodes(other.image!, { formats: ['QRCode'] })).toEqual([]);
  });
});

describe('barcode tags (Phase 19)', () => {
  it.each([
    ['Code128', 'krm-0142'],
    ['Code39', 'KRM-0143'],
    ['EAN13', '5901234123457'],
  ] as const)('reads a %s tag with the scanner formats and finds its record', async (format, text) => {
    const tag = await writer.writeBarcode(text, { format, scale: 3 });
    expect(tag.error).toBe('');
    const [hit] = await reader.readBarcodes(tag.image!, { formats: [...TAG_BARCODE_FORMATS], tryHarder: true, maxNumberOfSymbols: 1 });
    expect(hit?.isValid).toBe(true);
    const box = equipmentSchema.parse({
      id: 'BOX-0000000001', name: 'Box-01', type: 'FAT', category: 'Fiber Distribution', lat: 12.9, lng: 77.6,
      area: '', street: '', status: 'Active', images: [], installedDate: '', tagCode: normalizeTag(text),
    });
    expect(findByTag([box], hit.text)?.id).toBe('BOX-0000000001');
  });

  it('still reads QR codes', () => {
    expect(TAG_BARCODE_FORMATS).toContain('QRCode');
  });
});
