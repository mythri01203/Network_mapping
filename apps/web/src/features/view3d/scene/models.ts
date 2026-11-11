import { isPoleType, STANDARD_12_COLORS } from '@fibergis/shared';

import type { BoxModel, ColorChip } from './types';

/**
 * Which 3D model draws each equipment type of the Equipment Toolbox. A type a person typed in
 * (a custom catalogue item) falls back to a labelled generic box, so every record is drawn.
 */

/** Types drawn inside a central-office rack. */
export const RACK_TYPES = new Set([
  'OLT',
  'ODF',
  'Fiber Patch Panel',
  'Core Switch',
  'Router',
  'MikroTik Router',
  'Firewall',
  'Optical Transmitter',
  'Headend Equipment',
  'Cable TV Headend',
]);

export const SWITCH_TYPES = new Set(['Core Switch', 'Router', 'MikroTik Router', 'Firewall']);

const BOX_MODELS: Record<string, BoxModel> = {
  FDT: 'closure',
  'Fiber Joint Closure': 'closure',
  'Splice Closure': 'closure',
  'Fiber Splice Joint': 'closure',
  'Fiber Splitter': 'closure',
  'Outdoor Splitter': 'closure',
  'Ratio Coupler': 'closure',
  'Fiber Connector': 'closure',
  'Optical Attenuator': 'closure',
  'Distribution Point': 'closure',
  FAT: 'fat',
  'Fiber Terminal Box': 'fat',
  'Pole-Mounted Terminal Box': 'fat',
  'Wall-Mounted Terminal Box': 'fat',
  'Underground Terminal Box': 'fat',
  FDMS: 'cabinet',
  'Fiber Distribution Cabinet': 'cabinet',
  Manhole: 'manhole',
  Handhole: 'manhole',
  'Underground Chamber': 'manhole',
  'Fiber Slack Loop': 'slack',
  ONT: 'ont',
  ONU: 'ont',
  'Wi-Fi Router': 'ont',
  'Optical Modem': 'ont',
  'Customer Terminal': 'ont',
  'Set-Top Box': 'ont',
  'Optical Instrument': 'ont',
  'CATV Optical Node': 'catv_node',
  'CATV RF Amplifier': 'catv_amp',
  'CATV Tap-Off Box': 'catv_tap',
  'Building Entry Point': 'entry',
  'Junction Point': 'entry',
  Duct: 'marker',
  Microduct: 'marker',
  'Cable Tray': 'marker',
};

export type EquipmentDrawing =
  { kind: 'rack' } | { kind: 'pole'; electric: boolean } | { kind: 'box'; model: BoxModel };

export function drawingFor(type: string): EquipmentDrawing {
  if (RACK_TYPES.has(type)) return { kind: 'rack' };
  if (isPoleType(type) || type === 'Telecom Pole' || type === 'Electric Pole')
    return { kind: 'pole', electric: type === 'Electric Pole' };
  return { kind: 'box', model: BOX_MODELS[type] ?? 'generic' };
}

/** Every built-in toolbox type and its model, for the docs table and the tests. */
export const MODEL_TABLE: readonly { type: string; drawing: string }[] = [
  ...[...RACK_TYPES].map((type) => ({
    type,
    drawing: SWITCH_TYPES.has(type)
      ? 'rack: switch/router'
      : type === 'OLT'
        ? 'rack: OLT chassis'
        : type === 'ODF' || type === 'Fiber Patch Panel'
          ? 'rack: ODF panel'
          : 'rack: 2U unit',
  })),
  { type: 'Telecom Pole', drawing: 'pole' },
  { type: 'Electric Pole', drawing: 'pole + crossarm + power lines' },
  ...Object.entries(BOX_MODELS).map(([type, model]) => ({ type, drawing: model })),
];

/** TIA-598 order, as chips with names. Never shown as colour alone. */
export const TIA598: readonly ColorChip[] = STANDARD_12_COLORS.map((c) => ({ name: c.name, hex: c.hex }));

/** The colour code of port `n` (1-based) of a box: TIA-598 order, starting again after 12. */
export const portColorCode = (n: number): ColorChip => TIA598[(((n - 1) % 12) + 12) % 12];

/** Role colours from the legend: OS2 feeder yellow, OM3 uplink aqua, Cat6 blue. */
export const ROLE_COLORS = {
  feeder: '#f2c500',
  branch: '#f2c500',
  uplink: '#10b5c4',
  cat6: '#1f5fff',
  other: '#9aa4ae',
} as const;
