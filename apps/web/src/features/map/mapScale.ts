/** The longest "round" distance (1, 2 or 5 × a power of ten) that fits in `maxMeters`. */
export function niceScaleMeters(maxMeters: number): number {
  if (!(maxMeters > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  for (const step of [5, 2, 1]) if (step * power <= maxMeters) return step * power;
  return power;
}

export const formatScale = (meters: number) => (meters >= 1000 ? `${meters / 1000} km` : `${meters} m`);
