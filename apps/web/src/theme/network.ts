import type { CableType } from '@fibergis/shared';

export interface CableStyle {
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
}

/**
 * Single source of truth for how each cable class is drawn. Map polylines, legends, chips and
 * toolbar swatches all derive from this table so they can never disagree.
 */
export const CABLE_STYLES: Record<CableType, CableStyle> = {
  'Main Feeder Fiber': { stroke: '#1d4ed8', strokeWidth: 5 },
  'Distribution Fiber': { stroke: '#0891b2', strokeWidth: 4 },
  'Drop Fiber': { stroke: '#d97706', strokeWidth: 2.5 },
  'Aerial Fiber': { stroke: '#16a34a', strokeWidth: 3.5, dashArray: '6, 4' },
  'Underground Fiber': { stroke: '#9333ea', strokeWidth: 4, dashArray: '8, 5' },
  'Coaxial Cable': { stroke: '#ea580c', strokeWidth: 3.5 },
  'Custom Cable': { stroke: '#475569', strokeWidth: 3 },
};

export function cableStyle(type: string | undefined | null): CableStyle {
  return (type && CABLE_STYLES[type as CableType]) || CABLE_STYLES['Custom Cable'];
}

export function cableColor(type: string | undefined | null): string {
  return cableStyle(type).stroke;
}
