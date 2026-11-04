import type L from 'leaflet';

/**
 * Custom panes, ordered by z-index relative to Leaflet's built-ins
 * (overlayPane 400, markerPane 600, tooltipPane 650, popupPane 700).
 */
export const PANES = {
  /** Selection / trace halos, always beneath the cable they outline. */
  halo: 'gis-halo',
  /** Field-route overlay. */
  route: 'gis-route',
  /** Sketch previews for drawing and measuring; never intercepts clicks. */
  sketch: 'gis-sketch',
  /** Equipment name labels; below markers so they never steal clicks. */
  labels: 'gis-labels',
} as const;

const PANE_Z_INDEX: Record<(typeof PANES)[keyof typeof PANES], number> = {
  'gis-halo': 390,
  'gis-route': 420,
  'gis-sketch': 450,
  'gis-labels': 550,
};

const NON_INTERACTIVE = new Set<string>([PANES.sketch, PANES.labels]);

export function createPanes(map: L.Map): void {
  for (const [name, zIndex] of Object.entries(PANE_Z_INDEX)) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
    if (NON_INTERACTIVE.has(name)) pane.style.pointerEvents = 'none';
  }
}
