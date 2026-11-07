export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** A short beep and a buzz after a save, where the phone allows. Sound needs an earlier tap. */
export function celebrateSave(): void {
  try {
    navigator.vibrate?.(150);
  } catch {
    // Not supported.
  }
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    tone.connect(gain).connect(ctx.destination);
    tone.start();
    tone.stop(ctx.currentTime + 0.25);
    tone.onended = () => void ctx.close();
  } catch {
    // Sound blocked: the tick and words still show.
  }
}
