/**
 * QR and barcode reading with zxing-wasm (barcodes since Phase 19). `BarcodeDetector` is experimental, so the decoder is bundled. The
 * WASM file is served by this app (and cached by the service worker); the library's default of
 * fetching it from a CDN is overridden, so scanning works with no signal.
 */
import type * as ZXingReader from 'zxing-wasm/reader';

type Reader = typeof ZXingReader;
type ReadFormat = NonNullable<NonNullable<Parameters<Reader['readBarcodes']>[1]>['formats']>[number];

let readerPromise: Promise<Reader> | null = null;

function loadReader(): Promise<Reader> {
  readerPromise ??= Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')])
    .then(([reader, wasm]) => {
      reader.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) },
      });
      return reader;
    })
    .catch((error) => {
      readerPromise = null;
      throw error;
    });
  return readerPromise;
}

/** Starts loading the decoder early, so the first scan is quick. */
export const preloadQrReader = (): void => void loadReader().catch(() => undefined);

/**
 * Phase 19: what an asset tag can be. QR codes as before, and the common printed 1D barcodes used
 * on asset labels (Code 128, Code 39, Code 93, ITF, Codabar) and retail labels (EAN-13, EAN-8,
 * UPC-A, UPC-E). The same bundled decoder reads them all: no new download.
 */
export const TAG_BARCODE_FORMATS = ['QRCode', 'Code128', 'Code39', 'Code93', 'ITF', 'Codabar', 'EAN13', 'EAN8', 'UPCA', 'UPCE'] as const satisfies readonly ReadFormat[];

const MAX_SCAN_SIDE = 720;
let canvas: HTMLCanvasElement | null = null;

/** Text of a QR code or barcode in the current video frame, or null when none is readable. */
export async function scanVideoFrame(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const reader = await loadReader();
  const scale = Math.min(1, MAX_SCAN_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  canvas ??= document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const results = await reader.readBarcodes(ctx.getImageData(0, 0, width, height), {
    formats: [...TAG_BARCODE_FORMATS],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  const hit = results.find((r) => r.isValid && r.text.trim());
  return hit ? hit.text : null;
}
