/** True when a keyboard event comes from a text field, so global shortcuts should stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

/** Drag payload type used when an equipment type is dragged from the catalog onto the map. */
export const EQUIPMENT_DRAG_TYPE = 'application/fiber-equipment-type';

/** Triggers a client-side download of `content` as `filename`. */
export function downloadFile(content: string, mimeType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

/** The device's real position with its accuracy. Rejects when there is none, and never falls back. */
export function currentGpsPosition(timeoutMs = 15_000): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracyMeters: coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5_000 },
    );
  });
}

/** Plain next action for a GPS failure. */
export function gpsFailureMessage(error: unknown): string {
  const code = (error as { code?: number } | undefined)?.code;
  if (code === 1) return 'Location is blocked for this app. Allow location in the browser, then try again.';
  if (code === 3) return 'Go to open sky and wait, then try again. Nothing was saved.';
  if (error instanceof Error && error.message === 'unsupported') return 'This device has no GPS here. Pick the place on the map instead.';
  return 'Could not get your position. Go to open sky and try again. Nothing was saved.';
}
