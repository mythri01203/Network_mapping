import { type Cable, type ColorScheme, coreIdentity, type JointClosure, type SpliceStatus } from '@fibergis/shared';

/**
 * Phase 8: the splice picture of one closure, worked out from its records only. OLT-side fibers
 * on the left, customer-side fibers on the right, one line per splice. A fiber is filled with its
 * colour only when the cable's scheme is known; otherwise it is white with its number. The
 * splice's state is shown by the line's shape and a mark, never by colour alone. A pigtail is a
 * fiber on the left with a line to a connector box on the right.
 */

export const DIAGRAM_WIDTH = 360;
const ROW = 26;
const HEADER = 20;
const TOP = 8;
export const LEFT_DOT_X = 150;
export const RIGHT_DOT_X = 210;

/** How a line is drawn. Each has a mark and words in the key. */
export type LinkShape = 'solid' | 'tested' | 'planned' | 'broken' | 'unused';

export const LINK_SHAPE_WORDS: Record<LinkShape, string> = {
  solid: 'Solid line: spliced',
  tested: 'Line with ✓: spliced and tested',
  planned: 'Dashed line: planned, not done',
  broken: 'Line with ✕: failed or damaged',
  unused: 'Dotted line: not used',
};

export const shapeOfStatus = (status: SpliceStatus): LinkShape =>
  status === 'Tested' ? 'tested' : status === 'Pending' ? 'planned' : status === 'Failed' || status === 'Damaged' ? 'broken' : status === 'Unused' ? 'unused' : 'solid';

export interface DiagramFiber {
  key: string;
  cableId: string;
  core: number;
  /** "F3" or "T1/3", from the recorded layout. */
  shortLabel: string;
  /** Only when the cable's scheme is known. */
  colorHex?: string;
  colorName?: string;
  y: number;
}

export interface DiagramGroup {
  cableName: string;
  y: number;
}

export interface DiagramLink {
  id: string;
  kind: 'splice' | 'pigtail';
  fromY: number;
  toY: number;
  shape: LinkShape;
  /** Words for screen readers and the title tooltip. */
  label: string;
  /** For a pigtail: the connector type, or "?" when not recorded. */
  connector?: string;
}

export interface SpliceDiagram {
  width: number;
  height: number;
  left: DiagramFiber[];
  right: DiagramFiber[];
  leftGroups: DiagramGroup[];
  rightGroups: DiagramGroup[];
  /** Connector boxes on the right, one per pigtail. */
  connectors: { id: string; y: number; text: string }[];
  links: DiagramLink[];
  empty: boolean;
}

interface End {
  cableId: string;
  core: number;
}

/** Which tray to draw: 'all', 'none' (no tray recorded) or a tray id. */
export type TrayFilter = string;

const onTray = (trayId: string | undefined, filter: TrayFilter) => filter === 'all' || (filter === 'none' ? !trayId : trayId === filter);

export function layoutSpliceDiagram(closure: JointClosure, cables: readonly Cable[], schemes: readonly ColorScheme[], filter: TrayFilter = 'all'): SpliceDiagram {
  const splices = closure.splices.filter((s) => !s.retiredAt && onTray(s.trayId, filter));
  const pigtails = (closure.terminations ?? []).filter((t) => !t.retiredAt && onTray(t.trayId, filter));
  const cableById = new Map(cables.map((c) => [c.id, c]));
  const nameOf = (id: string, fallback?: string) => cableById.get(id)?.name ?? fallback ?? id;

  const column = (ends: End[], names: Map<string, string>) => {
    const unique = new Map<string, End>();
    for (const e of ends) unique.set(`${e.cableId}#${e.core}`, e);
    const byCable = new Map<string, End[]>();
    for (const e of unique.values()) byCable.set(e.cableId, [...(byCable.get(e.cableId) ?? []), e]);
    const order = [...byCable.keys()].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    const fibers: DiagramFiber[] = [];
    const groups: DiagramGroup[] = [];
    let y = TOP;
    for (const cableId of order) {
      groups.push({ cableName: names.get(cableId) ?? cableId, y: y + 12 });
      y += HEADER;
      for (const e of byCable.get(cableId)!.sort((a, b) => a.core - b.core)) {
        const cable = cableById.get(cableId);
        const identity = cable ? coreIdentity(cable, e.core, schemes) : undefined;
        fibers.push({
          key: `${cableId}#${e.core}`,
          cableId,
          core: e.core,
          shortLabel: identity?.shortLabel ?? `F${e.core}`,
          ...(identity?.fiberColor ? { colorHex: identity.fiberColor.hex, colorName: identity.fiberColor.name } : {}),
          y: y + ROW / 2,
        });
        y += ROW;
      }
    }
    return { fibers, groups, bottom: y };
  };

  const names = new Map<string, string>();
  for (const s of splices) {
    names.set(s.inputCableId, nameOf(s.inputCableId, s.inputCableName));
    names.set(s.outputCableId, nameOf(s.outputCableId, s.outputCableName));
  }
  for (const t of pigtails) names.set(t.cableId, nameOf(t.cableId, t.cableName));

  const left = column(
    [...splices.map((s) => ({ cableId: s.inputCableId, core: s.inputCore })), ...pigtails.map((t) => ({ cableId: t.cableId, core: t.core }))],
    names,
  );
  const right = column(splices.map((s) => ({ cableId: s.outputCableId, core: s.outputCore })), names);
  const yOf = (fibers: DiagramFiber[], cableId: string, core: number) => fibers.find((f) => f.key === `${cableId}#${core}`)?.y ?? 0;

  let connectorY = right.bottom + (pigtails.length && splices.length ? HEADER : 0);
  const connectors: SpliceDiagram['connectors'] = [];
  const links: DiagramLink[] = splices.map((s) => ({
    id: s.id,
    kind: 'splice',
    fromY: yOf(left.fibers, s.inputCableId, s.inputCore),
    toY: yOf(right.fibers, s.outputCableId, s.outputCore),
    shape: shapeOfStatus(s.status),
    label: `${names.get(s.inputCableId)} fiber ${s.inputCore} to ${names.get(s.outputCableId)} fiber ${s.outputCore}: ${s.status}`,
  }));
  for (const t of pigtails) {
    const y = connectorY + ROW / 2;
    connectorY += ROW;
    const text = `${t.connectorType ?? 'Connector ?'}${t.pigtailLabel ? ` ${t.pigtailLabel}` : ''}`;
    connectors.push({ id: t.id, y, text });
    links.push({
      id: t.id,
      kind: 'pigtail',
      fromY: yOf(left.fibers, t.cableId, t.core),
      toY: y,
      shape: 'solid',
      connector: t.connectorType ?? '?',
      label: `${names.get(t.cableId)} fiber ${t.core} ends on a pigtail, ${t.connectorType ?? 'connector not recorded'}`,
    });
  }
  const height = Math.max(left.bottom, connectorY, right.bottom) + TOP;
  return {
    width: DIAGRAM_WIDTH,
    height,
    left: left.fibers,
    right: right.fibers,
    leftGroups: left.groups,
    rightGroups: right.groups,
    connectors,
    links,
    empty: links.length === 0,
  };
}
