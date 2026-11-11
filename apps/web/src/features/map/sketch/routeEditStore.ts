import { create } from 'zustand';

import type { LatLng, RouteEnd } from '@fibergis/shared';

/**
 * Phase 5: screen state for changing a cable's or a duct's line on the map. Nothing here is network
 * data: each finished action runs one command (one undo step) and the tool stays open for the next.
 * Every action is a tap: tap a point, then tap the new place. No drag or long-press is needed.
 */

export type RouteEditTarget = { kind: 'cable'; id: string } | { kind: 'duct'; id: string };

export type RouteTool = 'move' | 'insert' | 'remove' | 'extend' | 'trim' | 'split';

export const ROUTE_TOOL_LABELS: Record<RouteTool, string> = {
  move: 'Move a point',
  insert: 'Add a point',
  remove: 'Remove a point',
  extend: 'Make longer',
  trim: 'Cut off an end',
  split: 'Split here',
};

export const ROUTE_TOOL_HINTS: Record<RouteTool, string> = {
  move: 'Tap the point to move, then tap its new place.',
  insert: 'Tap where the new point goes. It joins the nearest part of the line.',
  remove: 'Tap the point to take out.',
  extend: 'Choose the end, then tap each new point going outwards. Tap Finish when done.',
  trim: 'Tap the point where the line should stop, then choose which end to cut off.',
  split: 'Tap the point where the cable is cut into two. To split between points, add a point there first.',
};

interface RouteEditState {
  target: RouteEditTarget | null;
  tool: RouteTool;
  /** The point tapped first (move, trim). */
  picked: number | null;
  /** Extend: which end grows, and the points tapped so far (not saved until Finish). */
  extendEnd: RouteEnd | null;
  extendPoints: LatLng[];
  /** Split: the point the person tapped, waiting for the split questions. */
  splitIndex: number | null;
  /** True while a command (and its question) is running, so taps are not taken twice. */
  busy: boolean;

  start: (target: RouteEditTarget, tool?: RouteTool) => void;
  stop: () => void;
  retarget: (target: RouteEditTarget) => void;
  setTool: (tool: RouteTool) => void;
  pick: (index: number | null) => void;
  setExtendEnd: (end: RouteEnd | null) => void;
  addExtendPoint: (point: LatLng) => void;
  undoExtendPoint: () => void;
  askSplit: (index: number | null) => void;
  setBusy: (busy: boolean) => void;
}

const fresh = { picked: null, extendEnd: null, extendPoints: [] as LatLng[], splitIndex: null, busy: false };

export const useRouteEditStore = create<RouteEditState>()((set) => ({
  target: null,
  tool: 'move',
  ...fresh,
  start: (target, tool = 'move') => set({ target, tool: target.kind === 'duct' && tool === 'split' ? 'move' : tool, ...fresh }),
  stop: () => set({ target: null, ...fresh }),
  retarget: (target) => set({ target, ...fresh }),
  setTool: (tool) => set((s) => ({ tool: s.target?.kind === 'duct' && tool === 'split' ? s.tool : tool, ...fresh })),
  pick: (picked) => set({ picked }),
  setExtendEnd: (extendEnd) => set({ extendEnd, extendPoints: [] }),
  addExtendPoint: (point) => set((s) => (s.extendEnd ? { extendPoints: [...s.extendPoints, point] } : {})),
  undoExtendPoint: () => set((s) => ({ extendPoints: s.extendPoints.slice(0, -1) })),
  askSplit: (splitIndex) => set({ splitIndex }),
  setBusy: (busy) => set({ busy }),
}));
