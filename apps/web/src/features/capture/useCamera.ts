import { useEffect, useRef, useState } from 'react';

export type CameraState = 'starting' | 'live' | 'blocked' | 'unavailable';

const liveViewSupported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  !(typeof window !== 'undefined' && window.isSecureContext === false);

/**
 * The back camera as a live stream for a framing guide or a QR scan. `unavailable` means the page
 * must fall back to the phone's own camera app (`<input capture>`), which needs no stream.
 */
export function useCameraStream(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: CameraState } | null>(null);
  const supported = liveViewSupported();

  useEffect(() => {
    if (!enabled || !supported) return undefined;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // The camera can still be busy for a moment after the previous screen released it, so a
    // non-permission failure is retried quietly before falling back to the phone's camera app.
    const open = (tries: number) => {
      navigator.mediaDevices
        .getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        .then(async (s) => {
          if (cancelled) {
            s.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = s;
          if (video) {
            video.srcObject = s;
            video.muted = true;
            video.setAttribute('playsinline', 'true');
            await video.play().catch(() => undefined);
          }
          if (!cancelled) setResult({ attempt, state: 'live' });
        })
        .catch((error: { name?: string }) => {
          if (cancelled) return;
          const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
          if (!blocked && tries < 2) {
            retryTimer = setTimeout(() => open(tries + 1), 500 * (tries + 1));
            return;
          }
          setResult({ attempt, state: blocked ? 'blocked' : 'unavailable' });
        });
    };
    open(0);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [enabled, supported, attempt]);

  const state: CameraState = !supported ? 'unavailable' : result?.attempt === attempt ? result.state : 'starting';
  return { videoRef, state, retry: () => setAttempt((n) => n + 1) };
}
