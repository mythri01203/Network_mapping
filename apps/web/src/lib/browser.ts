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
