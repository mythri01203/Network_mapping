/** One entry of the TIA-598 12-colour fibre identification code. */
export interface FiberColorDef {
  number: number;
  name: string;
  hex: string;
  textColor: string;
}

export const STANDARD_12_COLORS: readonly FiberColorDef[] = [
  { number: 1, name: 'Blue', hex: '#0284c7', textColor: '#ffffff' },
  { number: 2, name: 'Orange', hex: '#ea580c', textColor: '#ffffff' },
  { number: 3, name: 'Green', hex: '#16a34a', textColor: '#ffffff' },
  { number: 4, name: 'Brown', hex: '#78350f', textColor: '#ffffff' },
  { number: 5, name: 'Slate', hex: '#64748b', textColor: '#ffffff' },
  { number: 6, name: 'White', hex: '#f8fafc', textColor: '#1e293b' },
  { number: 7, name: 'Red', hex: '#dc2626', textColor: '#ffffff' },
  { number: 8, name: 'Black', hex: '#1e293b', textColor: '#ffffff' },
  { number: 9, name: 'Yellow', hex: '#eab308', textColor: '#1e293b' },
  { number: 10, name: 'Violet', hex: '#8b5cf6', textColor: '#ffffff' },
  { number: 11, name: 'Rose', hex: '#f43f5e', textColor: '#ffffff' },
  { number: 12, name: 'Aqua', hex: '#06b6d4', textColor: '#ffffff' },
];

/** Colour of a core within its 12-fibre tube (cores are 1-based). */
export function getFiberColor(coreNumber: number): FiberColorDef {
  const index = (coreNumber - 1) % 12;
  return STANDARD_12_COLORS[index];
}

/** 1-based buffer tube that holds a core, assuming 12 fibres per tube. */
export function getTubeNumber(coreNumber: number): number {
  return Math.floor((coreNumber - 1) / 12) + 1;
}

export function getTubeColor(tubeNumber: number): FiberColorDef {
  const index = (tubeNumber - 1) % 12;
  return STANDARD_12_COLORS[index];
}
