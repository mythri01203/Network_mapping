import type { Equipment, EquipmentPort, OltConfig } from '../model/types';

export interface StandardPortColor {
  number: number;
  name: string;
  hex: string;
}

export const STANDARD_PORT_COLORS: StandardPortColor[] = [
  { number: 1, name: 'Blue', hex: '#0284c7' },
  { number: 2, name: 'Orange', hex: '#ea580c' },
  { number: 3, name: 'Green', hex: '#16a34a' },
  { number: 4, name: 'Brown', hex: '#78350f' },
  { number: 5, name: 'Slate', hex: '#64748b' },
  { number: 6, name: 'White', hex: '#f8fafc' },
  { number: 7, name: 'Red', hex: '#dc2626' },
  { number: 8, name: 'Black', hex: '#1e293b' },
  { number: 9, name: 'Yellow', hex: '#eab308' },
  { number: 10, name: 'Violet', hex: '#7c3aed' },
  { number: 11, name: 'Pink', hex: '#e11d48' },
  { number: 12, name: 'Aqua', hex: '#06b6d4' },
];

export interface OltDescriptionParams {
  name: string;
  id?: string;
  technology: 'EPON' | 'GPON';
  manufacturer?: string;
  model?: string;
  area?: string;
  street?: string;
  totalPorts: number;
  portColorMap?: Record<string, string>;
  splitters?: Array<{
    id: string;
    ratio: string;
    inPort: string;
    outPortsCount?: number;
    parentPonPort?: string;
  }>;
  cables?: Array<{
    id: string;
    name?: string;
    type?: string;
    coreCount?: number;
    colorHex?: string;
    ponPort?: string;
    lengthMeters?: number;
  }>;
}

/**
 * Generates the standardized dynamic OLT description according to Module 6 specifications.
 * Synthesizes OLT Name, Technology, Manufacturer, Model, Port Config, Port Colors, Splitter Config, and Cable Config.
 */
export function generateOltDescription(params: OltDescriptionParams): string {
  const lines: string[] = [];

  lines.push(`OLT Name: ${params.name || 'Unnamed OLT'}`);
  if (params.id) {
    lines.push(`OLT ID: ${params.id}`);
  }
  lines.push(`Technology: ${params.technology}`);
  lines.push(`Manufacturer: ${params.manufacturer || 'Syrotech'}`);
  lines.push(`Model: ${params.model || `${params.technology} ${params.totalPorts}-Port OLT`}`);

  if (params.area || params.street) {
    const loc = [params.street, params.area].filter(Boolean).join(', ');
    lines.push(`Location: ${loc}`);
  }

  lines.push('');
  lines.push('Port Configuration:');
  lines.push(`- Total PON Ports: ${params.totalPorts}`);
  lines.push(`- Port Type: ${params.technology}`);
  const lastPad = String(params.totalPorts).padStart(2, '0');
  lines.push(`- Port Numbers: PON-01 to PON-${lastPad}`);

  if (params.portColorMap && Object.keys(params.portColorMap).length > 0) {
    lines.push('');
    lines.push('Port Color Configuration:');
    const sortedPortKeys = Object.keys(params.portColorMap).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '') || '0', 10);
      const numB = parseInt(b.replace(/\D/g, '') || '0', 10);
      return numA - numB;
    });

    for (const key of sortedPortKeys) {
      lines.push(`- ${key}: ${params.portColorMap[key]}`);
    }
  }

  if (params.splitters && params.splitters.length > 0) {
    lines.push('');
    lines.push('Splitter Configuration:');
    for (const spl of params.splitters) {
      lines.push(`- Splitter ID: ${spl.id}`);
      lines.push(`  Split Ratio: ${spl.ratio}`);
      lines.push(`  Input Port: ${spl.inPort}${spl.parentPonPort ? ` (Fed by ${spl.parentPonPort})` : ''}`);
      lines.push(`  Output Ports: ${spl.outPortsCount || spl.ratio.split(':')[1] || '8'}`);
    }
  }

  if (params.cables && params.cables.length > 0) {
    lines.push('');
    lines.push('Cable Configuration:');
    for (const c of params.cables) {
      lines.push(`- Cable ID: ${c.id}`);
      if (c.name) lines.push(`  Cable Name: ${c.name}`);
      lines.push(`  Cable Type: ${c.type || 'Single Mode Feeder Fiber'}`);
      if (c.coreCount) lines.push(`  Fiber Cores: ${c.coreCount}`);
      if (c.colorHex) lines.push(`  Cable Color: ${c.colorHex}`);
      if (c.ponPort) lines.push(`  Origin PON: ${c.ponPort}`);
      if (c.lengthMeters) lines.push(`  Length: ${c.lengthMeters.toFixed(1)} m`);
    }
  }

  return lines.join('\n');
}

/**
 * Automatically builds logical PON ports for an OLT based on port count and color coding.
 */
export function buildOltLogicalPorts(
  oltId: string,
  totalPorts: number,
  technology: 'EPON' | 'GPON',
  portColorMap: Record<string, string> = {},
): EquipmentPort[] {
  return Array.from({ length: totalPorts }, (_, i) => {
    const num = i + 1;
    const pad = String(num).padStart(2, '0');
    const portCode = `PON-${pad}`;
    const color = portColorMap[portCode] || STANDARD_PORT_COLORS[i % STANDARD_PORT_COLORS.length].name;

    return {
      id: `${oltId}-${portCode}`,
      portNumber: num,
      portType: 'PON',
      slotCardPort: portCode,
      technology,
      color,
      status: 'Available',
      remarks: `${technology} optical PON port ${num}`,
    };
  });
}

/**
 * Validates OLT configuration rules according to Module 10 specifications:
 * - Technology must be EPON or GPON
 * - Total ports must be positive
 * - Port names must be unique
 */
export function validateOltConfig(olt: Partial<Equipment> & { oltConfig?: Partial<OltConfig> }): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const tech = olt.oltConfig?.technology || olt.technology;
  if (!tech || (tech !== 'GPON' && tech !== 'EPON')) {
    errors.push('An OLT must have a valid technology selected (EPON or GPON).');
  }

  const portCount = olt.oltConfig?.ponPortCount || olt.totalPorts || 0;
  if (portCount <= 0) {
    errors.push('OLT must have at least 1 PON port configured.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
