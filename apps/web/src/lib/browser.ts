/** Asks the user to confirm a destructive action. Outside a browser (tests) it always confirms. */
export function confirmAction(message: string): boolean {
  return typeof window === 'undefined' || typeof window.confirm !== 'function' ? true : window.confirm(message);
}

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
