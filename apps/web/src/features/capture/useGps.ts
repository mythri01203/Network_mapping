import { useEffect, useMemo, useRef, useState } from 'react';

import { decideGps, type GpsDecision, type GpsLimits, type GpsSample } from '@fibergis/shared';

export type GpsProblem = 'denied' | 'unavailable' | null;

export interface GpsSampler {
  samples: GpsSample[];
  decision: GpsDecision;
  problem: GpsProblem;
  elapsedMs: number;
}

interface Reading {
  session: string;
  samples: GpsSample[];
  problem: GpsProblem;
  elapsedMs: number;
}

const MAX_SAMPLES = 60;
const NONE: GpsSample[] = [];

const decide = (samples: GpsSample[], problem: GpsProblem, elapsedMs: number, limits: GpsLimits) =>
  // Blocked or missing GPS gives nothing to wait for.
  decideGps(samples, problem ? Math.max(elapsedMs, limits.waitSeconds * 1000) : elapsedMs, limits);

/**
 * Collects phone GPS readings while `active`, for the capture named by `session`. Nothing is shown
 * as coordinates; the screens show a progress ring and a tick. `onUpdate` hears every new decision,
 * so a screen can move on at the green tick. Repeated identical readings are counted once.
 */
export function useGpsSampler(
  active: boolean,
  session: string,
  limits: GpsLimits,
  onUpdate?: (decision: GpsDecision, samples: GpsSample[]) => void,
): GpsSampler {
  const [reading, setReading] = useState<Reading | null>(null);
  const listener = useRef(onUpdate);
  const latestLimits = useRef(limits);
  useEffect(() => {
    listener.current = onUpdate;
    latestLimits.current = limits;
  });

  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    let samples: GpsSample[] = [];
    let problem: GpsProblem = null;
    const publish = () => {
      const elapsedMs = Date.now() - startedAt;
      setReading({ session, samples, problem, elapsedMs });
      listener.current?.(decide(samples, problem, elapsedMs, latestLimits.current), samples);
    };
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) problem = 'unavailable';
    const watchId = geo?.watchPosition(
      ({ coords, timestamp }) => {
        problem = null;
        const sample: GpsSample = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp || Date.now() };
        const last = samples.at(-1);
        if (!(last && last.at === sample.at && last.lat === sample.lat && last.lng === sample.lng)) {
          samples = [...samples, sample].slice(-MAX_SAMPLES);
        }
        publish();
      },
      (error) => {
        if (error.code === 1) problem = 'denied';
        else if (error.code === 2) problem = 'unavailable';
        publish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    const timer = setInterval(publish, 500);
    return () => {
      if (watchId !== undefined) geo?.clearWatch(watchId);
      clearInterval(timer);
    };
  }, [active, session]);

  // A reading from an earlier capture, or from before GPS stopped, does not count.
  const current = active && reading?.session === session ? reading : null;
  const samples = current?.samples ?? NONE;
  const problem = current?.problem ?? null;
  const elapsedMs = current?.elapsedMs ?? 0;
  const decision = useMemo(() => decide(samples, problem, elapsedMs, limits), [samples, problem, elapsedMs, limits]);
  return { samples, decision, problem, elapsedMs };
}
