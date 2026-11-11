import type { FiberTermination, JointClosure, SpliceRecord, SpliceTray } from '../model/types';
import { isSpliceActive } from './fiberIndex';

/**
 * Phase 8: what sits on each tray of a closure. Pure helpers shared by the rules, the splice
 * screen and the splice report. Only active splices (not out of service, not entered by mistake)
 * and active pigtails take a place on a tray.
 */

export interface TrayItem {
  kind: 'splice' | 'pigtail';
  id: string;
  /** Short words for messages: "C-A fiber 3 → C-B fiber 3" or "pigtail on C-A fiber 4". */
  label: string;
  cassette?: string;
  position?: number;
}

export interface TrayPositionTaken {
  cassette?: string;
  position: number;
  items: TrayItem[];
}

export interface TrayUsage {
  tray: SpliceTray;
  /** Active splices and pigtails on this tray, with or without a position. */
  items: TrayItem[];
  used: number;
  /** Positions recorded for more than one item: a physical impossibility. */
  positionsTaken: TrayPositionTaken[];
}

export const spliceLabel = (s: Pick<SpliceRecord, 'inputCableName' | 'inputCableId' | 'inputCore' | 'outputCableName' | 'outputCableId' | 'outputCore'>): string =>
  `${s.inputCableName || s.inputCableId} fiber ${s.inputCore} → ${s.outputCableName || s.outputCableId} fiber ${s.outputCore}`;

export const terminationLabel = (t: Pick<FiberTermination, 'cableName' | 'cableId' | 'core'>): string => `pigtail on ${t.cableName || t.cableId} fiber ${t.core}`;

/** Active pigtails: not taken out, not entered by mistake. */
export const activeTerminations = (closure: Pick<JointClosure, 'terminations'>): FiberTermination[] => (closure.terminations ?? []).filter((t) => !t.retiredAt);

/** Everything on the trays of a closure, tray by tray, in the order the trays are recorded. */
export function trayUsage(closure: Pick<JointClosure, 'trays' | 'splices' | 'terminations'>): TrayUsage[] {
  const items: (TrayItem & { trayId: string })[] = [
    ...closure.splices
      .filter((s) => isSpliceActive(s) && s.trayId)
      .map((s) => ({ kind: 'splice' as const, id: s.id, trayId: s.trayId!, label: spliceLabel(s), ...(s.cassette ? { cassette: s.cassette } : {}), ...(s.position !== undefined ? { position: s.position } : {}) })),
    ...activeTerminations(closure)
      .filter((t) => t.trayId)
      .map((t) => ({ kind: 'pigtail' as const, id: t.id, trayId: t.trayId!, label: terminationLabel(t), ...(t.cassette ? { cassette: t.cassette } : {}), ...(t.position !== undefined ? { position: t.position } : {}) })),
  ];
  return (closure.trays ?? []).map((tray) => {
    const onTray = items.filter((i) => i.trayId === tray.id).map(({ trayId: _t, ...rest }) => rest);
    const byPlace = new Map<string, TrayPositionTaken>();
    for (const item of onTray) {
      if (item.position === undefined) continue;
      // Positions are per cassette. Two items with no cassette recorded share the tray's own positions.
      const key = `${item.cassette ?? ''}#${item.position}`;
      const place = byPlace.get(key) ?? { ...(item.cassette ? { cassette: item.cassette } : {}), position: item.position, items: [] };
      place.items.push(item);
      byPlace.set(key, place);
    }
    return { tray, items: onTray, used: onTray.length, positionsTaken: [...byPlace.values()].filter((p) => p.items.length > 1) };
  });
}

/** Tray positions already holding something, for the splice form: "taken" lists, never a guess at the next free one. */
export function takenPositions(closure: Pick<JointClosure, 'trays' | 'splices' | 'terminations'>, trayId: string, cassette?: string, exceptId?: string): number[] {
  const usage = trayUsage(closure).find((u) => u.tray.id === trayId);
  if (!usage) return [];
  return usage.items
    .filter((i) => i.id !== exceptId && i.position !== undefined && (i.cassette ?? '') === (cassette?.trim() ?? ''))
    .map((i) => i.position!)
    .sort((a, b) => a - b);
}

/**
 * Whether a splice runs against the sides recorded at the closure. 'input' when the OLT-side
 * cable is recorded as going out towards customers, 'output' when the customer-side cable is
 * recorded as coming in from the OLT. Undefined when it agrees or nothing is recorded ("through"
 * says nothing about direction). Cable drawing direction is never used: it is not a record of
 * which side is towards the OLT.
 */
export function spliceDirectionMismatch(closure: Pick<JointClosure, 'cableEntries'>, inputCableId: string, outputCableId: string): 'input' | 'output' | undefined {
  const role = (cableId: string) => (closure.cableEntries ?? []).find((e) => e.cableId === cableId)?.role;
  if (role(inputCableId) === 'out') return 'input';
  if (role(outputCableId) === 'in') return 'output';
  return undefined;
}
