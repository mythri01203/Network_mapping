export interface FiberColorDef {
  number: number;
  name: string;
  hex: string;
  textColor: string;
}

export const STANDARD_12_COLORS: FiberColorDef[] = [
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

export function getFiberColor(coreNumber: number): FiberColorDef {
  const index = (coreNumber - 1) % 12;
  return STANDARD_12_COLORS[index];
}

export function getTubeNumber(coreNumber: number): number {
  return Math.floor((coreNumber - 1) / 12) + 1;
}

export function getTubeColor(tubeNumber: number): FiberColorDef {
  const index = (tubeNumber - 1) % 12;
  return STANDARD_12_COLORS[index];
}

export const CORE_STATUS_COLORS = {
  Available: {
    bg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500',
    border: '#10b981',
    hex: '#10b981',
    label: 'Available',
  },
  'In Use': {
    bg: 'bg-blue-100 text-blue-800 border-blue-300',
    dot: 'bg-blue-600',
    border: '#2563eb',
    hex: '#2563eb',
    label: 'In Use',
  },
  Reserved: {
    bg: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
    border: '#f59e0b',
    hex: '#f59e0b',
    label: 'Reserved',
  },
  Damaged: {
    bg: 'bg-rose-100 text-rose-800 border-rose-300',
    dot: 'bg-rose-600',
    border: '#e11d48',
    hex: '#e11d48',
    label: 'Damaged',
  },
  'Under Maintenance': {
    bg: 'bg-purple-100 text-purple-800 border-purple-300',
    dot: 'bg-purple-600',
    border: '#9333ea',
    hex: '#9333ea',
    label: 'Under Maintenance',
  },
  Unverified: {
    bg: 'bg-slate-100 text-slate-700 border-slate-300',
    dot: 'bg-slate-400',
    border: '#94a3b8',
    hex: '#94a3b8',
    label: 'Unverified',
  },
};

export const CABLE_TYPE_COLORS: Record<string, { stroke: string; strokeWidth: number; dashArray?: string }> = {
  'Main Feeder Fiber': { stroke: '#1d4ed8', strokeWidth: 5 }, // Strong Royal Blue
  'Distribution Fiber': { stroke: '#0891b2', strokeWidth: 4 }, // Cyan/Teal
  'Drop Fiber': { stroke: '#d97706', strokeWidth: 2.5 }, // Amber / Gold
  'Aerial Fiber': { stroke: '#16a34a', strokeWidth: 3.5, dashArray: '6, 4' }, // Dashed Green
  'Underground Fiber': { stroke: '#9333ea', strokeWidth: 4, dashArray: '8, 5' }, // Dashed Purple
  'Coaxial Cable': { stroke: '#ea580c', strokeWidth: 3.5 }, // Orange
  'Custom Cable': { stroke: '#475569', strokeWidth: 3 },
};
